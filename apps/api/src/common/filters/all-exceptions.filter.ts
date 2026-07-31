import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common'
import { Request, Response } from 'express'

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name)

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const res = ctx.getResponse<Response>()
    const req = ctx.getRequest<Request>()

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR

    const raw =
      exception instanceof HttpException
        ? exception.getResponse()
        : exception instanceof Error
          ? exception.message
          : 'Internal server error'

    // getResponse() is either a string or an object like { statusCode, message, error }.
    // Flatten so the client always receives `message: string | string[]` rather than a
    // nested object (which the web client tries to render directly and React rejects).
    const message =
      typeof raw === 'string'
        ? raw
        : ((raw as { message?: string | string[] }).message ?? 'Error')

    if (status >= 500) {
      this.logger.error(`${req.method} ${req.url} → ${status}`, exception instanceof Error ? exception.stack : undefined)
    }

    res.status(status).json({
      statusCode: status,
      path: req.url,
      timestamp: new Date().toISOString(),
      message,
    })
  }
}
