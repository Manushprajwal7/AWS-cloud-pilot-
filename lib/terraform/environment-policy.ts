/**
 * Deterministic environment/business-policy rules a plan must clear before
 * autoApprovalWorker will ever consider it. These are separate from
 * security-policy.ts (which governs the *code*) — this module governs
 * whether the *plan's effect* is safe to apply without a human.
 */

import type { CloudEnvironment } from '@/lib/simulation/types'

export interface EnvironmentPolicyInputs {
  environment: CloudEnvironment
  deleteCount: number
  replacementCount: number
  requiresApproval: boolean
  estimatedMonthlyCostChangeUsd: number
}

export function evaluateEnvironmentPolicy(inputs: EnvironmentPolicyInputs): string[] {
  const violations: string[] = []

  if (inputs.deleteCount > 0) {
    violations.push(`plan deletes ${inputs.deleteCount} resource(s) — deletions are never auto-approved`)
  }
  if (inputs.replacementCount > 0) {
    violations.push(`plan replaces ${inputs.replacementCount} resource(s) — replacements are treated as unsafe and never auto-approved`)
  }
  if (inputs.environment === 'production' && (inputs.deleteCount > 0 || inputs.replacementCount > 0)) {
    violations.push('production environment: destructive changes require manual review')
  }
  if (inputs.requiresApproval) {
    violations.push('remediation plan explicitly requires human approval')
  }
  if (inputs.estimatedMonthlyCostChangeUsd > 0) {
    violations.push(`plan increases estimated monthly cost by $${inputs.estimatedMonthlyCostChangeUsd.toFixed(2)} — cost increases are never auto-approved`)
  }

  return violations
}
