// A tab-local identity hint, never a credential. Retain it on sign-out so stale history cannot belong to the next user.
const TAB_USER_KEY = 'yg.tabUserId'

export function tabUserId(): string | null {
  try { return sessionStorage.getItem(TAB_USER_KEY) } catch { return null }
}

export function rememberTabUser(id: string): void {
  try { sessionStorage.setItem(TAB_USER_KEY, id) } catch { /* Session state still clears return navigation in memory. */ }
}
