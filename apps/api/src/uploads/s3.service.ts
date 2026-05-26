import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { GetObjectCommand, PutObjectCommand, S3Client, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { loadEnv } from '../config/env'

/**
 * Thin S3 wrapper. Two clients:
 *  - internal: backend → MinIO (uses S3_ENDPOINT, talks over the docker network)
 *  - public:   used to sign URLs the browser will hit (S3_PUBLIC_ENDPOINT host)
 *
 * In prod the two endpoints can point at the same nginx, in dev they typically
 * point at the same host:port pair anyway.
 */
@Injectable()
export class S3Service implements OnModuleInit {
  private readonly logger = new Logger(S3Service.name)
  private readonly env = loadEnv()
  private internal: S3Client | null = null
  private publicClient: S3Client | null = null

  get bucket(): string {
    return this.env.S3_BUCKET
  }

  get configured(): boolean {
    return !!(this.env.S3_ENDPOINT && this.env.S3_ACCESS_KEY && this.env.S3_SECRET_KEY)
  }

  async onModuleInit() {
    if (!this.configured) {
      this.logger.warn('S3 not configured — file attachments disabled. Set S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY.')
      return
    }
    this.internal = this.buildClient(this.env.S3_ENDPOINT!)
    this.publicClient = this.buildClient(this.env.S3_PUBLIC_ENDPOINT ?? this.env.S3_ENDPOINT!)

    // Idempotent bucket-exists check. Doesn't try to create on AWS (assume the
    // bucket is provisioned out-of-band there); does try on MinIO.
    try {
      await this.internal.send(new HeadBucketCommand({ Bucket: this.bucket }))
    } catch {
      try {
        await this.internal.send(new CreateBucketCommand({ Bucket: this.bucket }))
        this.logger.log(`Created bucket "${this.bucket}"`)
      } catch (err) {
        this.logger.warn(`Could not create bucket "${this.bucket}": ${err instanceof Error ? err.message : err}`)
      }
    }
  }

  private buildClient(endpoint: string): S3Client {
    return new S3Client({
      region: this.env.S3_REGION,
      endpoint,
      credentials: {
        accessKeyId: this.env.S3_ACCESS_KEY!,
        secretAccessKey: this.env.S3_SECRET_KEY!,
      },
      // MinIO + most non-AWS S3 use path-style URLs (https://host/bucket/key
      // instead of https://bucket.host/key). Safe to set on AWS too.
      forcePathStyle: true,
    })
  }

  /** Signs a PUT URL the browser uploads to. Expires in 5 minutes. */
  async presignUpload(args: { key: string; contentType: string; expiresIn?: number }): Promise<string> {
    this.requireClient()
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: args.key,
      ContentType: args.contentType,
    })
    return getSignedUrl(this.publicClient!, cmd, { expiresIn: args.expiresIn ?? 300 })
  }

  /** Signs a GET URL — used by the agent when it needs to hand a URL to a
   *  vision model that fetches via HTTP (OpenAI sometimes does this). */
  async presignDownload(key: string, expiresIn = 600): Promise<string> {
    this.requireClient()
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key })
    return getSignedUrl(this.publicClient!, cmd, { expiresIn })
  }

  /** Fetches the object via the internal client and returns base64-encoded body
   *  + the recorded content type. Used to inline image data for LLM calls. */
  async fetchAsBase64(key: string): Promise<{ data: string; contentType: string | undefined }> {
    this.requireClient()
    const out = await this.internal!.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    if (!out.Body) throw new Error(`Empty body for s3 object ${key}`)
    // out.Body is a Readable in node — collect to buffer
    const chunks: Buffer[] = []
    for await (const chunk of out.Body as unknown as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk))
    }
    const buf = Buffer.concat(chunks)
    return { data: buf.toString('base64'), contentType: out.ContentType }
  }

  private requireClient() {
    if (!this.internal || !this.publicClient) {
      throw new Error('S3 not configured — set S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY')
    }
  }
}
