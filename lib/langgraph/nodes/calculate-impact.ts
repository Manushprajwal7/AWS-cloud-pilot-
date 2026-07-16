/**
 * financialImpactWorker node: computes the dollar impact of the diagnosed
 * anomaly deterministically via lib/financial/impact.ts. No LLM involved —
 * this node exists so planRemediationAgent has a real number to ground its
 * plan in rather than asking the LLM to estimate savings itself.
 */

import { calculateAnomalyFinancialImpact } from '@/lib/financial/impact'
import type { GraphState, GraphStateUpdate } from '../state'

export async function calculateImpactNode(state: GraphState): Promise<GraphStateUpdate> {
  const { anomaly, resource } = state
  if (!anomaly || !resource) {
    throw new Error('financialImpactWorker: no anomaly/resource in state — earlier nodes must run first')
  }

  const financialImpact = calculateAnomalyFinancialImpact(anomaly, resource)

  return { financialImpact }
}
