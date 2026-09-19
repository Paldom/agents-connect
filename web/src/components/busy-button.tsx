import { Loader2Icon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { Button } from '@/components/ui/button'

/** A Button that is disabled and shows a spinner while `busy`. */
export function BusyButton({ busy, disabled, children, ...props }: ComponentProps<typeof Button> & { busy?: boolean }) {
  return (
    <Button disabled={busy || disabled} aria-busy={busy || undefined} {...props}>
      {busy && <Loader2Icon className="animate-spin" aria-hidden />}
      {children}
    </Button>
  )
}
