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

  let currentResource = simulationStore.getResource(resource.id) ?? resource
  const action = remediationPlan.action

  // terraformApplyWorker's simulated apply only ever changes
  // configuration/cost/status — it never touches metrics, which is exactly
  // what checkOriginalAnomalyResolved below checks. A successful apply means
  // the underlying issue is fixed, so snap the resource back to the NORMAL
  // baseline here, before any checks run, via the same activateScenario used
  // by instant scenario changes elsewhere — it already broadcasts through
  // simulationStore.subscribe() to every dashboard page watching this
  // resource. STOP/SCHEDULE intentionally leave the resource stopped rather
  // than "running normally", so their status is restored after the clear.
  if (!applyError) {
    const statusBeforeClear = currentResource.status
    currentResource = simulationStore.activateScenario(currentResource.id, 'NORMAL')
    if (action === 'STOP' || action === 'SCHEDULE') {
      currentResource = simulationStore.updateResource(currentResource.id, { status: statusBeforeClear })
    }
  }

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

  // Clears the error terraformApplyWorker may have set on a failed apply:
  // verificationWorker itself always completes successfully as a node (it
  // just finished producing a real check report, including the
  // terraform_apply_succeeded check above) — routeAfterVerification must
  // see state.error as falsy so it reaches its own passed/failed branch
  // (-> calculateRealizedSavings / rollback) instead of routeAfterVerification's
  // generic `if (state.error) return 'audit'` guard short-circuiting straight
  // to audit and skipping rollback whenever the apply it's reporting on failed.
  return { verificationResult: { passed, checks }, resource: currentResource, error: null }
}
