import { BadRequestException, Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { S3Service } from './s3.service'

/** Max upload size in bytes — keeps inline base64 image messages from blowing
 *  out the LLM context. 8MB raw → ~10.6MB base64 → still tolerable for vision
 *  models. Bump later if needed. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

const ALLOWED_IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
])

/** File extensions for the S3 key — best-effort mapping. */
const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

export interface PresignUploadRequest {
  mediaType: string
  size: number
  /** Original file name (for record-keeping only — the S3 key is generated). */
  originalName?: string
}

export interface PresignUploadResponse {
  /** S3 object key (used as the attachment identifier in subsequent message bodies). */
  key: string
  /** Browser PUTs file body to this URL with a matching Content-Type header. */
  uploadUrl: string
  /** Seconds until the upload URL expires. */
  expiresIn: number
  /** Snapshot the client should echo back when sending the message. */
  attachment: {
    key: string
    kind: 'image'
    mediaType: string
    size: number
    originalName: string
  }
}

@Injectable()
export class UploadsService {
  constructor(private readonly s3: S3Service) {}

  async presignUpload(userId: string, req: PresignUploadRequest): Promise<PresignUploadResponse> {
    if (!this.s3.configured) {
      throw new BadRequestException('Server is not configured for file uploads')
    }
    if (!Number.isFinite(req.size) || req.size <= 0) {
      throw new BadRequestException('Invalid size')
    }
    if (req.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(`File too large (max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB)`)
    }
    if (!ALLOWED_IMAGE_MIME.has(req.mediaType)) {
      throw new BadRequestException(`Unsupported mediaType: ${req.mediaType}`)
    }

    const ext = MIME_TO_EXT[req.mediaType] ?? 'bin'
    const today = new Date()
    const datePath = `${today.getUTCFullYear()}/${String(today.getUTCMonth() + 1).padStart(2, '0')}/${String(today.getUTCDate()).padStart(2, '0')}`
    const key = `users/${userId}/${datePath}/${randomUUID()}.${ext}`

    const uploadUrl = await this.s3.presignUpload({
      key,
      contentType: req.mediaType,
      expiresIn: 300,
    })

    return {
      key,
      uploadUrl,
      expiresIn: 300,
      attachment: {
        key,
        kind: 'image',
        mediaType: req.mediaType,
        size: req.size,
        originalName: (req.originalName ?? '').slice(0, 200),
      },
    }
  }
}
