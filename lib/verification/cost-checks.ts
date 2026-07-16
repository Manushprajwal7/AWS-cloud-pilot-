/**
 * Confirms the resource's real, simulated cost after apply didn't exceed
 * what autoApprovalWorker actually approved. A small tolerance absorbs
 * floating-point noise, not a policy exception.
 */

import type { SimulatedCloudResource } from '@/lib/simulation/types'
import type { CheckResult } from './health-checks'

const COST_TOLERANCE_USD = 1

export function checkCostWithinApprovedEstimate(
  baseline: SimulatedCloudResource,
  current: SimulatedCloudResource,
  approvedEstimatedMonthlyCostChangeUsd: number,
): CheckResult {
  const actualChangeUsd = current.cost.projectedMonthlyUsd - baseline.cost.projectedMonthlyUsd
  const passed = actualChangeUsd <= approvedEstimatedMonthlyCostChangeUsd + COST_TOLERANCE_USD

  return {
    name: 'cost_within_approved_estimate',
    passed,
    details: `actual monthly cost change $${actualChangeUsd.toFixed(2)} vs approved estimate $${approvedEstimatedMonthlyCostChangeUsd.toFixed(2)}`,
  }
}
