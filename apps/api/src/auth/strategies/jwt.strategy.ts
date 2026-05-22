import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import type { Request } from 'express'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        // Fallback for SSE clients (e.g. EventSource / curl) that cannot set headers.
        (req: Request) => (typeof req?.query?.token === 'string' ? req.query.token : null),
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET ?? 'dev-only-secret-do-not-use',
    })
  }

  async validate(payload: { sub: string; email: string }) {
    return { sub: payload.sub, email: payload.email }
  }
}
