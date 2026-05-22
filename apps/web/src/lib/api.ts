import { useAuthStore } from '@/stores/auth-store'

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
  const token = useAuthStore.getState().token
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(`/api${path}`, { ...init, headers })
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
