import { describe, expect, it } from 'vitest'
import {
  calculateExpectedPostRemediationCost,
  calculateScheduledShutdownSavings,
  isRemediationFeasible,
  recommendRightsizing,
  recommendScaleIn,
  recommendScaleOut,
} from './rightsizing'
import { calculateCost } from '@/lib/simulation/resources'
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

  function makeScalableEcsResource(overrides: Partial<SimulatedCloudResource> = {}): SimulatedCloudResource {
    const configuration = { desiredCapacity: 2, minCapacity: 1, maxCapacity: 5, vcpu: 1, memoryGb: 2 }
    const metrics = { ...makeResource().metrics, cpuPercent: 92, ...overrides.metrics }
    const hourlyUsd = calculateCost('ECS', configuration, metrics).hourlyUsd
    return makeResource({
      service: 'ECS',
      configuration,
      metrics,
      cost: { hourlyUsd, dailyUsd: hourlyUsd * 24, projectedMonthlyUsd: hourlyUsd * 730 },
      ...overrides,
    })
  }

  describe('recommendScaleOut', () => {
    it('recommends one more task for a high-CPU ECS service with headroom', () => {
      const resource = makeScalableEcsResource()
      const rec = recommendScaleOut(resource)
      expect(rec?.recommendedCapacity).toBe(3)
      expect(rec?.projectedCost.monthlyUsd).toBeGreaterThan(rec!.currentCost.monthlyUsd)
    })

    it('never recommends going above maxCapacity', () => {
      const resource = makeResource({
        service: 'ECS',
        configuration: { desiredCapacity: 5, minCapacity: 1, maxCapacity: 5, vcpu: 1, memoryGb: 2 },
        metrics: { ...makeResource().metrics, cpuPercent: 92 },
      })
      expect(recommendScaleOut(resource)).toBeNull()
    })

    it('returns null when CPU is not high enough to justify scaling out', () => {
      const resource = makeResource({
        service: 'ECS',
        configuration: { desiredCapacity: 2, minCapacity: 1, maxCapacity: 5, vcpu: 1, memoryGb: 2 },
      })
      expect(recommendScaleOut(resource)).toBeNull()
    })

    it('returns null for non-ECS services', () => {
      const resource = makeResource({ metrics: { ...makeResource().metrics, cpuPercent: 92 } })
      expect(recommendScaleOut(resource)).toBeNull()
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

    it('NO_ACTION returns the current cost unchanged', () => {
      const resource = makeResource()
      expect(calculateExpectedPostRemediationCost(resource, 'NO_ACTION')).toBe(resource.cost.projectedMonthlyUsd)
    })

    it('SCALE_OUT falls back to the current cost when no recommendation applies, and costs more when it does', () => {
      const resource = makeResource()
      expect(calculateExpectedPostRemediationCost(resource, 'SCALE_OUT')).toBe(resource.cost.projectedMonthlyUsd)

      const scalable = makeScalableEcsResource()
      const rec = recommendScaleOut(scalable)!
      expect(calculateExpectedPostRemediationCost(scalable, 'SCALE_OUT')).toBe(rec.projectedCost.monthlyUsd)
      expect(rec.projectedCost.monthlyUsd).toBeGreaterThan(scalable.cost.projectedMonthlyUsd)
    })
  })

  describe('isRemediationFeasible', () => {
    it('RIGHTSIZE is feasible only when recommendRightsizing returns a recommendation', () => {
      expect(isRemediationFeasible(makeResource(), 'RIGHTSIZE')).toBe(true)
      const highCpu = makeResource({ metrics: { ...makeResource().metrics, cpuPercent: 91 } })
      expect(isRemediationFeasible(highCpu, 'RIGHTSIZE')).toBe(false)
    })

    it('SCALE_IN is feasible only when recommendScaleIn returns a recommendation', () => {
      const scalable = makeResource({
        service: 'ECS',
        configuration: { desiredCapacity: 4, minCapacity: 2, maxCapacity: 8, vcpu: 1, memoryGb: 2 },
      })
      expect(isRemediationFeasible(scalable, 'SCALE_IN')).toBe(true)
      expect(isRemediationFeasible(makeResource(), 'SCALE_IN')).toBe(false)
    })

    it('STOP and SCHEDULE are always feasible', () => {
      expect(isRemediationFeasible(makeResource(), 'STOP')).toBe(true)
      expect(isRemediationFeasible(makeResource(), 'SCHEDULE')).toBe(true)
    })

    it('SCALE_OUT and NO_ACTION are never feasible (no Terraform template)', () => {
      expect(isRemediationFeasible(makeResource(), 'SCALE_OUT')).toBe(false)
      expect(isRemediationFeasible(makeResource(), 'NO_ACTION')).toBe(false)
    })
  })
})
