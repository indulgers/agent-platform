import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { Embedder } from './embedder'

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly embedder: Embedder,
  ) {}

  async ingest(args: { userId: string; conversationId?: string; chunks: string[] }): Promise<void> {
    for (const chunk of args.chunks) {
      const embedding = await this.embedder.embed(chunk)
      if (!embedding) continue
      const vector = `[${embedding.join(',')}]`
      // Prisma typed insert does not understand the vector type — use raw SQL.
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO "MemoryChunk" ("id", "userId", "conversationId", "content", "embedding", "createdAt")
         VALUES ($1, $2, $3, $4, $5::vector, NOW())`,
        cuid(),
        args.userId,
        args.conversationId ?? null,
        chunk,
        vector,
      )
    }
  }

  async search(args: { userId: string; query: string; k: number }): Promise<Array<{ content: string; score: number }>> {
    const embedding = await this.embedder.embed(args.query)
    if (!embedding) return []
    const vector = `[${embedding.join(',')}]`
    const rows = await this.prisma.$queryRawUnsafe<Array<{ content: string; score: number }>>(
      `SELECT content, 1 - ("embedding" <=> $1::vector) AS score
         FROM "MemoryChunk"
        WHERE "userId" = $2
        ORDER BY "embedding" <=> $1::vector
        LIMIT $3`,
      vector,
      args.userId,
      args.k,
    )
    return rows
  }
}

/** Minimal cuid-shaped id generator — Prisma will not auto-default for raw inserts. */
function cuid(): string {
  return 'c' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}
