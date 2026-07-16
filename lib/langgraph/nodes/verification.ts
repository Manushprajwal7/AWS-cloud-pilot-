/**
 * verificationWorker node: runs every deterministic post-apply check
 * (lib/verification/*) against the resource's real current state and
 * persists one VerificationResult row per check. Always runs after
 * terraformApplyWorker — even when apply failed, since "terraform apply
 * fails" is itself one of the conditions being checked here, not a reason
 * to skip verification.
 */

import { prisma } from '@/lib/db/client'
import {
  checkCpuUtilization,
  checkErrorRate,
  checkMemoryUtilization,
  checkNoUnexpectedSideEffects,
  checkResourceAvailability,
  checkResourceHealth,
  type CheckResult,
} from '@/lib/verification/health-checks'
import { checkOriginalAnomalyResolved } from '@/lib/verification/anomaly-checks'
import { checkCostWithinApprovedEstimate } from '@/lib/verification/cost-checks'
import { simulationStore } from '@/lib/simulation/simulation-store'
import type { GraphState, GraphStateUpdate } from '../state'

export async function verificationNode(state: GraphState): Promise<GraphStateUpdate> {
  const { resource, preApplySnapshot, anomaly, remediationPlan, approvalDecision, applyExecutionId, error: applyError } = state
  if (!resource || !preApplySnapshot || !anomaly || !remediationPlan || !approvalDecision || !applyExecutionId) {
    throw new Error('verificationWorker: missing required state — terraformApplyWorker must run first')
  }

  const currentResource = simulationStore.getResource(resource.id) ?? resource
  const action = remediationPlan.action

  const checks: CheckResult[] = [
    { name: 'terraform_apply_succeeded', passed: !applyError, details: applyError ? applyError.slice(0, 300) : 'apply succeeded' },
    checkResourceHealth(currentResource, action),
    checkResourceAvailability(currentResource, action),
    checkErrorRate(currentResource, preApplySnapshot),
    checkCpuUtilization(currentResource),
    checkMemoryUtilization(currentResource),
    checkNoUnexpectedSideEffects(preApplySnapshot, currentResource),
    checkOriginalAnomalyResolved(currentResource.id, anomaly.type),
    checkCostWithinApprovedEstimate(preApplySnapshot, currentResource, approvalDecision.analysis.estimatedMonthlyCostChangeUsd),
  ]

  const passed = checks.every((check) => check.passed)

  await prisma.verificationResult.createMany({
    data: checks.map((check) => ({
      terraformExecutionId: applyExecutionId,
      checkName: check.name,
      passed: check.passed,
      details: { details: check.details },
    })),
  })

  return { verificationResult: { passed, checks }, resource: currentResource }
}
