import { useEffect, useMemo, useState } from 'react'
import { Loader2, X, FileText, AlertTriangle } from 'lucide-react'
import { uploadImage, type AttachmentMeta } from '@/lib/uploads'
import { cn } from '@/lib/utils'

/**
 * Drafted attachments live in local component state on the composer; once the
 * message is sent, the chips are cleared and the `attachments` array goes onto
 * the POST body alongside `content`.
 *
 * Two kinds: image (real S3-backed attachment) and text (client-side preview
 * that the parent inlines as a fenced code block before sending).
 */

export type DraftAttachment =
  | { kind: 'image'; status: 'uploading'; localId: string; previewUrl: string; name: string }
  | { kind: 'image'; status: 'ready'; localId: string; previewUrl: string; meta: AttachmentMeta }
  | { kind: 'image'; status: 'error'; localId: string; previewUrl: string; name: string; error: string }
  | { kind: 'text'; localId: string; name: string; content: string; language: string }

export interface ComposerAttachmentsProps {
  attachments: DraftAttachment[]
  onRemove: (localId: string) => void
  /** Show a warning chip when image attachments exist but the model doesn't do vision. */
  visionUnsupported?: boolean
  modelDisplayName?: string
}

export function ComposerAttachments({
  attachments,
  onRemove,
  visionUnsupported,
  modelDisplayName,
}: ComposerAttachmentsProps) {
  if (attachments.length === 0) return null

  return (
    <div className="px-2 pt-2 pb-1 flex flex-wrap gap-2">
      {attachments.map(a => (
        <AttachmentChip key={a.localId} attachment={a} onRemove={() => onRemove(a.localId)} />
      ))}

      {visionUnsupported && attachments.some(a => a.kind === 'image') && (
        <div className="flex items-center gap-1.5 text-[11.5px] text-[color:var(--color-warning)] font-mono px-2 py-1 rounded-md border border-[color:color-mix(in_oklab,var(--color-warning)_40%,var(--color-hairline))] bg-[color:color-mix(in_oklab,var(--color-warning)_8%,var(--color-surface-1))]">
          <AlertTriangle className="w-3 h-3" />
          {modelDisplayName ?? 'Active model'} doesn’t support vision — images will be dropped server-side.
        </div>
      )}
    </div>
  )
}

function AttachmentChip({ attachment, onRemove }: { attachment: DraftAttachment; onRemove: () => void }) {
  if (attachment.kind === 'text') {
    return (
      <div className="group flex items-center gap-2 max-w-[260px] px-2 py-1 rounded-md border border-border bg-[color:var(--color-surface-1)] text-[12px]">
        <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono text-[11.5px]">{attachment.name}</span>
        <span className="text-[10.5px] text-muted-foreground font-mono shrink-0">
          {formatBytes(attachment.content.length)}
        </span>
        <RemoveBtn onClick={onRemove} />
      </div>
    )
  }
  // image
  return (
    <div
      className={cn(
        'group relative flex items-center gap-2 px-1.5 py-1.5 rounded-md border bg-[color:var(--color-surface-1)] text-[12px] min-w-0',
        attachment.status === 'error'
          ? 'border-[color:color-mix(in_oklab,var(--color-danger)_50%,var(--color-hairline))]'
          : 'border-border',
      )}
    >
      <div className="relative w-9 h-9 rounded overflow-hidden bg-[color:var(--color-surface-2)] border border-[color:var(--color-hairline)] shrink-0">
        <img src={attachment.previewUrl} alt="" className="w-full h-full object-cover" />
        {attachment.status === 'uploading' && (
          <div className="absolute inset-0 bg-black/50 grid place-items-center">
            <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
          </div>
        )}
      </div>
      <div className="flex flex-col min-w-0 max-w-[180px]">
        <span className="truncate font-mono text-[11.5px]">
          {attachment.status === 'ready' ? attachment.meta.originalName : attachment.kind === 'image' ? attachment.name : ''}
        </span>
        <span className="text-[10.5px] text-muted-foreground font-mono">
          {attachment.status === 'ready' && formatBytes(attachment.meta.size)}
          {attachment.status === 'uploading' && 'uploading…'}
          {attachment.status === 'error' && (
            <span className="text-[color:var(--color-danger)]" title={attachment.error}>error</span>
          )}
        </span>
      </div>
      <RemoveBtn onClick={onRemove} />
    </div>
  )
}

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ml-1 p-0.5 rounded hover:bg-[color:var(--color-surface-3)] text-muted-foreground hover:text-foreground shrink-0"
      aria-label="Remove attachment"
    >
      <X className="w-3 h-3" />
    </button>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / 1024 / 1024).toFixed(2)}MB`
}

// ---------------------------------------------------------------------------
// Hook: useAttachmentDraft — owns the upload lifecycle so the composer just
// reads the array + a few callbacks.
// ---------------------------------------------------------------------------

let localIdSeq = 0
function nextLocalId(): string {
  return `att-${++localIdSeq}-${Date.now().toString(36)}`
}

export function useAttachmentDraft() {
  const [attachments, setAttachments] = useState<DraftAttachment[]>([])

  // Revoke object URLs when chips disappear to avoid leaks
  useEffect(() => {
    return () => {
      for (const a of attachments) {
        if (a.kind === 'image') URL.revokeObjectURL(a.previewUrl)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addImage = (file: File) => {
    const localId = nextLocalId()
    const previewUrl = URL.createObjectURL(file)
    setAttachments(prev => [
      ...prev,
      { kind: 'image', status: 'uploading', localId, previewUrl, name: file.name },
    ])

    uploadImage(file)
      .then(meta => {
        setAttachments(prev =>
          prev.map<DraftAttachment>(a => {
            if (a.kind !== 'image' || a.localId !== localId) return a
            return { kind: 'image', status: 'ready', localId: a.localId, previewUrl: a.previewUrl, meta }
          }),
        )
      })
      .catch(err => {
        const errMsg = err instanceof Error ? err.message : String(err)
        setAttachments(prev =>
          prev.map<DraftAttachment>(a => {
            if (a.kind !== 'image' || a.localId !== localId) return a
            const name = a.status === 'ready' ? a.meta.originalName : a.name
            return {
              kind: 'image',
              status: 'error',
              localId: a.localId,
              previewUrl: a.previewUrl,
              name,
              error: errMsg,
            }
          }),
        )
      })
  }

  const addText = (file: File, content: string, language: string) => {
    setAttachments(prev => [
      ...prev,
      { kind: 'text', localId: nextLocalId(), name: file.name, content, language },
    ])
  }

  const remove = (localId: string) => {
    setAttachments(prev => {
      const removed = prev.find(a => a.localId === localId)
      if (removed?.kind === 'image') URL.revokeObjectURL(removed.previewUrl)
      return prev.filter(a => a.localId !== localId)
    })
  }

  const clear = () => {
    setAttachments(prev => {
      for (const a of prev) if (a.kind === 'image') URL.revokeObjectURL(a.previewUrl)
      return []
    })
  }

  const readyImages = useMemo(
    () => attachments.filter(a => a.kind === 'image' && a.status === 'ready').map(a => (a as Extract<DraftAttachment, { status: 'ready' }>).meta),
    [attachments],
  )

  const isBusy = useMemo(
    () => attachments.some(a => a.kind === 'image' && a.status === 'uploading'),
    [attachments],
  )

  return { attachments, addImage, addText, remove, clear, readyImages, isBusy }
}
