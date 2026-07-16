/**
 * monitorWorker node: pulls the current, real state of the target resource
 * (and its metric history) from the simulation store. This is the graph's
 * only entry point into live data — every downstream node works off what
 * this node captured, not a fresh read of its own.
 *
 * Node functions here are pure business logic: they return a partial state
 * update or throw. Timing, retry/failure bookkeeping, and persistence are
 * handled once, generically, by withNodeInstrumentation in ../graph.ts.
 */

import { simulationStore } from '@/lib/simulation/simulation-store'
import type { GraphState, GraphStateUpdate } from '../state'

export class ResourceNotFoundError extends Error {
  constructor(resourceId: string) {
    super(`monitorWorker: resource '${resourceId}' does not exist in the simulation store`)
    this.name = 'ResourceNotFoundError'
  }
}

export async function monitorNode(state: GraphState): Promise<GraphStateUpdate> {
  const resource = simulationStore.getResource(state.resourceId)
  if (!resource) {
    throw new ResourceNotFoundError(state.resourceId)
  }

  const metricHistory = simulationStore.getMetricHistory(state.resourceId)

  return { resource, metricHistory }
}
