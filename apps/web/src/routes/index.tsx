import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'

interface ConversationRow {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    if (!useAuthStore.getState().token) throw redirect({ to: '/login' })
  },
  component: IndexRedirect,
})

/**
 * The root path is just a router — we always want the user inside a chat.
 * Pick the most-recent conversation, or create one if the user has none.
 */
function IndexRedirect() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = await api<ConversationRow[]>('/conversations')
        if (cancelled) return
        if (list.length > 0) {
          void navigate({ to: '/chat/$id', params: { id: list[0]!.id }, replace: true })
          return
        }
        const created = await api<ConversationRow>('/conversations', {
          method: 'POST',
          body: JSON.stringify({}),
        })
        if (cancelled) return
        void navigate({ to: '/chat/$id', params: { id: created.id }, replace: true })
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [navigate])

  return (
    <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
      {error ? <span className="text-[color:var(--color-danger)]">{error}</span> : 'Loading…'}
    </div>
  )
}
