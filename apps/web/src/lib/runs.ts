import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ApprovePlanInput,
  CreateRunInput,
  PlanStep,
  Run,
  RunStatus,
} from '@agent-platform/shared'
import { api } from '@/lib/api'

/** A row in the run list rail — the trimmed shape returned by `GET /runs`. */
export interface RunListRow {
  id: string
  conversationId: string
  goal: string
  status: RunStatus
  createdAt: string
  updatedAt: string
}

const KEY = ['runs'] as const

export function useRuns(enabled = true) {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api<RunListRow[]>('/runs'),
    enabled,
    // Keep the rail reasonably current without a live per-user channel (D7).
    refetchOnWindowFocus: true,
  })
}

export function useRun(id: string, enabled = true) {
  return useQuery({
    queryKey: [...KEY, id] as const,
    queryFn: () => getRun(id),
    enabled,
  })
}

/** One-shot fetch of a Run snapshot (used by the detail pane before it subscribes live). */
export function getRun(id: string) {
  return api<Run>(`/runs/${id}`)
}

export const RUNS_KEY = KEY

/** Insert a freshly-created Run at the head of the rail list (newest first, de-duped). */
export function prependRunRow(prev: RunListRow[] | undefined, run: Run): RunListRow[] {
  const row: RunListRow = {
    id: run.id,
    conversationId: run.conversationId,
    goal: run.goal,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  }
  return prev ? [row, ...prev.filter(r => r.id !== row.id)] : [row]
}

export function useCreateRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateRunInput) =>
      api<Run>('/runs', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: created => {
      qc.setQueryData<RunListRow[]>(KEY, prev => prependRunRow(prev, created))
    },
  })
}

export function approvePlan(id: string, input: ApprovePlanInput = {}) {
  return api<Run>(`/runs/${id}/plan/approve`, { method: 'POST', body: JSON.stringify(input) })
}

export function interruptRun(id: string) {
  return api<Run>(`/runs/${id}/interrupt`, { method: 'POST' })
}

export function resolveCheckpoint(id: string, approve: boolean) {
  return api<Run>(`/runs/${id}/checkpoint`, { method: 'POST', body: JSON.stringify({ approve }) })
}

export type { PlanStep, Run }
