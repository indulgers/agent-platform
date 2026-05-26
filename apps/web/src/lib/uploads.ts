import { api } from '@/lib/api'

export interface AttachmentMeta {
  key: string
  kind: 'image'
  mediaType: string
  size: number
  originalName: string
}

interface PresignResponse {
  key: string
  uploadUrl: string
  expiresIn: number
  attachment: AttachmentMeta
}

const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const MAX_BYTES = 8 * 1024 * 1024

/**
 * Two-step upload:
 *   1. POST /uploads/presign with media-type + size → get a presigned URL
 *   2. PUT the file bytes directly to that URL
 * Returns the attachment metadata to echo back when the user sends the message.
 */
export async function uploadImage(file: File): Promise<AttachmentMeta> {
  if (!ALLOWED_IMAGE_MIME.has(file.type)) {
    throw new Error(`Unsupported image type: ${file.type || 'unknown'}`)
  }
  if (file.size > MAX_BYTES) {
    throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB, max ${MAX_BYTES / 1024 / 1024}MB)`)
  }

  const presign = await api<PresignResponse>('/uploads/presign', {
    method: 'POST',
    body: JSON.stringify({
      mediaType: file.type,
      size: file.size,
      originalName: file.name,
    }),
  })

  const put = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  })
  if (!put.ok) {
    throw new Error(`Upload failed: ${put.status} ${put.statusText}`)
  }

  return presign.attachment
}

/**
 * Read a text-ish file and return the decoded string. Used for client-side
 * inlining of text attachments as fenced code blocks (no S3 needed).
 */
export function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

const TEXT_MIME_PATTERNS = [
  /^text\//,
  /^application\/(json|yaml|x-yaml|xml|javascript|typescript)$/,
]

export function isTextFile(file: File): boolean {
  if (TEXT_MIME_PATTERNS.some(re => re.test(file.type))) return true
  // mime sniff failed — fall back to extension
  return /\.(txt|md|json|ya?ml|csv|tsv|log|ini|conf|toml|sh|js|ts|tsx|jsx|py|go|rs|java|c|cc|cpp|h|hpp|sql)$/i.test(
    file.name,
  )
}

export function isImageFile(file: File): boolean {
  return ALLOWED_IMAGE_MIME.has(file.type)
}

/** Map a file extension to a fence-block language hint. */
export function languageFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'ts',
    tsx: 'tsx',
    js: 'js',
    jsx: 'jsx',
    py: 'python',
    sh: 'bash',
    md: 'markdown',
    json: 'json',
    yml: 'yaml',
    yaml: 'yaml',
    sql: 'sql',
    go: 'go',
    rs: 'rust',
    css: 'css',
    html: 'html',
    xml: 'xml',
    diff: 'diff',
    dockerfile: 'dockerfile',
  }
  if (name.toLowerCase() === 'dockerfile') return 'dockerfile'
  return map[ext] ?? ext
}
