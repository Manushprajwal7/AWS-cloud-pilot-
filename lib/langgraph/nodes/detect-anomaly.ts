/**
 * anomalyDetectionWorker node: re-evaluates the resource captured by
 * monitorWorker against the deterministic rule set (lib/anomalies) and
 * selects the single most severe active anomaly to carry through the rest
 * of the run. When nothing matches, state.anomaly stays null and
 * routeAfterDetectAnomaly (../routes.ts) ends the run immediately.
 */

import { anomalyDetector } from '@/lib/anomalies/detector'
import type { Anomaly, AnomalySeverity } from '@/lib/anomalies/types'
import type { GraphState, GraphStateUpdate } from '../state'

const SEVERITY_RANK: Record<AnomalySeverity, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
}

function mostSevere(anomalies: Anomaly[]): Anomaly | null {
  if (anomalies.length === 0) return null
  return anomalies.reduce((worst, candidate) =>
    SEVERITY_RANK[candidate.severity] > SEVERITY_RANK[worst.severity] ? candidate : worst,
  )
}

export async function detectAnomalyNode(state: GraphState): Promise<GraphStateUpdate> {
  anomalyDetector.evaluateResource(state.resourceId)
  const activeAnomalies = anomalyDetector.listAnomalies({ resourceId: state.resourceId, status: 'active' })

  return { anomaly: mostSevere(activeAnomalies) }
}
