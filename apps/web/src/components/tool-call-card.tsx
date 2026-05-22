import type { UiToolEvent } from '@/stores/chat-store'
import { cn } from '@/lib/utils'

const statusColour: Record<UiToolEvent['status'], string> = {
  running: 'border-yellow-500/40 bg-yellow-500/5',
  ok: 'border-emerald-500/40 bg-emerald-500/5',
  error: 'border-destructive/50 bg-destructive/5',
}

export function ToolCallCard({ tool }: { tool: UiToolEvent }) {
  return (
    <div className={cn('rounded-md border px-3 py-2 my-2 text-xs font-mono space-y-1', statusColour[tool.status])}>
      <div className="font-semibold flex items-center gap-2">
        <span>{tool.name}</span>
        <span className="uppercase text-[10px] tracking-wide opacity-70">{tool.status}</span>
      </div>
      <details>
        <summary className="cursor-pointer opacity-70 text-[11px]">args</summary>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(tool.args, null, 2)}</pre>
      </details>
      {(tool.result !== undefined || tool.error) && (
        <details>
          <summary className="cursor-pointer opacity-70 text-[11px]">{tool.error ? 'error' : 'result'}</summary>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all">
            {tool.error ?? JSON.stringify(tool.result, null, 2)}
          </pre>
        </details>
      )}
    </div>
  )
}
