import { Body, Controller, Param, Post, Req, Res, UseGuards } from '@nestjs/common'
import type { Request, Response } from 'express'
import type { SseEvent } from '@agent-platform/shared'
import { AgentsService } from './agents.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator'

interface SendMessageBody {
  content: string
}

@Controller('agents')
@UseGuards(JwtAuthGuard)
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  /**
   * SSE endpoint. POST so we can pass a body, write events manually to keep full control of
   * flush timing (NestJS @Sse is RxJS-based and harder to interleave with async work).
   */
  @Post(':conversationId/messages')
  async send(
    @CurrentUser() user: CurrentUserPayload,
    @Param('conversationId') conversationId: string,
    @Body() body: SendMessageBody,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    const emit = (event: SseEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    }

    const abort = () => {
      // The agent service does not currently support mid-flight cancellation, but we close
      // the response so the client knows we're done.
      res.end()
    }
    req.on('close', abort)

    try {
      await this.agents.sendMessage({
        userId: user.sub,
        conversationId,
        content: body.content,
        emit,
      })
    } catch (err) {
      emit({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      res.end()
    }
  }
}
