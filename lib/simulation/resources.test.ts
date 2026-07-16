import { describe, expect, it } from 'vitest'
import { buildSeedResources, calculateCost } from './resources'
import type { CloudEnvironment, CloudService } from './types'

describe('lib/simulation/resources', () => {
  describe('resource initialization', () => {
    const resources = buildSeedResources()

    it('seeds exactly the required 8 resources', () => {
      expect(resources).toHaveLength(8)
    })

    it('has unique ids', () => {
      const ids = resources.map((r) => r.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('covers every required service type', () => {
      const services = new Set(resources.map((r) => r.service))
      const expected: CloudService[] = ['EC2', 'RDS', 'ECS', 'LAMBDA', 'ELASTICACHE']
      for (const service of expected) {
        expect(services.has(service)).toBe(true)
      }
    })

    it('covers development, staging, and production environments', () => {
      const environments = new Set(resources.map((r) => r.environment))
      const expected: CloudEnvironment[] = ['development', 'staging', 'production']
      for (const env of expected) {
        expect(environments.has(env)).toBe(true)
      }
    })

    it('includes at least one EC2 in each of development/staging/production', () => {
      const ec2Envs = new Set(resources.filter((r) => r.service === 'EC2').map((r) => r.environment))
      expect(ec2Envs.has('development')).toBe(true)
      expect(ec2Envs.has('staging')).toBe(true)
      expect(ec2Envs.has('production')).toBe(true)
    })

    it('includes RDS in staging and production', () => {
      const rdsEnvs = new Set(resources.filter((r) => r.service === 'RDS').map((r) => r.environment))
      expect(rdsEnvs.has('staging')).toBe(true)
      expect(rdsEnvs.has('production')).toBe(true)
    })

    it('every resource starts in the NORMAL scenario with status running', () => {
      for (const resource of resources) {
        expect(resource.activeScenario).toBe('NORMAL')
        expect(resource.status).toBe('running')
      }
    })

    it('every resource has a positive cost', () => {
      for (const resource of resources) {
        expect(resource.cost.hourlyUsd).toBeGreaterThan(0)
        expect(resource.cost.dailyUsd).toBeGreaterThan(0)
        expect(resource.cost.projectedMonthlyUsd).toBeGreaterThan(0)
      }
    })

    it('every resource has a valid ISO updatedAt timestamp', () => {
      for (const resource of resources) {
        expect(() => new Date(resource.updatedAt).toISOString()).not.toThrow()
      }
    })
  })

  describe('cost calculations', () => {
    it('daily cost is always hourly * 24', () => {
      const cost = calculateCost('EC2', { instanceType: 'm5.large' }, { requestsPerMinute: 0 })
      expect(cost.dailyUsd).toBeCloseTo(cost.hourlyUsd * 24, 2)
    })

    it('projected monthly cost is always hourly * 730', () => {
      const cost = calculateCost('EC2', { instanceType: 'm5.large' }, { requestsPerMinute: 0 })
      expect(cost.projectedMonthlyUsd).toBeCloseTo(cost.hourlyUsd * 730, 2)
    })

    it('a larger EC2 instance type costs more per hour than a smaller one', () => {
      const small = calculateCost('EC2', { instanceType: 't3.small' }, { requestsPerMinute: 0 })
      const large = calculateCost('EC2', { instanceType: 'm5.xlarge' }, { requestsPerMinute: 0 })
      expect(large.hourlyUsd).toBeGreaterThan(small.hourlyUsd)
    })

    it('ECS cost scales with desired task count', () => {
      const oneTask = calculateCost('ECS', { desiredCapacity: 1, vcpu: 1, memoryGb: 2 }, { requestsPerMinute: 0 })
      const fiveTasks = calculateCost('ECS', { desiredCapacity: 5, vcpu: 1, memoryGb: 2 }, { requestsPerMinute: 0 })
      expect(fiveTasks.hourlyUsd).toBeCloseTo(oneTask.hourlyUsd * 5, 2)
    })

    it('Lambda cost increases with request volume', () => {
      const low = calculateCost('LAMBDA', { memoryGb: 0.5 }, { requestsPerMinute: 1 })
      const high = calculateCost('LAMBDA', { memoryGb: 0.5 }, { requestsPerMinute: 10000 })
      expect(high.hourlyUsd).toBeGreaterThan(low.hourlyUsd)
    })

    it('falls back to a default rate for an unknown instance type instead of throwing', () => {
      expect(() => calculateCost('EC2', { instanceType: 'not-a-real-type' }, { requestsPerMinute: 0 })).not.toThrow()
      const cost = calculateCost('EC2', { instanceType: 'not-a-real-type' }, { requestsPerMinute: 0 })
      expect(cost.hourlyUsd).toBeGreaterThan(0)
    })
  })
})
