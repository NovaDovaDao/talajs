# Terminal sync protocol

How a register (terminal) pairs with Tala, records sales offline, and stays in step with the catalog. The schemas are in `@talajs/contracts` (`src/api/sync.ts`), so a register written in TypeScript can import them directly.

The rule behind the design is that **the register never needs the cloud to complete a sale**. Whatever it pushes describes something that already happened at the counter. Tala records it, and anything questionable goes to a review queue rather than being thrown away.

## 1. Pairing

1. A manager creates the terminal: `POST /v1/tenants/{tenantId}/terminals` with `{ storeId, name, code }`. `code` is a short prefix for offline order numbers, such as `T2`, and is unique per store.
2. The response includes a **pairing code** such as `7KQ2M-XW9HD`. It's shown once, expires after 15 minutes and works once. Only its SHA-256 hash is stored.
3. The register sends it to `POST /v1/terminal/pair` with `{ pairingCode }`. No other credential is needed, and case, spaces and dashes don't matter.
4. The response holds the **terminal token** (`tala_t_…`) and the terminal's `tenantId`, `storeId` and `code`. Store the token in the platform keychain. Tala keeps only its hash.

From then on the register sends `Authorization: Bearer tala_t_…` on every request. A terminal acts as `STAFF` in its own store: it can read the catalog, use the order API while online, and push and pull. It can't manage the catalog, members or other stores.

**Moving to new hardware or losing the token:** `POST …/terminals/{id}/pairing-code` issues a fresh code. The old token keeps working until the new code is used, and is then replaced.

**Revoking:** `POST …/terminals/{id}/revoke` is permanent. The token stops working on the next request.

## 2. Recording offline

The register generates every id itself, as UUIDv7: order, line, payment, and each mutation. That needs no server round trip, and the ids double as dedupe keys.

- **Prices and tax** come from the catalog the register last pulled. Totals are computed with `priceOrder` from `@talajs/contracts`, the same function the server uses, so they agree.
- **Order numbers** take the form `{code}-{seq}`, for example `T2-0042`. Numbers without the terminal's prefix are rejected. If `number` is omitted, the server assigns one from the store's counter.
- Each change is appended to a local **outbox** as a mutation:

```json
{
  "id": "0193…",                       // UUIDv7, the dedupe key
  "clientTs": "2026-11-19T09:14:03Z",  // when it happened at the counter
  "type": "order.add_lines",
  "payload": { "orderId": "0193…", "lines": [ … ] },
  "baseVersion": 3,                    // optional, see §4
  "actorMembershipId": "0192…"         // optional, who did it, see §6
}
```

| `type` | Payload | Notes |
|---|---|---|
| `order.open` | `orderId`, `number?`, `isTab`, `tabName?`, `customerId?`, `note?`, `openedAt?` | Opens a cart or tab in the terminal's store. |
| `order.add_lines` | `orderId`, `lines[]` | Each line is a snapshot: `id`, `variantId` (or null for custom), `itemName`, `variantName`, `unitPriceMinor`, `quantity`, `taxRateBps`, `modifiers[]`, `note`. Lines already received are skipped. |
| `order.void_line` | `orderId`, `lineId`, `reason` | Puts the line's stock back. |
| `order.pay` | `orderId`, `paymentId`, `method: CASH`, `amountMinor`, `tipMinor` | Only cash can be recorded offline. |
| `order.complete` | `orderId`, `completedAt?` | Needs the order to be paid in full. |
| `order.void` | `orderId`, `reason` | Only before payment; puts all stock back. |

A complete offline sale is four mutations: open, add_lines, pay, complete.

## 3. Pushing

`POST /v1/tenants/{tenantId}/sync/push` with `{ mutations: [...] }`, up to 100 per request, oldest first.

- Mutations are applied **in order, each in its own transaction**, so one failure doesn't block the rest.
- The response has one result per mutation, in the same order:

```json
{ "results": [ { "id": "0193…", "status": "APPLIED", "reviewItemIds": [] }, … ] }
```

| `status` | Meaning | What the register does |
|---|---|---|
| `APPLIED` | Done. `reviewItemIds` may be non-empty when it was applied but needs a look (see below). | Remove from outbox. |
| `DUPLICATE` | Already received. `original` says what happened the first time. | Remove from outbox. |
| `CONFLICT` | Not applied, because applying it would be wrong. Kept in a review item. | Remove from outbox; optionally tell the user. |
| `REJECTED` | Invalid: bad payload, unknown order, another store's order. Kept in a review item. | Remove from outbox; log it. |

**Every status is final for that mutation id**, so the outbox entry can always be removed once a result comes back. If the request itself fails (network error or 5xx), push the same batch again. Already-applied mutations come back as `DUPLICATE`, and the same mutation is never applied twice, even when two pushes of it race.

## 4. Conflicts and the review queue

Sales are facts, so most surprises are **applied and flagged** rather than refused:

| Situation | Result | Review item |
|---|---|---|
| An offline sale takes strictly tracked stock below zero | `APPLIED` | `NEGATIVE_STOCK` on the stock level |
| A line was sold at a price different from the current catalog price | `APPLIED` (the charged price is kept) | `SYNC_CONFLICT`, `reason: price_mismatch` |
| Cash taken twice for one tab (two registers) | `APPLIED` | `PAYMENT_MISMATCH` with `overpaidMinor` |
| A voided line leaves the order overpaid | `APPLIED` | `PAYMENT_MISMATCH` |

Some changes would be wrong to apply after the fact. These become **conflicts**:

| Situation | Result |
|---|---|
| `order.void_line` or `order.void` with a `baseVersion` older than the order's current `version` (someone else changed the tab) | `CONFLICT` |
| Lines added to, or a line voided on, an order that is completed or voided | `CONFLICT` |
| Cash taken on a voided order | `CONFLICT` (`PAYMENT_MISMATCH`) |
| Completing an order with a balance due, or voiding one with payments | `CONFLICT` |

**`baseVersion`:** send the order `version` the register last saw (from the order API or an earlier push) with voids. Adding lines and taking payments never need it: drinks poured and cash taken on two registers both really happened.

Review items keep the original payload, the reason and the versions involved. Managers with access to all stores see them in the review queue:
- `GET …/review-items?status=OPEN`
- `POST …/review-items/{id}/resolve` with `{ status: RESOLVED | DISMISSED, note? }`

Resolving records the decision. Any fix (a refund, a recount, voiding by hand) is made through the normal API.

## 5. Pulling the catalog

`GET /v1/tenants/{tenantId}/sync/pull?cursor=…&limit=…`

- **First run:** call without a cursor. The response replays the catalog change history, collapsed to each entity's latest state. Pull again with the returned `cursor` while `hasMore` is true.
- **Afterwards:** poll with the last cursor, for example every 30 to 60 seconds while online, and right after reconnecting.
- Each change is `{ entity, id, op, data }`. `data` is the entity's current state in the same shape as the REST API returns it, so the register can upsert it. Archived entities arrive with `archivedAt` set; nothing is ever deleted.
- Entities: `store`, `tax_rate`, `category`, `item` (with variants, categories and modifier groups), `modifier_group` (with modifiers), `store_item` (per-store availability and price override), `stock_level`, and `staff` (see §6). Only the terminal's own store's stores, store items and stock levels are included.
- The cursor is opaque. Store it only after the changes have been applied locally.

**Consistency:** the feed never skips a change.
- A change appears only once every database transaction that started writing before it has finished. A slow transaction therefore delays the feed briefly rather than letting a change slip in behind the cursor.
- In practice a change made in the admin shows up on the next poll.
- Long-running write transactions anywhere in the database, such as a big migration, hold the feed back until they finish.

## 6. Staff and PINs

The terminal token says which *register* is talking. A PIN says which *person* is at it, so sales, voids and payments are recorded against them. People set their own PIN in the admin (Your account), or a manager resets it. A PIN has the tenant's `pinLength` digits (4 by default, up to 6) and is unique within a store, so the PIN alone identifies the person.

**Online:** `POST /v1/tenants/{tenantId}/sync/pin` with `{ pin }` returns the staff member: `{ id, displayName, role, active }`, where `id` is their membership id.
- A wrong PIN is `403 invalid_pin`, with `details.attemptsLeft`.
- After 5 wrong PINs in a row, the register's PIN entry is locked for 15 minutes: `423 pin_locked`, with `details.lockedUntil`. The lock is logged in the tenant's audit log.
- A right PIN resets the count. A `403` here is about the PIN, not the token: don't re-pair.

**Offline:** the pull feed's `staff` entity lists the people who can work this store's registers: `{ id, displayName, role, active, pinDigest }`.
- `pinDigest` is `sha256("<id>:<pin>")` as lower-case hex, or null without a PIN.
- `active: false` means revoked, or no longer allowed in this store: drop them locally.
- To check a PIN offline, compute the digest for each active person and compare.

**PINs attribute; they don't authorize.** A 4–6 digit PIN can be found from its digest in well under a second by anyone holding the register's storage, and no amount of hashing changes that for so few digits. So:
- Offline, a PIN only says who did something. Put their id in the mutation's `actorMembershipId`. The server records the actor as `pin:<membershipId>@terminal:<terminalId>` if that person is active in the store, and the terminal otherwise. It grants nothing: the register can do exactly what its token allows.
- Anything that needs a manager (a refund, a void after payment, overriding a price) must be checked online, with `/sync/pin` returning `role: MANAGER` or higher. Or leave it to the review queue. Voids after completion and refunds are already unavailable in sync.
- Treat the digests like the rest of the register's data: in app-private storage, cleared when the register is unpaired.

## 7. Recommended register loop

```
on sale/edit:      append mutation to local outbox; update local state
every N seconds:   if online:
                     push outbox in batches of ≤100, oldest first
                       → remove each mutation that got a result
                     pull with the stored cursor until hasMore is false
                       → apply changes, then store the new cursor
on PIN entry:      online: POST /sync/pin; offline: compare against staff digests
                   → put the person's id in actorMembershipId on their mutations
on token 401:      stop syncing; ask a manager to re-pair
```
