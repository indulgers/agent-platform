import { useState, type KeyboardEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Rocket } from 'lucide-react'
import { useCreateRun } from '@/lib/runs'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

/**
 * Launch a new Run from a goal alone (D3). The backend auto-creates the hidden
 * conversation; on success we navigate to the new Run's detail pane.
 */
export function RunComposer() {
  const navigate = useNavigate()
  const create = useCreateRun()
  const [goal, setGoal] = useState('')

  const launch = async () => {
    const trimmed = goal.trim()
    if (!trimmed || create.isPending) return
    const run = await create.mutateAsync({ goal: trimmed })
    setGoal('')
    void navigate({ to: '/runs/$id', params: { id: run.id } })
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void launch()
    }
  }

  return (
    <div className="px-3 pt-3 pb-2 border-b border-border">
      <div className="rounded-lg border border-border bg-[color:var(--color-surface-2)] focus-within:border-[color:var(--color-hairline-strong)] transition-colors p-2 space-y-2">
        <Textarea
          value={goal}
          onChange={e => setGoal(e.target.value)}
          onKeyDown={onKey}
          placeholder="Give the agent a goal…"
          rows={3}
          disabled={create.isPending}
          className="bg-transparent border-0 resize-none focus-visible:ring-0 focus-visible:ring-offset-0 text-[13px]"
        />
        <Button
          onClick={launch}
          disabled={!goal.trim() || create.isPending}
          size="sm"
          className="w-full gap-1.5"
        >
          <Rocket className="w-3.5 h-3.5" />
          {create.isPending ? 'Launching…' : 'Launch Run'}
        </Button>
      </div>
      {create.isError && (
        <p className="mt-2 text-[11.5px] text-[color:var(--color-danger)]">
          Couldn’t launch the Run. Try again.
        </p>
      )}
    </div>
  )
}
