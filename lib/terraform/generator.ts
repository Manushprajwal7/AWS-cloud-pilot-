/**
 * terraformGenerationAgent's business logic. Groq genuinely authors the HCL
 * text, streamed token-by-token via onToken — but every fact that matters
 * for safety is fixed before the model ever runs: generateTerraformForAction
 * (templates.ts) determines the resource type, resource address, and the
 * exact attribute values/tags the remediation requires, and is handed to the
 * model as the ground-truth spec it must implement. The model is never free
 * to invent a different resource type/address, and if its response doesn't
 * structurally contain the required resource block at all, generation falls
 * back to that same deterministic template rather than failing the run.
 * Nothing here is the last line of defense, though — staticSecurityWorker,
 * the sandbox fmt/init/validate/plan steps, selfCorrectionAgent, and the
 * deterministic autoApprovalWorker all still run against whatever comes out
 * of this function, unchanged, before anything is ever applied.
 */

import type { SimulatedCloudResource } from '@/lib/simulation/types'
import type { RemediationAction } from '@/lib/financial/rightsizing'
import { callGroqChatStream } from '@/lib/ai/groq'
import { generateTerraformForAction, wrapWithProviderBlock } from './templates'
import { normalizeTerraformCode } from './code-normalizer'
import { hashTerraformCode } from './hashing'
import type { TerraformResourceType } from './types'

export interface GeneratedArtifact {
  /** Full, normalized Terraform file — the only place generated code lives. */
  hcl: string
  checksum: string
  resourceAddress: string
  resourceType: TerraformResourceType
  changeDescription: string
}

export interface GenerateTerraformArtifactOptions {
  /** Called with each incremental HCL text delta as Groq streams it. */
  onToken?: (delta: string) => void
}

const CODEGEN_SYSTEM_PROMPT = `You are CloudPilot's Terraform remediation code generator. You are given a required resource type, a required resource local name, and a reference specification describing the exact attributes, values, and tags a remediation requires. Write the complete Terraform resource block implementing it.

Hard rules (violating any of these means your output will be discarded and a deterministic fallback used instead):
- The block's header MUST be exactly: resource "<given type>" "<given name>"
- Include every attribute and value shown in the reference specification, unchanged.
- Include a tags block matching the reference specification's tags exactly.
- Do NOT add a provisioner block.
- Do NOT add a provider block or a terraform {} block — those are added separately.
- Do NOT add any resource other than the one specified.
- Do NOT remove or weaken any security-relevant argument.
- Output ONLY the Terraform code for this one resource block — no markdown code fences, no explanation, no comments outside the block.`

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Splices `lifecycle { create_before_destroy = true }` into the resource
 * block, always — after extraction/fallback resolution, so it's guaranteed
 * regardless of whether Groq's response happened to include it. This is
 * the graceful-downgrade half of the plan's own claim (see the comment
 * header wrapWithProviderBlock renders): if this change is ever applied as
 * a replacement rather than an in-place update, the old resource is never
 * torn down before its replacement exists.
 */
export function injectLifecycleBlock(hclBody: string): string {
  const lastBraceIndex = hclBody.lastIndexOf('}')
  if (lastBraceIndex === -1) return hclBody
  const lifecycleBlock = '\n  lifecycle {\n    create_before_destroy = true\n  }\n'
  return `${hclBody.slice(0, lastBraceIndex)}${lifecycleBlock}${hclBody.slice(lastBraceIndex)}`
}

/**
 * Finds the required `resource "<type>" "<name>" { ... }` block inside
 * Groq's (possibly fenced, possibly chatty) response and returns just that
 * block via brace-matching, or null if the response doesn't structurally
 * contain it.
 */
function extractResourceBlock(text: string, resourceType: string, localName: string): string | null {
  const stripped = text.replace(/```(?:hcl|terraform)?/g, '')
  const startPattern = new RegExp(`resource\\s+"${escapeRegExp(resourceType)}"\\s+"${escapeRegExp(localName)}"\\s*\\{`)
  const match = startPattern.exec(stripped)
  if (!match) return null

  let depth = 0
  let end = match.index
  for (; end < stripped.length; end++) {
    if (stripped[end] === '{') depth++
    else if (stripped[end] === '}') {
      depth--
      if (depth === 0) {
        end++
        break
      }
    }
  }
  if (depth !== 0) return null

  return stripped.slice(match.index, end).trim()
}

export async function generateTerraformArtifact(
  resource: SimulatedCloudResource,
  action: RemediationAction,
  rationale: string,
  options: GenerateTerraformArtifactOptions = {},
): Promise<GeneratedArtifact> {
  // Fail fast, before spending an LLM call, if there's no template for this
  // action/service — also the source of the fixed type/address/spec below.
  const generated = generateTerraformForAction(resource, action)
  const localName = generated.resourceAddress.slice(generated.resourceType.length + 1)

  const userPrompt = `Resource: ${resource.name} (${resource.service}, ${resource.environment}, ${resource.region})
Action: ${action}
Rationale: ${rationale}

Required resource type: ${generated.resourceType}
Required resource local name: ${localName}

Reference specification (implement these exact attributes, values, and tags):
\`\`\`hcl
${generated.hcl}
\`\`\`

Write the complete Terraform resource block yourself.`

  let streamed = ''
  try {
    streamed = await callGroqChatStream({
      messages: [
        { role: 'system', content: CODEGEN_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0,
      onToken: (delta) => options.onToken?.(delta),
    })
  } catch {
    streamed = ''
  }

  const extracted = extractResourceBlock(streamed, generated.resourceType, localName)
  const hclBody = injectLifecycleBlock(extracted ?? generated.hcl)

  const wrapped = wrapWithProviderBlock(hclBody, generated.changeSummary)
  const normalized = normalizeTerraformCode(wrapped)
  const checksum = hashTerraformCode(normalized)

  return {
    hcl: normalized,
    checksum,
    resourceAddress: generated.resourceAddress,
    resourceType: generated.resourceType,
    changeDescription: `${action} on ${generated.resourceAddress}: ${rationale}`,
  }
}
