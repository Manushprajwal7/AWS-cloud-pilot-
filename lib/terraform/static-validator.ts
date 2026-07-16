/**
 * Runs every SECURITY_POLICIES rule against a Terraform artifact's HCL and
 * aggregates the result. This is the only function staticSecurityWorker
 * (../langgraph/nodes/static-security.ts) calls — it never re-implements
 * policy logic itself.
 */

import { SECURITY_POLICIES } from './security-policy'
import type { StaticValidationResult } from './types'

export function runStaticSecurityValidation(hcl: string): StaticValidationResult {
  const findings = SECURITY_POLICIES.flatMap((policy) => policy.evaluate(hcl))

  return {
    passed: findings.length === 0,
    findings,
  }
}
