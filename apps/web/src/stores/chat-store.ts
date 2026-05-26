import { create } from 'zustand'
import type { SseEvent } from '@agent-platform/shared'

export interface UiToolEvent {
  id: string
  name: string
  args: unknown
  status: 'running' | 'ok' | 'error'
  result?: unknown
  error?: string
}

export interface UiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  tools: UiToolEvent[]
}

interface ChatState {
  conversationId: string | null
  messages: UiMessage[]
  streamingAssistantId: string | null
  isStreaming: boolean
  abortController: AbortController | null
  setConversation: (id: string | null) => void
  reset: () => void
  loadMessages: (messages: UiMessage[]) => void
  addUserMessage: (content: string) => void
  beginAssistant: () => AbortController
  handleEvent: (event: SseEvent) => void
  stop: () => void
  /** Drop the latest assistant message locally — used by regenerate before re-streaming. */
  dropLastAssistant: () => string | undefined
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversationId: null,
  messages: [],
  streamingAssistantId: null,
  isStreaming: false,
  abortController: null,

  setConversation: id => set({ conversationId: id }),
  reset: () => set({ messages: [], streamingAssistantId: null, isStreaming: false, abortController: null }),

  loadMessages: messages => set({ messages, streamingAssistantId: null, isStreaming: false, abortController: null }),

  addUserMessage: content => {
    const id = `local-${Date.now()}-u`
    set(s => ({ messages: [...s.messages, { id, role: 'user', content, tools: [] }] }))
  },

  beginAssistant: () => {
    const id = `local-${Date.now()}-a`
    const controller = new AbortController()
    set(s => ({
      messages: [...s.messages, { id, role: 'assistant', content: '', tools: [] }],
      streamingAssistantId: id,
      isStreaming: true,
      abortController: controller,
    }))
    return controller
  },

  stop: () => {
    const ctrl = get().abortController
    if (ctrl) ctrl.abort()
    set({ isStreaming: false, streamingAssistantId: null, abortController: null })
  },

  dropLastAssistant: () => {
    const messages = get().messages
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'assistant') {
        const removed = messages[i]
        set({ messages: messages.slice(0, i) })
        return removed?.content
      }
    }
    return undefined
  },

  handleEvent: event => {
    const state = get()
    const id = state.streamingAssistantId
    if (!id) return

    if (event.type === 'token') {
      set(s => ({
        messages: s.messages.map(m => (m.id === id ? { ...m, content: m.content + event.delta } : m)),
      }))
    } else if (event.type === 'tool_call') {
      set(s => ({
        messages: s.messages.map(m =>
          m.id === id
            ? { ...m, tools: [...m.tools, { id: event.id, name: event.name, args: event.args, status: 'running' }] }
            : m,
        ),
      }))
    } else if (event.type === 'tool_result') {
      set(s => ({
        messages: s.messages.map(m =>
          m.id === id
            ? {
                ...m,
                tools: m.tools.map(t =>
                  t.id === event.id
                    ? {
                        ...t,
                        status: event.ok ? 'ok' : 'error',
                        result: event.result,
                        error: event.error,
                      }
                    : t,
                ),
              }
            : m,
        ),
      }))
    } else if (event.type === 'message_done' || event.type === 'done') {
      set({ isStreaming: false, streamingAssistantId: null, abortController: null })
    } else if (event.type === 'error') {
      set(s => ({
        messages: s.messages.map(m => (m.id === id ? { ...m, content: m.content + `\n\n[error] ${event.message}` } : m)),
        isStreaming: false,
        streamingAssistantId: null,
        abortController: null,
      }))
    }
  },
}))
