import type { RunStatus } from '@agent-platform/shared'
import { Badge, type BadgeProps } from '@/components/ui/badge'

const config: Record<RunStatus, { label: string; tone: NonNullable<BadgeProps['tone']> }> = {
  planning: { label: 'Planning', tone: 'muted' },
  awaiting_approval: { label: 'Awaiting approval', tone: 'warning' },
  running: { label: 'Running', tone: 'accent' },
  paused: { label: 'Paused', tone: 'warning' },
  done: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
}

export function RunStatusBadge({ status, className }: { status: RunStatus; className?: string }) {
  const { label, tone } = config[status]
  return (
    <Badge dot tone={tone} className={className}>
      {label}
    </Badge>
  )
}
