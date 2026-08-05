import { useState } from 'react'
import { Check, ShieldAlert, X } from 'lucide-react'
import { resolveCheckpoint } from '@/lib/runs'
import { Button } from '@/components/ui/button'

/**
 * The approval prompt shown while a Run is paused at a checkpoint: the pending
 * tool call and its arguments, with approve (resume and run it) or reject (stop).
 */
export function CheckpointCard({ runId, tool, args }: { runId: string; tool: string; args: unknown }) {
  const [busy, setBusy] = useState(false)

  const resolve = async (approve: boolean) => {
    if (busy) return
    setBusy(true)
    try {
      await resolveCheckpoint(runId, approve)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-[color:color-mix(in_oklab,var(--color-warning)_45%,var(--color-hairline))] bg-[color:color-mix(in_oklab,var(--color-warning)_6%,var(--color-surface-1))] p-3 space-y-2">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
        <ShieldAlert className="w-4 h-4 text-[color:var(--color-warning)]" />
        Approve tool call?
      </div>
      <div className="text-[13px] font-mono text-foreground">{tool}</div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all text-[11px] font-mono text-muted-foreground bg-[color:var(--color-surface-2)] rounded-md p-2">
        {JSON.stringify(args, null, 2)}
      </pre>
      <div className="flex gap-2 pt-1">
        <Button onClick={() => resolve(true)} disabled={busy} size="sm" className="gap-1.5">
          <Check className="w-3.5 h-3.5" /> Approve
        </Button>
        <Button onClick={() => resolve(false)} disabled={busy} size="sm" variant="ghost" className="gap-1.5">
          <X className="w-3.5 h-3.5" /> Reject
        </Button>
      </div>
    </div>
  )
}
