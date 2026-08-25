import { useAuthStore } from '@/stores/auth-store'

interface RefreshResponse {
  accessToken: string
  user: { id: string; email: string }
}

let refreshing: Promise<string | null> | null = null

/**
 * Silently renew the access token using the httpOnly refresh cookie. Single-flight:
 * concurrent 401s (e.g. a REST call and an SSE stream) share one refresh request.
 * Returns the new access token, or null if the session can't be renewed.
 */
export function refreshAccessToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = doRefresh().finally(() => {
      refreshing = null
    })
  }
  return refreshing
}

async function doRefresh(): Promise<string | null> {
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as RefreshResponse
    useAuthStore.getState().setAuth(data.accessToken, data.user)
    return data.accessToken
  } catch {
    return null
  }
}

/** Revoke the refresh token server-side, then clear local auth state. */
export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
  } catch {
    /* best-effort; clear locally regardless */
  }
  useAuthStore.getState().clear()
}
