/**
 * rollbackWorker node: only reached when verificationWorker found a
 * failing check. Restores the exact pre-apply simulation snapshot
 * (lib/rollback/rollback-plan.ts) and persists a RollbackRecord explaining
 * why, referencing the same TerraformExecution row verification results
 * are attached to.
 */

import { prisma } from '@/lib/db/client'
import { restoreRollbackSnapshot } from '@/lib/rollback/rollback-plan'
import type { GraphState, GraphStateUpdate } from '../state'

export async function rollbackNode(state: GraphState): Promise<GraphStateUpdate> {
  const { preApplySnapshot, applyExecutionId, verificationResult } = state
  if (!preApplySnapshot || !applyExecutionId || !verificationResult) {
    throw new Error('rollbackWorker: missing preApplySnapshot/verificationResult in state — verificationWorker must run first')
  }

  const reason = verificationResult.checks
    .filter((check) => !check.passed)
    .map((check) => `${check.name}: ${check.details}`)
    .join('; ')

  const rollbackRecord = await prisma.rollbackRecord.create({
    data: { terraformExecutionId: applyExecutionId, reason, status: 'in_progress' },
  })

  const restoredResource = restoreRollbackSnapshot(preApplySnapshot)

  await prisma.rollbackRecord.update({
    where: { id: rollbackRecord.id },
    data: { status: 'completed', completedAt: new Date() },
  })

  return {
    resource: restoredResource,
    rollbackResult: { rolledBack: true, reason },
  }
}
