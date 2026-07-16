/**
 * auditWorker node: the graph's terminal node on every path (success,
 * no-anomaly, security/approval rejection, rollback, or failure — see
 * routes.ts). Writes one real AuditEvent row per run describing what
 * actually happened, and — since it's the one node guaranteed to run on
 * every path — is also responsible for removing the sandbox's temporary
 * workspace directory, so cleanup happens whether the sandbox succeeded,
 * failed, or was never reached.
 */

import { prisma } from '@/lib/db/client'
import { removeSandboxWorkspace } from '@/lib/terraform/temp-workspace'
import type { GraphState, GraphStateUpdate } from '../state'

function describeOutcome(state: GraphState): { action: string; metadata: Record<string, unknown> } {
  if (state.rollbackResult?.rolledBack) {
    return {
      action: 'remediation_rolled_back',
      metadata: {
        resourceId: state.resourceId,
        applyExecutionId: state.applyExecutionId,
        reason: state.rollbackResult.reason,
        failedChecks: state.verificationResult?.checks.filter((c) => !c.passed) ?? [],
      },
    }
  }
  if (state.applySucceeded) {
    return {
      action: 'remediation_applied',
      metadata: {
        resourceId: state.resourceId,
        terraformArtifactId: state.terraformArtifactId,
        applyExecutionId: state.applyExecutionId,
        planSummary: state.planSummary,
        realizedMonthlySavingsUsd: state.realizedSavingsUsd,
      },
    }
  }
  if (state.approvalDecision && state.approvalDecision.decision === 'rejected') {
    return {
      action: 'plan_rejected_by_policy',
      metadata: {
        resourceId: state.resourceId,
        terraformArtifactId: state.terraformArtifactId,
        reason: state.approvalDecision.reason,
        riskScore: state.approvalDecision.analysis.riskScore,
        violations: state.approvalDecision.analysis.violations,
      },
    }
  }
  if (state.securityValidation && !state.securityValidation.passed) {
    return {
      action: 'remediation_rejected_by_policy',
      metadata: {
        resourceId: state.resourceId,
        remediationPlanId: state.remediationPlanId,
        terraformArtifactId: state.terraformArtifactId,
        findings: state.securityValidation.findings,
      },
    }
  }
  if (state.error) {
    return {
      action: 'run_failed',
      metadata: { error: state.error, resourceId: state.resourceId, correctionAttempts: state.correctionAttempts },
    }
  }
  if (!state.anomaly) {
    return { action: 'run_completed_no_anomaly', metadata: { resourceId: state.resourceId } }
  }
  return {
    action: 'run_completed',
    metadata: {
      resourceId: state.resourceId,
      anomalyId: state.anomaly.id,
      anomalyType: state.anomaly.type,
      remediationAction: state.remediationPlan?.action ?? null,
      expectedMonthlySavingsUsd: state.remediationPlan?.expectedMonthlySavingsUsd ?? null,
      requiresApproval: state.remediationPlan?.requiresApproval ?? null,
      terraformArtifactId: state.terraformArtifactId,
      planSummary: state.planSummary,
    },
  }
}

function finalStatus(state: GraphState): GraphState['status'] {
  if (state.rollbackResult?.rolledBack) return 'rolled_back'
  if (state.applySucceeded) return 'applied'
  if (state.approvalDecision?.decision === 'rejected') return 'rejected'
  if (state.securityValidation && !state.securityValidation.passed) return 'rejected'
  if (state.error) return 'failed'
  if (!state.anomaly) return 'no_anomaly'
  return 'completed'
}

export async function auditNode(state: GraphState): Promise<GraphStateUpdate> {
  const agentRun = await prisma.agentRun.findUnique({ where: { runId: state.runId } })
  const { action, metadata } = describeOutcome(state)

  await prisma.auditEvent.create({
    data: {
      agentRunId: agentRun?.id ?? null,
      actor: 'langgraph:auditWorker',
      action,
      entityType: 'AgentRun',
      entityId: state.runId,
      metadata: metadata as object,
    },
  })

  if (state.sandboxWorkspacePath) {
    await removeSandboxWorkspace(state.sandboxWorkspacePath)
  }

  return {
    status: finalStatus(state),
  }
}
