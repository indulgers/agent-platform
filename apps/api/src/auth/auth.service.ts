import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as argon2 from 'argon2'
import { PrismaService } from '../prisma/prisma.service'
import { RegisterDto } from './dto/register.dto'
import { LoginDto } from './dto/login.dto'

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (existing) throw new ConflictException('Email already registered')

    const passwordHash = await argon2.hash(dto.password)
    const user = await this.prisma.user.create({
      data: { email: dto.email, passwordHash },
      select: { id: true, email: true },
    })
    return this.issueToken(user)
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (!user) throw new UnauthorizedException('Invalid credentials')

    const ok = await argon2.verify(user.passwordHash, dto.password)
    if (!ok) throw new UnauthorizedException('Invalid credentials')

    return this.issueToken({ id: user.id, email: user.email })
  }

  private issueToken(user: { id: string; email: string }) {
    const accessToken = this.jwt.sign({ sub: user.id, email: user.email })
    return { accessToken, user }
  }
}
