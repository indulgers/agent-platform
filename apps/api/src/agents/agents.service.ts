import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { SseEvent } from '@agent-platform/shared'
import { PrismaService } from '../prisma/prisma.service'
import { ConversationsService } from '../conversations/conversations.service'
import { AgentRunner } from './runner/agent-runner'
import { OpenAIProvider } from './llm/openai.provider'
import { AnthropicProvider } from './llm/anthropic.provider'
import { MemoryService } from '../memory/memory.service'
import type { AssistantToolCall, ChatMessage, ChatProvider } from './llm/llm.interface'
import { loadEnv } from '../config/env'

const SYSTEM_PROMPT = `You are agent-platform, a helpful multi-tool task agent.
- Plan in short steps. When unsure, call a tool rather than guess.
- Tools available: http_fetch (read public URLs), vector_search (recall the user's prior memories).
- After you finish, write a concise, direct answer for the user.
- Never invent tool results; only use what tools actually returned.`

@Injectable()
export class AgentsService {
  private readonly env = loadEnv()

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly runner: AgentRunner,
    private readonly openai: OpenAIProvider,
    private readonly anthropic: AnthropicProvider,
    private readonly memory: MemoryService,
  ) {}

  private pickProvider(): ChatProvider {
    return this.env.LLM_DEFAULT_PROVIDER === 'openai' ? this.openai : this.anthropic
  }

  async sendMessage(args: {
    userId: string
    conversationId: string
    content: string
    emit: (event: SseEvent) => void
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
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      args.emit({ type: 'error', message })
      args.emit({ type: 'done' })
      throw err
    }

    // Persist assistant + tool messages produced during the run (skip the user msg, already saved).
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

    // Best-effort: ingest the user prompt + assistant answer into memory.
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
}
