import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { TasksService } from './tasks.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator'

@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get(':id')
  get(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.tasks.get(user.sub, id)
  }
}
