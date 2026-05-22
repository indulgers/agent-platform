import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useChatStore } from '@/stores/chat-store'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ToolCallCard } from '@/components/tool-call-card'
import { consumeSse } from '@/lib/sse'
import { cn } from '@/lib/utils'

export function ChatStream({ conversationId }: { conversationId: string }) {
  const messages = useChatStore(s => s.messages)
  const isStreaming = useChatStore(s => s.isStreaming)
  const addUserMessage = useChatStore(s => s.addUserMessage)
  const beginAssistant = useChatStore(s => s.beginAssistant)
  const handleEvent = useChatStore(s => s.handleEvent)
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const submit = async () => {
    const content = draft.trim()
    if (!content || isStreaming) return
    setDraft('')
    addUserMessage(content)
    beginAssistant()
    try {
      await consumeSse(`/agents/${conversationId}/messages`, { content }, handleEvent)
    } catch (err) {
      handleEvent({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div className="flex-1 flex flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 max-w-3xl w-full mx-auto">
        {messages.map(m => (
          <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'rounded-lg px-3 py-2 text-sm max-w-[80%]',
                m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted',
              )}
            >
              {m.tools.map(t => <ToolCallCard key={t.id} tool={t} />)}
              <div className="whitespace-pre-wrap">{m.content || (m.role === 'assistant' && isStreaming ? '…' : '')}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t p-4 max-w-3xl w-full mx-auto">
        <div className="flex gap-2 items-end">
          <Textarea
            placeholder="Ask the agent something…"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onKey}
            disabled={isStreaming}
            rows={2}
          />
          <Button onClick={submit} disabled={isStreaming || draft.trim().length === 0}>
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}
