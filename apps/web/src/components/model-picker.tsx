import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import {
  useConversations,
  useModels,
  useUpdateConversation,
  type ModelEntry,
} from '@/lib/conversations'
import { cn } from '@/lib/utils'

const PROVIDER_LABEL: Record<ModelEntry['provider'], string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
}

const PROVIDER_DOT_CLASS: Record<ModelEntry['provider'], string> = {
  openai: 'bg-emerald-400',
  anthropic: 'bg-orange-400',
  deepseek: 'bg-blue-400',
}

export function ModelPicker({ conversationId }: { conversationId: string }) {
  const { data: models } = useModels()
  const { data: conversations } = useConversations()
  const update = useUpdateConversation()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const conversation = conversations?.find(c => c.id === conversationId)
  const effectiveModelId = conversation?.model ?? models?.defaultModel
  const active = models?.models.find(m => m.id === effectiveModelId)
  const isOverride = !!conversation?.model

  // close on outside click / Esc
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!models) {
    return (
      <span className="font-mono text-[11px] text-muted-foreground">loading models…</span>
    )
  }

  const grouped = groupByProvider(models.models)

  const onPick = async (id: string | null) => {
    setOpen(false)
    await update.mutateAsync({ id: conversationId, patch: { model: id } })
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          'inline-flex items-center gap-1.5 px-2 h-6 rounded-md text-[11.5px] font-mono',
          'border border-border bg-[color:var(--color-surface-1)] hover:bg-[color:var(--color-surface-2)]',
          'text-foreground transition-colors',
        )}
        title={isOverride ? 'Conversation override' : 'Using default model'}
      >
        <span className={cn('w-1.5 h-1.5 rounded-full', active && PROVIDER_DOT_CLASS[active.provider])} />
        <span>{active?.displayName ?? effectiveModelId ?? 'no model'}</span>
        <ChevronDown className="w-3 h-3 opacity-70" />
      </button>

      {open && (
        <div
          className="absolute bottom-[calc(100%+6px)] left-0 z-50 min-w-[280px] rounded-lg border border-border bg-[color:var(--color-surface-2)] shadow-lg overflow-hidden"
          role="listbox"
        >
          <div className="px-3 py-2 border-b border-border text-[11px] font-mono text-muted-foreground tracking-[0.04em] flex items-center justify-between">
            <span>MODEL</span>
            {isOverride && (
              <button
                type="button"
                onClick={() => onPick(null)}
                className="text-[10.5px] normal-case text-muted-foreground hover:text-foreground"
                title="Use the workspace default for new conversations"
              >
                use default ({models.defaultModel})
              </button>
            )}
          </div>
          <div className="max-h-[420px] overflow-y-auto py-1">
            {Object.entries(grouped).map(([provider, list]) => (
              <div key={provider}>
                <div className="px-3 pt-2 pb-1 text-[10px] font-mono text-muted-foreground tracking-[0.06em]">
                  {PROVIDER_LABEL[provider as ModelEntry['provider']]}
                </div>
                {list.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onPick(m.id)}
                    className={cn(
                      'w-full px-3 py-2 text-left hover:bg-[color:var(--color-surface-3)] transition-colors flex items-start gap-3',
                      m.id === effectiveModelId && 'bg-[color:var(--color-surface-3)]',
                    )}
                    role="option"
                    aria-selected={m.id === effectiveModelId}
                  >
                    <span className={cn('mt-1.5 w-1.5 h-1.5 rounded-full shrink-0', PROVIDER_DOT_CLASS[m.provider])} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium">{m.displayName}</span>
                        {m.supportsVision && (
                          <span className="text-[9.5px] font-mono uppercase tracking-[0.06em] text-muted-foreground border border-border rounded px-1 py-px">
                            vision
                          </span>
                        )}
                      </div>
                      <div className="text-[11.5px] text-muted-foreground">{m.description}</div>
                      <div className="text-[10.5px] font-mono text-muted-foreground mt-1">
                        ${m.costPer1M.input.toFixed(2)} in · ${m.costPer1M.output.toFixed(2)} out / 1M tok
                      </div>
                    </div>
                    {m.id === effectiveModelId && <Check className="w-3.5 h-3.5 mt-1.5 text-[color:var(--color-accent)] shrink-0" />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function groupByProvider(models: ModelEntry[]): Record<string, ModelEntry[]> {
  const out: Record<string, ModelEntry[]> = {}
  for (const m of models) {
    out[m.provider] ??= []
    out[m.provider]!.push(m)
  }
  return out
}
