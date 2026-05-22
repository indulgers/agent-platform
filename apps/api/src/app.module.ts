import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { BullModule } from '@nestjs/bullmq'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './auth/auth.module'
import { UsersModule } from './users/users.module'
import { ConversationsModule } from './conversations/conversations.module'
import { AgentsModule } from './agents/agents.module'
import { TasksModule } from './tasks/tasks.module'
import { MemoryModule } from './memory/memory.module'
import { HealthController } from './common/health.controller'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' },
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    ConversationsModule,
    AgentsModule,
    TasksModule,
    MemoryModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
