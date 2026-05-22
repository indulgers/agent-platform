import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common'
import { ConversationsService } from './conversations.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator'

@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.conversations.list(user.sub)
  }

  @Post()
  create(@CurrentUser() user: CurrentUserPayload, @Body() body: { title?: string }) {
    return this.conversations.create(user.sub, body?.title)
  }

  @Get(':id')
  get(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.conversations.getWithMessages(user.sub, id)
  }

  @Delete(':id')
  remove(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.conversations.delete(user.sub, id)
  }
}
