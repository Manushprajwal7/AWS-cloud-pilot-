/**
 * terraformPlanWorker node: the sandbox pipeline's last step —
 * `terraform plan -out=approved.tfplan` followed by `terraform show -json
 * approved.tfplan`. Parses the real plan JSON (lib/terraform/plan-parser.ts)
 * into a PlanSummary, persists it on the TerraformArtifact, and closes out
 * the TerraformExecution row this whole pipeline has been reporting into.
 * `terraform apply` is not implemented anywhere in this codebase — this
 * node produces a reviewable plan and stops.
 */

import { prisma } from '@/lib/db/client'
import { runTerraformPlan } from '@/lib/terraform/sandbox'
import { parseTerraformPlanJson, PlanParseError } from '@/lib/terraform/plan-parser'
import { emitCommandOutput } from '../command-output-bus'
import { appendExecutionLog, renderCommandLog, workspaceFromPath } from './terraform-sandbox-shared'
import type { GraphState, GraphStateUpdate } from '../state'

export async function terraformPlanNode(state: GraphState): Promise<GraphStateUpdate> {
  const { sandboxWorkspacePath, terraformExecutionId, terraformArtifactId } = state
  if (!sandboxWorkspacePath || !terraformExecutionId || !terraformArtifactId) {
    throw new Error('terraformPlanWorker: missing sandbox workspace in state — terraformValidateWorker must run first')
  }

  const workspace = workspaceFromPath(sandboxWorkspacePath)

  const { planResult, showResult, planJson } = await runTerraformPlan(workspace, {
    onStdout: (chunk) => emitCommandOutput(state.runId, 'terraformPlan', 'stdout', chunk),
    onStderr: (chunk) => emitCommandOutput(state.runId, 'terraformPlan', 'stderr', chunk),
  })

  const execution = await prisma.terraformExecution.findUnique({ where: { id: terraformExecutionId } })
  const log = appendExecutionLog(execution?.logs, `${renderCommandLog(planResult)}\n\n${renderCommandLog(showResult)}`)

  if (planResult.exitCode !== 0 || planJson === null) {
    await prisma.terraformExecution.update({
      where: { id: terraformExecutionId },
      data: { status: 'failed', exitCode: planResult.exitCode ?? showResult.exitCode, logs: log, completedAt: new Date() },
    })
    return {
      sandboxCommandResults: [planResult, showResult],
      error: `terraform plan failed (exit ${planResult.exitCode ?? 'null'}${planResult.timedOut ? ', timed out' : ''}):\n${planResult.stderr || planResult.stdout}`.slice(0, 4000),
    }
  }

  let planSummary
  try {
    planSummary = parseTerraformPlanJson(planJson)
  } catch (error) {
    const message = error instanceof PlanParseError ? error.message : 'Failed to parse terraform plan JSON'
    await prisma.terraformExecution.update({
      where: { id: terraformExecutionId },
      data: { status: 'failed', exitCode: planResult.exitCode, logs: log, completedAt: new Date() },
    })
    return { sandboxCommandResults: [planResult, showResult], error: message }
  }

  await Promise.all([
    prisma.terraformExecution.update({
      where: { id: terraformExecutionId },
      data: { status: 'succeeded', exitCode: 0, logs: log, completedAt: new Date() },
    }),
    prisma.terraformArtifact.update({
      where: { id: terraformArtifactId },
      data: { planJson: planSummary as object },
    }),
  ])

  return {
    sandboxCommandResults: [planResult, showResult],
    planSummary,
    error: null,
  }
}
