import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import Improvements from './Improvements'

const mocks = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(),
  user: { id: 'draft-owner', name: 'Owner', email: 'draft@test.local', role: 'owner', orgId: 'org', activeCafeId: 'cafe-a', cafeIds: ['cafe-a', 'cafe-b'] },
}))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user, isOwner: true, logout: vi.fn(), switchCafe: vi.fn() }) }))
vi.mock('@/lib/api', () => ({ default: { get: mocks.get, post: mocks.post } }))
vi.mock('@/assets/logo.png', () => ({ default: 'logo.png' }))
vi.mock('@/assets/guava-icon.png', () => ({ default: 'icon.png' }))

const description = `S18-start ${'The draft should survive a forced sign-in. '.repeat(40)}`.slice(0, 1492) + ' S18-end'
const mount = () => render(<MemoryRouter><Improvements /></MemoryRouter>)
async function openForm() {
  await screen.findByText('No improvements logged yet')
  await userEvent.click(screen.getAllByRole('button', { name: /log an improvement/i })[0])
}
async function fillDraft() {
  fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'S18 retained title' } })
  fireEvent.change(screen.getByLabelText(/What's the idea/i), { target: { value: description } })
  fireEvent.change(screen.getByLabelText(/What would "done" look like/i), { target: { value: 'Keep every character.' } })
  await userEvent.selectOptions(screen.getByLabelText('Area of the app'), 'planning')
  await userEvent.selectOptions(screen.getByLabelText('Priority'), 'high')
}

describe('Improvements draft recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    mocks.user.id = 'draft-owner'
    mocks.user.activeCafeId = 'cafe-a'
    mocks.get.mockResolvedValue({ data: { improvements: [], counts: { all: 0 } } })
    mocks.post.mockRejectedValue({ response: { status: 401, data: { message: 'Please sign in again.' } } })
  })

  it('restores all typed fields after a refused save and forced-sign-in remount for the same user and cafe', async () => {
    const first = mount()
    await openForm()
    await fillDraft()
    await userEvent.click(screen.getByRole('button', { name: /log it/i }))
    await screen.findByText('Please sign in again.')
    first.unmount()
    mount()
    expect(await screen.findByLabelText('Title *')).toHaveValue('S18 retained title')
    expect(screen.getByLabelText(/What's the idea/i)).toHaveValue(description)
    expect(screen.getByLabelText(/What would "done" look like/i)).toHaveValue('Keep every character.')
    expect(screen.getByLabelText('Area of the app')).toHaveValue('planning')
    expect(screen.getByLabelText('Priority')).toHaveValue('high')
    expect(mocks.post).toHaveBeenCalledTimes(1)
  })

  it('keeps drafts separate for another cafe and another user', async () => {
    const first = mount()
    await openForm()
    await fillDraft()
    first.unmount()
    mocks.user.activeCafeId = 'cafe-b'
    const otherCafe = mount()
    await openForm()
    expect(screen.getByLabelText('Title *')).toHaveValue('')
    otherCafe.unmount()
    mocks.user.activeCafeId = 'cafe-a'
    mocks.user.id = 'other-owner'
    const otherUser = mount()
    await openForm()
    expect(screen.getByLabelText('Title *')).toHaveValue('')
    otherUser.unmount()
    mocks.user.id = 'draft-owner'
    mount()
    expect(await screen.findByLabelText('Title *')).toHaveValue('S18 retained title')
  })

  it('discards the saved draft when the user cancels', async () => {
    const first = mount()
    await openForm()
    await fillDraft()
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    first.unmount()
    mount()
    await openForm()
    expect(screen.getByLabelText('Title *')).toHaveValue('')
  })

  it('does not reopen an untouched form after a remount', async () => {
    const first = mount()
    await openForm()
    first.unmount()
    mount()
    await screen.findByText('No improvements logged yet')
    expect(screen.queryByLabelText('Title *')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /log an improvement/i }).length).toBeGreaterThan(0)
  })

  it('discards the draft only after a successful save', async () => {
    mocks.post.mockResolvedValue({ data: { improvement: { ticketNumber: 1 } } })
    const first = mount()
    await openForm()
    await fillDraft()
    await userEvent.click(screen.getByRole('button', { name: /log it/i }))
    await screen.findByText(/Logged as #1/i)
    first.unmount()
    mount()
    await openForm()
    expect(screen.getByLabelText('Title *')).toHaveValue('')
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1))
  })
})
