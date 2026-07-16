/**
 * Snapshot/restore for the simulated environment. terraformApplyWorker
 * captures a snapshot of the target resource immediately before mutating
 * simulationStore; rollbackWorker restores it byte-for-byte on a failed
 * verification. This is the "exact previous simulation snapshot" the
 * phase objective calls for — not a best-effort partial undo.
 */

import { simulationStore } from '@/lib/simulation/simulation-store'
import type { SimulatedCloudResource } from '@/lib/simulation/types'

export type RollbackSnapshot = SimulatedCloudResource

export function captureRollbackSnapshot(resource: SimulatedCloudResource): RollbackSnapshot {
  return structuredClone(resource)
}

export function restoreRollbackSnapshot(snapshot: RollbackSnapshot): SimulatedCloudResource {
  const { id, ...updates } = snapshot
  return simulationStore.updateResource(id, updates)
}
