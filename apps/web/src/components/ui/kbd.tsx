import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Linear-style keyboard chip. Renders monospace, has a top-bevel border
 * (1px regular + 2px bottom) for the subtle 3D feel.
 */
export const Kbd = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ className, children, ...props }, ref) => (
    <kbd
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5',
        'font-mono text-[11.5px] text-muted-foreground',
        'bg-secondary border border-border border-b-2 rounded-[5px]',
        'tracking-normal select-none',
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  ),
)
Kbd.displayName = 'Kbd'
