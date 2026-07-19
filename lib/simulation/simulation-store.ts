/**
 * The server-owned simulation store. This is the single source of truth for
 * simulated resource state — API routes, the tick engine (Phase 3), and any
 * UI all read from and write through this module. React component state
 * must never be treated as authoritative; components only render what this
 * store reports and, at most, cache it locally between reads.
 */

import { buildSeedResources, calculateCost } from './resources'
import { getScenarioDefinition, isValidScenario } from './scenarios'
import type {
  MetricSnapshot,
  ResourceMetrics,
  ScenarioType,
  SimulatedCloudResource,
  SimulationStoreEvent,
  SimulationStoreListener,
} from './types'

const HISTORY_LIMIT_PER_RESOURCE = 500

export class SimulationResourceNotFoundError extends Error {
  resourceId: string

  constructor(resourceId: string) {
    super(`Simulated resource '${resourceId}' does not exist`)
    this.name = 'SimulationResourceNotFoundError'
    this.resourceId = resourceId
  }
}

export class InvalidScenarioError extends Error {
  scenario: string

  constructor(scenario: string) {
    super(`'${scenario}' is not a valid scenario type`)
    this.name = 'InvalidScenarioError'
    this.scenario = scenario
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

export interface SimulationStore {
  listResources(): SimulatedCloudResource[]
  getResource(id: string): SimulatedCloudResource | undefined
  updateResource(id: string, updates: Partial<Omit<SimulatedCloudResource, 'id'>>): SimulatedCloudResource
  activateScenario(id: string, scenario: ScenarioType): SimulatedCloudResource
  resetResource(id: string): SimulatedCloudResource
  saveMetricSnapshot(id: string, metrics: ResourceMetrics): SimulatedCloudResource
  getMetricHistory(id: string): MetricSnapshot[]
  subscribe(listener: SimulationStoreListener): () => void
}

/**
 * Create an isolated simulation store instance. Most of the app should use
 * the shared `simulationStore` singleton below; this factory exists so
 * tests (and anything else that needs a clean slate) don't share state.
 */
export function createSimulationStore(): SimulationStore {
  const seeds = buildSeedResources()
  const resources = new Map<string, SimulatedCloudResource>(seeds.map((r) => [r.id, clone(r)]))
  const seedById = new Map<string, SimulatedCloudResource>(seeds.map((r) => [r.id, clone(r)]))
  const history = new Map<string, MetricSnapshot[]>()
  const listeners = new Set<SimulationStoreListener>()

  function requireResource(id: string): SimulatedCloudResource {
    const resource = resources.get(id)
    if (!resource) {
      throw new SimulationResourceNotFoundError(id)
    }
    return resource
  }

  function notify(event: SimulationStoreEvent): void {
    for (const listener of listeners) {
      listener(event)
    }
  }

  function listResources(): SimulatedCloudResource[] {
    return Array.from(resources.values())
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(clone)
  }

  function getResource(id: string): SimulatedCloudResource | undefined {
    const resource = resources.get(id)
    return resource ? clone(resource) : undefined
  }

  function updateResource(id: string, updates: Partial<Omit<SimulatedCloudResource, 'id'>>): SimulatedCloudResource {
    const current = requireResource(id)

    const updated: SimulatedCloudResource = {
      ...current,
      ...updates,
      id: current.id,
      configuration: { ...current.configuration, ...updates.configuration },
      metrics: { ...current.metrics, ...updates.metrics },
      cost: { ...current.cost, ...updates.cost },
      updatedAt: new Date().toISOString(),
    }

    resources.set(id, updated)
    notify({ type: 'resource_updated', resourceId: id, resource: clone(updated) })
    return clone(updated)
  }

  function activateScenario(id: string, scenario: ScenarioType): SimulatedCloudResource {
    const current = requireResource(id)

    if (!isValidScenario(scenario)) {
      throw new InvalidScenarioError(scenario)
    }

    const definition = getScenarioDefinition(scenario)
    const metrics = { ...definition.targetMetrics }
    const cost = calculateCost(current.service, current.configuration, metrics)

    const updated: SimulatedCloudResource = {
      ...current,
      activeScenario: scenario,
      status: definition.status,
      metrics,
      cost,
      updatedAt: new Date().toISOString(),
    }

    resources.set(id, updated)
    notify({ type: 'scenario_activated', resourceId: id, resource: clone(updated) })
    return clone(updated)
  }

  function resetResource(id: string): SimulatedCloudResource {
    requireResource(id)
    const seed = seedById.get(id)
    if (!seed) {
      throw new SimulationResourceNotFoundError(id)
    }

    const reset: SimulatedCloudResource = {
      ...clone(seed),
      updatedAt: new Date().toISOString(),
    }

    resources.set(id, reset)
    history.set(id, [])
    notify({ type: 'resource_reset', resourceId: id, resource: clone(reset) })
    return clone(reset)
  }

  function saveMetricSnapshot(id: string, metrics: ResourceMetrics): SimulatedCloudResource {
    const current = requireResource(id)
    const cost = calculateCost(current.service, current.configuration, metrics)
    const timestamp = new Date().toISOString()

    const updated: SimulatedCloudResource = {
      ...current,
      metrics,
      cost,
      updatedAt: timestamp,
    }

    resources.set(id, updated)

    const resourceHistory = history.get(id) ?? []
    resourceHistory.push({ resourceId: id, timestamp, metrics: clone(metrics), cost: clone(cost) })
    if (resourceHistory.length > HISTORY_LIMIT_PER_RESOURCE) {
      resourceHistory.splice(0, resourceHistory.length - HISTORY_LIMIT_PER_RESOURCE)
    }
    history.set(id, resourceHistory)

    notify({ type: 'metric_snapshot_saved', resourceId: id, resource: clone(updated) })
    return clone(updated)
  }

  function getMetricHistory(id: string): MetricSnapshot[] {
    requireResource(id)
    return clone(history.get(id) ?? [])
  }

  function subscribe(listener: SimulationStoreListener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  return {
    listResources,
    getResource,
    updateResource,
    activateScenario,
    resetResource,
    saveMetricSnapshot,
    getMetricHistory,
    subscribe,
  }
}

/**
 * Shared singleton used by API routes. A module-level singleton is
 * ephemeral (resets on server restart / cold start) — the same limitation
 * lib/mockAwsState.ts had, called out in the Phase 0 audit. Persisting this
 * to a real database is out of scope for this phase.
 *
 * Pinned to globalThis (the same pattern as lib/db/client.ts) because a plain
 * module-level const is NOT actually a process-wide singleton in Next.js:
 * instrumentation.ts and the route handlers are bundled into separate module
 * registries, so each would get its own store — the tick engine would then
 * mutate a store no API route can see, and every panel would render the frozen
 * seed data forever. Dev-mode hot reload duplicates it the same way.
 */
const globalForSimulation = globalThis as unknown as { simulationStore?: SimulationStore }

export const simulationStore: SimulationStore = globalForSimulation.simulationStore ?? createSimulationStore()

globalForSimulation.simulationStore = simulationStore
