import { formatMoney } from '@talajs/contracts'

export const money = (minor: number, currency: string) => formatMoney(minor, currency)

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
export const when = (iso: string | null | undefined) => (iso ? dateTime.format(new Date(iso)) : '—')

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
export function ago(iso: string | null | undefined) {
  if (!iso) return 'never'
  const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
  const abs = Math.abs(s)
  if (abs < 60) return relative.format(s, 'second')
  if (abs < 3600) return relative.format(Math.round(s / 60), 'minute')
  if (abs < 86400) return relative.format(Math.round(s / 3600), 'hour')
  return relative.format(Math.round(s / 86400), 'day')
}

/** Digits of the currency's minor unit (2 for USD, 0 for JPY). */
export function minorDigits(currency: string) {
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  )
}

/** "4.50" → 450 for USD. Returns null for anything that isn't a valid amount. */
export function parseMoney(text: string, currency: string): number | null {
  const digits = minorDigits(currency)
  const clean = text.replace(/[^\d.]/g, '')
  if (!clean || !/^\d*(\.\d*)?$/.test(clean)) return null
  const [whole = '0', frac = ''] = clean.split('.')
  if (frac.length > digits) return null
  return Number(whole) * 10 ** digits + Number(frac.padEnd(digits, '0') || 0)
}

export function toMoneyInput(minor: number, currency: string) {
  const digits = minorDigits(currency)
  return (minor / 10 ** digits).toFixed(digits)
}
