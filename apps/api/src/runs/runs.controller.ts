import { BadRequestException, Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common'
import type { Request, Response } from 'express'
import {
  approvePlanInputSchema,
  createRunInputSchema,
  resolveCheckpointInputSchema,
} from '@agent-platform/shared'
import { RunsService } from './runs.service'
import { RunEventsService } from './run-events'
import { openSseStream, writeSse } from '../common/sse'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator'

@Controller('runs')
@UseGuards(JwtAuthGuard)
export class RunsController {
  constructor(
    private readonly runs: RunsService,
    private readonly runEvents: RunEventsService,
  ) {}

  @Get()
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.runs.list(user.sub)
  }

  @Post()
  create(@CurrentUser() user: CurrentUserPayload, @Body() body: unknown) {
    const parsed = createRunInputSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException(parsed.error.issues)
    return this.runs.create(user.sub, parsed.data)
  }

  @Get(':id')
  get(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.runs.get(user.sub, id)
  }

  /**
   * Live SSE stream of a Run's events (`plan_proposed`, `run_status`,
   * `checkpoint_hit`, `token`, `tool_*`, `usage`, …). The client renders the
   * durable snapshot from `GET /runs/:id`, then applies this live tail. Only the
   * owner may subscribe. The stream stays open until the client disconnects.
   */
  @Get(':id/events')
  async events(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // Ownership check (throws before any header is sent) then open the stream.
    await this.runs.get(user.sub, id)
    openSseStream(res)

    const unsubscribe = await this.runEvents.subscribe(id, event => writeSse(res, event))
    const onClose = () => {
      unsubscribe()
      if (!res.writableEnded) res.end()
    }
    req.on('close', onClose)
  }

  @Post(':id/plan/approve')
  approvePlan(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = approvePlanInputSchema.safeParse(body ?? {})
    if (!parsed.success) throw new BadRequestException(parsed.error.issues)
    return this.runs.approvePlan(user.sub, id, parsed.data)
  }

  @Post(':id/interrupt')
  interrupt(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.runs.interrupt(user.sub, id)
  }

  @Post(':id/checkpoint')
  resolveCheckpoint(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = resolveCheckpointInputSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException(parsed.error.issues)
    return this.runs.resolveCheckpoint(user.sub, id, parsed.data.approve)
  }
}
