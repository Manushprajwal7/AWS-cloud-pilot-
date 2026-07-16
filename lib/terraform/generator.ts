/**
 * terraformGenerationAgent's business logic. The LLM never sees or writes
 * HCL — generateTerraformForAction (templates.ts) builds 100% of the code
 * deterministically from the resource's real configuration and
 * lib/financial/rightsizing.ts's recommendation. Groq is only asked for a
 * human-readable change description and an echo of the action, validated
 * against a schema with no `code`/`hcl` field at all, so there is no
 * mechanism by which the model could inject arbitrary Terraform even if it
 * tried.
 */

import { z } from 'zod'
import type { SimulatedCloudResource } from '@/lib/simulation/types'
import type { RemediationAction } from '@/lib/financial/rightsizing'
import { generateStructuredOutput } from '@/lib/langgraph/structured-output'
import { generateTerraformForAction, wrapWithProviderBlock } from './templates'
import { normalizeTerraformCode } from './code-normalizer'
import { hashTerraformCode } from './hashing'
import type { TerraformResourceType } from './types'

export const terraformNarrativeSchema = z.object({
  changeDescription: z.string().min(1).describe('One or two sentence human-readable summary of the infrastructure change'),
  confirmedAction: z
    .enum(['NO_ACTION', 'STOP', 'RIGHTSIZE', 'SCHEDULE', 'SCALE_OUT', 'SCALE_IN'])
    .describe('Echo of the action this change implements'),
})

export type TerraformNarrative = z.infer<typeof terraformNarrativeSchema>

export interface GeneratedArtifact {
  /** Full, normalized Terraform file — the only place generated code lives. */
  hcl: string
  checksum: string
  resourceAddress: string
  resourceType: TerraformResourceType
  changeDescription: string
}

const SYSTEM_PROMPT = `You are CloudPilot's Terraform change-narrative writer. You are given the Terraform resource address and action that will be applied — you do not write or see any Terraform code. Describe the change in plain language for a human reviewer.

Rules:
- confirmedAction must exactly equal the action you are given.
- Respond with ONLY a JSON object with keys: changeDescription (string), confirmedAction (string).`

export async function generateTerraformArtifact(
  resource: SimulatedCloudResource,
  action: RemediationAction,
  rationale: string,
): Promise<GeneratedArtifact> {
  // Fail fast, before spending an LLM call, if there's no template for this action/service.
  const generated = generateTerraformForAction(resource, action)

  const userPrompt = `Resource: ${resource.name} (${resource.service}, ${resource.environment}, ${resource.region})
Terraform resource address: ${generated.resourceAddress}
Action: ${action}
Rationale: ${rationale}

Describe this change for a human reviewer. confirmedAction must be "${action}".`

  const narrative = await generateStructuredOutput({
    schema: terraformNarrativeSchema,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
  })

  const wrapped = wrapWithProviderBlock(generated.hcl, generated.resourceType)
  const normalized = normalizeTerraformCode(wrapped)
  const checksum = hashTerraformCode(normalized)

  return {
    hcl: normalized,
    checksum,
    resourceAddress: generated.resourceAddress,
    resourceType: generated.resourceType,
    // narrative.confirmedAction is never trusted over `action` — it's LLM
    // output, not a source of truth. It's validated by the schema but not
    // used to drive any behavior beyond being embedded in the description.
    changeDescription: narrative.changeDescription,
  }
}
