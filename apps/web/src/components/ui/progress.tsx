import * as React from 'react'
import { cn } from '~/lib/utils'

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number
  indicatorClassName?: string
}

function Progress({ className, value = 0, indicatorClassName, ...props }: ProgressProps) {
  const boundedValue = Math.max(0, Math.min(100, value))

  return (
    <div
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-secondary', className)}
      {...props}
    >
      <div
        className={cn('h-full w-full flex-1 bg-primary transition-all', indicatorClassName)}
        style={{ transform: `translateX(-${100 - boundedValue}%)` }}
      />
    </div>
  )
}

export { Progress }
