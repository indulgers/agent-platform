import { createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { useNavigate } from '@tanstack/react-router'

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
  component: HomePage,
})

function HomePage() {
  const navigate = useNavigate()
  const [conversations, setConversations] = useState<ConversationRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api<ConversationRow[]>('/conversations')
      .then(setConversations)
      .finally(() => setLoading(false))
  }, [])

  const startNew = async () => {
    const convo = await api<ConversationRow>('/conversations', { method: 'POST', body: JSON.stringify({}) })
    navigate({ to: '/chat/$id', params: { id: convo.id } })
  }

  return (
    <div className="max-w-2xl w-full mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Conversations</h1>
        <Button onClick={startNew}>New chat</Button>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : conversations.length === 0 ? (
        <p className="text-sm text-muted-foreground">No conversations yet. Start a new chat.</p>
      ) : (
        <ul className="divide-y border rounded-md">
          {conversations.map(c => (
            <li key={c.id} className="p-3 hover:bg-accent">
              <button
                className="text-left w-full text-sm"
                onClick={() => navigate({ to: '/chat/$id', params: { id: c.id } })}
              >
                <div className="font-medium">{c.title}</div>
                <div className="text-xs text-muted-foreground">{new Date(c.updatedAt).toLocaleString()}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
