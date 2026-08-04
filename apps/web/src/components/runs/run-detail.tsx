import { useRun } from '@/lib/runs'
import { RunStatusBadge } from '@/components/runs/run-status-badge'
import { Markdown } from '@/components/markdown'

/**
 * Snapshot view of one Run (goal + status + result/error). The live timeline and
 * pinned action card are layered on in later slices (#19, #20).
 */
export function RunDetail({ runId }: { runId: string }) {
  const { data: run, isLoading, isError } = useRun(runId)

  if (isLoading) {
    return <div className="flex-1 grid place-items-center text-sm text-muted-foreground">Loading run…</div>
  }
  if (isError || !run) {
    return (
      <div className="flex-1 grid place-items-center text-sm text-[color:var(--color-danger)]">
        Couldn’t load this run.
      </div>
    )
  }

  const result = run.result as { answer?: string } | null | undefined

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-3xl mx-auto w-full flex items-start justify-between gap-4">
          <h1 className="text-[15px] font-medium leading-snug text-foreground">{run.goal}</h1>
          <RunStatusBadge status={run.status} className="shrink-0 mt-0.5" />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto w-full space-y-4">
          {run.status === 'failed' && run.error && (
            <div className="rounded-md border border-[color:color-mix(in_oklab,var(--color-danger)_50%,var(--color-hairline))] bg-[color:color-mix(in_oklab,var(--color-danger)_8%,var(--color-surface-1))] px-3 py-2 text-[13px] text-[color:var(--color-danger)]">
              {run.error}
            </div>
          )}

          {run.plan?.steps?.length ? (
            <section className="rounded-lg border border-border bg-[color:var(--color-surface-1)] p-4">
              <h2 className="text-[11px] font-mono tracking-[0.06em] text-muted-foreground mb-2">PLAN</h2>
              <ol className="space-y-1.5">
                {run.plan.steps.map(step => (
                  <li key={step.index} className="flex gap-2 text-[13px] text-foreground">
                    <span className="text-muted-foreground font-mono shrink-0">{step.index + 1}.</span>
                    <span>{step.description}</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {result?.answer ? (
            <section className="rounded-lg border border-border bg-[color:var(--color-surface-1)] p-4">
              <h2 className="text-[11px] font-mono tracking-[0.06em] text-muted-foreground mb-2">ANSWER</h2>
              <Markdown content={result.answer} />
            </section>
          ) : (
            run.status !== 'failed' && (
              <p className="text-sm text-muted-foreground">
                {run.status === 'planning'
                  ? 'Drafting a plan…'
                  : run.status === 'awaiting_approval'
                    ? 'Waiting for plan approval.'
                    : 'Working…'}
              </p>
            )
          )}
        </div>
      </div>
    </div>
  )
}
