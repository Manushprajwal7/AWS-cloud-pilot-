import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { createTickEngine } from './tick-engine'
import { createSimulationStore, InvalidScenarioError, SimulationResourceNotFoundError } from './simulation-store'
import type { SimulationStore } from './simulation-store'

function fixedRandom(value: number) {
  return () => value
}

describe('lib/simulation/tick-engine', () => {
  let store: SimulationStore

  beforeEach(() => {
    store = createSimulationStore()
  })

  describe('start and stop behaviour', () => {
    it('is not running until start() is called', () => {
      const engine = createTickEngine(store, { random: fixedRandom(0.5) })
      expect(engine.isRunning()).toBe(false);
    })

    it('start() then real timers advance ticks; stop() halts them', () => {
      vi.useFakeTimers()
      try {
        const engine = createTickEngine(store, { tickIntervalMs: 1000, random: fixedRandom(0.5) })
        const [resource] = store.listResources()

        engine.start()
        expect(engine.isRunning()).toBe(true)

        vi.advanceTimersByTime(3500)
        expect(engine.getTickCount()).toBe(3)
        const historyAfterStart = store.getMetricHistory(resource.id).length

        engine.stop()
        expect(engine.isRunning()).toBe(false)

        vi.advanceTimersByTime(5000)
        expect(engine.getTickCount()).toBe(3)
        expect(store.getMetricHistory(resource.id).length).toBe(historyAfterStart)
      } finally {
        vi.useRealTimers()
      }
    })

    it('calling start() twice does not create duplicate timers', () => {
      vi.useFakeTimers()
      try {
        const engine = createTickEngine(store, { tickIntervalMs: 1000, random: fixedRandom(0.5) })
        engine.start()
        engine.start()

        vi.advanceTimersByTime(2000)
        expect(engine.getTickCount()).toBe(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it('calling stop() when not running is a no-op', () => {
      const engine = createTickEngine(store)
      expect(() => engine.stop()).not.toThrow()
      expect(engine.isRunning()).toBe(false)
    })
  })

  describe('tick progression', () => {
    it('manual tick() advances every resource and records history', () => {
      const engine = createTickEngine(store, { tickIntervalMs: 5000, random: fixedRandom(0.5) })
      const resources = store.listResources()

      engine.tick()

      for (const resource of resources) {
        expect(store.getMetricHistory(resource.id)).toHaveLength(1)
      }
      expect(engine.getTickCount()).toBe(1)
    })

    it('repeated ticks accumulate history per resource', () => {
      const engine = createTickEngine(store, { tickIntervalMs: 5000, random: fixedRandom(0.5) })
      const [resource] = store.listResources()

      for (let i = 0; i < 5; i++) engine.tick()

      expect(store.getMetricHistory(resource.id)).toHaveLength(5)
      expect(engine.getTickCount()).toBe(5)
    })
  })

  describe('setResourceScenario (progressive, not instant)', () => {
    it('updates activeScenario/status immediately but leaves metrics for ticks to carry', () => {
      const engine = createTickEngine(store, { tickIntervalMs: 5000, random: fixedRandom(0.5) })
      const [resource] = store.listResources()
      const originalCpu = resource.metrics.cpuPercent

      const updated = engine.setResourceScenario(resource.id, 'CPU_SPIKE')
      expect(updated.activeScenario).toBe('CPU_SPIKE')
      expect(updated.status).toBe('degraded')
      // Metrics haven't moved yet — that's the tick engine's job, not this call's.
      expect(updated.metrics.cpuPercent).toBe(originalCpu)
    })

    it('subsequent ticks ramp the resource toward the new scenario target', () => {
      const engine = createTickEngine(store, { tickIntervalMs: 5000, random: fixedRandom(0.5) })
      const [resource] = store.listResources()

      engine.setResourceScenario(resource.id, 'CPU_SPIKE')
      for (let i = 0; i < 10; i++) engine.tick()

      const after = store.getResource(resource.id)!
      expect(after.metrics.cpuPercent).toBeGreaterThan(80)
    })

    it('throws InvalidScenarioError for a bad scenario value', () => {
      const engine = createTickEngine(store)
      const [resource] = store.listResources()
      // @ts-expect-error deliberately invalid
      expect(() => engine.setResourceScenario(resource.id, 'NOT_REAL')).toThrow(InvalidScenarioError)
    })

    it('throws SimulationResourceNotFoundError for an unknown resource id', () => {
      const engine = createTickEngine(store)
      expect(() => engine.setResourceScenario('ghost', 'CPU_SPIKE')).toThrow(SimulationResourceNotFoundError)
    })
  })

  describe('tick interval configuration', () => {
    it('setTickIntervalMs changes the interval used by subsequent start()s', () => {
      vi.useFakeTimers()
      try {
        const engine = createTickEngine(store, { tickIntervalMs: 1000, random: fixedRandom(0.5) })
        engine.setTickIntervalMs(2000)
        expect(engine.getTickIntervalMs()).toBe(2000)

        engine.start()
        vi.advanceTimersByTime(1999)
        expect(engine.getTickCount()).toBe(0)
        vi.advanceTimersByTime(1)
        expect(engine.getTickCount()).toBe(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('rejects a non-positive tick interval', () => {
      const engine = createTickEngine(store)
      expect(() => engine.setTickIntervalMs(0)).toThrow(RangeError)
      expect(() => engine.setTickIntervalMs(-100)).toThrow(RangeError)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })
})
