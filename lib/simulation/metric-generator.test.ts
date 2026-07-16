import { describe, expect, it } from 'vitest'
import { generateMetrics } from './metric-generator'
import { SCENARIO_DEFINITIONS } from './scenarios'

// A deterministic "random" source for reproducible tests.
function fixedRandom(value: number) {
  return () => value
}

describe('lib/simulation/metric-generator', () => {
  it('is deterministic given a fixed random source', () => {
    const a = generateMetrics('NORMAL', { random: fixedRandom(0.5) })
    const b = generateMetrics('NORMAL', { random: fixedRandom(0.5) })
    expect(a).toEqual(b)
  })

  it('varies output when the random source varies', () => {
    const a = generateMetrics('NORMAL', { random: fixedRandom(0) })
    const b = generateMetrics('NORMAL', { random: fixedRandom(1) })
    expect(a.cpuPercent).not.toBe(b.cpuPercent)
  })

  it('clamps percentage fields to [0, 100] even under maximum jitter', () => {
    const high = generateMetrics('CPU_SPIKE', { random: fixedRandom(1) })
    const low = generateMetrics('CPU_SPIKE', { random: fixedRandom(0) })
    for (const m of [high, low]) {
      expect(m.cpuPercent).toBeGreaterThanOrEqual(0)
      expect(m.cpuPercent).toBeLessThanOrEqual(100)
      expect(m.memoryPercent).toBeGreaterThanOrEqual(0)
      expect(m.memoryPercent).toBeLessThanOrEqual(100)
    }
  })

  it('never produces negative network, request, or latency values', () => {
    const metrics = generateMetrics('IDLE_RESOURCE', { random: fixedRandom(0) })
    expect(metrics.networkInMb).toBeGreaterThanOrEqual(0)
    expect(metrics.networkOutMb).toBeGreaterThanOrEqual(0)
    expect(metrics.requestsPerMinute).toBeGreaterThanOrEqual(0)
    expect(metrics.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('produces cpuPercent close to the scenario target for CPU_SPIKE', () => {
    const metrics = generateMetrics('CPU_SPIKE', { random: fixedRandom(0.5) })
    const target = SCENARIO_DEFINITIONS.CPU_SPIKE.targetMetrics.cpuPercent
    expect(metrics.cpuPercent).toBeCloseTo(target, 0)
  })

  it('keeps idleHours at 0 for non-idle scenarios', () => {
    const metrics = generateMetrics('CPU_SPIKE', { random: fixedRandom(0.5) })
    expect(metrics.idleHours).toBe(0)
  })

  it('accumulates idleHours from previousMetrics instead of resetting it for IDLE_RESOURCE', () => {
    const first = generateMetrics('IDLE_RESOURCE', { random: fixedRandom(0.5) })
    const second = generateMetrics('IDLE_RESOURCE', {
      random: fixedRandom(0.5),
      previousMetrics: { ...first, idleHours: 10 },
    })
    expect(second.idleHours).toBeGreaterThanOrEqual(10)
  })
})
