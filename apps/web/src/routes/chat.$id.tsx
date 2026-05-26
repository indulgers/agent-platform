import { createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect } from 'react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useChatStore, type UiMessage } from '@/stores/chat-store'
import { ChatStream } from '@/components/chat-stream'
import { ConversationSidebar } from '@/components/conversation-sidebar'

interface ConversationWithMessages {
  id: string
  title: string
  model: string | null
  messages: Array<{
    id: string
    role: string
    content: string
    toolCalls?: unknown
    usage?: { model: string; promptTokens: number; completionTokens: number; costUsd: number } | null
    attachments?:
      | Array<{ key: string; kind: 'image'; mediaType: string; size: number; originalName?: string }>
      | null
  }>
}

export const Route = createFileRoute('/chat/$id')({
  beforeLoad: () => {
    if (!useAuthStore.getState().token) throw redirect({ to: '/login' })
  },
  component: ChatPage,
})

function ChatPage() {
  const { id } = Route.useParams()
  const setConversation = useChatStore(s => s.setConversation)
  const loadMessages = useChatStore(s => s.loadMessages)
  const reset = useChatStore(s => s.reset)

  useEffect(() => {
    setConversation(id)
    reset()
    api<ConversationWithMessages>(`/conversations/${id}`).then(convo => {
      const ui: UiMessage[] = []
      for (const m of convo.messages) {
        if (m.role === 'user')
          ui.push({
            id: m.id,
            role: 'user',
            content: m.content,
            tools: [],
            attachments: m.attachments ?? undefined,
          })
        else if (m.role === 'assistant')
          ui.push({
            id: m.id,
            role: 'assistant',
            content: m.content,
            tools: [],
            usage: m.usage ?? undefined,
          })
        else if (m.role === 'tool') {
          const last = ui[ui.length - 1]
          if (last && last.role === 'assistant') {
            last.content = last.content + `\n\n[tool] ${m.content.slice(0, 200)}`
          }
        }
      }
      loadMessages(ui)
    })
  }, [id, setConversation, loadMessages, reset])

  return (
    <div className="flex-1 flex min-h-0">
      <ConversationSidebar activeId={id} />
      <ChatStream conversationId={id} />
    </div>
  )
}
