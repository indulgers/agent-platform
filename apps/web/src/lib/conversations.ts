import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface ConversationRow {
  id: string
  title: string
  /** null = use server defaults; otherwise a model id from the registry */
  model: string | null
  createdAt: string
  updatedAt: string
}

export interface ConversationPatch {
  title?: string
  model?: string | null
}

const KEY = ['conversations'] as const

export function useConversations(enabled = true) {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api<ConversationRow[]>('/conversations'),
    enabled,
  })
}

export function useCreateConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input?: { title?: string }) =>
      api<ConversationRow>('/conversations', { method: 'POST', body: JSON.stringify(input ?? {}) }),
    onSuccess: created => {
      qc.setQueryData<ConversationRow[]>(KEY, prev => (prev ? [created, ...prev] : [created]))
    },
  })
}

/**
 * Unified update — PATCH /conversations/:id accepts both title and model.
 * Optimistic for title (instant); model also applies optimistically.
 */
export function useUpdateConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ConversationPatch }) =>
      api<ConversationRow>(`/conversations/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: KEY })
      const previous = qc.getQueryData<ConversationRow[]>(KEY)
      qc.setQueryData<ConversationRow[]>(KEY, prev =>
        prev?.map(c => (c.id === id ? { ...c, ...patch } : c)),
      )
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(KEY, ctx.previous)
    },
  })
}

/** Back-compat alias — old sidebar code calls this for rename. */
export function useRenameConversation() {
  const update = useUpdateConversation()
  return {
    ...update,
    mutate: (vars: { id: string; title: string }) => update.mutate({ id: vars.id, patch: { title: vars.title } }),
    mutateAsync: (vars: { id: string; title: string }) =>
      update.mutateAsync({ id: vars.id, patch: { title: vars.title } }),
  }
}

export function useDeleteConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/conversations/${id}`, { method: 'DELETE' }),
    onMutate: async id => {
      await qc.cancelQueries({ queryKey: KEY })
      const previous = qc.getQueryData<ConversationRow[]>(KEY)
      qc.setQueryData<ConversationRow[]>(KEY, prev => prev?.filter(c => c.id !== id))
      return { previous }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(KEY, ctx.previous)
    },
  })
}

/** Refresh after a stream finishes (server bumped updatedAt + maybe auto-titled). */
export function useRefreshConversations() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: KEY })
}

// ---------------------------------------------------------------------------
// Models registry hook (GET /api/models)
// ---------------------------------------------------------------------------

export interface ModelEntry {
  id: string
  provider: 'openai' | 'anthropic' | 'deepseek'
  displayName: string
  description: string
  supportsVision: boolean
  costPer1M: { input: number; output: number }
}

export interface ModelsResponse {
  models: ModelEntry[]
  defaultModel: string
  defaultProvider: string
}

export function useModels() {
  return useQuery({
    queryKey: ['models'] as const,
    queryFn: () => api<ModelsResponse>('/models'),
    staleTime: Infinity, // static catalog — never refetch
  })
}
