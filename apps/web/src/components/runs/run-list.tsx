import { Link } from '@tanstack/react-router'
import { useRuns } from '@/lib/runs'
import { RunStatusBadge } from '@/components/runs/run-status-badge'
import { RunComposer } from '@/components/runs/run-composer'
import { cn } from '@/lib/utils'

/** Compact relative timestamp, e.g. "3m", "2h", "5d". */
function ago(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'now'
  const mins = secs / 60
  if (mins < 60) return `${Math.floor(mins)}m`
  const hrs = mins / 60
  if (hrs < 24) return `${Math.floor(hrs)}h`
  return `${Math.floor(hrs / 24)}d`
}

export function RunList({ activeId }: { activeId?: string }) {
  const { data: runs = [], isLoading } = useRuns()

  return (
    <aside
      className="hidden md:flex flex-col w-[280px] shrink-0 border-r border-border bg-[color:var(--color-surface-1)]"
      aria-label="Runs"
    >
      <RunComposer />

      <div className="px-3 pt-3 pb-2 text-[11px] font-mono text-muted-foreground tracking-[0.06em]">
        RUNS
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
        {isLoading && <div className="px-2 text-xs text-muted-foreground">Loading…</div>}
        {!isLoading && runs.length === 0 && (
          <div className="px-2 text-xs text-muted-foreground">No runs yet — launch one above.</div>
        )}
        {runs.map(run => (
          <Link
            key={run.id}
            to="/runs/$id"
            params={{ id: run.id }}
            className={cn(
              'group block rounded-md px-2 py-2 transition-colors',
              run.id === activeId
                ? 'bg-[color:var(--color-surface-3)]'
                : 'hover:bg-[color:var(--color-surface-2)]',
            )}
            title={run.goal}
          >
            <div
              className={cn(
                'text-[13px] leading-snug line-clamp-2',
                run.id === activeId ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground',
              )}
            >
              {run.goal}
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <RunStatusBadge status={run.status} />
              <span className="text-[11px] font-mono text-muted-foreground shrink-0">{ago(run.updatedAt)}</span>
            </div>
          </Link>
        ))}
      </div>
    </aside>
  )
}
