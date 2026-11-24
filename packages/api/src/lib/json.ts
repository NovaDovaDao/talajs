/** The JSON shape of a value: Dates become ISO strings (as `JSON.stringify` does). */
export type Jsonify<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? Jsonify<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonify<T[K]> }
      : T

export function toJson<T>(value: T): Jsonify<T> {
  return convert(value) as Jsonify<T>
}

function convert(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(convert)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = convert(v)
    return out
  }
  return value
}
