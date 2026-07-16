/**
 * The auto-approval decision itself: a pure function over a PlanAnalysis
 * and the security decision. No Groq call anywhere in this file or its
 * caller (autoApprovalWorker) — approval is either deterministically
 * "yes" or deterministically "no", with a reason that traces back to a
 * specific check, never a model's opinion.
 */

import type { PlanAnalysis } from './types'

export interface AutoApprovalDecisionInput {
  analysis: PlanAnalysis
  securityPassed: boolean
}

export interface AutoApprovalDecision {
  decision: 'approved' | 'rejected'
  reason: string
}

const MAX_AUTO_APPROVE_RISK_SCORE = 30

export function decideAutoApproval(input: AutoApprovalDecisionInput): AutoApprovalDecision {
  if (!input.securityPassed) {
    return { decision: 'rejected', reason: 'static security validation did not pass' }
  }

  if (input.analysis.violations.length > 0) {
    return { decision: 'rejected', reason: input.analysis.violations.join('; ') }
  }

  if (input.analysis.riskScore > MAX_AUTO_APPROVE_RISK_SCORE) {
    return {
      decision: 'rejected',
      reason: `risk score ${input.analysis.riskScore} exceeds the auto-approval threshold of ${MAX_AUTO_APPROVE_RISK_SCORE}`,
    }
  }

  return {
    decision: 'approved',
    reason: `plan affects ${input.analysis.affectedResourceCount} resource(s) with no deletions, replacements, or policy violations, and risk score ${input.analysis.riskScore} is within the auto-approval threshold`,
  }
}
