/**
 * terraformApplyWorker node: the only place `terraform apply` is ever
 * invoked, and only ever as `apply -auto-approve approved.tfplan` — the
 * exact plan file terraformPlanWorker produced, in the same workspace. No
 * fresh plan is generated here.
 *
 * Before running anything, re-derives the current code hash and plan hash
 * from state and compares them against what autoApprovalWorker actually
 * approved (PlanApproval.codeHash/planHash). Any mismatch — a different
 * artifact, drift, a stale/reused approval — halts before `terraform
 * apply` is invoked (routeAfterTerraformApply sends this case straight to
 * audit, skipping verification/rollback entirely since nothing was ever
 * applied). This is the immutable-plan guarantee: apply only ever runs
 * against the exact thing that was approved.
 *
 * This environment has no real AWS credentials (command-runner.ts never
 * forwards them), so the real `terraform apply` invocation will typically
 * fail at the provider's own auth step — a real, expected outcome, not a
 * bug. Because the whole point of this codebase is a simulated
 * environment, a real exit-0 apply is what actually mutates
 * simulationStore (applyRemediationToSimulation below), mirroring the
 * approved action — that mutation is what verificationWorker/
 * rollbackWorker (Phase 9) then check and can undo. A snapshot of the
 * resource is always captured first, whether or not apply ends up
 * succeeding, so rollbackWorker always has something exact to restore.
 */

import { prisma } from '@/lib/db/client'
import { runTerraformApply } from '@/lib/terraform/sandbox'
import { hashJson } from '@/lib/terraform/hashing'
import { calculateCost } from '@/lib/simulation/resources'
import { simulationStore } from '@/lib/simulation/simulation-store'
import type { SimulatedCloudResource } from '@/lib/simulation/types'
import { recommendRightsizing, recommendScaleIn, type RemediationAction } from '@/lib/financial/rightsizing'
import { captureRollbackSnapshot } from '@/lib/rollback/rollback-plan'
import { emitCommandOutput } from '../command-output-bus'
import { renderCommandLog, workspaceFromPath } from './terraform-sandbox-shared'
import type { GraphState, GraphStateUpdate } from '../state'

/**
 * The simulated effect of a successful apply. STOP maps to a status
 * change; RIGHTSIZE/SCALE_IN recompute configuration + cost via the same
 * deterministic recommendation functions generation used, re-run here
 * rather than threaded through state (the resource hasn't changed since
 * generation within one run, so the result is identical). SCHEDULE/
 * SCALE_OUT/NO_ACTION have no immediate state change — SCHEDULE is a
 * future/external trigger, not an in-place mutation.
 */
function applyRemediationToSimulation(resource: SimulatedCloudResource, action: RemediationAction): void {
  switch (action) {
    case 'STOP':
      simulationStore.updateResource(resource.id, { status: 'stopped' })
      return
    case 'RIGHTSIZE': {
      const recommendation = recommendRightsizing(resource)
      if (!recommendation) return
      const configuration = { ...resource.configuration, instanceType: recommendation.recommendedInstanceType }
      const cost = calculateCost(resource.service, configuration, resource.metrics)
      simulationStore.updateResource(resource.id, { configuration, cost })
      return
    }
    case 'SCALE_IN': {
      const recommendation = recommendScaleIn(resource)
      if (!recommendation) return
      const configuration = { ...resource.configuration, desiredCapacity: recommendation.recommendedCapacity }
      const cost = calculateCost(resource.service, configuration, resource.metrics)
      simulationStore.updateResource(resource.id, { configuration, cost })
      return
    }
    case 'SCHEDULE':
    case 'SCALE_OUT':
    case 'NO_ACTION':
      return
  }
}

export async function terraformApplyNode(state: GraphState): Promise<GraphStateUpdate> {
  const { sandboxWorkspacePath, terraformArtifactId, terraformArtifact, planSummary, approvalDecision, resource, remediationPlan } = state
  if (!sandboxWorkspacePath || !terraformArtifactId || !terraformArtifact || !planSummary || !approvalDecision || !resource || !remediationPlan) {
    throw new Error('terraformApplyWorker: missing workspace/artifact/plan/approval/resource in state — autoApprovalWorker must run first')
  }
  if (approvalDecision.decision !== 'approved') {
    throw new Error('terraformApplyWorker: reached with a non-approved decision — routing must have a bug')
  }

  const currentCodeHash = terraformArtifact.checksum
  const currentPlanHash = hashJson(planSummary)

  if (currentCodeHash !== approvalDecision.codeHash || currentPlanHash !== approvalDecision.planHash) {
    return {
      error:
        `terraformApplyWorker: refusing to apply — hash mismatch against the approved plan ` +
        `(code: approved=${approvalDecision.codeHash.slice(0, 12)} current=${currentCodeHash.slice(0, 12)}; ` +
        `plan: approved=${approvalDecision.planHash.slice(0, 12)} current=${currentPlanHash.slice(0, 12)})`,
    }
  }

  const preApplySnapshot = captureRollbackSnapshot(resource)
  const workspace = workspaceFromPath(sandboxWorkspacePath)

  const execution = await prisma.terraformExecution.create({
    data: { terraformArtifactId, operation: 'apply', status: 'running', startedAt: new Date() },
  })

  const result = await runTerraformApply(workspace, {
    onStdout: (chunk) => emitCommandOutput(state.runId, 'terraformApply', 'stdout', chunk),
    onStderr: (chunk) => emitCommandOutput(state.runId, 'terraformApply', 'stderr', chunk),
  })

  const succeeded = result.exitCode === 0
  const log = renderCommandLog(result)

  await prisma.terraformExecution.update({
    where: { id: execution.id },
    data: {
      status: succeeded ? 'succeeded' : 'failed',
      exitCode: result.exitCode,
      logs: log,
      appliedCodeHash: currentCodeHash,
      appliedPlanHash: currentPlanHash,
      completedAt: new Date(),
    },
  })

  if (!succeeded) {
    return {
      preApplySnapshot,
      applyExecutionId: execution.id,
      error: `terraform apply failed (exit ${result.exitCode ?? 'null'}${result.timedOut ? ', timed out' : ''}):\n${result.stderr || result.stdout}`.slice(0, 4000),
    }
  }

  applyRemediationToSimulation(resource, remediationPlan.action)
  const updatedResource = simulationStore.getResource(resource.id) ?? resource

  return {
    preApplySnapshot,
    applyExecutionId: execution.id,
    applySucceeded: true,
    resource: updatedResource,
    error: null,
  }
}
