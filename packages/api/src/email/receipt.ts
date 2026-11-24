import { formatMoney } from '@talajs/contracts'

export interface ReceiptData {
  tenantName: string
  storeName: string
  timezone: string
  order: {
    id: string
    number: string
    currency: string
    subtotalMinor: number
    taxMinor: number
    totalMinor: number
    tipMinor: number
    completedAt: Date | null
    lines: {
      itemName: string
      variantName: string | null
      quantity: number
      lineTotalMinor: number
      modifiers: { name: string }[]
    }[]
    payments: { method: string; amountMinor: number; tipMinor: number }[]
  }
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch,
  )

/** A plain, dependency-free receipt. Pass your own `render` to `createTalaConsumer` to brand it. */
export function renderReceipt({
  tenantName,
  storeName,
  timezone,
  order,
}: ReceiptData): RenderedEmail {
  const money = (minor: number) => formatMoney(minor, order.currency)
  const when = order.completedAt
    ? new Intl.DateTimeFormat('en', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: timezone,
      }).format(order.completedAt)
    : ''
  const lines = order.lines.map((l) => {
    const name = [l.itemName, l.variantName].filter(Boolean).join(' ')
    const mods = l.modifiers.map((m) => m.name).join(', ')
    return {
      label: `${l.quantity} × ${name}${mods ? ` (${mods})` : ''}`,
      amount: money(l.lineTotalMinor),
    }
  })
  const totals: [string, string][] = [
    ['Subtotal', money(order.subtotalMinor)],
    ['Tax', money(order.taxMinor)],
    ['Total', money(order.totalMinor)],
  ]
  if (order.tipMinor > 0) totals.push(['Tip', money(order.tipMinor)])
  const paid = order.payments.map(
    (p) =>
      [`Paid (${p.method.toLowerCase()})`, money(p.amountMinor + p.tipMinor)] as [string, string],
  )

  const subject = `Your receipt from ${storeName} (order ${order.number})`
  const text = [
    tenantName === storeName ? storeName : `${tenantName} · ${storeName}`,
    `Order ${order.number}${when ? ` · ${when}` : ''}`,
    '',
    ...lines.map((l) => `${l.label}  ${l.amount}`),
    '',
    ...[...totals, ...paid].map(([k, v]) => `${k}: ${v}`),
    '',
    'Thank you!',
  ].join('\n')

  const row = (k: string, v: string, bold = false) =>
    `<tr><td style="padding:4px 0">${bold ? `<b>${escapeHtml(k)}</b>` : escapeHtml(k)}</td><td style="padding:4px 0;text-align:right">${bold ? `<b>${escapeHtml(v)}</b>` : escapeHtml(v)}</td></tr>`
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;color:#222">
<h2 style="margin-bottom:0">${escapeHtml(storeName)}</h2>
<p style="margin-top:4px;color:#666">Order ${escapeHtml(order.number)}${when ? ` · ${escapeHtml(when)}` : ''}</p>
<table style="width:100%;border-collapse:collapse">${lines.map((l) => row(l.label, l.amount)).join('')}</table>
<hr style="border:none;border-top:1px solid #ddd">
<table style="width:100%;border-collapse:collapse">${totals.map(([k, v]) => row(k, v, k === 'Total')).join('')}${paid.map(([k, v]) => row(k, v)).join('')}</table>
<p>Thank you!</p>
</body></html>`
  return { subject, html, text }
}
