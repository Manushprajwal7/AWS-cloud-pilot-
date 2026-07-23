/**
 * The second half of the CloudPilot graph, compiled on its own so a run
 * that stopped at awaitApproval (see graph.ts / nodes/await-approval.ts)
 * can be resumed from exactly where it left off once a human clicks Apply
 * in the terraform-sandbox UI:
 *
 *   terraformApply -> verification -> [rollback | calculateRealizedSavings] -> audit -> END
 *
 * Reuses the same node functions, routers, and withNodeInstrumentation
 * wrapper as the main graph (buildGraph in graph.ts) — this is not a
 * reimplementation, it's the identical tail of the pipeline, just entered
 * at a different point. See app/api/graph/runs/[runId]/apply/route.ts for
 * the caller.
 */

import { StateGraph, START, END } from '@langchain/langgraph'
import { terraformApplyNode } from './nodes/terraform-apply'
import { verificationNode } from './nodes/verification'
import { rollbackNode } from './nodes/rollback'
import { calculateRealizedSavingsNode } from './nodes/calculate-realized-savings'
import { auditNode } from './nodes/audit'
import { routeAfterTerraformApply, routeAfterVerification } from './routes'
import { withNodeInstrumentation } from './graph'
import { GraphStateAnnotation } from './state'

export function buildApplyContinuationGraph() {
  const graph = new StateGraph(GraphStateAnnotation)
    .addNode('terraformApply', withNodeInstrumentation('terraformApply', terraformApplyNode))
    .addNode('verification', withNodeInstrumentation('verification', verificationNode))
    .addNode('rollback', withNodeInstrumentation('rollback', rollbackNode))
    .addNode('calculateRealizedSavings', withNodeInstrumentation('calculateRealizedSavings', calculateRealizedSavingsNode))
    .addNode('audit', withNodeInstrumentation('audit', auditNode))
    .addEdge(START, 'terraformApply')
    .addConditionalEdges('terraformApply', routeAfterTerraformApply, { verification: 'verification', audit: 'audit' })
    .addConditionalEdges('verification', routeAfterVerification, {
      rollback: 'rollback',
      calculateRealizedSavings: 'calculateRealizedSavings',
      audit: 'audit',
    })
    .addEdge('rollback', 'audit')
    .addEdge('calculateRealizedSavings', 'audit')
    .addEdge('audit', END)

  return graph.compile()
}

export const applyContinuationGraph = buildApplyContinuationGraph()

// Small: apply -> verification -> (rollback|savings) -> audit is at most 4
// node hops with no loops, unlike the main graph's bounded correction loop.
export const APPLY_CONTINUATION_RECURSION_LIMIT = 10
