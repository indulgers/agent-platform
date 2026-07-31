import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import {
  approvePlanInputSchema,
  createRunInputSchema,
  resolveCheckpointInputSchema,
} from '@agent-platform/shared'
import { RunsService } from './runs.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator'

@Controller('runs')
@UseGuards(JwtAuthGuard)
export class RunsController {
  constructor(private readonly runs: RunsService) {}

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
