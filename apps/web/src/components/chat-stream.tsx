import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useChatStore } from '@/stores/chat-store'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Kbd } from '@/components/ui/kbd'
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
                'rounded-xl px-3 py-2 text-sm max-w-[80%] leading-[1.55]',
                m.role === 'user'
                  ? 'bg-[color:var(--color-accent)] text-white border border-[color:color-mix(in_oklab,var(--color-accent)_80%,white_20%)] shadow-sm'
                  : 'bg-[color:var(--color-surface-1)] border border-border',
              )}
            >
              {m.tools.map(t => <ToolCallCard key={t.id} tool={t} />)}
              <div className="whitespace-pre-wrap">
                {m.content || (m.role === 'assistant' && isStreaming ? <span className="text-muted-foreground">…</span> : '')}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-border p-4 max-w-3xl w-full mx-auto">
        <div className="flex gap-2 items-end">
          <div className="relative flex-1">
            <Textarea
              placeholder="Ask the agent something…"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={onKey}
              disabled={isStreaming}
              rows={2}
              className="bg-[color:var(--color-surface-2)] resize-none"
            />
            <div className="absolute right-3 bottom-2.5 flex items-center gap-1 pointer-events-none opacity-60">
              <Kbd>↵</Kbd>
              <span className="text-[11px] text-muted-foreground">to send</span>
            </div>
          </div>
          <Button onClick={submit} disabled={isStreaming || draft.trim().length === 0}>
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}
