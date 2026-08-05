import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Square } from 'lucide-react'
import type { SseEvent } from '@agent-platform/shared'
import { useRunsStore } from '@/stores/runs-store'
import { getRun, interruptRun, RUNS_KEY, type RunListRow } from '@/lib/runs'
import { consumeSseGet } from '@/lib/sse'
import { Button } from '@/components/ui/button'
import { RunStatusBadge } from '@/components/runs/run-status-badge'
import { RunTimeline } from '@/components/runs/run-timeline'
import { PlanApprovalCard } from '@/components/runs/plan-approval-card'
import { CheckpointCard } from '@/components/runs/checkpoint-card'

/**
 * One Run: renders the durable snapshot, then applies the live event tail so the
 * timeline and status update in real time. On open we load the snapshot first,
 * then subscribe — the reducer's handlers are idempotent, so any overlap dedupes.
 * The pinned action card (plan approval / checkpoint) is layered on in #20.
 */
export function RunDetail({ runId }: { runId: string }) {
  const qc = useQueryClient()
  const goal = useRunsStore(s => s.goal)
  const status = useRunsStore(s => s.status)
  const proposedSteps = useRunsStore(s => s.proposedSteps)
  const tools = useRunsStore(s => s.tools)
  const answer = useRunsStore(s => s.answer)
  const error = useRunsStore(s => s.error)
  const pendingAction = useRunsStore(s => s.pendingAction)
  const checkpoint = useRunsStore(s => s.checkpoint)
  const reset = useRunsStore(s => s.reset)
  const loadSnapshot = useRunsStore(s => s.loadSnapshot)
  const handleEvent = useRunsStore(s => s.handleEvent)

  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const ctrl = new AbortController()
    setPhase('loading')
    reset()

    // Apply each live event, and keep the open Run's rail badge in sync (D7).
    const onEvent = (event: SseEvent) => {
      handleEvent(event)
      if (event.type === 'run_status') {
        qc.setQueryData<RunListRow[]>(RUNS_KEY, prev =>
          prev?.map(r => (r.id === runId ? { ...r, status: event.status } : r)),
        )
        if (event.status === 'done' || event.status === 'failed') {
          void qc.invalidateQueries({ queryKey: RUNS_KEY })
        }
      }
    }

    getRun(runId)
      .then(run => {
        if (ctrl.signal.aborted) return // a newer run was opened while this was in flight
        loadSnapshot(run)
        setPhase('ready')
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setPhase('error')
      })
      .finally(() => {
        if (ctrl.signal.aborted) return
        // Stream the live tail; a finished Run simply yields nothing.
        void consumeSseGet(`/runs/${runId}/events`, onEvent, ctrl.signal).catch(() => {
          /* aborted on unmount, or the run ended — snapshot already rendered */
        })
      })

    return () => ctrl.abort()
  }, [runId, reset, loadSnapshot, handleEvent, qc])

  if (phase === 'loading') {
    return (
      <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading run…
        </span>
      </div>
    )
  }
  if (phase === 'error') {
    return (
      <div className="flex-1 grid place-items-center text-sm text-[color:var(--color-danger)]">
        Couldn’t load this run.
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-3xl mx-auto w-full flex items-start justify-between gap-4">
          <h1 className="text-[15px] font-medium leading-snug text-foreground">{goal}</h1>
          <div className="flex items-center gap-2 shrink-0">
            {status === 'running' && (
              <Button
                onClick={() => void interruptRun(runId).catch(() => {})}
                variant="secondary"
                size="sm"
                className="gap-1.5"
              >
                <Square className="w-3 h-3 fill-current" /> Stop
              </Button>
            )}
            {status && <RunStatusBadge status={status} className="mt-0.5" />}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto w-full space-y-4">
          {status === 'failed' && error && (
            <div className="rounded-md border border-[color:color-mix(in_oklab,var(--color-danger)_50%,var(--color-hairline))] bg-[color:color-mix(in_oklab,var(--color-danger)_8%,var(--color-surface-1))] px-3 py-2 text-[13px] text-[color:var(--color-danger)]">
              {error}
            </div>
          )}

          {status === 'planning' ? (
            <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Drafting a plan…
            </p>
          ) : (
            <RunTimeline plan={proposedSteps} tools={tools} answer={answer} />
          )}

          {status === 'running' && tools.length === 0 && !answer && (
            <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Working…
            </p>
          )}
        </div>
      </div>

      {/* One pinned action slot: whatever the Run needs from the user right now. */}
      {pendingAction && (
        <div className="border-t border-border p-4">
          <div className="max-w-3xl mx-auto w-full">
            {pendingAction === 'plan' && proposedSteps && (
              <PlanApprovalCard runId={runId} steps={proposedSteps} />
            )}
            {pendingAction === 'checkpoint' && checkpoint && (
              <CheckpointCard runId={runId} tool={checkpoint.tool} args={checkpoint.args} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
