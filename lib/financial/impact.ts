/**
 * Deterministic financial impact of anomalies. Groq may explain these
 * numbers in prose (a later phase), but must never generate them — every
 * value here traces back to calculateCost() and a resource's real,
 * simulated cost, via a fixed, documented waste-fraction heuristic per
 * anomaly type.
 */

import type { Anomaly, AnomalyType } from '@/lib/anomalies/types'
import type { SimulatedCloudResource } from '@/lib/simulation/types'
import { toCostBreakdown, type CostBreakdown } from './pricing'

/**
 * Fraction (0-1) of a resource's current cost considered "waste" while a
 * given anomaly type is active. Only anomaly types with a defensible
 * dollar-waste interpretation are listed — CPU spikes, memory leaks,
 * traffic surges, and elevated error rates are performance/reliability
 * risks, not a wasted-spend figure, so no number is invented for them.
 */
const WASTE_FRACTION_BY_TYPE: Partial<Record<AnomalyType, number>> = {
  IDLE_RESOURCE: 1, // paying full price for a resource doing essentially nothing
  OVERPROVISIONED: 0.4, // heuristic share of spend attributable to excess headroom
  COST_SPIKE: 0.3, // heuristic share of the elevated spend considered avoidable
}

export interface FinancialImpact {
  anomalyId: string
  resourceId: string
  type: AnomalyType
  wasteFraction: number
  estimatedWaste: CostBreakdown
}

/** Null when this anomaly type has no defined waste interpretation. */
export function calculateAnomalyFinancialImpact(
  anomaly: Anomaly,
  resource: SimulatedCloudResource,
): FinancialImpact | null {
  const fraction = WASTE_FRACTION_BY_TYPE[anomaly.type]
  if (fraction === undefined) return null

  return {
    anomalyId: anomaly.id,
    resourceId: resource.id,
    type: anomaly.type,
    wasteFraction: fraction,
    estimatedWaste: toCostBreakdown(resource.cost.hourlyUsd * fraction),
  }
}

export function calculateAggregateWaste(impacts: FinancialImpact[]): CostBreakdown {
  const totalHourly = impacts.reduce((sum, impact) => sum + impact.estimatedWaste.hourlyUsd, 0)
  return toCostBreakdown(totalHourly)
}
