/**
 * terraformInitWorker node: `terraform init` against the workspace
 * terraformFormatWorker created. The only sandbox step allowed outbound
 * network access (see lib/terraform/sandbox.ts) — it has to fetch the aws
 * provider plugin from the registry. Returns normally (error set on state)
 * rather than throwing on failure — see terraform-format.ts's header
 * comment for why that matters to selfCorrectionAgent.
 */

import { prisma } from '@/lib/db/client'
import { runTerraformInit } from '@/lib/terraform/sandbox'
import { emitCommandOutput } from '../command-output-bus'
import { appendExecutionLog, renderCommandLog, workspaceFromPath } from './terraform-sandbox-shared'
import type { GraphState, GraphStateUpdate } from '../state'

export async function terraformInitNode(state: GraphState): Promise<GraphStateUpdate> {
  const { sandboxWorkspacePath, terraformExecutionId } = state
  if (!sandboxWorkspacePath || !terraformExecutionId) {
    throw new Error('terraformInitWorker: missing sandbox workspace in state — terraformFormatWorker must run first')
  }

  const workspace = workspaceFromPath(sandboxWorkspacePath)

  const result = await runTerraformInit(workspace, {
    onStdout: (chunk) => emitCommandOutput(state.runId, 'terraformInit', 'stdout', chunk),
    onStderr: (chunk) => emitCommandOutput(state.runId, 'terraformInit', 'stderr', chunk),
  })

  const execution = await prisma.terraformExecution.findUnique({ where: { id: terraformExecutionId } })
  const combinedLog = appendExecutionLog(execution?.logs, renderCommandLog(result))

  if (result.exitCode !== 0) {
    await prisma.terraformExecution.update({
      where: { id: terraformExecutionId },
      data: { status: 'failed', exitCode: result.exitCode, logs: combinedLog, completedAt: new Date() },
    })
    return {
      sandboxCommandResults: [result],
      error: `terraform init failed (exit ${result.exitCode ?? 'null'}${result.timedOut ? ', timed out' : ''}):\n${result.stderr || result.stdout}`.slice(0, 4000),
    }
  }

  await prisma.terraformExecution.update({ where: { id: terraformExecutionId }, data: { logs: combinedLog } })

  return { sandboxCommandResults: [result], error: null }
}
