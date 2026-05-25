import * as React from 'react'
import { cn } from '@/lib/utils'

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Render a status dot before the label. */
  dot?: boolean
  /** Dot colour. Defaults to accent. */
  tone?: 'accent' | 'success' | 'warning' | 'danger' | 'muted'
}

const toneToColor: Record<NonNullable<BadgeProps['tone']>, string> = {
  accent: 'bg-[color:var(--color-accent)]',
  success: 'bg-[color:var(--color-success)]',
  warning: 'bg-[color:var(--color-warning)]',
  danger: 'bg-[color:var(--color-danger)]',
  muted: 'bg-muted-foreground',
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, children, dot, tone = 'accent', ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1.5 h-[22px] px-2.5',
        'text-[11.5px] font-medium tracking-[0.02em]',
        'text-muted-foreground bg-[color:var(--color-surface-1)]',
        'border border-border rounded-full',
        className,
      )}
      {...props}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={cn('w-1.5 h-1.5 rounded-full', toneToColor[tone])}
        />
      )}
      {children}
    </span>
  ),
)
Badge.displayName = 'Badge'
