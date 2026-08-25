import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common'
import type { CookieOptions, Request, Response } from 'express'
import { AuthService, IssuedTokens } from './auth.service'
import { RegisterDto } from './dto/register.dto'
import { LoginDto } from './dto/login.dto'

/** The refresh token rides in an httpOnly cookie, scoped to the auth routes. */
const REFRESH_COOKIE = 'refresh_token'
const COOKIE_PATH = '/api/auth'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30 * 1000 // 30 days, in ms

function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: COOKIE_PATH,
    maxAge: COOKIE_MAX_AGE,
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    return this.withRefreshCookie(res, await this.auth.register(dto))
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    return this.withRefreshCookie(res, await this.auth.login(dto))
  }

  /** Rotate the refresh cookie and mint a fresh access token. */
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined
    return this.withRefreshCookie(res, await this.auth.refresh(token))
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE] as string | undefined)
    res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH })
  }

  /** Set the rotated refresh token as an httpOnly cookie; return access + user only. */
  private withRefreshCookie(res: Response, tokens: IssuedTokens) {
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOptions())
    return { accessToken: tokens.accessToken, user: tokens.user }
  }
}
