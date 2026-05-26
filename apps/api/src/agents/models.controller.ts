import { Controller, Get, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { MODEL_REGISTRY } from './models.registry'
import { loadEnv } from '../config/env'

@Controller('models')
@UseGuards(JwtAuthGuard)
export class ModelsController {
  private readonly env = loadEnv()

  @Get()
  list() {
    return {
      models: MODEL_REGISTRY,
      defaultModel: this.env.LLM_DEFAULT_MODEL,
      defaultProvider: this.env.LLM_DEFAULT_PROVIDER,
    }
  }
}
