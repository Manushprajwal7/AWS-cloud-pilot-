/**
 * calculateRealizedSavingsWorker node: only reached when verification
 * passed (the change stuck, no rollback). Compares the pre-apply snapshot's
 * cost against the resource's real current cost — the same deterministic
 * pricing model used everywhere else in this codebase — and persists it on
 * the RemediationPlan row.
 */

import { prisma } from '@/lib/db/client'
import { round2 } from '@/lib/financial/pricing'
import { simulationStore } from '@/lib/simulation/simulation-store'
import type { GraphState, GraphStateUpdate } from '../state'

export async function calculateRealizedSavingsNode(state: GraphState): Promise<GraphStateUpdate> {
  const { preApplySnapshot, remediationPlanId, resource } = state
  if (!preApplySnapshot || !remediationPlanId || !resource) {
    throw new Error('calculateRealizedSavingsWorker: missing preApplySnapshot/remediationPlanId in state — verificationWorker must run first')
  }

  const currentResource = simulationStore.getResource(resource.id) ?? resource
  const realizedMonthlySavingsUsd = round2(preApplySnapshot.cost.projectedMonthlyUsd - currentResource.cost.projectedMonthlyUsd)

  await prisma.remediationPlan.update({
    where: { id: remediationPlanId },
    data: { realizedMonthlySavingsUsd },
  })

  return { realizedSavingsUsd: realizedMonthlySavingsUsd }
}
