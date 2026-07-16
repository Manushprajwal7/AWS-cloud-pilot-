/**
 * Deterministic analysis of a real `terraform show -json` plan summary
 * (lib/terraform/plan-parser.ts). Combines counts derived from the plan
 * itself with risk-score.ts and environment-policy.ts into one
 * PlanAnalysis — this is what planPolicyWorker persists and
 * autoApprovalWorker decides on. No LLM anywhere in this module.
 */

import type { CloudEnvironment } from '@/lib/simulation/types'
import { calculateRiskScore } from './risk-score'
import { evaluateEnvironmentPolicy } from './environment-policy'
import { isAllowedResourceType } from './provider-allowlist'
import type { PlanAnalysis, PlanSummary } from './types'

export interface RemediationPlanInputs {
  requiresApproval: boolean
  expectedMonthlySavingsUsd: number | null
}

function isReplacement(actions: string[]): boolean {
  return actions.includes('delete') && actions.includes('create')
}

export function analyzePlan(planSummary: PlanSummary, environment: CloudEnvironment, remediationPlan: RemediationPlanInputs): PlanAnalysis {
  const { resourceChanges } = planSummary

  const replacementCount = resourceChanges.filter((rc) => isReplacement(rc.actions)).length
  const createCount = resourceChanges.filter((rc) => rc.actions.includes('create') && !isReplacement(rc.actions)).length
  const deleteCount = resourceChanges.filter((rc) => rc.actions.includes('delete') && !isReplacement(rc.actions)).length
  const updateCount = resourceChanges.filter((rc) => rc.actions.includes('update')).length
  const affectedResourceCount = resourceChanges.filter((rc) => !(rc.actions.length === 1 && rc.actions[0] === 'no-op')).length

  // Negative = cost decrease (savings), positive = cost increase.
  const estimatedMonthlyCostChangeUsd = -(remediationPlan.expectedMonthlySavingsUsd ?? 0)

  // Also covers "unapproved providers": every allowed resource type is
  // aws_*, so a resource from any other provider fails this same check.
  const unsupportedResourceViolations = resourceChanges
    .filter((rc) => !isAllowedResourceType(rc.type))
    .map((rc) => `unsupported resource type '${rc.type}' at ${rc.address}`)

  const environmentViolations = evaluateEnvironmentPolicy({
    environment,
    deleteCount,
    replacementCount,
    requiresApproval: remediationPlan.requiresApproval,
    estimatedMonthlyCostChangeUsd,
  })

  const riskScore = calculateRiskScore({
    createCount,
    updateCount,
    deleteCount,
    replacementCount,
    estimatedMonthlyCostChangeUsd,
    environment,
  })

  return {
    createCount,
    updateCount,
    deleteCount,
    replacementCount,
    affectedResourceCount,
    estimatedMonthlyCostChangeUsd,
    riskScore,
    violations: [...unsupportedResourceViolations, ...environmentViolations],
  }
}
