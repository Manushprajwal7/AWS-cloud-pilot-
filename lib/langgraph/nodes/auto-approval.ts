/**
 * autoApprovalWorker node: the deterministic approve/reject decision
 * (lib/terraform/auto-approval.ts) — never Groq. Persists a PlanApproval
 * row carrying the exact code hash and plan hash this decision was made
 * against; terraformApplyWorker re-verifies both before ever touching
 * `terraform apply`, so this row is the immutable record of what was
 * actually approved.
 */

import { prisma } from '@/lib/db/client'
import { decideAutoApproval } from '@/lib/terraform/auto-approval'
import { hashJson } from '@/lib/terraform/hashing'
import type { GraphState, GraphStateUpdate } from '../state'

export async function autoApprovalNode(state: GraphState): Promise<GraphStateUpdate> {
  const { planAnalysis, terraformArtifact, terraformArtifactId, planSummary, securityValidation } = state
  if (!planAnalysis || !terraformArtifact || !terraformArtifactId || !planSummary) {
    throw new Error('autoApprovalWorker: missing planAnalysis/terraformArtifact/planSummary in state — planPolicyWorker must run first')
  }

  const decision = decideAutoApproval({ analysis: planAnalysis, securityPassed: securityValidation?.passed ?? false })
  const codeHash = terraformArtifact.checksum
  const planHash = hashJson(planSummary)
  const now = new Date()

  await prisma.planApproval.create({
    data: {
      terraformArtifactId,
      codeHash,
      planHash,
      createCount: planAnalysis.createCount,
      updateCount: planAnalysis.updateCount,
      deleteCount: planAnalysis.deleteCount,
      replacementCount: planAnalysis.replacementCount,
      affectedResourceCount: planAnalysis.affectedResourceCount,
      estimatedMonthlyCostChangeUsd: planAnalysis.estimatedMonthlyCostChangeUsd,
      riskScore: planAnalysis.riskScore,
      decision: decision.decision,
      reason: decision.reason,
      approvedAt: decision.decision === 'approved' ? now : null,
    },
  })

  return {
    approvalDecision: { decision: decision.decision, reason: decision.reason, codeHash, planHash, analysis: planAnalysis },
  }
}
