/**
 * Deterministic content hashing. Always hash *normalized* input (HCL via
 * code-normalizer.ts, plans via the stable JSON stringify below) so the
 * same logical content always produces the same hash regardless of key
 * order or incidental whitespace — this is what makes the
 * approved-hash-vs-current-hash checks in autoApprovalWorker/
 * terraformApplyWorker meaningful.
 */

import { createHash } from 'node:crypto'

export function hashTerraformCode(normalizedHcl: string): string {
  return createHash('sha256').update(normalizedHcl, 'utf8').digest('hex')
}

/** Recursively sorts object keys so JSON.stringify output is order-independent. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort()
    const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

/** Deterministic hash of a plan summary (or any JSON-serializable value) — the "plan hash" tracked by PlanApproval and re-verified by terraformApplyWorker. */
export function hashJson(value: unknown): string {
  return createHash('sha256').update(stableStringify(value), 'utf8').digest('hex')
}
