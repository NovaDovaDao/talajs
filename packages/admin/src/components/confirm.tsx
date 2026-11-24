import { type ReactNode, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

/** A confirmation dialog, optionally asking for a reason (voids, refunds). */
export function Confirm({
  trigger,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive = false,
  reason,
  onConfirm,
}: {
  trigger: ReactNode
  title: string
  description?: ReactNode
  confirmLabel?: string
  destructive?: boolean
  /** Ask for a reason, with this label. */
  reason?: string
  onConfirm: (reason: string) => void
}) {
  const [text, setText] = useState('')
  return (
    <AlertDialog onOpenChange={(open) => open && setText('')}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        {reason && (
          <Field>
            <FieldLabel htmlFor="confirm-reason">{reason}</FieldLabel>
            <Input
              id="confirm-reason"
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
            />
          </Field>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? 'destructive' : 'default'}
            disabled={reason !== undefined && text.trim() === ''}
            onClick={() => onConfirm(text.trim())}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
