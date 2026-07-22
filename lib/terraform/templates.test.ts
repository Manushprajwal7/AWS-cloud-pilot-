import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { generateTerraformForAction, wrapWithProviderBlock, UnsupportedRemediationError } from './templates'
import type { SimulatedCloudResource } from '@/lib/simulation/types'

function makeResource(overrides: Partial<SimulatedCloudResource> = {}): SimulatedCloudResource {
  return {
    id: 'res-ec2-prod-01',
    name: 'prod-web-01',
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

describe('lib/terraform/templates', () => {
  describe('generateTerraformForAction', () => {
    it('aligns tags block `=` signs to the widest key, matching terraform fmt canonical style', () => {
      const generated = generateTerraformForAction(makeResource(), 'RIGHTSIZE')
      expect(generated.hcl).toContain(
        [
          '  tags = {',
          '    "Name"        = "prod-web-01"',
          '    "Environment" = "production"',
          '    "ManagedBy"   = "cloudpilot"',
          '  }',
        ].join('\n'),
      )
    })

    it('throws UnsupportedRemediationError for RIGHTSIZE when utilization is too high to size down', () => {
      const resource = makeResource({ metrics: { ...makeResource().metrics, cpuPercent: 91 } })
      expect(() => generateTerraformForAction(resource, 'RIGHTSIZE')).toThrow(UnsupportedRemediationError)
    })

    it('throws UnsupportedRemediationError for NO_ACTION (no template)', () => {
      expect(() => generateTerraformForAction(makeResource(), 'NO_ACTION')).toThrow(UnsupportedRemediationError)
    })

    it('throws UnsupportedRemediationError for SCALE_OUT when CPU is not high enough to justify it', () => {
      expect(() => generateTerraformForAction(makeResource(), 'SCALE_OUT')).toThrow(UnsupportedRemediationError)
    })

    it('generates a bumped desired_count for SCALE_OUT on a high-CPU ECS service with headroom', () => {
      const resource = makeResource({
        service: 'ECS',
        configuration: { desiredCapacity: 2, minCapacity: 1, maxCapacity: 5 },
        metrics: { ...makeResource().metrics, cpuPercent: 92 },
      })
      const generated = generateTerraformForAction(resource, 'SCALE_OUT')
      expect(generated.action).toBe('SCALE_OUT')
      expect(generated.hcl).toContain('desired_count = 3')
    })

    it('RIGHTSIZE changeSummary states the real before/after instance types and observed utilization countering the scenario', () => {
      const resource = makeResource() // cpuPercent: 8, memoryPercent: 15, instanceType: m5.xlarge
      const generated = generateTerraformForAction(resource, 'RIGHTSIZE')
      expect(generated.changeSummary).toContain('m5.xlarge')
      expect(generated.changeSummary).toContain('m5.large') // one size down from m5.xlarge
      expect(generated.changeSummary).toContain('8.0%')
      expect(generated.changeSummary).toContain('15.0%')
      expect(generated.changeSummary.toLowerCase()).toContain('gracefully downgrading')
    })

    it('SCALE_IN changeSummary states the real before/after task counts', () => {
      const resource = makeResource({
        service: 'ECS',
        configuration: { desiredCapacity: 3, minCapacity: 1, maxCapacity: 5 },
        metrics: { ...makeResource().metrics, cpuPercent: 5 },
      })
      const generated = generateTerraformForAction(resource, 'SCALE_IN')
      expect(generated.changeSummary).toContain('3 to 2 tasks')
    })

    it('throws UnsupportedRemediationError for SCALE_OUT when already at maxCapacity', () => {
      const resource = makeResource({
        service: 'ECS',
        configuration: { desiredCapacity: 5, minCapacity: 1, maxCapacity: 5 },
        metrics: { ...makeResource().metrics, cpuPercent: 92 },
      })
      expect(() => generateTerraformForAction(resource, 'SCALE_OUT')).toThrow(UnsupportedRemediationError)
    })
  })

  describe('wrapWithProviderBlock', () => {
    const original = process.env.TERRAFORM_AWS_ENDPOINT

    beforeEach(() => {
      delete process.env.TERRAFORM_AWS_ENDPOINT
    })
    afterEach(() => {
      if (original === undefined) delete process.env.TERRAFORM_AWS_ENDPOINT
      else process.env.TERRAFORM_AWS_ENDPOINT = original
    })

    it('omits the endpoints block when TERRAFORM_AWS_ENDPOINT is unset', () => {
      const wrapped = wrapWithProviderBlock('resource "aws_instance" "x" {\n}')
      expect(wrapped).not.toContain('endpoints {')
    })

    it('redirects every service endpoint to TERRAFORM_AWS_ENDPOINT when set, for LocalStack', () => {
      process.env.TERRAFORM_AWS_ENDPOINT = 'http://localstack:4566'
      const wrapped = wrapWithProviderBlock('resource "aws_instance" "x" {\n}')

      expect(wrapped).toContain('endpoints {')
      for (const service of ['ec2', 'rds', 'ecs', 'lambda', 'elasticache']) {
        const pattern = new RegExp(`${service}\\s*=\\s*"http://localstack:4566"`)
        expect(wrapped).toMatch(pattern)
      }
    })
  })
})
