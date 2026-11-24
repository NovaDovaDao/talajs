import { useEffect, useState } from 'react'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group'
import { parseMoney, toMoneyInput } from '@/lib/format'

/** Edits integer minor units as a decimal amount ("4.50" ↔ 450). */
export function MoneyInput({
  value,
  onChange,
  currency,
  id,
  placeholder = '0.00',
  allowEmpty = false,
  autoFocus,
  onBlur,
}: {
  value: number | null
  onChange: (minor: number | null) => void
  currency: string
  id?: string
  placeholder?: string
  allowEmpty?: boolean
  autoFocus?: boolean
  onBlur?: () => void
}) {
  const [text, setText] = useState(value === null ? '' : toMoneyInput(value, currency))
  useEffect(() => {
    if (value === null) return
    if (parseMoney(text, currency) !== value) setText(toMoneyInput(value, currency))
  }, [value, currency, text])
  const invalid = text !== '' && parseMoney(text, currency) === null
  return (
    <InputGroup>
      <InputGroupAddon>
        <InputGroupText>{currency}</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput
        id={id}
        inputMode="decimal"
        placeholder={placeholder}
        value={text}
        autoFocus={autoFocus}
        aria-invalid={invalid || undefined}
        onBlur={onBlur}
        onChange={(e) => {
          setText(e.target.value)
          const minor = parseMoney(e.target.value, currency)
          if (minor !== null) onChange(minor)
          else if (e.target.value === '' && allowEmpty) onChange(null)
        }}
      />
    </InputGroup>
  )
}
