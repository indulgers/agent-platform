import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface ConversationRow {
  id: string
  title: string
  createdAt: string
  updatedAt: string
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

export function useRenameConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api<ConversationRow>(`/conversations/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
    onMutate: async ({ id, title }) => {
      await qc.cancelQueries({ queryKey: KEY })
      const previous = qc.getQueryData<ConversationRow[]>(KEY)
      qc.setQueryData<ConversationRow[]>(KEY, prev =>
        prev?.map(c => (c.id === id ? { ...c, title } : c)),
      )
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(KEY, ctx.previous)
    },
  })
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

/** Refresh the cache after a stream completes (server bumped updatedAt + maybe auto-titled). */
export function useRefreshConversations() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: KEY })
}
