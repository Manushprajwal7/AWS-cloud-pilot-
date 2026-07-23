/**
 * awaitApprovalWorker node: the graph's human-in-the-loop gate. Reached only
 * when autoApprovalWorker approved the plan (routes.ts) — it does not
 * re-decide anything, it just stops the run here instead of proceeding
 * straight into terraformApplyWorker. The sandbox workspace and the exact
 * approved plan file are left untouched (auditWorker's cleanup does not run
 * on this path) so a later POST /api/graph/runs/:runId/apply can resume the
 * graph from terraformApplyWorker against the identical artifact.
 */

import type { GraphState, GraphStateUpdate } from '../state'

export async function awaitApprovalNode(_state: GraphState): Promise<GraphStateUpdate> {
  return { status: 'awaiting_approval' }
}
