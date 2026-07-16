/**
 * Shared Zod coercion for a `?limit=` query parameter, used by every
 * "recent N rows" list route (audit events, graph runs, ...).
 */

import { z } from 'zod'

export function limitQuerySchema(defaultLimit: number, maxLimit: number) {
  return z
    .string()
    .nullable()
    .transform((value) => {
      if (!value) return defaultLimit
      const parsed = Number(value)
      return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), maxLimit) : defaultLimit
    })
}
