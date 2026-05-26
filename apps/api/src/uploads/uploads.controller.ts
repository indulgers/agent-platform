import { BadRequestException, Body, Controller, ForbiddenException, Post, UseGuards } from '@nestjs/common'
import { UploadsService, type PresignUploadRequest, type PresignUploadResponse } from './uploads.service'
import { S3Service } from './s3.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator'

@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(
    private readonly uploads: UploadsService,
    private readonly s3: S3Service,
  ) {}

  @Post('presign')
  async presign(
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: PresignUploadRequest,
  ): Promise<PresignUploadResponse> {
    return this.uploads.presignUpload(user.sub, body)
  }

  /**
   * Mint a short-lived presigned GET URL for an attachment the user owns.
   * Path-based ownership check: keys are namespaced as users/<userId>/...,
   * so a prefix match against the caller's id is sufficient.
   */
  @Post('view')
  async view(
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: { key: string },
  ): Promise<{ url: string; expiresIn: number }> {
    if (!body.key) throw new BadRequestException('Missing key')
    const expected = `users/${user.sub}/`
    if (!body.key.startsWith(expected)) {
      throw new ForbiddenException('Not your object')
    }
    const url = await this.s3.presignDownload(body.key, 600)
    return { url, expiresIn: 600 }
  }
}
