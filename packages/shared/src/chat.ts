import { z } from 'zod'

export const messageRoleSchema = z.enum(['user', 'assistant', 'tool', 'system'])
export type MessageRole = z.infer<typeof messageRoleSchema>

export const toolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: z.unknown(),
})
export type ToolCall = z.infer<typeof toolCallSchema>

export const messageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: messageRoleSchema,
  content: z.string(),
  toolCalls: z.array(toolCallSchema).nullable().optional(),
  toolCallId: z.string().nullable().optional(),
  createdAt: z.string(),
})
export type Message = z.infer<typeof messageSchema>

export const sendMessageSchema = z.object({
  content: z.string().min(1).max(8000),
})
export type SendMessageInput = z.infer<typeof sendMessageSchema>

export const createConversationSchema = z.object({
  title: z.string().min(1).max(120).optional(),
})
export type CreateConversationInput = z.infer<typeof createConversationSchema>
