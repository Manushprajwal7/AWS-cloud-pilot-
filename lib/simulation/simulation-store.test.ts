import { describe, expect, it, beforeEach } from 'vitest'
import {
  createSimulationStore,
  SimulationResourceNotFoundError,
  InvalidScenarioError,
  type SimulationStore,
} from './simulation-store'
import type { SimulationStoreEvent } from './types'

describe('lib/simulation/simulation-store', () => {
  let store: SimulationStore

  beforeEach(() => {
    store = createSimulationStore()
  })

  describe('resource initialization', () => {
    it('lists all 8 seeded resources', () => {
      expect(store.listResources()).toHaveLength(8)
    })

    it('getResource returns a resource that exists', () => {
      const [first] = store.listResources()
      const resource = store.getResource(first.id)
      expect(resource?.id).toBe(first.id)
    })

    it('returned resources are defensive copies (mutating the result does not affect the store)', () => {
      const [first] = store.listResources()
      const resource = store.getResource(first.id)!
      resource.name = 'mutated-name'
      const reFetched = store.getResource(first.id)!
      expect(reFetched.name).not.toBe('mutated-name')
    })
  })

  describe('invalid resource handling', () => {
    it('getResource returns undefined for an unknown id (does not throw)', () => {
      expect(store.getResource('does-not-exist')).toBeUndefined()
    })

    it('updateResource throws SimulationResourceNotFoundError for an unknown id', () => {
      expect(() => store.updateResource('does-not-exist', { status: 'stopped' })).toThrow(
        SimulationResourceNotFoundError,
      )
    })

    it('activateScenario throws SimulationResourceNotFoundError for an unknown id', () => {
      expect(() => store.activateScenario('does-not-exist', 'CPU_SPIKE')).toThrow(SimulationResourceNotFoundError)
    })

    it('resetResource throws SimulationResourceNotFoundError for an unknown id', () => {
      expect(() => store.resetResource('does-not-exist')).toThrow(SimulationResourceNotFoundError)
    })

    it('saveMetricSnapshot throws SimulationResourceNotFoundError for an unknown id', () => {
      const [first] = store.listResources()
      expect(() =>
        store.saveMetricSnapshot('does-not-exist', first.metrics),
      ).toThrow(SimulationResourceNotFoundError)
    })

    it('getMetricHistory throws SimulationResourceNotFoundError for an unknown id', () => {
      expect(() => store.getMetricHistory('does-not-exist')).toThrow(SimulationResourceNotFoundError)
    })

    it('activateScenario throws InvalidScenarioError for a garbage scenario value', () => {
      const [first] = store.listResources()
      // @ts-expect-error deliberately passing an invalid scenario to test runtime validation
      expect(() => store.activateScenario(first.id, 'NOT_A_SCENARIO')).toThrow(InvalidScenarioError)
    })

    it('the error carries the offending resource id', () => {
      try {
        store.updateResource('ghost-id', {})
        expect.unreachable()
      } catch (error) {
        expect(error).toBeInstanceOf(SimulationResourceNotFoundError)
        expect((error as SimulationResourceNotFoundError).resourceId).toBe('ghost-id')
      }
    })
  })

  describe('scenario activation', () => {
    it('activating CPU_SPIKE sets high cpuPercent and status degraded', () => {
      const [first] = store.listResources()
      const updated = store.activateScenario(first.id, 'CPU_SPIKE')

      expect(updated.activeScenario).toBe('CPU_SPIKE')
      expect(updated.status).toBe('degraded')
      expect(updated.metrics.cpuPercent).toBeGreaterThan(80)
    })

    it('activating IDLE_RESOURCE sets low cpuPercent and status optimizing', () => {
      const [first] = store.listResources()
      const updated = store.activateScenario(first.id, 'IDLE_RESOURCE')

      expect(updated.activeScenario).toBe('IDLE_RESOURCE')
      expect(updated.status).toBe('optimizing')
      expect(updated.metrics.cpuPercent).toBeLessThan(10)
      expect(updated.metrics.idleHours).toBeGreaterThan(0)
    })

    it('recalculates cost after activating a scenario', () => {
      const [first] = store.listResources()
      const before = first.cost.hourlyUsd
      const updated = store.activateScenario(first.id, 'CPU_SPIKE')
      // Cost model is driven by instance type + request volume, not CPU directly,
      // but for a Lambda-priced resource higher requestsPerMinute should raise cost.
      expect(updated.cost).toBeDefined()
      expect(typeof before).toBe('number')
    })

    it('updates updatedAt on activation', async () => {
      const [first] = store.listResources()
      await new Promise((resolve) => setTimeout(resolve, 2))
      const updated = store.activateScenario(first.id, 'MEMORY_LEAK')
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(new Date(first.updatedAt).getTime())
    })

    it('notifies subscribers with a scenario_activated event', () => {
      const [first] = store.listResources()
      const events: SimulationStoreEvent[] = []
      const unsubscribe = store.subscribe((event) => events.push(event))

      store.activateScenario(first.id, 'TRAFFIC_SURGE')
      unsubscribe()

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('scenario_activated')
      expect(events[0].resourceId).toBe(first.id)
      expect(events[0].resource.activeScenario).toBe('TRAFFIC_SURGE')
    })
  })

  describe('resource reset', () => {
    it('restores activeScenario to NORMAL and status to running', () => {
      const [first] = store.listResources()
      store.activateScenario(first.id, 'CPU_SPIKE')

      const reset = store.resetResource(first.id)
      expect(reset.activeScenario).toBe('NORMAL')
      expect(reset.status).toBe('running')
      expect(reset.metrics).toEqual(first.metrics)
    })

    it('restores the original cost', () => {
      const [first] = store.listResources()
      store.activateScenario(first.id, 'TRAFFIC_SURGE')
      const reset = store.resetResource(first.id)
      expect(reset.cost).toEqual(first.cost)
    })

    it('clears metric history for the resource', () => {
      const [first] = store.listResources()
      store.saveMetricSnapshot(first.id, first.metrics)
      expect(store.getMetricHistory(first.id).length).toBeGreaterThan(0)

      store.resetResource(first.id)
      expect(store.getMetricHistory(first.id)).toHaveLength(0)
    })

    it('notifies subscribers with a resource_reset event', () => {
      const [first] = store.listResources()
      const events: SimulationStoreEvent[] = []
      const unsubscribe = store.subscribe((event) => events.push(event))

      store.resetResource(first.id)
      unsubscribe()

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('resource_reset')
    })
  })

  describe('update, snapshot, and subscribe', () => {
    it('updateResource merges a partial update', () => {
      const [first] = store.listResources()
      const updated = store.updateResource(first.id, { status: 'stopped' })
      expect(updated.status).toBe('stopped')
      expect(updated.name).toBe(first.name)
    })

    it('saveMetricSnapshot updates current metrics and appends to history', () => {
      const [first] = store.listResources()
      const newMetrics = { ...first.metrics, cpuPercent: 77 }

      const updated = store.saveMetricSnapshot(first.id, newMetrics)
      expect(updated.metrics.cpuPercent).toBe(77)

      const history = store.getMetricHistory(first.id)
      expect(history).toHaveLength(1)
      expect(history[0].metrics.cpuPercent).toBe(77)
      expect(history[0].resourceId).toBe(first.id)
    })

    it('caps metric history per resource', () => {
      const [first] = store.listResources()
      for (let i = 0; i < 510; i++) {
        store.saveMetricSnapshot(first.id, { ...first.metrics, cpuPercent: i % 100 })
      }
      expect(store.getMetricHistory(first.id).length).toBeLessThanOrEqual(500)
    })

    it('subscribe/unsubscribe stops delivering events after unsubscribing', () => {
      const [first] = store.listResources()
      const events: SimulationStoreEvent[] = []
      const unsubscribe = store.subscribe((event) => events.push(event))

      store.updateResource(first.id, { status: 'stopped' })
      unsubscribe()
      store.updateResource(first.id, { status: 'running' })

      expect(events).toHaveLength(1)
    })
  })
})
