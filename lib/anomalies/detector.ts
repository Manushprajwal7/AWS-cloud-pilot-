/**
 * The anomaly detector: runs ANOMALY_RULES against a resource whenever the
 * simulation store reports new metrics, maintains a deduplicated registry
 * of active/resolved anomalies, and exposes its own subscribe() for
 * GET /api/anomalies/stream — mirroring lib/simulation/simulation-store.ts's
 * design so the two systems compose the same way.
 */

import { randomUUID } from 'node:crypto'
import { simulationStore, type SimulationStore } from '@/lib/simulation/simulation-store'
import { ANOMALY_RULES } from './rules'
import { ALL_ANOMALY_TYPES, type Anomaly, type AnomalyEvent, type AnomalyListener, type AnomalyType } from './types'

export class AnomalyNotFoundError extends Error {
  anomalyId: string

  constructor(anomalyId: string) {
    super(`Anomaly '${anomalyId}' does not exist`)
    this.name = 'AnomalyNotFoundError'
    this.anomalyId = anomalyId
  }
}

export interface AnomalyFilter {
  status?: 'active' | 'resolved'
  resourceId?: string
  type?: AnomalyType
}

export interface AnomalyDetector {
  listAnomalies(filter?: AnomalyFilter): Anomaly[]
  getAnomaly(id: string): Anomaly | undefined
  resolveAnomaly(id: string): Anomaly
  evaluateResource(resourceId: string): Anomaly[]
  evaluateAll(): Anomaly[]
  subscribe(listener: AnomalyListener): () => void
  /** Unsubscribe from the simulation store. Mainly for test cleanup. */
  stop(): void
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function keyFor(resourceId: string, type: AnomalyType): string {
  return `${resourceId}::${type}`
}

/**
 * Create an isolated anomaly detector bound to a given simulation store.
 * Most of the app should use the shared `anomalyDetector` singleton below;
 * this factory exists so tests don't share state with each other or with
 * the real simulation store.
 */
export function createAnomalyDetector(store: SimulationStore): AnomalyDetector {
  const anomalies = new Map<string, Anomaly>()
  // resourceId::type -> the id of that pairing's current active anomaly, for O(1) dedup.
  const activeByKey = new Map<string, string>()
  const listeners = new Set<AnomalyListener>()

  function notify(event: AnomalyEvent): void {
    for (const listener of listeners) listener(event)
  }

  function evaluateResource(resourceId: string): Anomaly[] {
    const resource = store.getResource(resourceId)
    if (!resource) return []

    const history = store.getMetricHistory(resourceId)
    const matchedTypes = new Set<AnomalyType>()
    const touched: Anomaly[] = []
    const now = new Date().toISOString()

    for (const rule of ANOMALY_RULES) {
      const match = rule(resource, history)
      if (!match) continue
      matchedTypes.add(match.type)

      const key = keyFor(resourceId, match.type)
      const existingId = activeByKey.get(key)

      if (existingId) {
        const existing = anomalies.get(existingId)!
        const updated: Anomaly = {
          ...existing,
          severity: match.severity,
          confidence: match.confidence,
          evidence: match.evidence,
          lastObservedAt: now,
        }
        anomalies.set(existingId, updated)
        touched.push(updated)
        notify({ type: 'anomaly_updated', anomaly: clone(updated) })
      } else {
        const id = randomUUID()
        const created: Anomaly = {
          id,
          resourceId,
          type: match.type,
          severity: match.severity,
          confidence: match.confidence,
          evidence: match.evidence,
          detectedAt: now,
          firstObservedAt: now,
          lastObservedAt: now,
          status: 'active',
        }
        anomalies.set(id, created)
        activeByKey.set(key, id)
        touched.push(created)
        notify({ type: 'anomaly_detected', anomaly: clone(created) })
      }
    }

    // Auto-resolve any anomaly that was active for this resource but whose
    // condition no longer matches this evaluation.
    for (const type of ALL_ANOMALY_TYPES) {
      if (matchedTypes.has(type)) continue
      const key = keyFor(resourceId, type)
      const existingId = activeByKey.get(key)
      if (!existingId) continue

      const existing = anomalies.get(existingId)
      activeByKey.delete(key)
      if (!existing || existing.status !== 'active') continue

      const resolved: Anomaly = {
        ...existing,
        status: 'resolved',
        resolvedAt: now,
        resolutionReason: 'condition_cleared',
      }
      anomalies.set(existingId, resolved)
      touched.push(resolved)
      notify({ type: 'anomaly_resolved', anomaly: clone(resolved) })
    }

    return touched.map(clone)
  }

  function evaluateAll(): Anomaly[] {
    return store.listResources().flatMap((resource) => evaluateResource(resource.id))
  }

  function listAnomalies(filter: AnomalyFilter = {}): Anomaly[] {
    return Array.from(anomalies.values())
      .filter((a) => !filter.status || a.status === filter.status)
      .filter((a) => !filter.resourceId || a.resourceId === filter.resourceId)
      .filter((a) => !filter.type || a.type === filter.type)
      .sort((a, b) => b.lastObservedAt.localeCompare(a.lastObservedAt))
      .map(clone)
  }

  function getAnomaly(id: string): Anomaly | undefined {
    const anomaly = anomalies.get(id)
    return anomaly ? clone(anomaly) : undefined
  }

  function resolveAnomaly(id: string): Anomaly {
    const existing = anomalies.get(id)
    if (!existing) {
      throw new AnomalyNotFoundError(id)
    }
    if (existing.status === 'resolved') {
      return clone(existing)
    }

    const resolved: Anomaly = {
      ...existing,
      status: 'resolved',
      resolvedAt: new Date().toISOString(),
      resolutionReason: 'manual',
    }
    anomalies.set(id, resolved)

    // Free the dedup slot so this condition can re-open as a fresh anomaly
    // (new id, new firstObservedAt) if it's still true on the next tick,
    // rather than silently reviving this manually-resolved record.
    const key = keyFor(existing.resourceId, existing.type)
    if (activeByKey.get(key) === id) {
      activeByKey.delete(key)
    }

    notify({ type: 'anomaly_resolved', anomaly: clone(resolved) })
    return clone(resolved)
  }

  function subscribe(listener: AnomalyListener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  const unsubscribeFromStore = store.subscribe((event) => {
    if (event.type === 'metric_snapshot_saved' || event.type === 'resource_reset') {
      evaluateResource(event.resourceId)
    }
  })

  function stop(): void {
    unsubscribeFromStore()
  }

  return {
    listAnomalies,
    getAnomaly,
    resolveAnomaly,
    evaluateResource,
    evaluateAll,
    subscribe,
    stop,
  }
}

/** Shared singleton bound to the shared simulationStore, used by the API routes. */
export const anomalyDetector = createAnomalyDetector(simulationStore)
