import type { UiToolEvent } from '@/stores/chat-store'
import { cn } from '@/lib/utils'

const statusColour: Record<UiToolEvent['status'], string> = {
  running: 'border-[color:color-mix(in_oklab,var(--color-warning)_40%,var(--color-hairline))] bg-[color:color-mix(in_oklab,var(--color-warning)_6%,var(--color-surface-1))]',
  ok: 'border-[color:color-mix(in_oklab,var(--color-success)_40%,var(--color-hairline))] bg-[color:color-mix(in_oklab,var(--color-success)_6%,var(--color-surface-1))]',
  error: 'border-[color:color-mix(in_oklab,var(--color-danger)_50%,var(--color-hairline))] bg-[color:color-mix(in_oklab,var(--color-danger)_8%,var(--color-surface-1))]',
}

const statusGlyph: Record<UiToolEvent['status'], string> = {
  running: '⋯',
  ok: '✓',
  error: '✕',
}

const statusTone: Record<UiToolEvent['status'], string> = {
  running: 'text-[color:var(--color-warning)]',
  ok: 'text-[color:var(--color-success)]',
  error: 'text-[color:var(--color-danger)]',
}

export function ToolCallCard({ tool }: { tool: UiToolEvent }) {
  return (
    <div className={cn('rounded-md border px-3 py-2 my-2 text-xs font-mono space-y-1', statusColour[tool.status])}>
      <div className="flex items-center gap-2 font-semibold">
        <span className={cn('text-[14px] leading-none', statusTone[tool.status])} aria-hidden="true">
          {statusGlyph[tool.status]}
        </span>
        <span className="text-foreground">{tool.name}</span>
        <span className="uppercase text-[10px] tracking-[0.06em] text-muted-foreground">{tool.status}</span>
      </div>
      <details>
        <summary className="cursor-pointer text-[11px] text-muted-foreground">args</summary>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all text-muted-foreground">{JSON.stringify(tool.args, null, 2)}</pre>
      </details>
      {(tool.result !== undefined || tool.error) && (
        <details>
          <summary className="cursor-pointer text-[11px] text-muted-foreground">
            {tool.error ? 'error' : 'result'}
          </summary>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all text-muted-foreground">
            {tool.error ?? JSON.stringify(tool.result, null, 2)}
          </pre>
        </details>
      )}
    </div>
  )
}
