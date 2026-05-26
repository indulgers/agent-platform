import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowDown, Send, Square } from 'lucide-react'
import { useChatStore } from '@/stores/chat-store'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Kbd } from '@/components/ui/kbd'
import { Message } from '@/components/message'
import { ModelPicker } from '@/components/model-picker'
import { Welcome } from '@/components/welcome'
import { consumeSse } from '@/lib/sse'
import { useRefreshConversations } from '@/lib/conversations'

export function ChatStream({ conversationId }: { conversationId: string }) {
  const messages = useChatStore(s => s.messages)
  const isStreaming = useChatStore(s => s.isStreaming)
  const addUserMessage = useChatStore(s => s.addUserMessage)
  const beginAssistant = useChatStore(s => s.beginAssistant)
  const handleEvent = useChatStore(s => s.handleEvent)
  const stop = useChatStore(s => s.stop)
  const dropLastAssistant = useChatStore(s => s.dropLastAssistant)
  const dropFromIndex = useChatStore(s => s.dropFromIndex)
  const refreshConversations = useRefreshConversations()

  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // Auto-scroll only while the user hasn't scrolled up themselves.
  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, autoScroll])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    setAutoScroll(distance < 80)
  }

  // Cmd/Ctrl+K from anywhere focuses the composer.
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        composerRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const stream = async (path: string, body: unknown) => {
    const controller = beginAssistant()
    try {
      await consumeSse(path, body, handleEvent, controller.signal)
    } catch (err) {
      if (controller.signal.aborted) return
      handleEvent({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      refreshConversations()
    }
  }

  const submit = async () => {
    const content = draft.trim()
    if (!content || isStreaming) return
    setDraft('')
    addUserMessage(content)
    await stream(`/agents/${conversationId}/messages`, { content })
  }

  const regenerate = async () => {
    if (isStreaming) return
    dropLastAssistant()
    await stream(`/agents/${conversationId}/regenerate`, {})
  }

  const editMessage = async (messageId: string, content: string) => {
    if (isStreaming) return
    // Drop the edited user message + everything after it locally so the UI
    // doesn't briefly show stale content. Then add the new user message
    // (which streams as a fresh assistant reply).
    const idx = messages.findIndex(m => m.id === messageId)
    if (idx >= 0) dropFromIndex(idx)
    addUserMessage(content)
    await stream(`/agents/${conversationId}/edit-message`, { messageId, content })
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  let lastAssistantIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'assistant') {
      lastAssistantIdx = i
      break
    }
  }

  const isEmpty = messages.length === 0

  return (
    <div className="flex-1 flex flex-col min-w-0 relative">
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <Welcome onPick={p => { setDraft(p); composerRef.current?.focus() }} />
        ) : (
          <div className="px-4 py-6 space-y-5 max-w-3xl w-full mx-auto">
            {messages.map((m, i) => (
              <Message
                key={m.id}
                message={m}
                isStreaming={isStreaming && i === messages.length - 1 && m.role === 'assistant'}
                isLastAssistant={i === lastAssistantIdx && !isStreaming}
                isStreamingAny={isStreaming}
                onRegenerate={regenerate}
                onEdit={editMessage}
              />
            ))}
          </div>
        )}
      </div>

      {!autoScroll && !isEmpty && (
        <button
          type="button"
          onClick={() => {
            setAutoScroll(true)
            if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
          }}
          className="absolute bottom-[100px] right-6 z-10 inline-flex items-center justify-center w-8 h-8 rounded-full bg-[color:var(--color-surface-2)] border border-border shadow-sm text-muted-foreground hover:text-foreground hover:border-[color:var(--color-hairline-strong)] transition-colors"
          aria-label="Scroll to latest"
        >
          <ArrowDown className="w-3.5 h-3.5" />
        </button>
      )}

      <div className="border-t border-border p-4">
        <div className="max-w-3xl w-full mx-auto">
          <div className="flex gap-2 items-end">
            <div className="relative flex-1">
              <Textarea
                ref={composerRef}
                placeholder={isStreaming ? 'Streaming…' : 'Ask the agent something…'}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={onKey}
                disabled={isStreaming}
                rows={2}
                className="bg-[color:var(--color-surface-2)] resize-none pr-24"
              />
              <div className="absolute right-3 bottom-2.5 flex items-center gap-1 pointer-events-none opacity-60">
                <Kbd>↵</Kbd>
                <span className="text-[11px] text-muted-foreground">to send</span>
              </div>
            </div>
            {isStreaming ? (
              <Button onClick={stop} variant="secondary" className="gap-1.5">
                <Square className="w-3 h-3 fill-current" /> Stop
              </Button>
            ) : (
              <Button onClick={submit} disabled={draft.trim().length === 0} className="gap-1.5">
                <Send className="w-3.5 h-3.5" /> Send
              </Button>
            )}
          </div>
          <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground font-mono">
            <ModelPicker conversationId={conversationId} />
            <UsageSummary />
            <span className="ml-auto flex items-center gap-1">
              <Kbd className="text-[10px]">⌘K</Kbd>
              <span>focus</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function UsageSummary() {
  const messages = useChatStore(s => s.messages)

  const { totalTokens, totalCost, lastUsage } = useMemo(() => {
    let totalTokens = 0
    let totalCost = 0
    let lastUsage: { promptTokens: number; completionTokens: number; costUsd: number } | undefined
    for (const m of messages) {
      if (m.role !== 'assistant' || !m.usage) continue
      totalTokens += m.usage.promptTokens + m.usage.completionTokens
      totalCost += m.usage.costUsd
      lastUsage = m.usage
    }
    return { totalTokens, totalCost, lastUsage }
  }, [messages])

  if (!lastUsage) return null

  return (
    <>
      <span className="opacity-60">·</span>
      <span title="Last turn: input ↑ output ↓ cost">
        ↑ {formatTokens(lastUsage.promptTokens)} · ↓ {formatTokens(lastUsage.completionTokens)} · $
        {lastUsage.costUsd.toFixed(4)}
      </span>
      <span className="opacity-60">·</span>
      <span title="Conversation total tokens / cost">
        {formatTokens(totalTokens)} total · ${totalCost.toFixed(4)}
      </span>
    </>
  )
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1000 * 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K'
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
}
