import type { PlanStep } from '@agent-platform/shared'
import type { RunTool } from '@/stores/runs-store'
import { ToolCallCard } from '@/components/tool-call-card'
import { Markdown } from '@/components/markdown'

/**
 * The body of a run detail: the approved plan (read-only context), the ordered
 * tool calls, and the agent's answer as it streams in. Reuses the chat surface's
 * tool-call card and markdown renderer.
 */
export function RunTimeline({
  plan,
  tools,
  answer,
}: {
  plan: PlanStep[] | null
  tools: RunTool[]
  answer: string
}) {
  return (
    <div className="space-y-4">
      {plan?.length ? (
        <section className="rounded-lg border border-border bg-[color:var(--color-surface-1)] p-4">
          <h2 className="text-[11px] font-mono tracking-[0.06em] text-muted-foreground mb-2">PLAN</h2>
          <ol className="space-y-1.5">
            {plan.map(step => (
              <li key={step.index} className="flex gap-2 text-[13px] text-foreground">
                <span className="text-muted-foreground font-mono shrink-0">{step.index + 1}.</span>
                <span>{step.description}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {tools.length > 0 && (
        <section>
          {tools.map(tool => (
            <ToolCallCard key={tool.id} tool={tool} />
          ))}
        </section>
      )}

      {answer && (
        <section className="rounded-lg border border-border bg-[color:var(--color-surface-1)] p-4">
          <h2 className="text-[11px] font-mono tracking-[0.06em] text-muted-foreground mb-2">ANSWER</h2>
          <Markdown content={answer} />
        </section>
      )}
    </div>
  )
}
