/**
 * terraformFormatWorker node: first sandbox node on a fresh pass, and the
 * loop-back target after a successful selfCorrectionAgent attempt. Creates
 * (or, on retry, reuses) the isolated temp workspace and the
 * TerraformExecution row this whole sandbox pipeline reports into, then
 * runs `terraform fmt -check -diff`. Real stdout/stderr is relayed live via
 * command-output-bus as it's produced by the child process, not buffered
 * until the node finishes.
 *
 * On failure this returns normally (error set on state) rather than
 * throwing, so sandboxWorkspacePath/terraformExecutionId are preserved in
 * state for selfCorrectionAgent to use — a thrown error would discard this
 * node's return value entirely (see graph.ts's withNodeInstrumentation).
 */

import { prisma } from '@/lib/db/client'
import { createSandboxWorkspace, writeCorrectedCode } from '@/lib/terraform/temp-workspace'
import { runTerraformFmtCheck } from '@/lib/terraform/sandbox'
import { emitCommandOutput } from '../command-output-bus'
import { appendExecutionLog, renderCommandLog, workspaceFromPath } from './terraform-sandbox-shared'
import type { GraphState, GraphStateUpdate } from '../state'

export async function terraformFormatNode(state: GraphState): Promise<GraphStateUpdate> {
  const { terraformArtifact, terraformArtifactId, sandboxWorkspacePath, terraformExecutionId } = state
  if (!terraformArtifact || !terraformArtifactId) {
    throw new Error('terraformFormatWorker: missing terraformArtifact in state — staticSecurityWorker must have passed first')
  }

  const workspace = sandboxWorkspacePath ? workspaceFromPath(sandboxWorkspacePath) : await createSandboxWorkspace(state.runId, terraformArtifact.hcl)
  if (sandboxWorkspacePath) {
    await writeCorrectedCode(workspace, terraformArtifact.hcl)
  }

  const execution = terraformExecutionId
    ? await prisma.terraformExecution.update({
        where: { id: terraformExecutionId },
        data: { status: 'running', completedAt: null },
      })
    : await prisma.terraformExecution.create({
        data: { terraformArtifactId, operation: 'plan', status: 'running', startedAt: new Date() },
      })

  const result = await runTerraformFmtCheck(workspace, {
    onStdout: (chunk) => emitCommandOutput(state.runId, 'terraformFormat', 'stdout', chunk),
    onStderr: (chunk) => emitCommandOutput(state.runId, 'terraformFormat', 'stderr', chunk),
  })

  const combinedLog = appendExecutionLog(execution.logs, renderCommandLog(result))

  if (result.exitCode !== 0) {
    await prisma.terraformExecution.update({
      where: { id: execution.id },
      data: { status: 'failed', exitCode: result.exitCode, logs: combinedLog, completedAt: new Date() },
    })
    return {
      sandboxWorkspacePath: workspace.path,
      terraformExecutionId: execution.id,
      sandboxCommandResults: [result],
      error: `terraform fmt -check failed (exit ${result.exitCode ?? 'null'}${result.timedOut ? ', timed out' : ''}):\n${result.stderr || result.stdout}`.slice(0, 4000),
    }
  }

  await prisma.terraformExecution.update({ where: { id: execution.id }, data: { logs: combinedLog } })

  return {
    sandboxWorkspacePath: workspace.path,
    terraformExecutionId: execution.id,
    sandboxCommandResults: [result],
    error: null,
  }
}
