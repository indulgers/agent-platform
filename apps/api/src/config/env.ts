import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  JWT_EXPIRES_IN: z.string().default('15m'),

  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  LLM_DEFAULT_PROVIDER: z.enum(['openai', 'anthropic']).default('anthropic'),
  LLM_DEFAULT_MODEL: z.string().default('claude-sonnet-4-6'),
  EMBEDDING_PROVIDER: z.enum(['openai']).default('openai'),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),

  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),

  AGENT_MAX_ITERATIONS: z.coerce.number().int().positive().default(8),
  AGENT_MAX_TOKENS: z.coerce.number().int().positive().default(4096),
})

export type Env = z.infer<typeof envSchema>

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('Invalid environment:', parsed.error.flatten().fieldErrors)
    process.exit(1)
  }
  return parsed.data
}
