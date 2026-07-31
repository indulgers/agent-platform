import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { BullModule } from '@nestjs/bullmq'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './auth/auth.module'
import { UsersModule } from './users/users.module'
import { ConversationsModule } from './conversations/conversations.module'
import { RunsModule } from './runs/runs.module'
import { AgentsModule } from './agents/agents.module'
import { MemoryModule } from './memory/memory.module'
import { UploadsModule } from './uploads/uploads.module'
import { HealthController } from './common/health.controller'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' },
    }),
    PrismaModule,
    UploadsModule,
    AuthModule,
    UsersModule,
    ConversationsModule,
    RunsModule,
    AgentsModule,
    MemoryModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
