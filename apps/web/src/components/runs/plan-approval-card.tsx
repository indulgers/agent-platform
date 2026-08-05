import { useState } from 'react'
import { ArrowDown, ArrowUp, Check, Plus, Trash2, X } from 'lucide-react'
import type { PlanStep } from '@agent-platform/shared'
import { approvePlan, interruptRun } from '@/lib/runs'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

/**
 * The editable Plan shown while a Run is awaiting approval. Edit step text,
 * reorder, add, or remove steps, then approve (start execution with the edited
 * steps) or reject (stop the Run). Steps are re-indexed on approve.
 */
export function PlanApprovalCard({ runId, steps }: { runId: string; steps: PlanStep[] }) {
  const [draft, setDraft] = useState<string[]>(() => steps.map(s => s.description))
  const [busy, setBusy] = useState(false)

  const editStep = (i: number, value: string) => setDraft(d => d.map((s, idx) => (idx === i ? value : s)))
  const removeStep = (i: number) => setDraft(d => d.filter((_, idx) => idx !== i))
  const addStep = () => setDraft(d => [...d, ''])
  const move = (i: number, dir: -1 | 1) =>
    setDraft(d => {
      const j = i + dir
      if (j < 0 || j >= d.length) return d
      const next = [...d]
      ;[next[i], next[j]] = [next[j]!, next[i]!]
      return next
    })

  const approve = async () => {
    const cleaned = draft.map(s => s.trim()).filter(Boolean)
    if (cleaned.length === 0 || busy) return
    setBusy(true)
    const planSteps: PlanStep[] = cleaned.map((description, index) => ({ index, description }))
    try {
      await approvePlan(runId, { steps: planSteps })
    } finally {
      setBusy(false)
    }
  }

  const reject = async () => {
    if (busy) return
    setBusy(true)
    try {
      await interruptRun(runId)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-[color:color-mix(in_oklab,var(--color-warning)_40%,var(--color-hairline))] bg-[color:color-mix(in_oklab,var(--color-warning)_5%,var(--color-surface-1))] p-3 space-y-2">
      <div className="text-[12px] font-mono tracking-[0.04em] text-muted-foreground">REVIEW PLAN</div>

      <ol className="space-y-1.5">
        {draft.map((step, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <span className="mt-2 text-[11px] font-mono text-muted-foreground w-4 shrink-0 text-right">{i + 1}</span>
            <Textarea
              value={step}
              onChange={e => editStep(i, e.target.value)}
              rows={1}
              disabled={busy}
              className="min-h-0 py-1.5 text-[13px] resize-none bg-[color:var(--color-surface-2)]"
            />
            <div className="flex flex-col shrink-0">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={busy || i === 0}
                className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                aria-label="Move step up"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={busy || i === draft.length - 1}
                className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                aria-label="Move step down"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => removeStep(i)}
              disabled={busy}
              className="mt-1 p-1 text-muted-foreground hover:text-[color:var(--color-danger)] disabled:opacity-30"
              aria-label="Remove step"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={addStep}
        disabled={busy}
        className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40"
      >
        <Plus className="w-3.5 h-3.5" /> Add step
      </button>

      <div className="flex gap-2 pt-1">
        <Button onClick={approve} disabled={busy || draft.every(s => !s.trim())} size="sm" className="gap-1.5">
          <Check className="w-3.5 h-3.5" /> Approve &amp; run
        </Button>
        <Button onClick={reject} disabled={busy} size="sm" variant="ghost" className="gap-1.5">
          <X className="w-3.5 h-3.5" /> Reject
        </Button>
      </div>
    </div>
  )
}
