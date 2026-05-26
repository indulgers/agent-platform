import { useState } from 'react'
import { Copy, Check, RotateCw } from 'lucide-react'
import type { UiMessage } from '@/stores/chat-store'
import { ToolCallCard } from '@/components/tool-call-card'
import { Markdown } from '@/components/markdown'
import { cn } from '@/lib/utils'

export interface MessageProps {
  message: UiMessage
  isStreaming?: boolean
  /** Whether this is the latest assistant message — controls regenerate visibility. */
  isLastAssistant?: boolean
  onRegenerate?: () => void
}

export function Message({ message, isStreaming, isLastAssistant, onRegenerate }: MessageProps) {
  const isUser = message.role === 'user'

  return (
    <div className={cn('group flex', isUser ? 'justify-end' : 'justify-start')}>
      <div className={cn('flex flex-col gap-1 max-w-[85%]', isUser && 'items-end')}>
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

        {/* Action row — only on assistant, only when not streaming */}
        {!isUser && !isStreaming && message.content && (
          <div className="flex gap-1 px-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <CopyButton text={message.content} />
            {isLastAssistant && onRegenerate && <RegenerateButton onClick={onRegenerate} />}
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
      /* clipboard denied — fail quietly */
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
