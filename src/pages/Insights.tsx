import { readApiError, describeApiError, type ApiErrorCopy } from '@/lib/apiErrors'
import { CHAT_CREDIT_COST, DEFAULT_RATE_LIMIT_SECONDS, ChatRequestError, chatRequestErrorFrom, chatFailureFrom, chatFailureFromStreamEvent, chatFailureCopy, savedChatFailureNotice, type ChatFailure, type ChatFailureKind } from '@/lib/chatFailure'
import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  memo,
  type ComponentType,
  type FormEvent,
  type ReactNode,
} from 'react'
import {
  Sparkles,
  AlertTriangle,
  RefreshCw,
  Clock,
  Upload,
  Send,
  Square,
  Database,
  MapPin,
  BarChart3,
  Plus,
  Archive,
  Trash2,
  Edit3,
} from 'lucide-react'
import { Link } from 'react-router'
import { AppLayout } from '@/components/layout/AppLayout'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import api, { authenticatedFetch } from '@/lib/api'
import { publishGuavaCredits, type GuavaCreditSnapshot } from '@/lib/creditEvents'
import { secureRandomId } from '@/lib/idempotency'
import { resolveRefreshOutcome, insightRefreshErrorNotice, INSIGHT_WINDOW_COPY, type InsightCacheStatus } from '@/lib/insightRefresh'
import { cn } from '@/lib/utils'
import { getInsightChatStorageKeys, readScopedStorage, writeScopedStorage } from '@/lib/chatStorage'
import { CHAT_MESSAGE_MAX_CHARS, trailingChatWindow } from '@/lib/chatWindow'
import { useAuth } from '@/hooks/useAuth'
import guavaIcon from '@/assets/guava-icon.png'
interface Insight {
  id: string
  text: string
  generatedAt: string | null
}

interface InsightReadResponse {
  success: boolean
  insights: string[]
  generatedAt: string | null
  requiresRefresh: boolean
  cacheStatus: InsightCacheStatus
}

interface InsightRefreshResponse extends Omit<InsightReadResponse, 'cacheStatus'> {
  cacheStatus?: InsightCacheStatus
  insufficientData?: boolean
  guavaCredits?: GuavaCreditSnapshot
  aiCredits?: GuavaCreditSnapshot
  meta?: { replayed?: boolean; coalesced?: boolean }
}

// Every Ask Guava answer is a metered spend, so a failed turn has to say which
// kind of failure it was. The backend already separates these: 402 out of
// credits, 403 CREDIT_SPEND_FORBIDDEN, 429 AI_RATE_LIMITED. Collapsing them
// into one "try again" told an owner with no credits to do the one thing that
// cannot work.
interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  slow?: boolean
  pending?: boolean
  failure?: ChatFailure
}

interface ChatContextStats {
  transactionCount: number
  locations: number
  topItems: number
  forecasts: number
  contextWindow?: string
}

interface InsightChat {
  _id: string
  title: string
  messages: ChatMessage[]
  contextStats?: ChatContextStats | null
  archived: boolean
  updatedAt: string
  createdAt: string
}

interface AssistantTypingState {
  target: string
  displayed: string
  finishing: boolean
  rafId: number | null
  lastFrameAt: number | null
}

const EMPTY_ANSWER = 'I could not generate an answer.'
// Only a failure that could plausibly succeed on a second attempt earns the
// non-streaming fallback, because that fallback is a second billable request.
const STILL_WORKING_AFTER_MS = 8_000
const STREAM_IDLE_TIMEOUT_MS = 45_000

const RECOVERABLE_FAILURES = new Set<ChatFailureKind>(['offline', 'transient'])

const QUICK_PROMPTS = [
  'What should I prepare more of tomorrow?',
  'Which items are underperforming and why?',
  'Where are my busiest trading windows?',
  'What changed in the last 30 days?',
]

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: 'Ask me about your sales, items, forecasts, trading hours, locations, or recent transaction patterns.',
}

function withMessageIds(chat: Omit<InsightChat, 'messages'> & { messages?: Array<Partial<ChatMessage>> }): InsightChat {
  return {
    ...chat,
    messages: (chat.messages || [])
      .filter((message) =>
        message &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string'
      )
      .map((message, index) => ({
        id: message.id || `${chat._id}-${index}`,
        role: message.role as 'user' | 'assistant',
        content: message.content || '',
        pending: false,
      })),
  }
}

function messagesForApi(messages: ChatMessage[]) {
  return messages
    .filter((message) => message.id !== 'welcome' && message.content.trim())
    .map(({ role, content }) => ({ role, content }))
}

function titleFromMessages(messages: ChatMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === 'user')?.content || ''
  const normalized = firstUserMessage.replace(/\s+/g, ' ').trim()
  return normalized ? normalized.slice(0, 60) : 'New chat'
}

function sortChats(chats: InsightChat[]) {
  return chats
    .slice()
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

function mergeChats(primary: InsightChat[], fallback: InsightChat[]) {
  const byId = new Map<string, InsightChat>()
  fallback.forEach((chat) => byId.set(chat._id, chat))
  primary.forEach((chat) => {
    const cached = byId.get(chat._id)
    byId.set(chat._id, {
      ...cached,
      ...chat,
      messages: chat.messages.length > 0 ? chat.messages : cached?.messages || [],
    })
  })
  return sortChats(Array.from(byId.values()))
}

function loadLocalChatList(storageKey?: string, scopeId?: string) {
  if (!storageKey || !scopeId) return []
  const stored = readScopedStorage<{ chats?: InsightChat[] }>(storageKey, scopeId)
  if (!Array.isArray(stored?.chats)) return []
  return stored.chats.map(withMessageIds)
}

function loadCurrentChat(storageKey?: string, scopeId?: string) {
  if (!storageKey || !scopeId) return null
  return readScopedStorage<{
    activeChatId?: string | null
    messages?: ChatMessage[]
    contextStats?: ChatContextStats | null
  }>(storageKey, scopeId)
}

function isLocalChat(chatId: string | null) {
  return Boolean(chatId?.startsWith('local-'))
}

function createLocalChat(messages: ChatMessage[], stats: ChatContextStats | null = null): InsightChat {
  const now = new Date().toISOString()
  const id = `local-${Date.now()}`
  return {
    _id: id,
    title: titleFromMessages(messages),
    messages: messages.filter((message) => message.id !== 'welcome').map((message, index) => ({
      ...message,
      id: message.id || `${id}-${index}`,
      pending: false,
    })),
    contextStats: stats,
    archived: false,
    createdAt: now,
    updatedAt: now,
  }
}

function timeAgo(isoDate: string) {
  const diff = Math.floor((Date.now() - new Date(isoDate).getTime()) / 60000)
  if (diff < 1) return 'just now'
  if (diff < 60) return `${diff} minute${diff === 1 ? '' : 's'} ago`
  const hours = Math.floor(diff / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  // Past a week "504 hours ago" is unreadable, and the chat list is the only
  // way to find an older thread by when it happened.
  return new Date(isoDate).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Johannesburg',
  })
}

function createInsightRefreshKey() {
  const entropy = secureRandomId()
  return `insight-refresh-${Date.now()}-${entropy}`.slice(0, 160)
}

function createChatRequestKey() {
  const entropy = secureRandomId()
  return `ask-guava-${Date.now()}-${entropy}`.slice(0, 160)
}

// The old badge claimed a meaning ("Watch", "Tip") derived from nothing but the
// insight's position in the array, so a growth insight in slot 2 was presented
// as a warning. The model does not return a category, so none is shown.
function InsightCard({ insight, index }: { insight: Insight; index: number }) {
  return (
    <div
      className="border-b border-[#242424] last:border-0 py-4"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-guava-green/10">
          <Sparkles className="h-4 w-4 text-guava-green" />
        </div>
        <p className="min-w-0 text-[#D0D0D0] text-sm leading-relaxed">{insight.text}</p>
      </div>
    </div>
  )
}

function InsightSkeleton() {
  return (
    <div className="py-4 border-b border-[#242424] last:border-0 flex gap-3">
      <Skeleton className="w-8 h-8 rounded-lg shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-16 rounded-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </div>
  )
}

function Stat({ icon: Icon, label, value }: {
  icon: ComponentType<{ className?: string }>
  label: string
  value: string | number
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <Icon className="w-3.5 h-3.5 text-muted" />
      <span className="text-muted">{label}</span>
      <span className="text-text font-semibold tabular-nums">{value}</span>
    </div>
  )
}

function renderInlineMarkdown(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} className="font-semibold text-text">{part.slice(2, -2)}</strong>
    }
    return part
  })
}

function isMarkdownTableSeparator(line: string) {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim())
}

function renderMarkdownTableRow(line: string, index: number, isHeader: boolean) {
  // Drop only the empty strings the leading and trailing pipes produce. A
  // blanket filter(Boolean) also removed genuine blank cells, which shifted
  // every value after the gap one column left — a revenue figure landing under
  // "Quantity" with nothing to show it had moved.
  const cells = line.split('|').map((cell) => cell.trim())
  if (cells[0] === '') cells.shift()
  if (cells[cells.length - 1] === '') cells.pop()
  if (cells.length < 2) return null

  return (
    <div
      key={index}
      className={cn(
        'grid overflow-hidden border-x border-b border-border first:rounded-t-lg last:rounded-b-lg',
        isHeader && 'border-t bg-[#202020] text-text'
      )}
      style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}
    >
      {cells.map((cell, cellIndex) => (
        <div
          key={`${index}-${cellIndex}`}
          className={cn(
            'px-3 py-2 text-xs border-r border-border last:border-r-0',
            isHeader ? 'font-semibold text-text' : 'text-[#D8D8D8]'
          )}
        >
          {renderInlineMarkdown(cell)}
        </div>
      ))}
    </div>
  )
}

// Memoised, and the line split memoised inside it: the typewriter re-renders
// Insights on every animation frame, and without this every completed answer in
// the transcript was re-split and re-regexed 60 times a second while a new
// answer streamed.
const MarkdownLite = memo(function MarkdownLite({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const lines = useMemo(() => text.split('\n'), [text])
  return (
    <div className="space-y-3 text-[15px] leading-7 text-[#E4E4E4]">
      {lines.map((rawLine, index) => {
        const line = rawLine.trim()
        const isFirstContent = lines.slice(0, index).every((previousLine) => !previousLine.trim())
        const headingMargin = isFirstContent ? '' : 'mt-4'
        if (!line) return <div key={index} className="h-1" />
        if (isMarkdownTableSeparator(line)) return null
        if (line.startsWith('|') && line.endsWith('|')) {
          return renderMarkdownTableRow(line, index, isMarkdownTableSeparator(lines[index + 1] || ''))
        }
        if (line.startsWith('### ')) {
          return (
            <h4 key={index} className={cn('text-text text-sm font-semibold', headingMargin)}>
              {renderInlineMarkdown(line.slice(4))}
            </h4>
          )
        }
        if (line.startsWith('## ')) {
          return (
            <h3 key={index} className={cn('text-text text-base font-semibold', headingMargin)}>
              {renderInlineMarkdown(line.slice(3))}
            </h3>
          )
        }
        if (line.startsWith('# ')) {
          return (
            <h2 key={index} className={cn('text-text text-lg font-semibold', headingMargin)}>
              {renderInlineMarkdown(line.slice(2))}
            </h2>
          )
        }
        if (/^[-*]\s+/.test(line)) {
          return (
            <div key={index} className="flex gap-2.5">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-guava-red" />
              <p>{renderInlineMarkdown(line.replace(/^[-*]\s+/, ''))}</p>
            </div>
          )
        }
        if (/^\d+\.\s+/.test(line)) {
          const [num] = line.split('.')
          return (
            <div key={index} className="flex gap-2">
              <span className="text-muted tabular-nums">{num}.</span>
              <p>{renderInlineMarkdown(line.replace(/^\d+\.\s+/, ''))}</p>
            </div>
          )
        }
        return <p key={index}>{renderInlineMarkdown(line)}</p>
      })}
      {streaming && <span className="inline-block h-4 w-0.5 rounded bg-guava-green/80 animate-pulse align-middle ml-1" />}
    </div>
  )
})

function ThinkingIndicator({ slow }: { slow?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 text-sm text-muted">
      <Sparkles className="h-4 w-4 animate-pulse text-guava-green" />
      <span>Reading your cafe data...{slow && <span className="mt-1 block text-xs">Still working. Answers that read a lot of history can take up to a minute; you can stop at any time.</span>}</span>
    </div>
  )
}

function ChatFailureNotice({ failure, onRetry }: { failure: ChatFailure; onRetry: () => void }) {
  const copy = chatFailureCopy(failure)

  // A stopped answer is a choice the user made, not an error to alarm them with.
  if (failure.kind === 'cancelled') {
    return <div role="status" className="mt-3 space-y-2 text-xs text-text">
      <p>{copy.detail}</p>
      {copy.action?.kind === 'retry' && (
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>{copy.action.label}</Button>
      )}
    </div>
  }

  return (
    <div className="mt-4 max-w-2xl rounded-lg border border-red-900/30 bg-red-900/10 px-3.5 py-3 text-sm text-red-400">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 space-y-1">
          <p className="font-semibold">{copy.title}</p>
          <p className={cn("leading-relaxed", failure.charged && "text-text")}>{copy.detail}</p>
          {copy.action?.kind === 'link' && (
            <div className="pt-2">
              <Button asChild variant="secondary" size="sm">
                <Link to={copy.action.to}>{copy.action.label}</Link>
              </Button>
            </div>
          )}
          {copy.action?.kind === 'retry' && (
            <div className="pt-2">
              <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
                {copy.action.label}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const MessageRow = memo(function MessageRow({
  message,
  onMessageRef,
  onRetry,
}: {
  message: ChatMessage
  onMessageRef: (messageId: string, node: HTMLDivElement | null) => void
  onRetry: (assistantId: string) => void
}) {
  const messageId = message.id
  const setNode = useCallback(
    (node: HTMLDivElement | null) => onMessageRef(messageId, node),
    [messageId, onMessageRef]
  )
  const retry = useCallback(() => onRetry(messageId), [messageId, onRetry])

  if (message.role === 'assistant') {
    // Emptiness is not the same as thinking. A done event with no delta left the
    // old falsy check showing "Thinking..." forever, with no cursor and nothing
    // else coming, while the server had already saved a different string.
    const isThinking = Boolean(message.pending) && !message.content
    return (
      <div ref={setNode} data-message-role="assistant" className="py-5 sm:py-6">
        <div className="max-w-3xl">
          {isThinking ? (
            <ThinkingIndicator slow={message.slow} />
          ) : (
            message.content && <MarkdownLite text={message.content} streaming={message.pending} />
          )}
          {message.failure && <ChatFailureNotice failure={message.failure} onRetry={retry} />}
        </div>
      </div>
    )
  }

  return (
    <div ref={setNode} data-message-role="user" className="flex justify-end py-4">
      <div className="max-w-[88%] rounded-2xl rounded-tr-md bg-guava-green-strong px-4 py-3 text-white shadow-lg shadow-black/15 sm:max-w-[72%]">
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
      </div>
    </div>
  )
})

const ChatComposer = memo(function ChatComposer({
  input,
  setInput,
  sendPrompt,
  onStop,
  isChatLoading,
  cooldownSeconds,
  creditsRemaining,
  floating = false,
}: {
  input: string
  setInput: (value: string) => void
  sendPrompt: (prompt: string) => void
  onStop: () => void
  isChatLoading: boolean
  cooldownSeconds: number
  creditsRemaining: number | null
  floating?: boolean
}) {
  const isCoolingDown = cooldownSeconds > 0

  return (
    <div
      className={cn(
        'mx-auto w-full max-w-215',
        floating && 'absolute bottom-5 left-1/2 z-20 w-[calc(100%-2rem)] -translate-x-1/2'
      )}
    >
      <form
        className={cn(
          'rounded-2xl border border-[#303030] bg-[#151515]/95 shadow-2xl shadow-black/30 backdrop-blur',
          // The textarea clears its own outline, so focus has to be visible on
          // the shell that surrounds it or a keyboard user cannot see where
          // they are in the composer.
          'p-3 transition-all focus-within:border-guava-green focus-within:ring-2 focus-within:ring-guava-green/40',
          floating ? 'min-h-28' : 'min-h-37.5'
        )}
        onSubmit={(event) => {
          event.preventDefault()
          sendPrompt(input)
        }}
      >
        <textarea
          value={input} maxLength={CHAT_MESSAGE_MAX_CHARS}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              sendPrompt(input)
            }
          }}
          rows={floating ? 2 : 3}
          aria-label="Ask a question about your cafe data"
          placeholder={floating ? 'Write a message...' : 'How can I help with your cafe today?'}
          className={cn(
            'w-full resize-none border-0 bg-transparent px-2 py-2 text-text placeholder:text-[#9E9E9E]',
            'focus-visible:outline-none',
            floating ? 'min-h-12 text-sm' : 'min-h-20 text-base'
          )}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-1">
          <span className="text-xs text-[#9E9E9E]">
            {CHAT_CREDIT_COST} credits per answer
            {creditsRemaining != null ? ` · ${creditsRemaining} remaining` : ''}
          </span>
          {isChatLoading ? (
            <Button type="button" variant="secondary" size="sm" onClick={onStop} aria-label="Stop generating">
              <Square className="h-3.5 w-3.5" />
              Stop
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || isCoolingDown}
              aria-label={
                isCoolingDown
                  ? `Rate limited, you can send again in ${cooldownSeconds} seconds`
                  : 'Send message'
              }
            >
              <Send className="w-4 h-4" />
            </Button>
          )}
        </div>
      </form>
      {floating && (
        <p className="mt-2 text-center text-xs text-muted">
          AI can make mistakes. Check important decisions against your source data.
        </p>
      )}
    </div>
  )
})

function ChatHistoryPanel({
  chats,
  activeChatId,
  isLoading,
  isBusy,
  hasMore,
  notice,
  onNewChat,
  onLoadMore,
  onSelectChat,
  onRenameChat,
  onArchiveChat,
  onDeleteChat,
}: {
  chats: InsightChat[]
  activeChatId: string | null
  isLoading: boolean
  isBusy: boolean
  hasMore: boolean
  notice: string | null
  onNewChat: () => void
  onLoadMore: () => void | Promise<void>
  onSelectChat: (chat: InsightChat) => void | Promise<void>
  onRenameChat: (chat: InsightChat) => void
  onArchiveChat: (chat: InsightChat, archived: boolean) => void
  onDeleteChat: (chat: InsightChat) => void
}) {
  const activeChats = chats.filter((chat) => !chat.archived)
  const archivedChats = chats.filter((chat) => chat.archived)

  const renderChat = (chat: InsightChat) => (
    <div
      key={chat._id}
      className={cn(
        'group flex items-center gap-2 rounded-lg border px-2 py-2 transition-colors',
        chat._id === activeChatId
          ? 'border-guava-red/35 bg-guava-red/10'
          : 'border-transparent hover:border-border hover:bg-[#202020]'
      )}
    >
      <button
        type="button"
        onClick={() => onSelectChat(chat)}
        className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-50"
        aria-current={chat._id === activeChatId ? 'true' : undefined}
        disabled={isBusy}
        title={isBusy ? 'Finish or stop the current answer before switching chats' : undefined}
      >
        <p className="truncate text-sm font-medium text-text">{chat.title}</p>
        <p className="text-[11px] text-[#949494]">{timeAgo(chat.updatedAt)}</p>
      </button>
      {/* Naming the chat in each label matters most on Delete: there is no undo,
          and a dozen identical "Delete chat" buttons make a screen-reader user
          count list positions to work out which conversation they are erasing. */}
      <div className="flex shrink-0 items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={() => onRenameChat(chat)}
          className="rounded-md p-1.5 text-[#9E9E9E] hover:bg-border hover:text-text"
          aria-label={`Rename chat "${chat.title}"`}
        >
          <Edit3 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onArchiveChat(chat, !chat.archived)}
          className="rounded-md p-1.5 text-[#9E9E9E] hover:bg-border hover:text-text"
          aria-label={`${chat.archived ? 'Unarchive' : 'Archive'} chat "${chat.title}"`}
        >
          <Archive className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onDeleteChat(chat)}
          className="rounded-md p-1.5 text-[#9E9E9E] hover:bg-border hover:text-guava-red-text"
          aria-label={`Delete chat "${chat.title}"`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )

  return (
    <Card className="flex max-h-70 min-h-55 flex-col overflow-hidden">
      <CardHeader className="shrink-0 pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Chats</CardTitle>
            <CardDescription>Saved Guava AI conversations.</CardDescription>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => onNewChat()}
            disabled={isBusy}
            title={isBusy ? 'Finish or stop the current answer before starting a new chat' : undefined}
          >
            <Plus className="h-3.5 w-3.5" />
            New
          </Button>
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-y-auto space-y-3">
        {notice && (
          <p className="rounded-lg border border-guava-green/25 bg-guava-green/10 px-3 py-2 text-xs text-guava-green">
            {notice}
          </p>
        )}
        {isLoading && <Skeleton className="h-10 w-full rounded-lg" />}
        {!isLoading && activeChats.length === 0 && archivedChats.length === 0 && (
          <p className="rounded-lg border border-border px-3 py-3 text-sm text-[#9E9E9E]">
            Your saved chats will appear here.
          </p>
        )}
        {activeChats.length > 0 && (
          <div className="space-y-1.5">
            <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-[#949494]">Recent</p>
            {activeChats.map(renderChat)}
          </div>
        )}
        {archivedChats.length > 0 && (
          <div className="space-y-1.5">
            <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-[#949494]">Archived</p>
            {archivedChats.map(renderChat)}
          </div>
        )}
        {hasMore && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => onLoadMore()}
            disabled={isLoading}
          >
            {isLoading ? 'Loading...' : 'Load older chats'}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

export default function Insights() {
  const { user } = useAuth()
  const storageKeys = useMemo(
    () =>
      user
        ? getInsightChatStorageKeys({ userId: user.id, orgId: user.orgId, cafeId: user.activeCafeId })
        : null,
    [user]
  )
  const storageScopeId = storageKeys?.scopeId
  const currentStorageKey = storageKeys?.current
  const listStorageKey = storageKeys?.list
  // Only the useState initialisers below read this. As a bare call it ran on
  // every render — a synchronous localStorage read plus a JSON.parse of up to
  // eighty saved messages, repeated on every animation frame of a streaming
  // answer, which is exactly when the page must stay responsive.
  const initialStoredChat = useMemo(
    () => loadCurrentChat(currentStorageKey, storageScopeId),
    [currentStorageKey, storageScopeId]
  )
  const [insights, setInsights] = useState<Insight[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [insightsFailureCopy, setInsightsFailureCopy] = useState<ApiErrorCopy | null>(null)
  const [insightsError, setInsightsError] = useState(false)
  const [insightsRetryKind, setInsightsRetryKind] = useState<'load' | 'refresh'>('load')
  const [cacheStatus, setCacheStatus] = useState<InsightCacheStatus>('empty')
  const [insufficientNotice, setInsufficientNotice] = useState<string | null>(null)
  const [insightNotice, setInsightNotice] = useState('')
  const refreshInFlightRef = useRef(false)
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null)
  const [hasData, setHasData] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
      if (!Array.isArray(initialStoredChat?.messages)) return [WELCOME_MESSAGE]

      const storedMessages = initialStoredChat.messages
        .filter((message: Partial<ChatMessage>) =>
          message &&
          (message.role === 'user' || message.role === 'assistant') &&
          typeof message.content === 'string'
        )
        .slice(-80)
        .map((message: ChatMessage) => ({ ...message, pending: false }))

      return storedMessages.length ? storedMessages : [WELCOME_MESSAGE]
  })
  const [input, setInput] = useState('')
  const [isChatLoading, setIsChatLoading] = useState(false)
  const [chats, setChats] = useState<InsightChat[]>(() => loadLocalChatList(listStorageKey, storageScopeId))
  const [activeChatId, setActiveChatId] = useState<string | null>(initialStoredChat?.activeChatId || null)
  const [isChatsLoading, setIsChatsLoading] = useState(false)
  const [chatPage, setChatPage] = useState(1)
  const [hasMoreChats, setHasMoreChats] = useState(false)
  const [contextStats, setContextStats] = useState<ChatContextStats | null>(initialStoredChat?.contextStats || null)
  const [liveStats, setLiveStats] = useState<ChatContextStats | null>(null)
  const [liveStatsFailed, setLiveStatsFailed] = useState(false)
  useEffect(() => {
    let active = true
    setLiveStats(null)
    setLiveStatsFailed(false)
    api.get<{ contextStats: ChatContextStats }>('/forecasts/insights/context')
      .then(({ data }) => { if (active) setLiveStats(data.contextStats ?? null) })
      .catch(() => { if (active) setLiveStatsFailed(true) })
    return () => { active = false }
  }, [storageScopeId])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const messageRefs = useRef(new Map<string, HTMLDivElement>())
  const assistantTypingRef = useRef(new Map<string, AssistantTypingState>())
  const scrollToBottomBehaviorRef = useRef<ScrollBehavior | null>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const activeChatIdRef = useRef<string | null>(activeChatId)
  const messagesRef = useRef<ChatMessage[]>(messages)
  const contextStatsRef = useRef<ChatContextStats | null>(contextStats)
  const isChatLoadingRef = useRef(false)
  const insightRefreshKeyRef = useRef<string | null>(null)
  const activeStreamAbortRef = useRef<AbortController | null>(null)
  const didInitialChatSelectionRef = useRef(false)
  const hasConversation = messages.some((message) => message.id !== 'welcome')
  const hasConversationRef = useRef(hasConversation)
  const [renameTarget, setRenameTarget] = useState<InsightChat | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<InsightChat | null>(null)
  const [chatNotice, setChatNotice] = useState<string | null>(null)
  const [scrollRevision, setScrollRevision] = useState(0)
  const [chatStatus, setChatStatus] = useState('')
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null)
  const [cooldownSeconds, setCooldownSeconds] = useState(0)
  const isMountedRef = useRef(true)
  const userCancelledRef = useRef(false)
  const streamStalledRef = useRef(false)
  const slowTimerRef = useRef<number | null>(null)
  const streamDeliveredRef = useRef(false)
  const cooldownUntilRef = useRef<number | null>(null)
  // One question keeps one idempotency key across every attempt, including a
  // user-initiated retry. Minting a fresh key on retry made the second attempt
  // a separate paid reservation for an answer already charged for.
  const chatRequestKeyRef = useRef<{ signature: string; key: string } | null>(null)
  const sendPromptRef = useRef<(prompt: string) => void>(() => {})

  useEffect(() => {
    activeChatIdRef.current = activeChatId
  }, [activeChatId])

  useEffect(() => {
    messagesRef.current = messages
    hasConversationRef.current = hasConversation
  }, [messages, hasConversation])

  useEffect(() => {
    contextStatsRef.current = contextStats
  }, [contextStats])

  const setActiveChat = useCallback((chatId: string | null) => {
    activeChatIdRef.current = chatId
    setActiveChatId(chatId)
  }, [])

  const setTrackedMessages = useCallback((nextMessages: ChatMessage[]) => {
    messagesRef.current = nextMessages
    hasConversationRef.current = nextMessages.some((message) => message.id !== 'welcome')
    setMessages(nextMessages)
  }, [])

  const updateTrackedMessages = useCallback((updater: (current: ChatMessage[]) => ChatMessage[]) => {
    setMessages((current) => {
      const nextMessages = updater(current)
      messagesRef.current = nextMessages
      hasConversationRef.current = nextMessages.some((message) => message.id !== 'welcome')
      return nextMessages
    })
  }, [])

  const setMessageNode = useCallback((messageId: string, node: HTMLDivElement | null) => {
    if (node) messageRefs.current.set(messageId, node)
    else messageRefs.current.delete(messageId)
  }, [])

  const requestScrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    scrollToBottomBehaviorRef.current = behavior
    setScrollRevision((current) => current + 1)
  }, [])

  const scrollChatToBottom = useCallback((behavior: ScrollBehavior) => {
    const scrollEl = chatScrollRef.current
    if (!scrollEl) return

    const top = scrollEl.scrollHeight
    if (typeof scrollEl.scrollTo === 'function') {
      scrollEl.scrollTo({ top, behavior })
    } else {
      scrollEl.scrollTop = top
    }

    if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior, block: 'end' })
    }
  }, [])

  const cancelAssistantTyping = useCallback((messageId?: string) => {
    const targets = messageId
      ? [[messageId, assistantTypingRef.current.get(messageId)] as const]
      : Array.from(assistantTypingRef.current.entries())

    targets.forEach(([id, state]) => {
      if (state?.rafId != null) window.cancelAnimationFrame(state.rafId)
      assistantTypingRef.current.delete(id)
    })
  }, [])

  // Replacing the transcript while a stream is in flight used to strand it: the
  // remaining deltas landed on a message that no longer existed, the header
  // stats of the newly opened chat were overwritten, and the composer stayed
  // locked until the orphan finished. Treat the switch as a cancellation.
  const cancelInFlightStream = useCallback(() => {
    if (!isChatLoadingRef.current) return
    userCancelledRef.current = true
    activeStreamAbortRef.current?.abort()
  }, [])

  const applyChat = useCallback((chat: InsightChat) => {
    cancelInFlightStream()
    cancelAssistantTyping()
    const normalized = withMessageIds(chat)
    setActiveChat(normalized._id)
    setTrackedMessages(normalized.messages.length ? normalized.messages : [WELCOME_MESSAGE])
    setContextStats(normalized.contextStats || null)
    setInput('')
    requestScrollToBottom('auto')
  }, [cancelAssistantTyping, cancelInFlightStream, requestScrollToBottom, setActiveChat, setTrackedMessages])

  const openChat = useCallback(async (chat: InsightChat) => {
    if (isLocalChat(chat._id)) {
      applyChat(chat)
      return
    }

    // Cached scoped messages keep selection responsive, while the detail read
    // remains authoritative and prevents list responses from carrying every
    // conversation transcript.
    if (chat.messages.length > 0) applyChat(chat)
    try {
      const { data } = await api.get(`/insight-chats/${chat._id}`)
      const detailedChat = withMessageIds(data.chat)
      setChats((current) => mergeChats([detailedChat], current))
      applyChat(detailedChat)
    } catch {
      if (chat.messages.length === 0) {
        setChatNotice('Could not load this chat. Please try again.')
      }
    }
  }, [applyChat])

  const applyInsightPayload = useCallback((
    data: { insights?: unknown; generatedAt?: unknown },
    nextCacheStatus: InsightCacheStatus
  ) => {
    const outcome = resolveRefreshOutcome({ ...data, cacheStatus: nextCacheStatus })
    setInsights(outcome.insights)
    setHasData(outcome.insights.length > 0)
    setCacheStatus(nextCacheStatus)
    setLastUpdated(outcome.generatedAt)
  }, [])

  const loadInsights = useCallback(async () => {
    setIsLoading(true)
    try {
      const { data } = await api.get<InsightReadResponse>('/forecasts/insights')
      const nextStatus: InsightCacheStatus = ['fresh', 'stale', 'empty', 'unconfigured', 'insufficient_data'].includes(data?.cacheStatus)
        ? data.cacheStatus
        : Array.isArray(data?.insights) && data.insights.length > 0
          ? 'fresh'
          : 'empty'
      applyInsightPayload(data, nextStatus)
      setInsightNotice(nextStatus === 'stale' || data.requiresRefresh ? resolveRefreshOutcome({ ...data, cacheStatus: 'stale' }).notice : '')
      setInsightsError(false)
    } catch {
      // Keep any previously loaded insights visible, but surface the failure honestly.
      setInsightsRetryKind('load')
      setInsightNotice('Insights are unavailable right now. Please try again.')
      setInsightsError(true)
    } finally {
      setIsLoading(false)
    }
  }, [applyInsightPayload])

  const refreshInsights = useCallback(async () => {
    if (refreshInFlightRef.current) return
    refreshInFlightRef.current = true
    setIsRefreshing(true)
    setInsightsError(false)
    setInsightsFailureCopy(null)
    const idempotencyKey = insightRefreshKeyRef.current ?? createInsightRefreshKey()
    insightRefreshKeyRef.current = idempotencyKey

    try {
      const { data } = await api.post<InsightRefreshResponse>(
        '/forecasts/insights/refresh',
        {},
        { headers: { 'Idempotency-Key': idempotencyKey }, timeout: 90_000 }
      )
      const outcome = resolveRefreshOutcome(data)
      setInsufficientNotice(outcome.status === 'insufficient_data' ? outcome.body : null)
      setInsightNotice(outcome.notice)
      if (outcome.status === 'insufficient_data') setCacheStatus(outcome.status)
      else applyInsightPayload(data, outcome.status)
      const creditSnapshot = data.guavaCredits ?? data.aiCredits
      setCreditsRemaining(creditSnapshot?.available ?? null)
      publishGuavaCredits(creditSnapshot)
      insightRefreshKeyRef.current = null
      setInsightsError(false)
    } catch (error) {
      setInsightsRetryKind('refresh')
      const info = readApiError(error)
      const copy = info.offline ? null : describeApiError(info)
      setInsightsFailureCopy(copy)
      setInsightNotice(copy ? `${copy.title}. ${copy.body}` : insightRefreshErrorNotice(error))
      setInsightsError(true)
    } finally {
      refreshInFlightRef.current = false
      setIsRefreshing(false)
    }
  }, [applyInsightPayload])

  const loadChats = useCallback(async () => {
    setIsChatsLoading(true)
    try {
      const { data } = await api.get('/insight-chats', {
        params: { archived: true, page: 1, limit: 30 },
      })
      const loadedChats: InsightChat[] = (data.chats || []).map(withMessageIds)
      const mergedChats = mergeChats(loadedChats, loadLocalChatList(listStorageKey, storageScopeId))
      setChats(mergedChats)
      setChatPage(1)
      setHasMoreChats(Boolean(data.pagination?.hasMore))

      if (isChatLoadingRef.current) return

      const savedActive = mergedChats.find((chat) => chat._id === activeChatIdRef.current)
      const firstActive = mergedChats.find((chat) => !chat.archived)

      if (!hasConversationRef.current && savedActive) {
        await openChat(savedActive)
      } else if (!didInitialChatSelectionRef.current && !hasConversationRef.current && firstActive) {
        await openChat(firstActive)
      }
      didInitialChatSelectionRef.current = true
    } catch {
      // Local storage keeps the current chat usable if the API is unavailable.
    } finally {
      setIsChatsLoading(false)
    }
  }, [listStorageKey, openChat, storageScopeId])

  const loadMoreChats = useCallback(async () => {
    if (isChatsLoading || !hasMoreChats) return
    setIsChatsLoading(true)
    const nextPage = chatPage + 1
    try {
      const { data } = await api.get('/insight-chats', {
        params: { archived: true, page: nextPage, limit: 30 },
      })
      const loadedChats: InsightChat[] = (data.chats || []).map(withMessageIds)
      setChats((current) => mergeChats(loadedChats, current))
      setChatPage(nextPage)
      setHasMoreChats(Boolean(data.pagination?.hasMore))
    } catch {
      setChatNotice('Could not load older chats. Please try again.')
    } finally {
      setIsChatsLoading(false)
    }
  }, [chatPage, hasMoreChats, isChatsLoading])

  useEffect(() => {
    loadInsights()
  }, [loadInsights])

  useEffect(() => {
    loadChats()
  }, [loadChats])

  useEffect(() => {
    if (hasConversation) requestScrollToBottom('auto')
  }, [hasConversation, requestScrollToBottom])

  useEffect(() => {
    const behavior = scrollToBottomBehaviorRef.current
    if (!behavior || !hasConversation) return

    if (scrollFrameRef.current != null) {
      window.cancelAnimationFrame(scrollFrameRef.current)
      scrollFrameRef.current = null
    }

    let secondFrame: number | null = null
    const firstFrame = window.requestAnimationFrame(() => {
      scrollChatToBottom(behavior)
      secondFrame = window.requestAnimationFrame(() => {
        scrollChatToBottom(behavior)
        scrollToBottomBehaviorRef.current = null
        scrollFrameRef.current = null
      })
      scrollFrameRef.current = secondFrame
    })

    scrollFrameRef.current = firstFrame

    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame != null) window.cancelAnimationFrame(secondFrame)
      if (scrollFrameRef.current === firstFrame || scrollFrameRef.current === secondFrame) {
        scrollFrameRef.current = null
      }
    }
  }, [hasConversation, messages.length, scrollChatToBottom, scrollRevision])

  useEffect(() => {
    if (messages.some((message) => message.pending)) return
    if (!currentStorageKey || !storageScopeId) return

    // Failure markers describe one attempt, not the conversation, so they are
    // not carried into storage. The partial answer above them is.
    const storedMessages = messages
      .filter((message) => message.id !== 'welcome' || messages.length === 1)
      .slice(-80)
      .map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        pending: false,
      }))

    writeScopedStorage(currentStorageKey, {
      scopeId: storageScopeId,
      activeChatId,
      messages: storedMessages,
      contextStats,
      updatedAt: new Date().toISOString(),
    })
  }, [activeChatId, messages, contextStats, currentStorageKey, storageScopeId])

  useEffect(() => {
    if (!listStorageKey || !storageScopeId) return
    writeScopedStorage(listStorageKey, {
      scopeId: storageScopeId,
      chats: chats.slice(0, 20).map((chat) => ({
        ...chat,
        messages: chat.messages.slice(-20).map((message) => ({ ...message, pending: false })),
      })),
      updatedAt: new Date().toISOString(),
    })
  }, [chats, listStorageKey, storageScopeId])

  // The rate limiter is per-minute and per-user. Inviting a retry inside the
  // window just spends another token, so the composer stays shut until it lifts.
  useEffect(() => {
    cooldownUntilRef.current = cooldownUntil
    if (!cooldownUntil) {
      setCooldownSeconds(0)
      return
    }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000))
      setCooldownSeconds(remaining)
      if (remaining === 0) setCooldownUntil(null)
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [cooldownUntil])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (slowTimerRef.current !== null) window.clearTimeout(slowTimerRef.current)
      activeStreamAbortRef.current?.abort()
      activeStreamAbortRef.current = null
      cancelAssistantTyping()
      if (scrollFrameRef.current != null) {
        window.cancelAnimationFrame(scrollFrameRef.current)
        scrollFrameRef.current = null
      }
    }
  }, [cancelAssistantTyping])

  useEffect(() => {
    if (!chatNotice) return
    const timer = window.setTimeout(() => setChatNotice(null), 3200)
    return () => window.clearTimeout(timer)
  }, [chatNotice])

  useEffect(() => {
    if (!renameTarget && !deleteTarget) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setRenameTarget(null)
      setRenameTitle('')
      setDeleteTarget(null)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [renameTarget, deleteTarget])

  const setAssistantContent = (id: string, content: string, pending: boolean) => {
    updateTrackedMessages((current) =>
      current.map((message) =>
        message.id === id
          ? { ...message, content, pending }
          : message
      )
    )
  }

  const frameSizeForBacklog = (backlog: number, elapsedMs: number) => {
    const charsPerSecond =
      backlog > 1200 ? 420 :
      backlog > 600 ? 320 :
      backlog > 220 ? 240 :
      170
    return Math.max(1, Math.floor((charsPerSecond * Math.max(elapsedMs, 16)) / 1000))
  }

  const scheduleAssistantTyping = (id: string) => {
    const state = assistantTypingRef.current.get(id)
    if (!state || state.rafId != null) return

    state.rafId = window.requestAnimationFrame((timestamp) => {
      const currentState = assistantTypingRef.current.get(id)
      if (!currentState) return

      currentState.rafId = null
      const elapsed = currentState.lastFrameAt == null ? 16 : timestamp - currentState.lastFrameAt
      currentState.lastFrameAt = timestamp

      const remaining = currentState.target.length - currentState.displayed.length
      if (remaining > 0) {
        const nextLength = currentState.displayed.length + Math.min(remaining, frameSizeForBacklog(remaining, elapsed))
        currentState.displayed = currentState.target.slice(0, nextLength)
        setAssistantContent(id, currentState.displayed, true)
      }

      if (currentState.displayed.length < currentState.target.length) {
        scheduleAssistantTyping(id)
        return
      }

      if (currentState.finishing) {
        setAssistantContent(id, currentState.displayed, false)
        assistantTypingRef.current.delete(id)
      }
    })
  }

  const appendAssistantDelta = (id: string, text: string, options: { replace?: boolean; finish?: boolean } = {}) => {
    const existingContent = messagesRef.current.find((message) => message.id === id)?.content || ''
    const existingState = assistantTypingRef.current.get(id)
    const state = existingState || {
      target: existingContent,
      displayed: existingContent,
      finishing: false,
      rafId: null,
      lastFrameAt: null,
    }

    if (options.replace) {
      state.target = text
      state.displayed = ''
      state.lastFrameAt = null
      setAssistantContent(id, '', true)
    } else {
      state.target += text
    }

    if (options.finish) state.finishing = true
    assistantTypingRef.current.set(id, state)
    scheduleAssistantTyping(id)
  }

  const revealAssistantMessage = (id: string, answer: string) => {
    appendAssistantDelta(id, answer, { replace: true, finish: true })
  }

  const finishAssistantMessage = (id: string) => {
    const state = assistantTypingRef.current.get(id)
    if (state) {
      state.finishing = true
      scheduleAssistantTyping(id)
      return
    }
    updateTrackedMessages((current) =>
      current.map((message) =>
        message.id === id ? { ...message, pending: false } : message
      )
    )
  }

  const handleStreamEvent = (rawEvent: string, assistantId: string) => {
    const lines = rawEvent.split('\n')
    const eventName = lines
      .find((line) => line.startsWith('event:'))
      ?.replace('event:', '')
      .trim()
    const dataText = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.replace('data:', '').trimStart())
      .join('\n')

    if (!eventName) return { type: 'ignored' as const }
    if (!dataText) throw new Error(`AI stream ${eventName} event had no data`)

    let data: {
      text?: string
      message?: string
      code?: string
      charged?: boolean | null
      retryable?: boolean
      credits?: number
      contextStats?: ChatContextStats | null
      guavaCredits?: GuavaCreditSnapshot
      aiCredits?: GuavaCreditSnapshot
      replayed?: boolean
    }
    try {
      data = JSON.parse(dataText)
    } catch {
      throw new Error(`AI stream ${eventName} event contained invalid data`)
    }
    if (eventName === 'delta') {
      const text = data.text || ''
      appendAssistantDelta(assistantId, text)
      return { type: 'delta' as const, text }
    }
    if (eventName === 'done') {
      setContextStats(data.contextStats || null)
      if (data.contextStats) setLiveStats(data.contextStats)
      const creditSnapshot = data.guavaCredits ?? data.aiCredits
      setCreditsRemaining(creditSnapshot?.available ?? null)
      publishGuavaCredits(creditSnapshot)
      finishAssistantMessage(assistantId)
      return { type: 'done' as const, contextStats: data.contextStats || null }
    }
    if (eventName === 'error') {
      const failure = chatFailureFromStreamEvent(data)
      throw new ChatRequestError(
        failure, failure.serverMessage || 'The AI stream stopped unexpectedly.'
      )
    }
    return { type: 'ignored' as const }
  }

  const streamAssistantMessage = async (
    assistantId: string,
    payloadMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
    idempotencyKey: string,
    chatId: string
  ) => {
    const controller = new AbortController()
    activeStreamAbortRef.current?.abort()
    activeStreamAbortRef.current = controller
    let idleTimer = 0
    const armIdle = () => {
      window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(() => { streamStalledRef.current = true; controller.abort() }, STREAM_IDLE_TIMEOUT_MS)
    }
    // Also bound a connection that never returns response headers.
    armIdle()
    try {
      const response = await authenticatedFetch('/forecasts/insights/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ chatId, messages: payloadMessages }),
        signal: controller.signal,
      })
      // response.status is the whole difference between "wait a moment" and
      // "buy credits". Reading it is what lets sendPrompt refuse to re-bill a
      // request that can never succeed.
      if (!response.ok) throw await chatRequestErrorFrom(response)
      if (!response.body) {
        throw new ChatRequestError({ kind: 'transient' }, 'The AI stream returned no body')
      }

      const reader = response.body.getReader()
      armIdle()
      const decoder = new TextDecoder()
      let buffer = ''
      let answer = ''
      let streamedContextStats: ChatContextStats | null = null
      let sawDone = false

      const processEvent = (event: string) => {
        const parsed = handleStreamEvent(event, assistantId)
        if (parsed.type === 'delta') {
          if (parsed.text.trim()) streamDeliveredRef.current = true
          answer += parsed.text
        } else if (parsed.type === 'done') {
          sawDone = true
          streamedContextStats = parsed.contextStats
        }
      }

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        armIdle()
        buffer += decoder.decode(value, { stream: true })

        const events = buffer.split('\n\n')
        buffer = events.pop() || ''
        for (const event of events) {
          processEvent(event)
        }
      }

      buffer += decoder.decode()
      if (buffer.trim()) {
        processEvent(buffer)
      }
      if (!sawDone) throw new Error('AI stream ended before its completion event')

      return { answer, contextStats: streamedContextStats }
    } finally {
      window.clearTimeout(idleTimer)
      if (activeStreamAbortRef.current === controller) {
        activeStreamAbortRef.current = null
      }
    }
  }

  const saveChat = async (
    chatId: string | null,
    chatMessages: ChatMessage[],
    stats: ChatContextStats | null = contextStats
  ) => {
    if (!chatId || chatMessages.some((message) => message.failure)) return

    if (isLocalChat(chatId)) {
      setChats((current) =>
        sortChats(
          current.map((chat) =>
            chat._id === chatId
              ? {
                  ...chat,
                  title: titleFromMessages(chatMessages),
                  messages: chatMessages
                    .filter((message) => message.id !== 'welcome')
                    .map((message) => ({ ...message, pending: false })),
                  contextStats: stats,
                  updatedAt: new Date().toISOString(),
                }
              : chat
          )
        )
      )
      return
    }

    const payload = {
      title: titleFromMessages(chatMessages),
      messages: messagesForApi(chatMessages).slice(-80),
      contextStats: stats || undefined,
    }

    try {
      const { data } = await api.patch(`/insight-chats/${chatId}`, payload)
      const updatedChat = withMessageIds(data.chat)
      setChats((current) =>
        sortChats([updatedChat, ...current.filter((chat) => chat._id !== updatedChat._id)])
      )
    } catch (error) {
      // Replacing the server chat with a local clone forked the conversation:
      // the user kept talking into a copy that only ever existed in this
      // browser, while the untouched server row reappeared, stale, at the next
      // load. The server chat stays; only the save is reported as failed.
      setChatNotice(savedChatFailureNotice(error) ?? 'Could not save this chat to your account. It is kept on this device for now.')
    }
  }

  const ensureActiveChat = async (chatMessages: ChatMessage[]) => {
    if (activeChatIdRef.current) return activeChatIdRef.current

    try {
      const { data } = await api.post('/insight-chats', {
        title: titleFromMessages(chatMessages),
        messages: messagesForApi(chatMessages).slice(-80),
        contextStats: contextStats || undefined,
      })
      const createdChat = withMessageIds(data.chat)
      setChats((current) => sortChats([createdChat, ...current.filter((chat) => chat._id !== createdChat._id)]))
      setActiveChat(createdChat._id)
      return createdChat._id
    } catch (error) {
      const notice = savedChatFailureNotice(error)
      if (notice) { setChatNotice(notice); throw error }
      const localChat = createLocalChat(chatMessages, contextStats)
      setChats((current) => sortChats([localChat, ...current.filter((chat) => chat._id !== localChat._id)]))
      setActiveChat(localChat._id)
      return localChat._id
    }
  }

  const preserveCurrentChat = async () => {
    if (!hasConversationRef.current) return

    const currentMessages = messagesRef.current.filter((message) => message.id !== 'welcome')
    if (currentMessages.length === 0) return

    if (activeChatIdRef.current) {
      await saveChat(activeChatIdRef.current, currentMessages, contextStatsRef.current)
      return
    }

    const localChat = createLocalChat(currentMessages, contextStatsRef.current)
    setChats((current) => sortChats([localChat, ...current.filter((chat) => chat._id !== localChat._id)]))
  }

  const resetDraftChat = () => {
    cancelInFlightStream()
    cancelAssistantTyping()
    setActiveChat(null)
    setTrackedMessages([WELCOME_MESSAGE])
    setContextStats(null)
    setInput('')
    scrollToBottomBehaviorRef.current = null
  }

  const startNewChat = async ({ preserve = true }: { preserve?: boolean } = {}) => {
    if (preserve) await preserveCurrentChat()
    didInitialChatSelectionRef.current = true
    resetDraftChat()
  }

  const requestRenameChat = (chat: InsightChat) => {
    setRenameTarget(chat)
    setRenameTitle(chat.title)
  }

  const confirmRenameChat = async (event: FormEvent) => {
    event.preventDefault()
    const chat = renameTarget
    const title = renameTitle.trim()
    if (!chat || !title) return

    setRenameTarget(null)
    setRenameTitle('')

    if (isLocalChat(chat._id)) {
      setChats((current) =>
        current.map((item) => (item._id === chat._id ? { ...item, title } : item))
      )
      setChatNotice('Chat renamed.')
      return
    }

    try {
      const { data } = await api.patch(`/insight-chats/${chat._id}`, { title })
      const updatedChat = withMessageIds(data.chat)
      setChats((current) => current.map((item) => (item._id === updatedChat._id ? updatedChat : item)))
      if (activeChatIdRef.current === updatedChat._id) {
        setActiveChat(updatedChat._id)
      }
      setChatNotice('Chat renamed.')
    } catch (error) {
      setChatNotice(savedChatFailureNotice(error) ?? 'Could not rename this chat. Please try again.')
    }
  }

  const archiveChat = async (chat: InsightChat, archived: boolean) => {
    if (isLocalChat(chat._id)) {
      setChats((current) =>
        current.map((item) => (item._id === chat._id ? { ...item, archived } : item))
      )
      if (archived && activeChatIdRef.current === chat._id) startNewChat({ preserve: false })
      return
    }

    try {
      const { data } = await api.patch(`/insight-chats/${chat._id}`, { archived })
      const updatedChat = withMessageIds(data.chat)
      setChats((current) => current.map((item) => (item._id === updatedChat._id ? updatedChat : item)))
      if (archived && activeChatIdRef.current === chat._id) startNewChat({ preserve: false })
    } catch (error) {
      setChatNotice(savedChatFailureNotice(error) ?? `Could not ${archived ? 'archive' : 'restore'} this chat. Please try again.`)
    }
  }

  const requestDeleteChat = (chat: InsightChat) => {
    setDeleteTarget(chat)
  }

  const confirmDeleteChat = async () => {
    const chat = deleteTarget
    if (!chat) return

    setDeleteTarget(null)

    if (!isLocalChat(chat._id)) {
      try {
        await api.delete(`/insight-chats/${chat._id}`)
      } catch (error) {
        setChatNotice(savedChatFailureNotice(error) ?? `Could not delete ${chat.title}. Please try again.`)
        return
      }
    }

    setChats((current) => current.filter((item) => item._id !== chat._id))
    if (activeChatIdRef.current === chat._id) startNewChat({ preserve: false })
    setChatNotice(`Deleted "${chat.title}".`)
  }

  const applyChatFailure = (assistantId: string, failure: ChatFailure) => {
    // Never replace what is already on screen. A drop nine hundred characters
    // into a useful answer used to erase all of it and leave one generic line,
    // for a turn the customer had already been charged for.
    finishAssistantMessage(assistantId)
    updateTrackedMessages((current) =>
      current.map((message) => (message.id === assistantId ? { ...message, failure } : message))
    )
    if (failure.kind === 'rate-limited' || failure.kind === 'busy') {
      setCooldownUntil(Date.now() + (failure.retryAfterSeconds ?? DEFAULT_RATE_LIMIT_SECONDS) * 1000)
    }
    setChatStatus(`${chatFailureCopy(failure).title}. ${chatFailureCopy(failure).detail}`)
  }

  const stopAnswer = useCallback(() => {
    userCancelledRef.current = true
    activeStreamAbortRef.current?.abort()
  }, [])

  const retryFailedAnswer = useCallback((assistantId: string) => {
    const current = messagesRef.current
    const index = current.findIndex((message) => message.id === assistantId)
    if (index < 1) return
    const question = current[index - 1].role === 'user' ? current[index - 1].content : ''
    if (!question) return
    // A provider-interrupted answer offers an explicit new paid ask; all free
    // recovery buttons retain the original key, including a charged 401.
    if (current[index].failure?.kind === 'interrupted') chatRequestKeyRef.current = null
    // Drop the failed turn so the retry does not stack a second copy of the
    // same question; the idempotency key is what keeps it from being re-billed.
    setTrackedMessages(current.slice(0, index - 1))
    sendPromptRef.current(question)
  }, [setTrackedMessages])

  const sendPrompt = async (prompt: string) => {
    const trimmed = prompt.trim()
    if (!trimmed || isChatLoadingRef.current) return
    if (cooldownUntilRef.current && cooldownUntilRef.current > Date.now()) return

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
    }
    const assistantId = `assistant-${Date.now()}`
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      pending: true,
    }
    const currentMessages = messagesRef.current
    const nextMessages = [...currentMessages, userMessage]

    requestScrollToBottom('smooth')
    setTrackedMessages([...nextMessages, assistantMessage])
    setInput('')
    isChatLoadingRef.current = true
    userCancelledRef.current = false
    streamDeliveredRef.current = false
    streamStalledRef.current = false
    slowTimerRef.current = window.setTimeout(() => {
      updateTrackedMessages((current) => current.map((message) =>
        message.id === assistantId && message.pending && !message.content ? { ...message, slow: true } : message))
    }, STILL_WORKING_AFTER_MS)
    setIsChatLoading(true)
    setChatStatus('Guava is working on your answer.')

    let streamFailure: ChatFailure | undefined
    try {
      const chatId = await ensureActiveChat(nextMessages)
      // Stop can precede the stream controller while a new chat is being saved.
      if (userCancelledRef.current) throw new DOMException('Stopped before requesting an answer', 'AbortError')
      const payloadMessages = trailingChatWindow(messagesForApi(nextMessages))
      const conversationText = JSON.stringify(payloadMessages)
      const fingerprint = globalThis.crypto?.subtle
        ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(conversationText))))
          .map((byte) => byte.toString(16).padStart(2, '0')).join('')
        : conversationText
      const signature = `${chatId}::${fingerprint}`
      if (chatRequestKeyRef.current?.signature !== signature) {
        chatRequestKeyRef.current = { signature, key: createChatRequestKey() }
      }
      const idempotencyKey = chatRequestKeyRef.current.key
      if (userCancelledRef.current) throw new DOMException('Stopped before requesting an answer', 'AbortError')

      try {
        const streamed = await streamAssistantMessage(
          assistantId,
          payloadMessages,
          idempotencyKey,
          chatId
        )
        if (!isMountedRef.current) return
        // A done event with no delta text is an empty answer, not a pending
        // one. Say so, and say the same thing the server just saved.
        const answer = streamed.answer.trim() || EMPTY_ANSWER
        if (!streamed.answer.trim()) revealAssistantMessage(assistantId, EMPTY_ANSWER)
        const stats = streamed.contextStats || contextStatsRef.current
        chatRequestKeyRef.current = null
        setChatStatus('Guava has finished this answer.')
        await saveChat(
          chatId,
          [...nextMessages, { ...assistantMessage, content: answer, pending: false }],
          stats
        )
      } catch (streamError) {
        const failure = chatFailureFrom(streamError, userCancelledRef.current, streamDeliveredRef.current, streamStalledRef.current)
        streamFailure = failure
        // The fallback is a second billable request. It is only worth issuing
        // when the failure could plausibly resolve: a 402, 403 or 429 cannot,
        // a stopped answer was not wanted, and an unmounted page has nowhere to
        // render what it would pay for.
        if (!isMountedRef.current || !RECOVERABLE_FAILURES.has(failure.kind)) throw streamError

        const { data } = await api.post(
          '/forecasts/insights/chat',
          { chatId, messages: payloadMessages },
          {
            headers: { 'Idempotency-Key': idempotencyKey },
            // The stream and the insight refresh both allow 90s. On the axios
            // default of 20s the client gave up while the server finished and
            // committed the charge: billed, and shown a failure.
            timeout: 90_000,
          }
        )
        if (!isMountedRef.current) return
        const creditSnapshot = data.guavaCredits ?? data.aiCredits
        setCreditsRemaining(creditSnapshot?.available ?? null)
        publishGuavaCredits(creditSnapshot)
        setContextStats(data.contextStats || null)
        // A retry with the same idempotency key either replays the already
        // committed full result or safely reruns a refunded stream. Replace any
        // partial stream rather than leaving a truncated paid answer visible.
        revealAssistantMessage(assistantId, data.answer || EMPTY_ANSWER)
        chatRequestKeyRef.current = null
        setChatStatus('Guava has finished this answer.')
        await saveChat(
          chatId,
          [...nextMessages, { ...assistantMessage, content: data.answer || EMPTY_ANSWER, pending: false }],
          data.contextStats || null
        )
      }
    } catch (error) {
      if (!isMountedRef.current) return
      const failure = chatFailureFrom(error, userCancelledRef.current, streamDeliveredRef.current, streamStalledRef.current)
      // A failed fallback cannot settle a charge the stream explicitly left unknown.
      if (streamFailure?.charged === null) failure.charged = null
      if (failure.kind === 'transient' && failure.charged === false && !failure.serverMessage) {
        failure.serverMessage = streamFailure?.serverMessage
      }
      // A refusal is settled: the same question later is a new request, so it
      // must not reuse a key the server would replay.
      if (failure.charged !== true && (failure.kind === 'out-of-credits' || failure.kind === 'not-permitted' || failure.kind === 'session-ended' || ['interrupted', 'billing-read-only', 'cafe-access', 'daily-limit', 'busy', 'invalid-request', 'payload-too-large', 'ai-unavailable'].includes(failure.kind))) {
        chatRequestKeyRef.current = null
      }
      applyChatFailure(assistantId, failure)
    } finally {
      if (slowTimerRef.current !== null) window.clearTimeout(slowTimerRef.current)
      slowTimerRef.current = null
      isChatLoadingRef.current = false
      userCancelledRef.current = false
      if (isMountedRef.current) setIsChatLoading(false)
    }
  }

  useEffect(() => {
    sendPromptRef.current = sendPrompt
  })

  // A stable handle for the memoised composer. sendPrompt is a fresh closure on
  // every render, so passing it directly re-rendered the composer — and the
  // textarea the user is trying to type into — on every streamed frame.
  const submitPrompt = useCallback((prompt: string) => sendPromptRef.current(prompt), [])
  const shownContextStats = liveStats ?? contextStats

  return (
    <>
      <AppLayout
        title={
          <div className="flex items-center gap-2">
            <span>Ask Guava</span>
            <Sparkles className="w-4 h-4 text-guava-red-text" />
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_420px] 2xl:h-[calc(100vh-113px)] 2xl:min-h-0">
          <Card className="relative flex min-h-140 flex-col overflow-hidden 2xl:h-full 2xl:min-h-0">
            <CardHeader className="pb-3 border-b border-[#242424]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <img src={guavaIcon} alt="" className="h-5 w-5 object-contain" />
                    Ask Your Data
                  </CardTitle>
                  <CardDescription>
                    Business context includes locations, forecasts, events, items, and recent transactions.
                  </CardDescription>
                </div>
                <Badge variant="secondary" className="flex items-center gap-1.5">
                  <img src={guavaIcon} alt="" className="h-3.5 w-3.5 object-contain" />
                  Guava AI
                </Badge>
              </div>
              <div className="flex flex-wrap gap-3 pt-3" title={!shownContextStats && liveStatsFailed ? 'Counts unavailable' : undefined}>
                <Stat icon={Database} label="Transactions" value={shownContextStats?.transactionCount?.toLocaleString('en-ZA') ?? '—'} />
                <Stat icon={MapPin} label="Locations" value={shownContextStats?.locations?.toLocaleString('en-ZA') ?? '—'} />
                <Stat icon={BarChart3} label="Forecasts" value={shownContextStats?.forecasts?.toLocaleString('en-ZA') ?? '—'} />
              </div>
              {shownContextStats?.contextWindow && (
                <p className="pt-2 text-xs text-muted">
                  Analysis window: {shownContextStats.contextWindow}
                </p>
              )}
            </CardHeader>

            <CardContent className="flex min-h-0 flex-1 flex-col p-0">
              {/* Lifecycle only. Announcing every typewriter frame would flood
                  the buffer; announcing nothing left a blind user unable to
                  tell whether their three credits had produced anything. */}
              <p role="status" aria-label="Chat status" aria-live="polite" aria-atomic="true" className="sr-only">
                {chatStatus}
              </p>
              {!hasConversation ? (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-10">
                  <div className="mb-8 text-center">
                    <div className="mb-4 flex items-center justify-center gap-3">
                      <Sparkles className="h-7 w-7 text-guava-red-text" />
                      <h2 className="text-3xl font-semibold text-text">Ask your business data</h2>
                    </div>
                    <p className="mx-auto max-w-xl text-sm leading-relaxed text-[#9E9E9E]">
                      Query sales, prep, trading windows, locations, forecasts, and recent transactions.
                    </p>
                  </div>
                  <ChatComposer
                    input={input}
                    setInput={setInput}
                    sendPrompt={submitPrompt}
                    onStop={stopAnswer}
                    isChatLoading={isChatLoading}
                    cooldownSeconds={cooldownSeconds}
                    creditsRemaining={creditsRemaining}
                  />
                  <div className="mt-5 flex max-w-215 flex-wrap justify-center gap-2">
                    {QUICK_PROMPTS.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => setInput(prompt)}
                        className="text-xs text-muted hover:text-text border border-border hover:border-[#3A3A3A] rounded-lg px-2.5 py-1.5 transition-colors"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {/* The composer floats over this scroll area, so long answers
                      used to be sliced off mid-table by its opaque edge. The
                      gradient lets content dissolve into the composer instead. */}
                  <div
                    aria-hidden
                    className="pointer-events-none absolute bottom-0 left-0 right-0 z-10 h-40 bg-gradient-to-t from-[#0F0F0F] via-[#0F0F0F]/85 to-transparent"
                  />
                  {/* role="log" plus a tab stop: without them the transcript was
                      neither announced nor scrollable without a mouse. */}
                  <div
                    ref={chatScrollRef}
                    role="log"
                    aria-label="Conversation"
                    tabIndex={0}
                    className="min-h-0 flex-1 overflow-y-auto px-6 pb-64 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-guava-green/40"
                  >
                    {messages
                      .filter((message) => message.id !== 'welcome')
                      .map((message) => (
                        <MessageRow
                          key={message.id}
                          message={message}
                          onMessageRef={setMessageNode}
                          onRetry={retryFailedAnswer}
                        />
                      ))}
                    <div className="pb-10 pt-4">
                      <div className="flex flex-wrap gap-2">
                        {QUICK_PROMPTS.map((prompt) => (
                          <button
                            key={prompt}
                            type="button"
                            onClick={() => setInput(prompt)}
                            className="text-xs text-muted hover:text-text border border-border hover:border-[#3A3A3A] rounded-lg px-2.5 py-1.5 transition-colors"
                          >
                            {prompt}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div ref={messagesEndRef} className="h-52" />
                  </div>
                  <ChatComposer
                    input={input}
                    setInput={setInput}
                    sendPrompt={submitPrompt}
                    onStop={stopAnswer}
                    isChatLoading={isChatLoading}
                    cooldownSeconds={cooldownSeconds}
                    creditsRemaining={creditsRemaining}
                    floating
                  />
                </>
              )}
            </CardContent>
          </Card>

          <div className="flex min-h-0 flex-col gap-5 2xl:h-full">
            <ChatHistoryPanel
              chats={chats}
              activeChatId={activeChatId}
              isLoading={isChatsLoading}
              isBusy={isChatLoading}
              hasMore={hasMoreChats}
              notice={chatNotice}
              onNewChat={startNewChat}
              onLoadMore={loadMoreChats}
              onSelectChat={openChat}
              onRenameChat={requestRenameChat}
              onArchiveChat={archiveChat}
              onDeleteChat={requestDeleteChat}
            />

            <Card className="flex max-h-180 min-h-90 flex-col overflow-hidden 2xl:min-h-0 2xl:flex-1 2xl:max-h-none">
              <CardHeader className="shrink-0 pb-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-guava-red-text" />
                      Auto Analysis
                    </CardTitle>
                    <CardDescription>
                      <span className="block">{INSIGHT_WINDOW_COPY}</span>Each manual refresh uses 10 Guava credits.
                      {creditsRemaining != null ? ` ${creditsRemaining} credits remaining.` : ''}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {lastUpdated && (
                      <div className="flex items-center gap-1.5 text-muted text-xs">
                        <Clock className="w-3 h-3" />
                        <span>Updated {timeAgo(lastUpdated)}</span>
                      </div>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={refreshInsights}
                      disabled={isLoading || isRefreshing || (cacheStatus === 'unconfigured' || cacheStatus === 'insufficient_data')}
                    >
                      <RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin')} />
                      {isRefreshing ? 'Refreshing...' : 'Refresh (10 credits)'}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 overflow-y-auto">
                <div role="status" aria-label="Analysis status" aria-live="polite" className={insightNotice ? 'mb-4 rounded-lg border border-border px-3.5 py-2.5 text-sm' : 'sr-only'}>
                  {cacheStatus === 'insufficient_data' && hasData ? `${insufficientNotice || resolveRefreshOutcome({ cacheStatus }).body} ` : ''}{insightNotice}
                </div>
                {insightsError && insightsFailureCopy?.action.kind === 'link' && (
                  <Link to={insightsFailureCopy.action.to}>{insightsFailureCopy.action.label}</Link>
                )}
                {!isLoading && insightsError && insightsFailureCopy?.action.kind !== 'link' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={insightsRetryKind === 'refresh' ? refreshInsights : loadInsights}
                      disabled={isRefreshing || isLoading}
                    >
                      Retry
                    </Button>
                )}

                {!isLoading && !hasData && !insightsError && (
                  <div className="flex flex-col items-center justify-center min-h-65 text-center">
                    <div className="w-12 h-12 rounded-xl bg-[#111111] border border-border flex items-center justify-center mb-4">
                      <Sparkles className="w-6 h-6 text-muted" />
                    </div>
                    <h2 className="text-text text-base font-semibold mb-2">
                      {resolveRefreshOutcome({ cacheStatus }).heading}
                    </h2>
                    <p className="text-muted text-sm mb-5 max-w-xs">
                      {insufficientNotice || resolveRefreshOutcome({ cacheStatus }).body}
                    </p>
                    {cacheStatus === 'insufficient_data' && <Link to="/data-health">Upload Sales Data</Link>}
                    {cacheStatus !== 'unconfigured' && cacheStatus !== 'insufficient_data' && (
                      <div className="flex flex-wrap justify-center gap-2">
                        <Button type="button" onClick={refreshInsights} disabled={isRefreshing}>
                          <RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />
                          {isRefreshing ? 'Generating...' : 'Generate (10 credits)'}
                        </Button>
                        <Button asChild variant="outline">
                          <Link to="/data-health">
                            <Upload className="w-4 h-4" />
                            Upload Sales Data
                          </Link>
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {(isLoading || hasData) && (
                  <div>
                    {isLoading
                      ? Array.from({ length: 4 }).map((_, i) => <InsightSkeleton key={i} />)
                      : insights.map((insight, i) => (
                          <InsightCard key={insight.id} insight={insight} index={i} />
                        ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </AppLayout>

      {renameTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rename-chat-title"
        >
          <form
            onSubmit={confirmRenameChat}
            className="w-full max-w-md rounded-2xl border border-border bg-[#151515] p-5 shadow-2xl shadow-black/40"
          >
            <div className="mb-4">
              <h2 id="rename-chat-title" className="text-lg font-semibold text-text">Rename chat</h2>
              <p className="mt-1 text-sm text-muted">Give this conversation a clearer name.</p>
            </div>
            <input
              value={renameTitle}
              onChange={(event) => setRenameTitle(event.target.value)}
              className="w-full rounded-xl border border-border bg-[#101010] px-3 py-2.5 text-sm text-text outline-none transition-colors placeholder:text-[#949494] focus:border-guava-green"
              aria-label="Chat name"
              autoFocus
            />
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setRenameTarget(null)
                  setRenameTitle('')
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!renameTitle.trim()}>
                Save
              </Button>
            </div>
          </form>
        </div>
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-chat-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-border bg-[#151515] p-5 shadow-2xl shadow-black/40">
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-guava-red/12 text-guava-red-text">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h2 id="delete-chat-title" className="text-lg font-semibold text-text">Delete chat?</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  Delete "{deleteTarget.title}"? This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button type="button" onClick={confirmDeleteChat} className="bg-guava-red hover:bg-guava-red/90">
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
