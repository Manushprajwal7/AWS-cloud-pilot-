/**
 * planningAgent node: turns the diagnosis into a concrete remediation plan.
 * The LLM only supplies judgment fields (rationale, risk level, whether
 * human approval is required) — the dollar figure it's given, and the one
 * that ends up in the final plan, always comes from
 * lib/financial/rightsizing.ts's deterministic cost model. If the model
 * returns a different number we overwrite it rather than trust it, so a
 * hallucinated dollar figure can never reach the plan.
 *
 * Also persists a RemediationPlan row — the FK terraformGenerationAgent
 * (Phase 7) needs to attach a TerraformArtifact to.
 */

import { prisma } from '@/lib/db/client'
import { round2 } from '@/lib/financial/pricing'
import { calculateExpectedPostRemediationCost, type RemediationAction } from '@/lib/financial/rightsizing'
import { remediationPlanSchema, type GraphState, type GraphStateUpdate } from '../state'
import { generateStructuredOutput } from '../structured-output'

const SYSTEM_PROMPT = `You are CloudPilot's remediation planning engine. You are given a diagnosed anomaly, its financial impact, and a deterministically computed expected monthly cost after remediation. Produce a remediation plan.

Rules:
- action must equal the recommendedActionType you are given — do not change it.
- expectedMonthlySavingsUsd must equal the value you are given — do not recompute or invent a different number.
- requiresApproval must be true for STOP or SCALE_IN actions on production resources, or when riskLevel is "high". Otherwise use your judgment.
- Respond with ONLY a JSON object with keys: action, rationale (string), riskLevel ("low"|"medium"|"high"), requiresApproval (boolean), expectedMonthlySavingsUsd (number).`

export async function planRemediationNode(state: GraphState): Promise<GraphStateUpdate> {
  const { anomaly, resource, diagnosis, financialImpact } = state
  if (!anomaly || !resource || !diagnosis) {
    throw new Error('planningAgent: missing anomaly/resource/diagnosis in state — earlier nodes must run first')
  }

  const action: RemediationAction = diagnosis.recommendedActionType
  const projectedMonthlyCost = calculateExpectedPostRemediationCost(resource, action)
  const expectedMonthlySavingsUsd = Math.max(0, round2(resource.cost.projectedMonthlyUsd - projectedMonthlyCost))

  const userPrompt = `Resource: ${resource.name} (${resource.service}, ${resource.environment})
Diagnosis root cause: ${diagnosis.rootCause}
Diagnosis explanation: ${diagnosis.explanation}
Recommended action type: ${action}
Current projected monthly cost: $${resource.cost.projectedMonthlyUsd.toFixed(2)}
Deterministically computed projected monthly cost after "${action}": $${projectedMonthlyCost.toFixed(2)}
Deterministically computed expected monthly savings: $${expectedMonthlySavingsUsd.toFixed(2)}
${financialImpact ? `Estimated current monthly waste from this anomaly: $${financialImpact.estimatedWaste.monthlyUsd.toFixed(2)}` : 'No waste-fraction interpretation defined for this anomaly type.'}

Produce the remediation plan JSON. action must be "${action}" and expectedMonthlySavingsUsd must be ${expectedMonthlySavingsUsd}.`

  const generated = await generateStructuredOutput({
    schema: remediationPlanSchema,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
  })

  const remediationPlan = {
    ...generated,
    action,
    expectedMonthlySavingsUsd,
  }

  const agentRun = await prisma.agentRun.findUnique({ where: { runId: state.runId } })
  if (!agentRun) {
    throw new Error(`planningAgent: no AgentRun row for runId '${state.runId}' — initializeGraphRun must run first`)
  }

  // anomalyId is intentionally omitted: anomalyDetector (Phase 6) is an
  // in-memory store, not backed by the Anomaly table, so anomaly.id has no
  // corresponding row to satisfy the FK.
  const persisted = await prisma.remediationPlan.create({
    data: {
      agentRunId: agentRun.id,
      action: remediationPlan.action,
      resourceId: resource.id,
      rationale: remediationPlan.rationale,
      expectedMonthlySavingsUsd: remediationPlan.expectedMonthlySavingsUsd,
      riskLevel: remediationPlan.riskLevel,
    },
  })

  return { remediationPlan, remediationPlanId: persisted.id }
}
