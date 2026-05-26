import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    return this.prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, model: true, createdAt: true, updatedAt: true },
    })
  }

  async create(userId: string, title?: string) {
    return this.prisma.conversation.create({
      data: { userId, title: title ?? 'New chat' },
      select: { id: true, title: true, model: true, createdAt: true, updatedAt: true },
    })
  }

  async getWithMessages(userId: string, id: string) {
    const convo = await this.prisma.conversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    })
    if (!convo) throw new NotFoundException('Conversation not found')
    if (convo.userId !== userId) throw new ForbiddenException('Not your conversation')
    return convo
  }

  async assertOwner(userId: string, id: string) {
    const convo = await this.prisma.conversation.findUnique({
      where: { id },
      select: { userId: true },
    })
    if (!convo) throw new NotFoundException('Conversation not found')
    if (convo.userId !== userId) throw new ForbiddenException('Not your conversation')
  }

  async delete(userId: string, id: string) {
    await this.assertOwner(userId, id)
    await this.prisma.conversation.delete({ where: { id } })
  }

  async update(userId: string, id: string, patch: { title?: string; model?: string | null }) {
    await this.assertOwner(userId, id)
    const data: { title?: string; model?: string | null } = {}
    if (typeof patch.title === 'string') {
      data.title = patch.title.trim().slice(0, 120) || 'New chat'
    }
    if (patch.model !== undefined) {
      // null clears the override (revert to default); otherwise store the model id verbatim
      data.model = patch.model || null
    }
    return this.prisma.conversation.update({
      where: { id },
      data,
      select: { id: true, title: true, model: true, createdAt: true, updatedAt: true },
    })
  }
}
