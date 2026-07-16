/**
 * Deterministic severity/confidence classification shared by every rule in
 * rules.ts, so "how bad is this" is computed the same way everywhere
 * instead of each rule inventing its own scale.
 */

import type { AnomalySeverity } from './types'

/**
 * Classify severity from a ratio expressed in the "higher is worse"
 * direction (observedValue / threshold once the caller has oriented the
 * metric that way — e.g. for a "lower is worse" metric like request
 * volume dropping, pass threshold / observedValue instead).
 */
export function severityFromRatio(ratio: number): AnomalySeverity {
  if (ratio >= 2) return 'critical'
  if (ratio >= 1.5) return 'high'
  if (ratio >= 1.15) return 'medium'
  return 'low'
}

/**
 * Deterministic confidence in [0.05, 0.95] from how far past threshold a
 * reading is and how consistently the window supported it (consistency is
 * the fraction of the observed window that met the condition, 0-1). This
 * is a fixed formula, not a model estimate — it exists so evidence can
 * carry a graded signal without ever claiming false precision (hence the
 * 0.95 ceiling, never 1.0).
 */
export function confidenceFromRatio(ratio: number, consistency = 1): number {
  const base = 0.5 + (ratio - 1) * 0.3
  return Math.max(0.05, Math.min(0.95, base * consistency))
}
