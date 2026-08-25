import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as argon2 from 'argon2'
import { PrismaService } from '../prisma/prisma.service'
import { RefreshTokenService } from './refresh-token.service'
import { RegisterDto } from './dto/register.dto'
import { LoginDto } from './dto/login.dto'

export interface AuthUser {
  id: string
  email: string
}

/** What register/login/refresh return: a short-lived access token, a rotating
 * refresh token (the caller puts it in an httpOnly cookie), and the user. */
export interface IssuedTokens {
  accessToken: string
  refreshToken: string
  user: AuthUser
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  async register(dto: RegisterDto): Promise<IssuedTokens> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (existing) throw new ConflictException('Email already registered')

    const passwordHash = await argon2.hash(dto.password)
    const user = await this.prisma.user.create({
      data: { email: dto.email, passwordHash },
      select: { id: true, email: true },
    })
    return this.issueTokens(user)
  }

  async login(dto: LoginDto): Promise<IssuedTokens> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (!user) throw new UnauthorizedException('Invalid credentials')

    const ok = await argon2.verify(user.passwordHash, dto.password)
    if (!ok) throw new UnauthorizedException('Invalid credentials')

    return this.issueTokens({ id: user.id, email: user.email })
  }

  /** Exchange a refresh token for a new access token, rotating the refresh token. */
  async refresh(oldToken: string | undefined): Promise<IssuedTokens> {
    if (!oldToken) throw new UnauthorizedException('Missing refresh token')
    const rotated = await this.refreshTokens.rotate(oldToken)
    if (!rotated) throw new UnauthorizedException('Invalid refresh token')

    const user = await this.prisma.user.findUnique({
      where: { id: rotated.userId },
      select: { id: true, email: true },
    })
    if (!user) throw new UnauthorizedException('Invalid refresh token')

    const accessToken = this.jwt.sign({ sub: user.id, email: user.email })
    return { accessToken, refreshToken: rotated.token, user }
  }

  /** Revoke a refresh token (logout). Safe when the token is absent/unknown. */
  async logout(token: string | undefined): Promise<void> {
    if (token) await this.refreshTokens.revoke(token)
  }

  private async issueTokens(user: AuthUser): Promise<IssuedTokens> {
    const accessToken = this.jwt.sign({ sub: user.id, email: user.email })
    const refreshToken = await this.refreshTokens.issue(user.id)
    return { accessToken, refreshToken, user }
  }
}
