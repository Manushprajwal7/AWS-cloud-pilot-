/**
 * terraformGenerationAgent node: generates the Terraform artifact for the
 * approved remediation plan and persists it. All code generation is
 * delegated to lib/terraform/generator.ts, which never lets the LLM emit
 * HCL text — see that module's header comment for why.
 */

import { prisma } from '@/lib/db/client'
import { generateTerraformArtifact } from '@/lib/terraform/generator'
import type { GraphState, GraphStateUpdate } from '../state'

export async function terraformGenerateNode(state: GraphState): Promise<GraphStateUpdate> {
  const { resource, remediationPlan, remediationPlanId } = state
  if (!resource || !remediationPlan || !remediationPlanId) {
    throw new Error('terraformGenerationAgent: missing resource/remediationPlan in state — planningAgent must run first')
  }

  const artifact = await generateTerraformArtifact(resource, remediationPlan.action, remediationPlan.rationale)

  const persisted = await prisma.terraformArtifact.create({
    data: {
      remediationPlanId,
      hcl: artifact.hcl,
      checksum: artifact.checksum,
    },
  })

  return {
    terraformArtifact: artifact,
    terraformArtifactId: persisted.id,
  }
}
