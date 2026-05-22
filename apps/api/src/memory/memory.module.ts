import { Module } from '@nestjs/common'
import { MemoryService } from './memory.service'
import { Embedder } from './embedder'

@Module({
  providers: [MemoryService, Embedder],
  exports: [MemoryService],
})
export class MemoryModule {}
