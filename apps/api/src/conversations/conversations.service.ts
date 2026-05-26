import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    return this.prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    })
  }

  async create(userId: string, title?: string) {
    return this.prisma.conversation.create({
      data: { userId, title: title ?? 'New chat' },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
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

  async rename(userId: string, id: string, title: string) {
    await this.assertOwner(userId, id)
    const trimmed = title.trim().slice(0, 120) || 'New chat'
    return this.prisma.conversation.update({
      where: { id },
      data: { title: trimmed },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    })
  }
}
