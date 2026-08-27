import { createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'

type Connector = { providerId: string; displayName: string; status: 'active' | 'revoked' | 'disconnected'; expiresAt: string | null }

export const Route = createFileRoute('/settings/integrations')({
  beforeLoad: () => { if (!useAuthStore.getState().token) throw redirect({ to: '/login' }) },
  component: Integrations,
})

/**
 * Displays available integrations and their connection status, with controls to authorize or disconnect providers.
 */
function Integrations() {
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [error, setError] = useState<string | null>(null)
  const load = () => api<Connector[]>('/connectors').then(setConnectors).catch(e => setError(e.message))
  useEffect(() => { void load() }, [])
  const callback = new URLSearchParams(window.location.search)
  const callbackStatus = callback.get('connector')
  const authorize = async (providerId: string) => { const { url } = await api<{ url: string }>(`/connectors/${providerId}/authorize`, { method: 'POST' }); window.location.assign(url) }
  const disconnect = async (providerId: string) => { await api<void>(`/connectors/${providerId}`, { method: 'DELETE' }); await load() }
  return <div className="flex-1 overflow-auto p-8"><div className="max-w-2xl space-y-6"><div><h1 className="text-xl font-semibold">Integrations</h1><p className="mt-1 text-sm text-muted-foreground">Connect services that the agent can use only in your conversations.</p></div>{callbackStatus === 'success' && <p className="text-sm text-[color:var(--color-success)]">Notion connected.</p>}{callbackStatus === 'cancel' && <p className="text-sm text-muted-foreground">Notion connection was cancelled.</p>}{callbackStatus === 'error' && <p className="text-sm text-[color:var(--color-danger)]">{callback.get('message') ?? 'Notion connection failed.'}</p>}{error && <p className="text-sm text-[color:var(--color-danger)]">{error}</p>}{connectors.map(c => <section key={c.providerId} className="rounded-lg border border-border p-5 flex items-center justify-between"><div><h2 className="font-medium">{c.displayName}</h2><p className="text-sm text-muted-foreground">{c.status === 'active' ? 'Connected' : c.status === 'revoked' ? 'Reconnect required' : 'Not connected'}</p></div>{c.status === 'active' ? <Button variant="ghost" onClick={() => void disconnect(c.providerId)}>Disconnect</Button> : <Button onClick={() => void authorize(c.providerId)}>{c.status === 'revoked' ? 'Reconnect' : 'Connect'}</Button>}</section>)}</div></div>
}
