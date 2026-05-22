import { Injectable, Logger } from '@nestjs/common'
import OpenAI from 'openai'

@Injectable()
export class Embedder {
  private readonly logger = new Logger(Embedder.name)
  private readonly client: OpenAI | null

  constructor() {
    this.client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null
  }

  async embed(text: string): Promise<number[] | null> {
    if (!this.client) {
      this.logger.warn('OPENAI_API_KEY not set — skipping embedding')
      return null
    }
    const res = await this.client.embeddings.create({
      model: process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small',
      input: text,
    })
    return res.data[0]?.embedding ?? null
  }
}
