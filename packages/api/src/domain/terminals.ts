import { type CreateTerminal, type ListQuery, type UpdateTerminal, uuidv7 } from '@talajs/contracts'
import type { TalaDb } from '@talajs/db'
import { HttpError, notFound } from '../errors.js'
import { toPage, withCursor } from '../lib/pagination.js'
import {
  newPairingCode,
  newTerminalToken,
  normalisePairingCode,
  sha256Hex,
} from '../lib/secrets.js'
import type { TenantContext, TenantTx } from '../types.js'
import { assertStoreAccess, storeFilter } from './access.js'

/** How long a pairing code stays valid. */
export const PAIRING_TTL_MS = 15 * 60 * 1000

const terminalSelect = {
  id: true,
  storeId: true,
  name: true,
  code: true,
  tokenHash: true,
  pairingExpiresAt: true,
  lastSeenAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
} as const

type TerminalRow = { tokenHash: string | null; pairingExpiresAt: Date | null }

/** Never expose hashes; show only whether the terminal is paired. */
function toTerminal<R extends TerminalRow>({ tokenHash, ...row }: R) {
  return {
    ...row,
    paired: tokenHash !== null,
    pairingExpiresAt:
      row.pairingExpiresAt && row.pairingExpiresAt.getTime() > Date.now()
        ? row.pairingExpiresAt
        : null,
  }
}

async function loadTerminal(ctx: TenantContext, tx: Pick<TenantTx, 'terminal'>, id: string) {
  const row = await tx.terminal.findUnique({ where: { id }, select: terminalSelect })
  if (!row) throw notFound('Terminal')
  assertStoreAccess(ctx, row.storeId)
  return row
}

export async function listTerminals(
  ctx: TenantContext,
  query: ListQuery & { storeId?: string | undefined },
) {
  if (query.storeId) assertStoreAccess(ctx, query.storeId)
  const rows = await ctx.db.terminal.findMany({
    where: withCursor(
      {
        ...storeFilter(ctx),
        ...(query.storeId ? { storeId: query.storeId } : {}),
        ...(query.includeArchived ? {} : { revokedAt: null }),
      },
      query,
    ),
    orderBy: { id: 'asc' },
    take: query.limit + 1,
    select: terminalSelect,
  })
  return toPage(rows.map(toTerminal), query.limit)
}

export const getTerminal = async (ctx: TenantContext, id: string) =>
  toTerminal(await loadTerminal(ctx, ctx.db, id))

/** Issue a fresh pairing code. Returned once; only its hash is stored. */
async function issuePairingCode(tx: Pick<TenantTx, 'terminal'>, id: string) {
  const pairingCode = newPairingCode()
  const pairingExpiresAt = new Date(Date.now() + PAIRING_TTL_MS)
  const row = await tx.terminal.update({
    where: { id },
    data: {
      pairingCodeHash: await sha256Hex(normalisePairingCode(pairingCode)),
      pairingExpiresAt,
    },
    select: terminalSelect,
  })
  return { terminal: toTerminal(row), pairingCode, pairingExpiresAt }
}

export async function createTerminal(ctx: TenantContext, input: CreateTerminal) {
  assertStoreAccess(ctx, input.storeId)
  const id = input.id ?? uuidv7()
  return ctx.db.$transaction(async (tx) => {
    await tx.terminal.create({ data: { ...input, id, tenantId: ctx.tenantId, scopes: ['pos'] } })
    return issuePairingCode(tx, id)
  })
}

export async function updateTerminal(ctx: TenantContext, id: string, input: UpdateTerminal) {
  await loadTerminal(ctx, ctx.db, id)
  return toTerminal(
    await ctx.db.terminal.update({ where: { id }, data: input, select: terminalSelect }),
  )
}

/**
 * New pairing code, e.g. to move a register to new hardware. The current token keeps working
 * until the new code is used, which replaces it.
 */
export async function repairTerminal(ctx: TenantContext, id: string) {
  const terminal = await loadTerminal(ctx, ctx.db, id)
  if (terminal.revokedAt) throw new HttpError(409, 'invalid_state', 'The terminal is revoked')
  return issuePairingCode(ctx.db, id)
}

/** Permanent: the token and any pending pairing code stop working at once. */
export async function revokeTerminal(ctx: TenantContext, id: string) {
  await loadTerminal(ctx, ctx.db, id)
  return toTerminal(
    await ctx.db.terminal.update({
      where: { id },
      data: {
        revokedAt: new Date(),
        tokenHash: null,
        pairingCodeHash: null,
        pairingExpiresAt: null,
      },
      select: terminalSelect,
    }),
  )
}

const invalidCode = () => new HttpError(401, 'unauthenticated', 'Invalid or expired pairing code')

/**
 * Exchange a pairing code for a terminal token (unauthenticated: the code is the credential).
 * Codes are single use: the conditional update means two simultaneous exchanges can't both win.
 */
export async function pairTerminal(db: TalaDb, pairingCode: string) {
  const hash = await sha256Hex(normalisePairingCode(pairingCode))
  const terminal = await db.client.terminal.findUnique({
    where: { pairingCodeHash: hash },
    select: { id: true, tenantId: true, storeId: true, name: true, code: true },
  })
  if (!terminal) throw invalidCode()
  const token = newTerminalToken()
  const { count } = await db.client.terminal.updateMany({
    where: {
      id: terminal.id,
      pairingCodeHash: hash,
      pairingExpiresAt: { gt: new Date() },
      revokedAt: null,
    },
    data: {
      tokenHash: await sha256Hex(token),
      pairingCodeHash: null,
      pairingExpiresAt: null,
      lastSeenAt: new Date(),
    },
  })
  if (count === 0) throw invalidCode()
  return { token, terminal }
}
