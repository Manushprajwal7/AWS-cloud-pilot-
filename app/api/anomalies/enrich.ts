/**
 * Attaches deterministic financial impact and a concrete savings
 * recommendation to an anomaly for API responses. Not a route itself (no
 * GET/POST export).
 */

import { simulationStore } from '@/lib/simulation/simulation-store'
import { calculateAnomalyFinancialImpact, type FinancialImpact } from '@/lib/financial/impact'
import {
  calculateScheduledShutdownSavings,
  recommendRightsizing,
  recommendScaleIn,
  type RightsizingRecommendation,
  type ScaleInRecommendation,
  type ScheduledShutdownRecommendation,
} from '@/lib/financial/rightsizing'
import type { Anomaly } from '@/lib/anomalies/types'
import type { SimulatedCloudResource } from '@/lib/simulation/types'

export type SavingsRecommendation =
  | ({ kind: 'rightsizing' } & RightsizingRecommendation)
  | ({ kind: 'scheduled_shutdown' } & ScheduledShutdownRecommendation)
  | ({ kind: 'scale_in' } & ScaleInRecommendation)

export interface EnrichedAnomaly extends Anomaly {
  financialImpact: FinancialImpact | null
  recommendation: SavingsRecommendation | null
}

/** The one recommendation, if any, most relevant to this anomaly type. */
function recommendationFor(anomaly: Anomaly, resource: SimulatedCloudResource): SavingsRecommendation | null {
  switch (anomaly.type) {
    case 'OVERPROVISIONED': {
      const scaleIn = recommendScaleIn(resource)
      if (scaleIn) return { kind: 'scale_in', ...scaleIn }
      const rightsizing = recommendRightsizing(resource)
      return rightsizing ? { kind: 'rightsizing', ...rightsizing } : null
    }
    case 'IDLE_RESOURCE': {
      if (resource.environment === 'production') return null // don't suggest scheduling downtime for production
      return { kind: 'scheduled_shutdown', ...calculateScheduledShutdownSavings(resource) }
    }
    default:
      return null
  }
}

export function enrichAnomaly(anomaly: Anomaly): EnrichedAnomaly {
  const resource = simulationStore.getResource(anomaly.resourceId)
  const financialImpact = resource ? calculateAnomalyFinancialImpact(anomaly, resource) : null
  const recommendation = resource ? recommendationFor(anomaly, resource) : null
  return { ...anomaly, financialImpact, recommendation }
}
