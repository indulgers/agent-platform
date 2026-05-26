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

  @Post(':conversationId/messages')
  async send(
    @CurrentUser() user: CurrentUserPayload,
    @Param('conversationId') conversationId: string,
    @Body() body: SendMessageBody,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.handleStream(req, res, controller =>
      this.agents.sendMessage({
        userId: user.sub,
        conversationId,
        content: body.content,
        emit: this.makeEmit(res),
        signal: controller.signal,
      }),
    )
  }

  /**
   * Regenerate the last assistant response in this conversation. Same SSE
   * stream shape as /messages — the client treats it identically.
   */
  @Post(':conversationId/regenerate')
  async regenerate(
    @CurrentUser() user: CurrentUserPayload,
    @Param('conversationId') conversationId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.handleStream(req, res, controller =>
      this.agents.regenerate({
        userId: user.sub,
        conversationId,
        emit: this.makeEmit(res),
        signal: controller.signal,
      }),
    )
  }

  private makeEmit(res: Response) {
    return (event: SseEvent) => {
      // If the client has already disconnected the socket, writing throws.
      // Swallow it — the runner sees the abort signal and unwinds separately.
      if (res.writableEnded || res.destroyed) return
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      } catch {
        /* socket gone */
      }
    }
  }

  private async handleStream(req: Request, res: Response, run: (c: AbortController) => Promise<unknown>) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    const controller = new AbortController()
    const onClose = () => controller.abort()
    req.on('close', onClose)

    try {
      await run(controller)
    } catch (err) {
      if (!controller.signal.aborted) {
        const message = err instanceof Error ? err.message : String(err)
        try {
          res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`)
        } catch {
          /* socket gone */
        }
      }
    } finally {
      req.off('close', onClose)
      if (!res.writableEnded) res.end()
    }
  }
}
