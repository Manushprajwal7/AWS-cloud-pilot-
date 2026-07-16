import { describe, expect, it } from 'vitest'
import {
  costSpikeRule,
  elevatedErrorRateRule,
  idleResourceRule,
  memoryLeakRule,
  overprovisionedRule,
  sustainedCpuSpikeRule,
  trafficSurgeRule,
} from './rules'
import type { MetricSnapshot, ResourceMetrics, SimulatedCloudResource } from '@/lib/simulation/types'

function baseResource(overrides: Partial<SimulatedCloudResource> = {}): SimulatedCloudResource {
  return {
    id: 'res-1',
    name: 'test-resource',
    service: 'EC2',
    environment: 'production',
    region: 'us-east-1',
    status: 'running',
    configuration: { instanceType: 'm5.large', vcpu: 2, memoryGb: 8 },
    metrics: baseMetrics(),
    cost: { hourlyUsd: 0.1, dailyUsd: 2.4, projectedMonthlyUsd: 73 },
    activeScenario: 'NORMAL',
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function baseMetrics(overrides: Partial<ResourceMetrics> = {}): ResourceMetrics {
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

function history(points: Array<Partial<ResourceMetrics> & { hourlyUsd?: number }>): MetricSnapshot[] {
  return points.map((point, i) => ({
    resourceId: 'res-1',
    timestamp: new Date(Date.now() + i * 1000).toISOString(),
    metrics: baseMetrics(point),
    cost: { hourlyUsd: point.hourlyUsd ?? 0.1, dailyUsd: (point.hourlyUsd ?? 0.1) * 24, projectedMonthlyUsd: (point.hourlyUsd ?? 0.1) * 730 },
  }))
}

describe('lib/anomalies/rules', () => {
  describe('sustained CPU spike', () => {
    it('fires when CPU stays >= 80% for the whole window', () => {
      const h = history([{ cpuPercent: 85 }, { cpuPercent: 90 }, { cpuPercent: 88 }])
      const match = sustainedCpuSpikeRule(baseResource(), h)
      expect(match?.type).toBe('SUSTAINED_CPU_SPIKE')
      expect(match?.severity).toBeDefined()
    })

    it('does not fire on a single momentary spike', () => {
      const h = history([{ cpuPercent: 20 }, { cpuPercent: 22 }, { cpuPercent: 95 }])
      expect(sustainedCpuSpikeRule(baseResource(), h)).toBeNull()
    })

    it('does not fire with insufficient history', () => {
      const h = history([{ cpuPercent: 95 }, { cpuPercent: 95 }])
      expect(sustainedCpuSpikeRule(baseResource(), h)).toBeNull()
    })

    it('does not fire under normal load', () => {
      const h = history([{ cpuPercent: 25 }, { cpuPercent: 30 }, { cpuPercent: 28 }])
      expect(sustainedCpuSpikeRule(baseResource(), h)).toBeNull()
    })
  })

  describe('idle resource', () => {
    it('fires when CPU and requests are near-zero and idleHours >= 1', () => {
      const resource = baseResource({ metrics: baseMetrics({ cpuPercent: 1, requestsPerMinute: 1, idleHours: 3 }) })
      const match = idleResourceRule(resource, [])
      expect(match?.type).toBe('IDLE_RESOURCE')
    })

    it('does not fire for an intentionally stopped resource', () => {
      const resource = baseResource({ status: 'stopped', metrics: baseMetrics({ cpuPercent: 0, requestsPerMinute: 0, idleHours: 10 }) })
      expect(idleResourceRule(resource, [])).toBeNull()
    })

    it('does not fire before idleHours has accumulated', () => {
      const resource = baseResource({ metrics: baseMetrics({ cpuPercent: 1, requestsPerMinute: 1, idleHours: 0.01 }) })
      expect(idleResourceRule(resource, [])).toBeNull()
    })

    it('does not fire when the resource is busy', () => {
      const resource = baseResource({ metrics: baseMetrics({ cpuPercent: 40, requestsPerMinute: 200, idleHours: 0 }) })
      expect(idleResourceRule(resource, [])).toBeNull()
    })
  })

  describe('memory leak', () => {
    it('fires when memory is high AND trending upward across the window', () => {
      const h = history([
        { memoryPercent: 70 },
        { memoryPercent: 76 },
        { memoryPercent: 82 },
        { memoryPercent: 88 },
        { memoryPercent: 92 },
      ])
      const match = memoryLeakRule(baseResource(), h)
      expect(match?.type).toBe('MEMORY_LEAK')
    })

    it('does not fire when memory is high but flat (not trending)', () => {
      const h = history([
        { memoryPercent: 90 },
        { memoryPercent: 91 },
        { memoryPercent: 89 },
        { memoryPercent: 90 },
        { memoryPercent: 91 },
      ])
      expect(memoryLeakRule(baseResource(), h)).toBeNull()
    })

    it('does not fire when trending up but still below threshold', () => {
      const h = history([
        { memoryPercent: 40 },
        { memoryPercent: 50 },
        { memoryPercent: 55 },
        { memoryPercent: 60 },
        { memoryPercent: 65 },
      ])
      expect(memoryLeakRule(baseResource(), h)).toBeNull()
    })
  })

  describe('overprovisioned', () => {
    it('fires when CPU and memory are both low but real traffic is present', () => {
      const h = history([
        { cpuPercent: 8, memoryPercent: 15, requestsPerMinute: 30 },
        { cpuPercent: 9, memoryPercent: 18, requestsPerMinute: 28 },
        { cpuPercent: 7, memoryPercent: 16, requestsPerMinute: 32 },
      ])
      const match = overprovisionedRule(baseResource(), h)
      expect(match?.type).toBe('OVERPROVISIONED')
    })

    it('does not fire for LAMBDA (no fixed instance size in this model)', () => {
      const h = history([
        { cpuPercent: 8, memoryPercent: 15, requestsPerMinute: 30 },
        { cpuPercent: 9, memoryPercent: 18, requestsPerMinute: 28 },
        { cpuPercent: 7, memoryPercent: 16, requestsPerMinute: 32 },
      ])
      expect(overprovisionedRule(baseResource({ service: 'LAMBDA' }), h)).toBeNull()
    })

    it('does not fire when there is essentially no traffic (that is IDLE_RESOURCE territory)', () => {
      const h = history([
        { cpuPercent: 2, memoryPercent: 10, requestsPerMinute: 1 },
        { cpuPercent: 2, memoryPercent: 10, requestsPerMinute: 1 },
        { cpuPercent: 2, memoryPercent: 10, requestsPerMinute: 1 },
      ])
      expect(overprovisionedRule(baseResource(), h)).toBeNull()
    })
  })

  describe('cost spike', () => {
    it('fires when hourly cost rises 1.5x+ over the window baseline', () => {
      const h = history([
        { hourlyUsd: 0.1 },
        { hourlyUsd: 0.1 },
        { hourlyUsd: 0.12 },
        { hourlyUsd: 0.14 },
        { hourlyUsd: 0.16 },
      ])
      const match = costSpikeRule(baseResource(), h)
      expect(match?.type).toBe('COST_SPIKE')
    })

    it('does not fire for a modest cost increase', () => {
      const h = history([
        { hourlyUsd: 0.1 },
        { hourlyUsd: 0.1 },
        { hourlyUsd: 0.1 },
        { hourlyUsd: 0.11 },
        { hourlyUsd: 0.11 },
      ])
      expect(costSpikeRule(baseResource(), h)).toBeNull()
    })
  })

  describe('traffic surge', () => {
    it('fires when requests rise 3x+ over baseline and clear the absolute floor', () => {
      const h = history([
        { requestsPerMinute: 100 },
        { requestsPerMinute: 150 },
        { requestsPerMinute: 250 },
        { requestsPerMinute: 350 },
        { requestsPerMinute: 400 },
      ])
      const match = trafficSurgeRule(baseResource(), h)
      expect(match?.type).toBe('TRAFFIC_SURGE')
    })

    it('does not fire when the ratio is high but absolute volume is tiny', () => {
      const h = history([
        { requestsPerMinute: 1 },
        { requestsPerMinute: 2 },
        { requestsPerMinute: 3 },
        { requestsPerMinute: 4 },
        { requestsPerMinute: 5 },
      ])
      expect(trafficSurgeRule(baseResource(), h)).toBeNull()
    })
  })

  describe('elevated error rate', () => {
    it('fires when error rate stays >= 1% for the window', () => {
      const h = history([{ errorRatePercent: 1.2 }, { errorRatePercent: 1.5 }])
      const match = elevatedErrorRateRule(baseResource(), h)
      expect(match?.type).toBe('ELEVATED_ERROR_RATE')
    })

    it('does not fire on a single transient blip', () => {
      const h = history([{ errorRatePercent: 0.1 }, { errorRatePercent: 2.5 }])
      expect(elevatedErrorRateRule(baseResource(), h)).toBeNull()
    })
  })
})
