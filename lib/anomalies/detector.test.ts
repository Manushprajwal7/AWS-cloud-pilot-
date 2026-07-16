import { describe, expect, it, beforeEach } from 'vitest'
import { createSimulationStore, type SimulationStore } from '@/lib/simulation/simulation-store'
import { createAnomalyDetector, AnomalyNotFoundError, type AnomalyDetector } from './detector'
import type { ResourceMetrics } from '@/lib/simulation/types'
import type { AnomalyEvent } from './types'

function metrics(overrides: Partial<ResourceMetrics> = {}): ResourceMetrics {
  return {
    cpuPercent: 25,
    memoryPercent: 40,
    networkInMb: 5,
    networkOutMb: 3,
    requestsPerMinute: 120,
    latencyMs: 45,
    errorRatePercent: 0.1,
    idleHours: 0,
    ...overrides,
  }
}

describe('lib/anomalies/detector', () => {
  let store: SimulationStore
  let detector: AnomalyDetector
  let resourceId: string

  beforeEach(() => {
    store = createSimulationStore()
    detector = createAnomalyDetector(store)
    resourceId = store.listResources()[0].id
  })

  describe('duplicate prevention', () => {
    it('creates exactly one active anomaly across repeated CPU-spike readings, not one per reading', () => {
      store.saveMetricSnapshot(resourceId, metrics({ cpuPercent: 85 }))
      store.saveMetricSnapshot(resourceId, metrics({ cpuPercent: 88 }))
      store.saveMetricSnapshot(resourceId, metrics({ cpuPercent: 90 })) // 3rd reading: sustained window satisfied
      store.saveMetricSnapshot(resourceId, metrics({ cpuPercent: 91 })) // still spiking -- must update, not duplicate

      const active = detector.listAnomalies({ status: 'active', resourceId, type: 'SUSTAINED_CPU_SPIKE' })
      expect(active).toHaveLength(1)
    })

    it('updates lastObservedAt but keeps the same id and firstObservedAt on repeated matches', async () => {
      store.saveMetricSnapshot(resourceId, metrics({ cpuPercent: 85 }))
      store.saveMetricSnapshot(resourceId, metrics({ cpuPercent: 88 }))
      store.saveMetricSnapshot(resourceId, metrics({ cpuPercent: 90 }))

      const [first] = detector.listAnomalies({ status: 'active', resourceId, type: 'SUSTAINED_CPU_SPIKE' })
      expect(first).toBeDefined()

      await new Promise((r) => setTimeout(r, 5))
      store.saveMetricSnapshot(resourceId, metrics({ cpuPercent: 92 }))

      const [second] = detector.listAnomalies({ status: 'active', resourceId, type: 'SUSTAINED_CPU_SPIKE' })
      expect(second.id).toBe(first.id)
      expect(second.firstObservedAt).toBe(first.firstObservedAt)
      expect(new Date(second.lastObservedAt).getTime()).toBeGreaterThanOrEqual(new Date(first.lastObservedAt).getTime())
    })
  })

  describe('auto-resolution', () => {
    it('resolves an active anomaly once its condition no longer matches', () => {
      store.saveMetricSnapshot(resourceId, metrics({ cpuPercent: 85 }))
      store.saveMetricSnapshot(resourceId, metrics({ cpuPercent: 88 }))
      store.saveMetricSnapshot(resourceId, metrics({ cpuPercent: 90 }))

      expect(detector.listAnomalies({ status: 'active', resourceId, type: 'SUSTAINED_CPU_SPIKE' })).toHaveLength(1)

      store.saveMetricSnapshot(resourceId, metrics({ cpuPercent: 20 }))

      expect(detector.listAnomalies({ status: 'active', resourceId, type: 'SUSTAINED_CPU_SPIKE' })).toHaveLength(0)
      const [resolved] = detector.listAnomalies({ status: 'resolved', resourceId, type: 'SUSTAINED_CPU_SPIKE' })
      expect(resolved.status).toBe('resolved')
      expect(resolved.resolutionReason).toBe('condition_cleared')
      expect(resolved.resolvedAt).toBeDefined()
    })
  })

  describe('manual resolution', () => {
    it('resolveAnomaly marks it resolved with reason "manual"', () => {
      store.saveMetricSnapshot(resourceId, metrics({ cpuPercent: 1, requestsPerMinute: 1, idleHours: 2 }))
      const [anomaly] = detector.listAnomalies({ status: 'active', resourceId, type: 'IDLE_RESOURCE' })
      expect(anomaly).toBeDefined()

      const resolved = detector.resolveAnomaly(anomaly.id)
      expect(resolved.status).toBe('resolved')
      expect(resolved.resolutionReason).toBe('manual')
    })

    it('a still-true condition re-opens as a NEW anomaly after manual resolution, not the old one reviving', () => {
      store.saveMetricSnapshot(resourceId, metrics({ cpuPercent: 1, requestsPerMinute: 1, idleHours: 2 }))
      const [original] = detector.listAnomalies({ status: 'active', resourceId, type: 'IDLE_RESOURCE' })
      detector.resolveAnomaly(original.id)

      // Condition is still true on the next reading.
      store.saveMetricSnapshot(resourceId, metrics({ cpuPercent: 1, requestsPerMinute: 1, idleHours: 2.1 }))

      const activeNow = detector.listAnomalies({ status: 'active', resourceId, type: 'IDLE_RESOURCE' })
      expect(activeNow).toHaveLength(1)
      expect(activeNow[0].id).not.toBe(original.id)
    })

    it('throws AnomalyNotFoundError for an unknown id', () => {
      expect(() => detector.resolveAnomaly('does-not-exist')).toThrow(AnomalyNotFoundError)
    })

    it('resolving an already-resolved anomaly is idempotent', () => {
      store.saveMetricSnapshot(resourceId, metrics({ cpuPercent: 1, requestsPerMinute: 1, idleHours: 2 }))
      const [anomaly] = detector.listAnomalies({ status: 'active', resourceId, type: 'IDLE_RESOURCE' })
      const first = detector.resolveAnomaly(anomaly.id)
      const second = detector.resolveAnomaly(anomaly.id)
      expect(second.status).toBe('resolved')
      expect(second.resolvedAt).toBe(first.resolvedAt)
    })
  })

  describe('lookups and filtering', () => {
    it('getAnomaly returns undefined for an unknown id', () => {
      expect(detector.getAnomaly('does-not-exist')).toBeUndefined()
    })

    it('listAnomalies filters by resourceId and type independently', () => {
      const [r1, r2] = store.listResources()
      store.saveMetricSnapshot(r1.id, metrics({ cpuPercent: 1, requestsPerMinute: 1, idleHours: 2 }))
      store.saveMetricSnapshot(r2.id, metrics({ errorRatePercent: 2 }))
      store.saveMetricSnapshot(r2.id, metrics({ errorRatePercent: 2 }))

      expect(detector.listAnomalies({ resourceId: r1.id })).toHaveLength(1)
      expect(detector.listAnomalies({ type: 'ELEVATED_ERROR_RATE' })).toHaveLength(1)
      expect(detector.listAnomalies({ resourceId: r1.id, type: 'ELEVATED_ERROR_RATE' })).toHaveLength(0)
    })
  })

  describe('subscribe', () => {
    it('notifies subscribers on detection and resolution', () => {
      const events: AnomalyEvent[] = []
      const unsubscribe = detector.subscribe((event) => events.push(event))

      store.saveMetricSnapshot(resourceId, metrics({ cpuPercent: 1, requestsPerMinute: 1, idleHours: 2 }))
      const [anomaly] = detector.listAnomalies({ status: 'active', resourceId })
      detector.resolveAnomaly(anomaly.id)

      unsubscribe()

      expect(events.some((e) => e.type === 'anomaly_detected')).toBe(true)
      expect(events.some((e) => e.type === 'anomaly_resolved')).toBe(true)
    })

    it('stops delivering events after unsubscribing', () => {
      const events: AnomalyEvent[] = []
      const unsubscribe = detector.subscribe((event) => events.push(event))
      unsubscribe()

      store.saveMetricSnapshot(resourceId, metrics({ cpuPercent: 1, requestsPerMinute: 1, idleHours: 2 }))
      expect(events).toHaveLength(0)
    })
  })

  describe('evaluateAll', () => {
    it('evaluates every resource in the store', () => {
      for (const resource of store.listResources()) {
        store.saveMetricSnapshot(resource.id, metrics({ cpuPercent: 1, requestsPerMinute: 1, idleHours: 2 }))
      }
      const touched = detector.evaluateAll()
      // Each idle-triggering resource should have produced at least one touched anomaly record.
      expect(touched.length).toBeGreaterThan(0)
    })
  })
})
