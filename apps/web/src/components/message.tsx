import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Copy, Check, RotateCw, Pencil } from 'lucide-react'
import type { UiMessage } from '@/stores/chat-store'
import { ToolCallCard } from '@/components/tool-call-card'
import { Markdown } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export interface MessageProps {
  message: UiMessage
  isStreaming?: boolean
  isLastAssistant?: boolean
  onRegenerate?: () => void
  /** Fires when the user saves an edit on their own message. */
  onEdit?: (messageId: string, content: string) => void
  /** Disable edit/regenerate while a stream is in flight. */
  isStreamingAny?: boolean
}

export function Message({
  message,
  isStreaming,
  isLastAssistant,
  onRegenerate,
  onEdit,
  isStreamingAny,
}: MessageProps) {
  const isUser = message.role === 'user'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Re-sync the draft if the message content changes (e.g. when the store reloads from server)
  useEffect(() => {
    if (!editing) setDraft(message.content)
  }, [message.content, editing])

  // Focus + size the textarea when entering edit mode.
  useEffect(() => {
    if (editing) {
      const t = textareaRef.current
      if (!t) return
      t.focus()
      t.setSelectionRange(t.value.length, t.value.length)
      t.style.height = 'auto'
      t.style.height = Math.min(t.scrollHeight, 320) + 'px'
    }
  }, [editing])

  const startEdit = () => {
    setDraft(message.content)
    setEditing(true)
  }

  const saveEdit = () => {
    const next = draft.trim()
    if (!next || next === message.content) {
      setEditing(false)
      return
    }
    setEditing(false)
    onEdit?.(message.id, next)
  }

  const cancelEdit = () => {
    setDraft(message.content)
    setEditing(false)
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      saveEdit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelEdit()
    }
  }

  return (
    <div className={cn('group flex', isUser ? 'justify-end' : 'justify-start')}>
      <div className={cn('flex flex-col gap-1', isUser ? 'items-end max-w-[85%]' : 'max-w-[85%]')}>
        {/* ---- bubble ---- */}
        {editing && isUser ? (
          <div
            className={cn(
              'w-full rounded-2xl px-3 py-2 text-[14px] leading-[1.55] border',
              'bg-[color:var(--color-surface-2)] border-[color:var(--color-hairline-strong)]',
            )}
            style={{ minWidth: '420px' }}
          >
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={e => {
                setDraft(e.target.value)
                const t = e.currentTarget
                t.style.height = 'auto'
                t.style.height = Math.min(t.scrollHeight, 320) + 'px'
              }}
              onKeyDown={onKey}
              rows={2}
              className="bg-transparent border-0 px-0 py-0 resize-none focus-visible:ring-0 focus-visible:ring-offset-0 min-h-0"
            />
            <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-[color:var(--color-hairline)]">
              <span className="mr-auto text-[11px] text-muted-foreground font-mono">⌘↵ to save · Esc to cancel</span>
              <Button size="sm" variant="ghost" onClick={cancelEdit}>
                Cancel
              </Button>
              <Button size="sm" onClick={saveEdit} disabled={!draft.trim()}>
                Save & regenerate
              </Button>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              'rounded-2xl px-3.5 py-2 text-[14px] leading-[1.55]',
              isUser
                ? 'bg-[color:var(--color-accent)] text-white border border-[color:color-mix(in_oklab,var(--color-accent)_80%,white_20%)] shadow-sm'
                : 'bg-[color:var(--color-surface-1)] border border-border',
            )}
          >
            {message.tools.map(t => <ToolCallCard key={t.id} tool={t} />)}

            {isUser ? (
              <div className="whitespace-pre-wrap break-words">{message.content}</div>
            ) : message.content ? (
              <Markdown content={message.content + (isStreaming ? ' ▍' : '')} />
            ) : isStreaming ? (
              <span className="text-muted-foreground">Thinking…</span>
            ) : null}
          </div>
        )}

        {/* ---- action row ---- */}
        {!editing && !isStreaming && message.content && (
          <div className="flex gap-1 px-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <CopyButton text={message.content} />
            {isUser && onEdit && !isStreamingAny && <EditButton onClick={startEdit} />}
            {!isUser && isLastAssistant && onRegenerate && !isStreamingAny && (
              <RegenerateButton onClick={onRegenerate} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard denied */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1 px-2 h-6 rounded-md text-[11.5px] text-muted-foreground hover:text-foreground hover:bg-[color:var(--color-surface-2)] border border-transparent hover:border-border transition-colors"
      title="Copy"
    >
      {copied ? (
        <>
          <Check className="w-3 h-3 text-[color:var(--color-success)]" />
          <span className="text-[color:var(--color-success)]">Copied</span>
        </>
      ) : (
        <>
          <Copy className="w-3 h-3" />
          <span>Copy</span>
        </>
      )}
    </button>
  )
}

function RegenerateButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2 h-6 rounded-md text-[11.5px] text-muted-foreground hover:text-foreground hover:bg-[color:var(--color-surface-2)] border border-transparent hover:border-border transition-colors"
      title="Regenerate"
    >
      <RotateCw className="w-3 h-3" />
      <span>Regenerate</span>
    </button>
  )
}

function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2 h-6 rounded-md text-[11.5px] text-muted-foreground hover:text-foreground hover:bg-[color:var(--color-surface-2)] border border-transparent hover:border-border transition-colors"
      title="Edit"
    >
      <Pencil className="w-3 h-3" />
      <span>Edit</span>
    </button>
  )
}
