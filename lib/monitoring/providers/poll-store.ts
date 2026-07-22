/**
 * Small in-memory store + poll loop shared by every monitoring adapter
 * (aws-cloudwatch.ts, gcp-monitoring.ts, prometheus.ts) — mirrors
 * lib/simulation/simulation-store.ts's own Map + Set<listener> + history
 * shape, just without the simulation-only mutators (activateScenario,
 * resetResource, ...) real backends have no equivalent for.
 */

import type {
  MetricSnapshot,
  SimulatedCloudResource,
  SimulationStoreEvent,
  SimulationStoreListener,
} from '@/lib/simulation/types'
import type { ReadableResourceStore } from '../types'

const HISTORY_LIMIT_PER_RESOURCE = 500

function clone<T>(value: T): T {
  return structuredClone(value)
}

export interface PollStore extends ReadableResourceStore {
  /** Replaces the full resource set for a poll cycle (adds/updates; does not remove resources missing from `resources` — a transient discovery-API hiccup shouldn't blank the dashboard). */
  applySnapshot(resources: SimulatedCloudResource[]): void
}

export function createPollStore(): PollStore {
  const resources = new Map<string, SimulatedCloudResource>()
  const history = new Map<string, MetricSnapshot[]>()
  const listeners = new Set<SimulationStoreListener>()

  function notify(event: SimulationStoreEvent): void {
    for (const listener of listeners) listener(event)
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

  function getMetricHistory(id: string): MetricSnapshot[] {
    return clone(history.get(id) ?? [])
  }

  function subscribe(listener: SimulationStoreListener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function applySnapshot(nextResources: SimulatedCloudResource[]): void {
    const timestamp = new Date().toISOString()

    for (const resource of nextResources) {
      resources.set(resource.id, resource)

      const resourceHistory = history.get(resource.id) ?? []
      resourceHistory.push({ resourceId: resource.id, timestamp, metrics: clone(resource.metrics), cost: clone(resource.cost) })
      if (resourceHistory.length > HISTORY_LIMIT_PER_RESOURCE) {
        resourceHistory.splice(0, resourceHistory.length - HISTORY_LIMIT_PER_RESOURCE)
      }
      history.set(resource.id, resourceHistory)

      notify({ type: 'metric_snapshot_saved', resourceId: resource.id, resource: clone(resource) })
    }
  }

  return { listResources, getResource, getMetricHistory, subscribe, applySnapshot }
}
