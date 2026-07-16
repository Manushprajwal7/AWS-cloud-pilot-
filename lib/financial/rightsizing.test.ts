import { describe, expect, it } from 'vitest'
import {
  calculateExpectedPostRemediationCost,
  calculateScheduledShutdownSavings,
  recommendRightsizing,
  recommendScaleIn,
} from './rightsizing'
import type { SimulatedCloudResource } from '@/lib/simulation/types'

function makeResource(overrides: Partial<SimulatedCloudResource> = {}): SimulatedCloudResource {
  return {
    id: 'res-1',
    name: 'test',
    service: 'EC2',
    environment: 'production',
    region: 'us-east-1',
    status: 'running',
    configuration: { instanceType: 'm5.xlarge', vcpu: 4, memoryGb: 16 },
    metrics: {
      cpuPercent: 8,
      memoryPercent: 15,
      networkInMb: 1,
      networkOutMb: 1,
      requestsPerMinute: 20,
      latencyMs: 20,
      errorRatePercent: 0,
      idleHours: 0,
    },
    cost: { hourlyUsd: 0.192, dailyUsd: 4.608, projectedMonthlyUsd: 140.16 },
    activeScenario: 'OVERPROVISIONED',
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('lib/financial/rightsizing', () => {
  describe('recommendRightsizing', () => {
    it('recommends stepping down one size when utilization is low', () => {
      const rec = recommendRightsizing(makeResource())
      expect(rec?.recommendedInstanceType).toBe('m5.large')
      expect(rec?.monthlySavings).toBeGreaterThan(0)
      expect(rec?.projectedCost.monthlyUsd).toBeLessThan(rec!.currentCost.monthlyUsd)
    })

    it('returns null when utilization does not support downsizing', () => {
      const resource = makeResource({ metrics: { ...makeResource().metrics, cpuPercent: 60, memoryPercent: 70 } })
      expect(recommendRightsizing(resource)).toBeNull()
    })

    it('returns null when already at the smallest known size', () => {
      const resource = makeResource({ configuration: { instanceType: 't3.small' } })
      expect(recommendRightsizing(resource)).toBeNull()
    })

    it('returns null for a service with no known size order', () => {
      const resource = makeResource({ service: 'LAMBDA', configuration: { memoryGb: 0.5 } })
      expect(recommendRightsizing(resource)).toBeNull()
    })
  })

  describe('calculateScheduledShutdownSavings', () => {
    it('savings scale with off-hours per day', () => {
      const resource = makeResource()
      const twelve = calculateScheduledShutdownSavings(resource, 12)
      const twentyFour = calculateScheduledShutdownSavings(resource, 24)
      expect(twentyFour.monthlySavings).toBeGreaterThan(twelve.monthlySavings)
    })

    it('projected cost never goes negative', () => {
      const resource = makeResource()
      const result = calculateScheduledShutdownSavings(resource, 24)
      expect(result.projectedCost.monthlyUsd).toBeGreaterThanOrEqual(0)
    })
  })

  describe('recommendScaleIn', () => {
    it('recommends one fewer task for an underutilized ECS service', () => {
      const resource = makeResource({
        service: 'ECS',
        configuration: { desiredCapacity: 4, minCapacity: 2, maxCapacity: 8, vcpu: 1, memoryGb: 2 },
      })
      const rec = recommendScaleIn(resource)
      expect(rec?.recommendedCapacity).toBe(3)
      expect(rec?.monthlySavings).toBeGreaterThan(0)
    })

    it('never recommends going below minCapacity', () => {
      const resource = makeResource({
        service: 'ECS',
        configuration: { desiredCapacity: 2, minCapacity: 2, maxCapacity: 8, vcpu: 1, memoryGb: 2 },
      })
      expect(recommendScaleIn(resource)).toBeNull()
    })

    it('returns null for non-ECS services', () => {
      expect(recommendScaleIn(makeResource())).toBeNull()
    })
  })

  describe('calculateExpectedPostRemediationCost', () => {
    it('STOP results in zero cost', () => {
      expect(calculateExpectedPostRemediationCost(makeResource(), 'STOP')).toBe(0)
    })

    it('RIGHTSIZE matches recommendRightsizing\'s projected cost', () => {
      const resource = makeResource()
      const rec = recommendRightsizing(resource)!
      expect(calculateExpectedPostRemediationCost(resource, 'RIGHTSIZE')).toBe(rec.projectedCost.monthlyUsd)
    })

    it('NO_ACTION and SCALE_OUT return the current cost unchanged', () => {
      const resource = makeResource()
      expect(calculateExpectedPostRemediationCost(resource, 'NO_ACTION')).toBe(resource.cost.projectedMonthlyUsd)
      expect(calculateExpectedPostRemediationCost(resource, 'SCALE_OUT')).toBe(resource.cost.projectedMonthlyUsd)
    })
  })
})
