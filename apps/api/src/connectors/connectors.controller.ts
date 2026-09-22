import { Controller, Delete, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser, type CurrentUserPayload } from '../common/decorators/current-user.decorator'
import { ConnectorsService } from './connectors.service'
import { loadEnv } from '../config/env'

@Controller('connectors')
@UseGuards(JwtAuthGuard)
export class ConnectorsController {
  constructor(private readonly connectors: ConnectorsService) {}
  @Get() list(@CurrentUser() user: CurrentUserPayload) { return this.connectors.list(user.sub) }
  @Post(':providerId/authorize') authorize(@CurrentUser() user: CurrentUserPayload, @Param('providerId') providerId: string) { return this.connectors.startAuthorization(user.sub, providerId) }
  @Delete(':providerId') async disconnect(@CurrentUser() user: CurrentUserPayload, @Param('providerId') providerId: string) { await this.connectors.disconnect(user.sub, providerId) }
}

@Controller('connectors/callback')
export class ConnectorCallbacksController {
  private readonly env = loadEnv()
  constructor(private readonly connectors: ConnectorsService) {}
  @Get(':providerId')
  async callback(@Param('providerId') providerId: string, @Query('state') state: string, @Query('code') code: string | undefined, @Query('error') error: string | undefined, @Res() res: Response) {
    const integrationsUrl = `${this.env.WEB_ORIGIN.replace(/\/$/, '')}${this.env.NODE_ENV === 'production' ? '/app' : ''}/settings/integrations`
    if (error === 'access_denied') return res.redirect(`${integrationsUrl}?connector=cancel`)
    try { await this.connectors.finishAuthorization(providerId, state, code, error); return res.redirect(`${integrationsUrl}?connector=success`) }
    catch (reason) { const message = reason instanceof Error ? reason.message : 'OAuth failed'; return res.redirect(`${integrationsUrl}?connector=error&message=${encodeURIComponent(message)}`) }
  }
}
