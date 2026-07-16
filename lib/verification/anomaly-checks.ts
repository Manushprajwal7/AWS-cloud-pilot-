/**
 * Checks whether the anomaly a remediation was meant to fix is actually
 * gone. Re-evaluates the deterministic rule set (lib/anomalies) against
 * the resource's current, real state — anomalyDetector only re-evaluates
 * automatically on 'metric_snapshot_saved'/'resource_reset' store events,
 * neither of which a plain updateResource() call (what terraformApplyWorker
 * uses to simulate an apply) emits, so this must explicitly trigger
 * re-evaluation before checking.
 */

import { anomalyDetector } from '@/lib/anomalies/detector'
import type { AnomalyType } from '@/lib/anomalies/types'
import type { CheckResult } from './health-checks'

export function checkOriginalAnomalyResolved(resourceId: string, anomalyType: AnomalyType): CheckResult {
  anomalyDetector.evaluateResource(resourceId)
  const stillActive = anomalyDetector.listAnomalies({ resourceId, status: 'active', type: anomalyType })

  const passed = stillActive.length === 0
  return {
    name: 'original_anomaly_resolved',
    passed,
    details: passed
      ? `no active '${anomalyType}' anomaly remains on ${resourceId}`
      : `'${anomalyType}' anomaly is still active on ${resourceId}`,
  }
}
