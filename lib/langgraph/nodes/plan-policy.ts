/**
 * planPolicyWorker node: deterministic analysis of the real plan
 * (lib/terraform/plan-policy.ts) — counts, cost change, risk score, and
 * policy violations. No LLM. autoApprovalWorker consumes this output.
 */

import { analyzePlan } from '@/lib/terraform/plan-policy'
import type { GraphState, GraphStateUpdate } from '../state'

export async function planPolicyNode(state: GraphState): Promise<GraphStateUpdate> {
  const { planSummary, resource, remediationPlan } = state
  if (!planSummary || !resource || !remediationPlan) {
    throw new Error('planPolicyWorker: missing planSummary/resource/remediationPlan in state — terraformPlanWorker must run first')
  }

  const analysis = analyzePlan(planSummary, resource.environment, {
    requiresApproval: remediationPlan.requiresApproval,
    expectedMonthlySavingsUsd: remediationPlan.expectedMonthlySavingsUsd,
  })

  return { planAnalysis: analysis }
}
