/**
 * Conditional routing for the CloudPilot graph. Every router inspects real
 * GraphState set by the node that just ran — nothing here guesses or
 * advances the run on a timer. A node-level failure (state.error set) or a
 * clean "no anomaly" result both short-circuit straight to the audit node
 * so the run is still recorded, then the graph ends.
 */

import { MAX_CORRECTION_ATTEMPTS, type GraphState } from './state'

export function routeAfterMonitor(state: GraphState): 'detectAnomaly' | 'audit' {
  return state.error ? 'audit' : 'detectAnomaly'
}

export function routeAfterDetectAnomaly(state: GraphState): 'diagnose' | 'audit' {
  if (state.error) return 'audit'
  return state.anomaly ? 'diagnose' : 'audit'
}

export function routeAfterDiagnose(state: GraphState): 'calculateImpact' | 'audit' {
  return state.error ? 'audit' : 'calculateImpact'
}

export function routeAfterCalculateImpact(state: GraphState): 'planRemediation' | 'audit' {
  return state.error ? 'audit' : 'planRemediation'
}

/**
 * NO_ACTION has no Terraform template (see UnsupportedRemediationError in
 * lib/terraform/templates.ts) — routing it into terraformGenerationAgent
 * would throw and mark the run 'failed' for what is actually a legitimate
 * planning outcome, not an error.
 */
const ACTIONS_WITHOUT_TERRAFORM_TEMPLATE = new Set(['NO_ACTION'])

export function routeAfterPlanRemediation(state: GraphState): 'terraformGenerate' | 'audit' {
  if (state.error) return 'audit'
  if (state.remediationPlan && ACTIONS_WITHOUT_TERRAFORM_TEMPLATE.has(state.remediationPlan.action)) return 'audit'
  return 'terraformGenerate'
}

export function routeAfterTerraformGenerate(state: GraphState): 'staticSecurity' | 'audit' {
  return state.error ? 'audit' : 'staticSecurity'
}

/** A security-policy rejection is not a node error — it routes to audit exactly like one, but auditNode reports it as 'rejected', not 'failed'. */
export function routeAfterStaticSecurity(state: GraphState): 'terraformFormat' | 'audit' {
  if (state.error) return 'audit'
  return state.securityValidation?.passed ? 'terraformFormat' : 'audit'
}

/** Shared by the three correctable sandbox steps: on failure, retry via selfCorrectionAgent while attempts remain, otherwise give up and audit. */
function routeSandboxStep(state: GraphState): 'proceed' | 'selfCorrection' | 'audit' {
  if (!state.error) return 'proceed'
  return state.correctionAttempts < MAX_CORRECTION_ATTEMPTS ? 'selfCorrection' : 'audit'
}

export function routeAfterTerraformFormat(state: GraphState): 'terraformInit' | 'selfCorrection' | 'audit' {
  const step = routeSandboxStep(state)
  return step === 'proceed' ? 'terraformInit' : step
}

export function routeAfterTerraformInit(state: GraphState): 'terraformValidate' | 'selfCorrection' | 'audit' {
  const step = routeSandboxStep(state)
  return step === 'proceed' ? 'terraformValidate' : step
}

export function routeAfterTerraformValidate(state: GraphState): 'terraformPlan' | 'selfCorrection' | 'audit' {
  const step = routeSandboxStep(state)
  return step === 'proceed' ? 'terraformPlan' : step
}

/** A successful correction always loops back to terraformFormat to re-run the whole sandbox chain against the corrected code; anything else (rejected/failed) stops the run. */
export function routeAfterSelfCorrection(state: GraphState): 'terraformFormat' | 'audit' {
  return state.error ? 'audit' : 'terraformFormat'
}

export function routeAfterTerraformPlan(state: GraphState): 'planPolicy' | 'audit' {
  return state.error ? 'audit' : 'planPolicy'
}

export function routeAfterPlanPolicy(state: GraphState): 'autoApproval' | 'audit' {
  return state.error ? 'audit' : 'autoApproval'
}

/**
 * An approved plan does not auto-apply — it stops at awaitApproval so a
 * human can review the generated Terraform (issue/impact) and explicitly
 * click Apply before terraformApplyWorker ever runs. See
 * lib/langgraph/nodes/await-approval.ts and app/api/graph/runs/[runId]/apply.
 */
export function routeAfterAutoApproval(state: GraphState): 'awaitApproval' | 'audit' {
  if (state.error) return 'audit'
  return state.approvalDecision?.decision === 'approved' ? 'awaitApproval' : 'audit'
}

/**
 * verificationWorker must run whenever apply was actually attempted —
 * including when it failed, since "terraform apply fails" is itself one of
 * the conditions verification checks. Only the immutable-plan hash
 * mismatch case (nothing was ever applied — no TerraformExecution row, so
 * applyExecutionId is still null) skips straight to audit.
 */
export function routeAfterTerraformApply(state: GraphState): 'verification' | 'audit' {
  return state.applyExecutionId ? 'verification' : 'audit'
}

export function routeAfterVerification(state: GraphState): 'rollback' | 'calculateRealizedSavings' | 'audit' {
  if (state.error) return 'audit'
  return state.verificationResult?.passed ? 'calculateRealizedSavings' : 'rollback'
}
