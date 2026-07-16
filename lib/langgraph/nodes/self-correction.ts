/**
 * selfCorrectionAgent node: attempts to fix the sandbox failure that just
 * happened, bounded to MAX_CORRECTION_ATTEMPTS (state.ts) per run. Which
 * strategy runs depends on which node actually failed (read from
 * state.nodeExecutions, the last 'failed' entry — the routing gate in
 * routes.ts only ever sends us here after terraformFormat/Init/Validate):
 *
 *  - terraformFormat failed -> deterministic fix: run real `terraform fmt`
 *    (mutating) on the workspace. No LLM involved; formatting a
 *    syntactically-valid file is a pure, always-correct operation.
 *  - terraformInit/terraformValidate failed -> bounded LLM fix
 *    (lib/terraform/self-correction.ts), always re-validated against the
 *    same static security policies real generation is validated against.
 *
 * Every attempt — corrected, rejected, or failed — is persisted as a
 * TerraformCorrectionAttempt row before this node returns.
 */

import { prisma } from '@/lib/db/client'
import { runTerraformFmtFix } from '@/lib/terraform/sandbox'
import { runStaticSecurityValidation } from '@/lib/terraform/static-validator'
import { normalizeTerraformCode } from '@/lib/terraform/code-normalizer'
import { hashTerraformCode } from '@/lib/terraform/hashing'
import { attemptLlmCorrection, type CorrectionOutcome } from '@/lib/terraform/self-correction'
import { readWorkspaceCode, workspaceFromPath } from '@/lib/terraform/temp-workspace'
import { emitCommandOutput } from '../command-output-bus'
import { MAX_CORRECTION_ATTEMPTS, type GraphState, type GraphStateUpdate } from '../state'

export async function selfCorrectionNode(state: GraphState): Promise<GraphStateUpdate> {
  const { terraformArtifact, terraformArtifactId, remediationPlanId, sandboxWorkspacePath, nodeExecutions, correctionAttempts } = state
  if (!terraformArtifact || !terraformArtifactId || !remediationPlanId || !sandboxWorkspacePath) {
    throw new Error('selfCorrectionAgent: missing terraform artifact/workspace in state — a sandbox node must have run first')
  }

  const attemptNumber = correctionAttempts + 1
  const lastFailure = [...nodeExecutions].reverse().find((entry) => entry.status === 'failed')
  const failedNode = lastFailure?.node
  const errorText = lastFailure?.error ?? state.error ?? 'Unknown sandbox failure'
  const previousCodeHash = terraformArtifact.checksum
  const workspace = workspaceFromPath(sandboxWorkspacePath)

  let outcome: CorrectionOutcome

  if (failedNode === 'terraformFormat') {
    const fmtResult = await runTerraformFmtFix(workspace, {
      onStdout: (chunk) => emitCommandOutput(state.runId, 'selfCorrection', 'stdout', chunk),
      onStderr: (chunk) => emitCommandOutput(state.runId, 'selfCorrection', 'stderr', chunk),
    })

    if (fmtResult.exitCode !== 0) {
      outcome = {
        result: 'failed',
        correctedHcl: null,
        correctedChecksum: null,
        reason: `terraform fmt could not reformat the file: ${fmtResult.stderr || fmtResult.stdout}`,
      }
    } else {
      const normalized = normalizeTerraformCode(await readWorkspaceCode(workspace))
      const security = runStaticSecurityValidation(normalized)
      outcome = security.passed
        ? {
            result: 'corrected',
            correctedHcl: normalized,
            correctedChecksum: hashTerraformCode(normalized),
            reason: 'terraform fmt reformatted the file to canonical style',
          }
        : {
            result: 'rejected',
            correctedHcl: null,
            correctedChecksum: null,
            reason: `fmt-corrected code failed static security validation: ${security.findings.map((f) => f.message).join('; ')}`,
          }
    }
  } else {
    outcome = await attemptLlmCorrection(terraformArtifact.hcl, errorText)
  }

  await prisma.terraformCorrectionAttempt.create({
    data: {
      terraformArtifactId,
      attemptNumber,
      previousCodeHash,
      correctedCodeHash: outcome.correctedChecksum,
      triggerError: errorText.slice(0, 4000),
      result: outcome.result,
    },
  })

  // Real attempt detail (attempt number, strategy, hashes, result) for the
  // terminal — reuses the same command_output SSE channel real terraform
  // stdout/stderr already streams over, so the UI needs no new event type
  // to display actual correction attempts as they happen.
  const strategy = failedNode === 'terraformFormat' ? 'deterministic fmt fix' : 'bounded LLM fix'
  emitCommandOutput(
    state.runId,
    'selfCorrection',
    'stdout',
    `Correction attempt ${attemptNumber}/${MAX_CORRECTION_ATTEMPTS} [${strategy}] triggered by ${failedNode ?? 'unknown'} failure\n` +
      `  previousCodeHash=${previousCodeHash.slice(0, 12)} correctedCodeHash=${outcome.correctedChecksum?.slice(0, 12) ?? 'n/a'}\n` +
      `  result=${outcome.result} — ${outcome.reason}`,
  )

  if (outcome.result !== 'corrected' || !outcome.correctedHcl || !outcome.correctedChecksum) {
    return {
      correctionAttempts: attemptNumber,
      error: `selfCorrectionAgent attempt ${attemptNumber} (${outcome.result}): ${outcome.reason}`,
    }
  }

  // LLM-path corrections haven't touched the workspace file yet (the fmt
  // path already has, via the real `terraform fmt` call above) —
  // terraformFormatWorker's retry pass will write terraformArtifact.hcl
  // into the workspace itself, so no direct file write is needed here.
  const newArtifact = await prisma.terraformArtifact.create({
    data: {
      remediationPlanId,
      hcl: outcome.correctedHcl,
      checksum: outcome.correctedChecksum,
    },
  })

  return {
    correctionAttempts: attemptNumber,
    error: null,
    terraformArtifactId: newArtifact.id,
    terraformArtifact: { ...terraformArtifact, hcl: outcome.correctedHcl, checksum: outcome.correctedChecksum },
  }
}
