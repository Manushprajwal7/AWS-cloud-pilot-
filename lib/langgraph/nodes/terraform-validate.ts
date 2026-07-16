/**
 * terraformValidateWorker node: `terraform validate` against the
 * initialized workspace. Runs with no network access — validation is a
 * purely local check of the configuration once providers are installed.
 * Returns normally (error set on state) rather than throwing on failure —
 * see terraform-format.ts's header comment for why that matters to
 * selfCorrectionAgent.
 */

import { prisma } from '@/lib/db/client'
import { runTerraformValidate } from '@/lib/terraform/sandbox'
import { emitCommandOutput } from '../command-output-bus'
import { appendExecutionLog, renderCommandLog, workspaceFromPath } from './terraform-sandbox-shared'
import type { GraphState, GraphStateUpdate } from '../state'

export async function terraformValidateNode(state: GraphState): Promise<GraphStateUpdate> {
  const { sandboxWorkspacePath, terraformExecutionId } = state
  if (!sandboxWorkspacePath || !terraformExecutionId) {
    throw new Error('terraformValidateWorker: missing sandbox workspace in state — terraformInitWorker must run first')
  }

  const workspace = workspaceFromPath(sandboxWorkspacePath)

  const result = await runTerraformValidate(workspace, {
    onStdout: (chunk) => emitCommandOutput(state.runId, 'terraformValidate', 'stdout', chunk),
    onStderr: (chunk) => emitCommandOutput(state.runId, 'terraformValidate', 'stderr', chunk),
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
      error: `terraform validate failed (exit ${result.exitCode ?? 'null'}${result.timedOut ? ', timed out' : ''}):\n${result.stderr || result.stdout}`.slice(0, 4000),
    }
  }

  await prisma.terraformExecution.update({ where: { id: terraformExecutionId }, data: { logs: combinedLog } })

  return { sandboxCommandResults: [result], error: null }
}
