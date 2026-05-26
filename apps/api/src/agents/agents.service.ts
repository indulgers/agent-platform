import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { SseEvent } from '@agent-platform/shared'
import { PrismaService } from '../prisma/prisma.service'
import { ConversationsService } from '../conversations/conversations.service'
import { AgentRunner } from './runner/agent-runner'
import { OpenAIProvider } from './llm/openai.provider'
import { AnthropicProvider } from './llm/anthropic.provider'
import { DeepSeekProvider } from './llm/deepseek.provider'
import { MemoryService } from '../memory/memory.service'
import type { AssistantToolCall, ChatMessage, ChatProvider } from './llm/llm.interface'
import { loadEnv } from '../config/env'

const SYSTEM_PROMPT = `You are agent-platform, a helpful multi-tool task agent.
- Plan in short steps. When unsure, call a tool rather than guess.
- Tools available: http_fetch (read public URLs), vector_search (recall the user's prior memories).
- After you finish, write a concise, direct answer for the user.
- Never invent tool results; only use what tools actually returned.
- Format responses with markdown when it improves readability: fenced code blocks
  with language hints, lists, tables, bold for key terms, links where appropriate.
  Do not over-format short single-sentence answers.`

const DEFAULT_TITLE = 'New chat'
const TITLE_MAX_LEN = 48

@Injectable()
export class AgentsService {
  private readonly env = loadEnv()

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly runner: AgentRunner,
    private readonly openai: OpenAIProvider,
    private readonly anthropic: AnthropicProvider,
    private readonly deepseek: DeepSeekProvider,
    private readonly memory: MemoryService,
  ) {}

  private pickProvider(): ChatProvider {
    switch (this.env.LLM_DEFAULT_PROVIDER) {
      case 'openai':
        return this.openai
      case 'deepseek':
        return this.deepseek
      case 'anthropic':
      default:
        return this.anthropic
    }
  }

  async sendMessage(args: {
    userId: string
    conversationId: string
    content: string
    emit: (event: SseEvent) => void
    signal?: AbortSignal
  }) {
    await this.conversations.assertOwner(args.userId, args.conversationId)

    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: args.conversationId },
      include: { messages: { orderBy: { createdAt: 'asc' }, take: 50 } },
    })
    if (!conversation) throw new NotFoundException('Conversation not found')

    const history: ChatMessage[] = conversation.messages.map(m => ({
      role: m.role as ChatMessage['role'],
      content: m.content,
      toolCalls: (m.toolCalls as unknown as AssistantToolCall[] | null) ?? undefined,
      toolCallId: m.toolCallId ?? undefined,
    }))

    const userMessageRow = await this.prisma.message.create({
      data: { conversationId: args.conversationId, role: 'user', content: args.content },
    })

    // Auto-title: if the conversation still has the default title and this is
    // the first user message, derive a short title from the content.
    if (
      conversation.title === DEFAULT_TITLE &&
      conversation.messages.filter(m => m.role === 'user').length === 0
    ) {
      await this.prisma.conversation.update({
        where: { id: args.conversationId },
        data: { title: deriveTitle(args.content) },
      })
    }

    let result
    try {
      result = await this.runner.run({
        provider: this.pickProvider(),
        model: this.env.LLM_DEFAULT_MODEL,
        systemPrompt: SYSTEM_PROMPT,
        history,
        userMessage: args.content,
        ctx: { userId: args.userId, conversationId: args.conversationId },
        maxIterations: this.env.AGENT_MAX_ITERATIONS,
        maxTokens: this.env.AGENT_MAX_TOKENS,
        emit: args.emit,
        signal: args.signal,
      })
    } catch (err) {
      const aborted = args.signal?.aborted || isAbortError(err)
      if (!aborted) {
        const message = err instanceof Error ? err.message : String(err)
        args.emit({ type: 'error', message })
        args.emit({ type: 'done' })
        throw err
      }
      // Aborted: don't re-emit (client already gone)
      args.emit({ type: 'done' })
      return { userMessageId: userMessageRow.id, assistantMessageIds: [], aborted: true }
    }

    const persisted: string[] = []
    for (const m of result.newMessages.slice(1)) {
      const row = await this.prisma.message.create({
        data: {
          conversationId: args.conversationId,
          role: m.role,
          content: m.content,
          toolCalls: m.toolCalls ? (m.toolCalls as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
          toolCallId: m.toolCallId ?? null,
        },
      })
      if (m.role === 'assistant') persisted.push(row.id)
    }

    await this.prisma.conversation.update({
      where: { id: args.conversationId },
      data: { updatedAt: new Date() },
    })

    this.memory
      .ingest({
        userId: args.userId,
        conversationId: args.conversationId,
        chunks: [args.content, result.finalAssistantText].filter(s => s.length > 0),
      })
      .catch(() => {})

    if (persisted.length > 0) args.emit({ type: 'message_done', messageId: persisted[persisted.length - 1]! })
    args.emit({ type: 'done' })

    return { userMessageId: userMessageRow.id, assistantMessageIds: persisted }
  }

  /**
   * Regenerate the last assistant response by:
   *  1. finding the last user message
   *  2. deleting it + all messages after it (assistant + tools)
   *  3. re-running sendMessage with the same content
   *
   * Same effect as the user typing the same message again, but doesn't
   * require an extra round-trip from the client.
   */
  async regenerate(args: {
    userId: string
    conversationId: string
    emit: (event: SseEvent) => void
    signal?: AbortSignal
  }) {
    await this.conversations.assertOwner(args.userId, args.conversationId)

    const lastUser = await this.prisma.message.findFirst({
      where: { conversationId: args.conversationId, role: 'user' },
      orderBy: { createdAt: 'desc' },
    })
    if (!lastUser) throw new BadRequestException('No user message to regenerate from')

    const content = lastUser.content

    // Delete the last user message and everything after it. sendMessage will
    // create a fresh user row + re-stream.
    await this.prisma.message.deleteMany({
      where: {
        conversationId: args.conversationId,
        createdAt: { gte: lastUser.createdAt },
      },
    })

    return this.sendMessage({ ...args, content })
  }

  /**
   * Edit a previously-sent user message and re-stream from there. Replaces
   * the message content and discards everything that came after it. The user
   * row is recreated by sendMessage (timestamp moves forward — matches the
   * user's mental model of "this is the new turn").
   */
  async editAndResend(args: {
    userId: string
    conversationId: string
    messageId: string
    content: string
    emit: (event: SseEvent) => void
    signal?: AbortSignal
  }) {
    await this.conversations.assertOwner(args.userId, args.conversationId)

    const target = await this.prisma.message.findUnique({ where: { id: args.messageId } })
    if (!target || target.conversationId !== args.conversationId) {
      throw new BadRequestException('Message not found in this conversation')
    }
    if (target.role !== 'user') {
      throw new BadRequestException('Only user messages can be edited')
    }
    const trimmed = args.content.trim()
    if (trimmed.length === 0) throw new BadRequestException('Content cannot be empty')

    await this.prisma.message.deleteMany({
      where: {
        conversationId: args.conversationId,
        createdAt: { gte: target.createdAt },
      },
    })

    return this.sendMessage({
      userId: args.userId,
      conversationId: args.conversationId,
      content: trimmed,
      emit: args.emit,
      signal: args.signal,
    })
  }
}

/** Truncate user text into a one-line title at a word boundary if possible. */
function deriveTitle(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= TITLE_MAX_LEN) return oneLine || DEFAULT_TITLE
  const cut = oneLine.slice(0, TITLE_MAX_LEN)
  const space = cut.lastIndexOf(' ')
  return (space > 24 ? cut.slice(0, space) : cut) + '…'
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; code?: string }
  return e.name === 'AbortError' || e.code === 'ABORT_ERR'
}
