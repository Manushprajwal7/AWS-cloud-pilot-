/**
 * The LLM-assisted half of selfCorrectionAgent's correction space. Phase 7
 * kept Groq out of code generation entirely; this is the one deliberate,
 * narrow exception — bounded to syntax/schema-level fixes and always
 * re-validated by the same deterministic security engine
 * (static-validator.ts) that gates original generation, so a correction
 * can never smuggle in a provisioner, an unapproved provider, or anything
 * else static-validator.ts would already reject. If the corrected code
 * fails that check, the correction is rejected outright — never applied,
 * never retried with a relaxed check.
 */

import { z } from 'zod'
import { generateStructuredOutput } from '@/lib/langgraph/structured-output'
import { normalizeTerraformCode } from './code-normalizer'
import { hashTerraformCode } from './hashing'
import { runStaticSecurityValidation } from './static-validator'
import type { CorrectionResult } from './types'

export const correctionSchema = z.object({
  correctedHcl: z.string().min(1).describe('The complete corrected Terraform file, not a diff or snippet'),
  changeSummary: z.string().min(1).describe('One or two sentence summary of exactly what was fixed'),
})

export interface CorrectionOutcome {
  result: CorrectionResult
  correctedHcl: string | null
  correctedChecksum: string | null
  reason: string
}

const SYSTEM_PROMPT = `You are CloudPilot's Terraform self-correction engine. You are given a Terraform file that failed \`terraform init\` or \`terraform validate\`, and the exact error it produced. Fix ONLY the reported error and return the complete corrected file.

You may ONLY correct:
- Syntax errors
- Missing required arguments
- Invalid Terraform attribute names
- Provider-schema errors
- Invalid resource references

You must NEVER, under any circumstance, even if it seems like it would fix the error:
- Add, remove, or modify a provisioner block
- Change the provider block, its version constraint, or add a new provider
- Add a resource of a type not already present in the file
- Weaken or remove a security-relevant argument (encryption, backups, ingress CIDRs, IAM permissions)
- Change the resource's intended action/behavior beyond the minimum needed to fix the reported error

Respond with ONLY a JSON object with keys: correctedHcl (string, the full file), changeSummary (string).`

export async function attemptLlmCorrection(hcl: string, errorText: string): Promise<CorrectionOutcome> {
  let generated: z.infer<typeof correctionSchema>
  try {
    generated = await generateStructuredOutput({
      schema: correctionSchema,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: `Original file:\n\`\`\`hcl\n${hcl}\n\`\`\`\n\nError:\n${errorText}\n\nFix only this error and return the complete corrected file.`,
    })
  } catch (error) {
    return {
      result: 'failed',
      correctedHcl: null,
      correctedChecksum: null,
      reason: error instanceof Error ? error.message : 'Correction model call failed',
    }
  }

  const normalized = normalizeTerraformCode(generated.correctedHcl)
  const security = runStaticSecurityValidation(normalized)

  if (!security.passed) {
    return {
      result: 'rejected',
      correctedHcl: null,
      correctedChecksum: null,
      reason: `Corrected code failed static security validation: ${security.findings.map((f) => f.message).join('; ')}`,
    }
  }

  return {
    result: 'corrected',
    correctedHcl: normalized,
    correctedChecksum: hashTerraformCode(normalized),
    reason: generated.changeSummary,
  }
}
