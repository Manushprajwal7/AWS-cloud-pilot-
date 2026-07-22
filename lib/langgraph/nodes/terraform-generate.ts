/**
 * terraformGenerationAgent node: generates the Terraform artifact for the
 * approved remediation plan and persists it. Code generation is delegated to
 * lib/terraform/generator.ts — see that module's header comment for how
 * Groq's streamed HCL is kept safe. Each token is republished via the
 * existing command-output-bus (the same pub/sub real terraform stdout/stderr
 * already uses), tagged with this node's name, so it reaches the UI over the
 * run's existing SSE stream with no new transport.
 */

import { prisma } from '@/lib/db/client'
import { generateTerraformArtifact } from '@/lib/terraform/generator'
import { emitCommandOutput } from '../command-output-bus'
import type { GraphState, GraphStateUpdate } from '../state'

export async function terraformGenerateNode(state: GraphState): Promise<GraphStateUpdate> {
  const { resource, remediationPlan, remediationPlanId } = state
  if (!resource || !remediationPlan || !remediationPlanId) {
    throw new Error('terraformGenerationAgent: missing resource/remediationPlan in state — planningAgent must run first')
  }

  const artifact = await generateTerraformArtifact(resource, remediationPlan.action, remediationPlan.rationale, {
    onToken: (delta) => emitCommandOutput(state.runId, 'terraformGenerate', 'stdout', delta),
  })

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
