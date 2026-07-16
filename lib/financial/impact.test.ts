import { describe, expect, it } from 'vitest'
import { calculateAggregateWaste, calculateAnomalyFinancialImpact } from './impact'
import type { Anomaly } from '@/lib/anomalies/types'
import type { SimulatedCloudResource } from '@/lib/simulation/types'

function makeResource(hourlyUsd: number): SimulatedCloudResource {
  return {
    id: 'res-1',
    name: 'test',
    service: 'EC2',
    environment: 'production',
    region: 'us-east-1',
    status: 'running',
    configuration: { instanceType: 'm5.large' },
    metrics: {
      cpuPercent: 1,
      memoryPercent: 10,
      networkInMb: 0,
      networkOutMb: 0,
      requestsPerMinute: 1,
      latencyMs: 5,
      errorRatePercent: 0,
      idleHours: 5,
    },
    cost: { hourlyUsd, dailyUsd: hourlyUsd * 24, projectedMonthlyUsd: hourlyUsd * 730 },
    activeScenario: 'IDLE_RESOURCE',
    updatedAt: new Date().toISOString(),
  }
}

function makeAnomaly(type: Anomaly['type']): Anomaly {
  const now = new Date().toISOString()
  return {
    id: 'anomaly-1',
    resourceId: 'res-1',
    type,
    severity: 'medium',
    confidence: 0.7,
    evidence: [],
    detectedAt: now,
    firstObservedAt: now,
    lastObservedAt: now,
    status: 'active',
  }
}

describe('lib/financial/impact', () => {
  it('IDLE_RESOURCE waste equals the full current hourly cost', () => {
    const resource = makeResource(0.5)
    const impact = calculateAnomalyFinancialImpact(makeAnomaly('IDLE_RESOURCE'), resource)
    expect(impact?.wasteFraction).toBe(1)
    expect(impact?.estimatedWaste.hourlyUsd).toBeCloseTo(0.5, 4)
  })

  it('OVERPROVISIONED waste is a partial fraction of current cost', () => {
    const resource = makeResource(1)
    const impact = calculateAnomalyFinancialImpact(makeAnomaly('OVERPROVISIONED'), resource)
    expect(impact?.wasteFraction).toBeGreaterThan(0)
    expect(impact?.wasteFraction).toBeLessThan(1)
    expect(impact?.estimatedWaste.hourlyUsd).toBeLessThan(resource.cost.hourlyUsd)
  })

  it('returns null for anomaly types with no defined waste interpretation', () => {
    const resource = makeResource(1)
    expect(calculateAnomalyFinancialImpact(makeAnomaly('SUSTAINED_CPU_SPIKE'), resource)).toBeNull()
    expect(calculateAnomalyFinancialImpact(makeAnomaly('MEMORY_LEAK'), resource)).toBeNull()
    expect(calculateAnomalyFinancialImpact(makeAnomaly('TRAFFIC_SURGE'), resource)).toBeNull()
    expect(calculateAnomalyFinancialImpact(makeAnomaly('ELEVATED_ERROR_RATE'), resource)).toBeNull()
  })

  it('calculateAggregateWaste sums multiple impacts into one breakdown', () => {
    const resource = makeResource(1)
    const a = calculateAnomalyFinancialImpact(makeAnomaly('IDLE_RESOURCE'), resource)!
    const b = calculateAnomalyFinancialImpact(makeAnomaly('OVERPROVISIONED'), { ...resource, id: 'res-2' })!
    const aggregate = calculateAggregateWaste([a, b])
    expect(aggregate.hourlyUsd).toBeCloseTo(a.estimatedWaste.hourlyUsd + b.estimatedWaste.hourlyUsd, 4)
  })

  it('calculateAggregateWaste returns zero for an empty list', () => {
    expect(calculateAggregateWaste([])).toEqual({ hourlyUsd: 0, dailyUsd: 0, monthlyUsd: 0, annualUsd: 0 })
  })
})
