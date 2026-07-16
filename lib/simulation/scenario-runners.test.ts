import { describe, expect, it } from 'vitest'
import { stepResourceMetrics } from './scenario-runners'
import { SCENARIO_DEFINITIONS } from './scenarios'
import type { ResourceMetrics } from './types'

function fixedRandom(value: number) {
  return () => value
}

const BASELINE: ResourceMetrics = {
  cpuPercent: 25,
  memoryPercent: 40,
  networkInMb: 5,
  networkOutMb: 3,
  requestsPerMinute: 120,
  latencyMs: 45,
  errorRatePercent: 0.1,
  idleHours: 0,
}

function tickN(
  current: ResourceMetrics,
  scenario: keyof typeof SCENARIO_DEFINITIONS,
  n: number,
  tickIntervalMs = 5000,
): ResourceMetrics {
  let metrics = current
  for (let i = 0; i < n; i++) {
    metrics = stepResourceMetrics(metrics, scenario, { random: fixedRandom(0.5), tickIntervalMs })
  }
  return metrics
}

describe('lib/simulation/scenario-runners', () => {
  describe('tick progression', () => {
    it('is deterministic given a fixed random source', () => {
      const a = stepResourceMetrics(BASELINE, 'CPU_SPIKE', { random: fixedRandom(0.5), tickIntervalMs: 5000 })
      const b = stepResourceMetrics(BASELINE, 'CPU_SPIKE', { random: fixedRandom(0.5), tickIntervalMs: 5000 })
      expect(a).toEqual(b)
    })

    it('moves metrics toward the scenario target rather than snapping to it in one tick', () => {
      const target = SCENARIO_DEFINITIONS.CPU_SPIKE.targetMetrics.cpuPercent
      const afterOneTick = stepResourceMetrics(BASELINE, 'CPU_SPIKE', { random: fixedRandom(0.5), tickIntervalMs: 5000 })

      expect(afterOneTick.cpuPercent).toBeGreaterThan(BASELINE.cpuPercent)
      expect(afterOneTick.cpuPercent).toBeLessThan(target)
    })
  })

  describe('CPU spike behaviour', () => {
    it('cpuPercent converges toward the CPU_SPIKE target over several ticks', () => {
      const target = SCENARIO_DEFINITIONS.CPU_SPIKE.targetMetrics.cpuPercent
      const after10 = tickN(BASELINE, 'CPU_SPIKE', 10)
      expect(after10.cpuPercent).toBeGreaterThan(80)
      expect(after10.cpuPercent).toBeCloseTo(target, -1)
    })

    it('each tick moves cpuPercent monotonically closer to the target while ramping up', () => {
      let metrics = BASELINE
      let previousDistance = Math.abs(SCENARIO_DEFINITIONS.CPU_SPIKE.targetMetrics.cpuPercent - metrics.cpuPercent)

      for (let i = 0; i < 8; i++) {
        metrics = stepResourceMetrics(metrics, 'CPU_SPIKE', { random: fixedRandom(0.5), tickIntervalMs: 5000 })
        const distance = Math.abs(SCENARIO_DEFINITIONS.CPU_SPIKE.targetMetrics.cpuPercent - metrics.cpuPercent)
        expect(distance).toBeLessThanOrEqual(previousDistance)
        previousDistance = distance
      }
    })
  })

  describe('idle-hour accumulation', () => {
    it('idleHours increases each tick while IDLE_RESOURCE is active', () => {
      const tickIntervalMs = 3_600_000 // 1 hour per tick, for an easy-to-read assertion
      const first = stepResourceMetrics(BASELINE, 'IDLE_RESOURCE', { random: fixedRandom(0.5), tickIntervalMs })
      const second = stepResourceMetrics(first, 'IDLE_RESOURCE', { random: fixedRandom(0.5), tickIntervalMs })

      expect(first.idleHours).toBeCloseTo(1, 1)
      expect(second.idleHours).toBeCloseTo(2, 1)
      expect(second.idleHours).toBeGreaterThan(first.idleHours)
    })

    it('idleHours decreases back toward 0 once the scenario is no longer idle-like', () => {
      const idle = tickN(BASELINE, 'IDLE_RESOURCE', 5, 3_600_000)
      expect(idle.idleHours).toBeGreaterThan(0)

      const recovered = stepResourceMetrics(idle, 'NORMAL', { random: fixedRandom(0.5), tickIntervalMs: 3_600_000 })
      expect(recovered.idleHours).toBeLessThan(idle.idleHours)
    })
  })

  describe('memory leak growth', () => {
    it('memoryPercent climbs slowly across ticks and stays below the 100% ceiling', () => {
      const target = SCENARIO_DEFINITIONS.MEMORY_LEAK.targetMetrics.memoryPercent
      const after1 = stepResourceMetrics(BASELINE, 'MEMORY_LEAK', { random: fixedRandom(0.5), tickIntervalMs: 5000 })
      const after30 = tickN(BASELINE, 'MEMORY_LEAK', 30)
      const after80 = tickN(BASELINE, 'MEMORY_LEAK', 80)

      // Slow approach rate: one tick should move only modestly, not most of the way there.
      expect(after1.memoryPercent).toBeGreaterThan(BASELINE.memoryPercent)
      expect(after1.memoryPercent).toBeLessThan(BASELINE.memoryPercent + 10)

      // Monotonic progress toward the target the longer the leak runs.
      expect(after30.memoryPercent).toBeGreaterThan(after1.memoryPercent)
      expect(after80.memoryPercent).toBeGreaterThan(after30.memoryPercent)
      expect(after80.memoryPercent).toBeCloseTo(target, -1)
      expect(after80.memoryPercent).toBeLessThanOrEqual(99)
    })

    it('never exceeds 100% even under many ticks with maximal jitter', () => {
      let metrics = { ...BASELINE, memoryPercent: 98 }
      for (let i = 0; i < 200; i++) {
        metrics = stepResourceMetrics(metrics, 'MEMORY_LEAK', { random: fixedRandom(1), tickIntervalMs: 5000 })
        expect(metrics.memoryPercent).toBeLessThanOrEqual(100)
      }
    })
  })

  describe('scenario recovery', () => {
    it('metrics return toward the NORMAL baseline after a scenario is switched back to NORMAL', () => {
      const spiked = tickN(BASELINE, 'CPU_SPIKE', 15)
      expect(spiked.cpuPercent).toBeGreaterThan(80)

      const recovering = tickN(spiked, 'NORMAL', 15)
      expect(recovering.cpuPercent).toBeLessThan(spiked.cpuPercent)
      expect(recovering.cpuPercent).toBeCloseTo(SCENARIO_DEFINITIONS.NORMAL.targetMetrics.cpuPercent, -1)
    })

    it('recovery is gradual, not instantaneous', () => {
      const spiked = tickN(BASELINE, 'TRAFFIC_SURGE', 15)
      const afterOneRecoveryTick = stepResourceMetrics(spiked, 'NORMAL', { random: fixedRandom(0.5), tickIntervalMs: 5000 })

      expect(afterOneRecoveryTick.requestsPerMinute).toBeLessThan(spiked.requestsPerMinute)
      expect(afterOneRecoveryTick.requestsPerMinute).toBeGreaterThan(
        SCENARIO_DEFINITIONS.NORMAL.targetMetrics.requestsPerMinute,
      )
    })
  })

  describe('maximum metric bounds', () => {
    it('percentage fields never leave [0, 100] across any scenario under extreme jitter, in either direction', () => {
      const scenarios = Object.keys(SCENARIO_DEFINITIONS) as Array<keyof typeof SCENARIO_DEFINITIONS>

      for (const scenario of scenarios) {
        let metrics = BASELINE
        for (let i = 0; i < 100; i++) {
          const random = i % 2 === 0 ? fixedRandom(0) : fixedRandom(1)
          metrics = stepResourceMetrics(metrics, scenario, { random, tickIntervalMs: 5000 })
          expect(metrics.cpuPercent).toBeGreaterThanOrEqual(0)
          expect(metrics.cpuPercent).toBeLessThanOrEqual(100)
          expect(metrics.memoryPercent).toBeGreaterThanOrEqual(0)
          expect(metrics.memoryPercent).toBeLessThanOrEqual(100)
          expect(metrics.errorRatePercent).toBeGreaterThanOrEqual(0)
          expect(metrics.errorRatePercent).toBeLessThanOrEqual(100)
        }
      }
    })

    it('non-percentage fields never go negative', () => {
      let metrics = BASELINE
      for (let i = 0; i < 50; i++) {
        metrics = stepResourceMetrics(metrics, 'IDLE_RESOURCE', { random: fixedRandom(0), tickIntervalMs: 5000 })
        expect(metrics.networkInMb).toBeGreaterThanOrEqual(0)
        expect(metrics.networkOutMb).toBeGreaterThanOrEqual(0)
        expect(metrics.requestsPerMinute).toBeGreaterThanOrEqual(0)
        expect(metrics.latencyMs).toBeGreaterThanOrEqual(0)
        expect(metrics.idleHours).toBeGreaterThanOrEqual(0)
      }
    })
  })
})
