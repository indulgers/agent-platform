import { create } from 'zustand'
import type { PlanStep, Run, RunStatus, SseEvent } from '@agent-platform/shared'

/** A tool call rendered in a Run's timeline, updated in place by its result. */
export interface RunTool {
  id: string
  name: string
  args: unknown
  status: 'running' | 'ok' | 'error'
  result?: unknown
  error?: string
}

export interface RunUsage {
  model: string
  promptTokens: number
  completionTokens: number
  costUsd: number
}

/** What the open Run currently needs from the user, if anything. */
export type PendingAction = 'plan' | 'checkpoint' | null

interface RunsState {
  runId: string | null
  goal: string | null
  status: RunStatus | null
  /** Proposed plan steps (from `plan_proposed` or a snapshot) — editable before approval. */
  proposedSteps: PlanStep[] | null
  /** The pending tool call while paused at a checkpoint. */
  checkpoint: { tool: string; args: unknown } | null
  tools: RunTool[]
  answer: string
  error: string | null
  usage: RunUsage | null
  pendingAction: PendingAction

  reset: () => void
  /** Hydrate from the durable snapshot (`GET /runs/:id`) before applying the live tail. */
  loadSnapshot: (run: Run) => void
  /** Apply one live SseEvent from the run event stream. */
  handleEvent: (event: SseEvent) => void
}

/** The action a Run in a given status is waiting on. */
function pendingFor(status: RunStatus | null): PendingAction {
  if (status === 'awaiting_approval') return 'plan'
  if (status === 'paused') return 'checkpoint'
  return null
}

const initial = {
  runId: null,
  goal: null,
  status: null,
  proposedSteps: null,
  checkpoint: null,
  tools: [] as RunTool[],
  answer: '',
  error: null,
  usage: null,
  pendingAction: null as PendingAction,
}

/** Narrow an unknown snapshot `data` blob to the SseEvent it was persisted from. */
function asEvent(data: unknown): SseEvent | null {
  if (data && typeof data === 'object' && 'type' in data) return data as SseEvent
  return null
}

export const useRunsStore = create<RunsState>((set, get) => ({
  ...initial,

  reset: () => set({ ...initial, tools: [] }),

  loadSnapshot: run => {
    const tools: RunTool[] = []
    for (const step of run.steps ?? []) {
      const ev = asEvent(step.data)
      if (ev?.type === 'tool_call') {
        tools.push({ id: ev.id, name: ev.name, args: ev.args, status: 'running' })
      } else if (ev?.type === 'tool_result') {
        const t = tools.find(x => x.id === ev.id)
        if (t) {
          t.status = ev.ok ? 'ok' : 'error'
          t.result = ev.result
          t.error = ev.error
        }
      }
    }
    const result = run.result as { answer?: string } | null | undefined
    const pendingCheckpoint = (run as { pendingCheckpoint?: { name: string; args: unknown } }).pendingCheckpoint
    set({
      runId: run.id,
      goal: run.goal,
      status: run.status,
      proposedSteps: run.plan?.steps ?? null,
      checkpoint:
        run.status === 'paused' && pendingCheckpoint
          ? { tool: pendingCheckpoint.name, args: pendingCheckpoint.args }
          : null,
      tools,
      answer: typeof result?.answer === 'string' ? result.answer : '',
      error: run.error ?? null,
      usage: null,
      pendingAction: pendingFor(run.status),
    })
  },

  handleEvent: event => {
    switch (event.type) {
      case 'run_status':
        set({
          status: event.status,
          pendingAction: pendingFor(event.status),
          // Leaving `paused` (e.g. after approving a checkpoint) clears the pending call.
          checkpoint: event.status === 'paused' ? get().checkpoint : null,
        })
        break
      case 'plan_proposed':
        set({ proposedSteps: event.steps })
        break
      case 'checkpoint_hit':
        set({ checkpoint: { tool: event.tool, args: event.args } })
        break
      case 'tool_call':
        // Idempotent: a checkpoint-approval replays execution, re-emitting earlier
        // tool calls with the same id — don't double-render them.
        if (get().tools.some(t => t.id === event.id)) break
        set(s => ({
          tools: [...s.tools, { id: event.id, name: event.name, args: event.args, status: 'running' }],
        }))
        break
      case 'tool_result':
        set(s => ({
          tools: s.tools.map(t =>
            t.id === event.id
              ? { ...t, status: event.ok ? 'ok' : 'error', result: event.result, error: event.error }
              : t,
          ),
        }))
        break
      case 'token':
        set(s => ({ answer: s.answer + event.delta }))
        break
      case 'usage':
        set({
          usage: {
            model: event.model,
            promptTokens: event.promptTokens,
            completionTokens: event.completionTokens,
            costUsd: event.costUsd,
          },
        })
        break
      case 'error':
        set({ error: event.message })
        break
      // message_done / done: terminal state is driven by run_status.
    }
  },
}))
