import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe, Logger } from '@nestjs/common'
import helmet from 'helmet'
import { AppModule } from './app.module'
import { loadEnv } from './config/env'
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter'

async function bootstrap() {
  const env = loadEnv()
  const app = await NestFactory.create(AppModule, { bufferLogs: true })

  app.use(helmet({ contentSecurityPolicy: false }))
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true })
  app.setGlobalPrefix('api', { exclude: ['health'] })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  app.useGlobalFilters(new AllExceptionsFilter())

  await app.listen(env.PORT)
  Logger.log(`API listening on http://localhost:${env.PORT}`, 'Bootstrap')
}

bootstrap().catch(err => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err)
  process.exit(1)
})
