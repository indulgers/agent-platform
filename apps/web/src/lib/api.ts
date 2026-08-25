import { useAuthStore } from '@/stores/auth-store'
import { refreshAccessToken } from '@/lib/auth'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message)
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const send = () => {
    const token = useAuthStore.getState().token
    const headers = new Headers(init.headers)
    headers.set('Content-Type', 'application/json')
    if (token) headers.set('Authorization', `Bearer ${token}`)
    // credentials: send the httpOnly refresh cookie on same-site requests.
    return fetch(`/api${path}`, { ...init, headers, credentials: 'include' })
  }

  let res = await send()
  // Access token expired → silently refresh once and retry. Auth endpoints are
  // excluded so a bad login/refresh doesn't recurse into another refresh.
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const refreshed = await refreshAccessToken()
    if (refreshed) res = await send()
  }

  if (!res.ok) {
    let body: unknown = undefined
    try {
      body = await res.json()
    } catch {
      /* noop */
    }
    if (res.status === 401) useAuthStore.getState().clear()
    throw new ApiError(res.status, `${res.status} ${res.statusText}`, body)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
