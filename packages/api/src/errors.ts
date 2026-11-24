import type { ErrorBody, ErrorCode } from '@talajs/contracts'
import { TenantScopeError } from '@talajs/db'
import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export class HttpError extends Error {
  override name = 'HttpError'
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} not found`)
export const forbidden = (message = 'Not allowed') => new HttpError(403, 'forbidden', message)
export const conflict = (message: string, details?: unknown) =>
  new HttpError(409, 'conflict', message, details)

interface PrismaLikeError {
  name: string
  code?: string
  message: string
  meta?: Record<string, unknown>
}

function isPrismaError(e: unknown): e is PrismaLikeError {
  return e instanceof Error && e.name.startsWith('PrismaClient')
}

/** Translate known failures into API errors; everything else is a 500. */
export function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error
  if (error instanceof HTTPException) {
    return new HttpError(error.status as ContentfulStatusCode, 'validation_error', error.message)
  }
  if (error instanceof TenantScopeError) {
    // Always a programming error, never the caller's fault; don't leak details.
    return new HttpError(500, 'internal_error', 'Internal error')
  }
  if (isPrismaError(error)) {
    switch (error.code) {
      case 'P2002':
        return conflict('A record with the same unique value already exists', {
          target: error.meta?.target ?? error.meta?.modelName,
        })
      case 'P2025':
        return notFound('Record')
      case 'P2003':
        return new HttpError(
          422,
          'invalid_reference',
          'A referenced record does not exist in this tenant',
        )
    }
    if (/check constraint/i.test(error.message)) {
      const constraint = /"?([a-z0-9_]+)"?\s*$/i.exec(error.message.split('constraint')[1] ?? '')
      return new HttpError(422, 'validation_error', 'Value violates a database constraint', {
        constraint: constraint?.[1],
      })
    }
  }
  return new HttpError(500, 'internal_error', 'Internal error')
}

export function errorResponse(c: Context, error: HttpError) {
  const body: ErrorBody = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  }
  return c.json(body, error.status)
}
