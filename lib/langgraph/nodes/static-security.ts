/**
 * staticSecurityWorker node: runs the deterministic policy engine
 * (lib/terraform/static-validator.ts) against the generated artifact and
 * persists one PolicyDecision row per policy evaluated. A failure here is
 * not a bug — routeAfterStaticSecurity (../routes.ts) sends it straight to
 * auditWorker instead of the sandbox, and the run is marked 'rejected'
 * rather than 'failed'. Groq is never in this loop: nothing here calls an
 * LLM, so there is no way for a model to talk its way past a policy.
 */

import { prisma } from '@/lib/db/client'
import { runStaticSecurityValidation } from '@/lib/terraform/static-validator'
import { SECURITY_POLICIES } from '@/lib/terraform/security-policy'
import type { GraphState, GraphStateUpdate } from '../state'

export async function staticSecurityNode(state: GraphState): Promise<GraphStateUpdate> {
  const { terraformArtifact, remediationPlanId } = state
  if (!terraformArtifact || !remediationPlanId) {
    throw new Error('staticSecurityWorker: missing terraformArtifact in state — terraformGenerationAgent must run first')
  }

  const result = runStaticSecurityValidation(terraformArtifact.hcl)

  const findingsByPolicy = new Map(result.findings.map((f) => [f.policyName, f]))
  await prisma.policyDecision.createMany({
    data: SECURITY_POLICIES.map((policy) => {
      const finding = findingsByPolicy.get(policy.name)
      return {
        remediationPlanId,
        policyName: policy.name,
        decision: finding ? 'rejected' : 'approved',
        reason: finding ? finding.message : `No violations of '${policy.name}' found`,
      }
    }),
  })

  return { securityValidation: result }
}
