import { type FormEvent, type ReactNode, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { FieldGroup } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'

/**
 * A dialog with a form. `onSubmit` resolves to `true` to close (e.g. after a successful save).
 * `onOpen` resets the form's state each time it opens.
 */
export function FormDialog({
  trigger,
  title,
  description,
  submitLabel = 'Save',
  onOpen,
  onSubmit,
  pending = false,
  disabled = false,
  children,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger?: ReactNode
  title: string
  description?: ReactNode
  submitLabel?: string
  onOpen?: () => void
  onSubmit: () => Promise<boolean> | boolean
  pending?: boolean
  disabled?: boolean
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [uncontrolled, setUncontrolled] = useState(false)
  const open = controlledOpen ?? uncontrolled
  const setOpen = (next: boolean) => {
    if (next) onOpen?.()
    onOpenChange?.(next)
    setUncontrolled(next)
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (await onSubmit()) setOpen(false)
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <FieldGroup>{children}</FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending || disabled}>
              {pending && <Spinner />} {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
