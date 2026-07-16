/**
 * Seed resource definitions, pricing, and cost calculation for the
 * simulated cloud infrastructure. Prices are plausible us-east-1
 * on-demand rates for a realistic simulation — not a live pricing feed.
 */

import type {
  CloudEnvironment,
  CloudService,
  ResourceConfiguration,
  ResourceCost,
  ResourceMetrics,
  SimulatedCloudResource,
} from './types'

const HOURS_PER_DAY = 24
const HOURS_PER_MONTH = 730

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/** Base hourly on-demand rate, keyed by service + instance/node type. */
const BASE_HOURLY_RATE: Record<string, number> = {
  't3.small': 0.0208,
  'm5.large': 0.096,
  'm5.xlarge': 0.192,
  'db.t3.medium': 0.068,
  'db.r5.xlarge': 0.504,
  'cache.r6g.large': 0.226,
}

/** Fargate per-vCPU-hour and per-GB-hour rates, used for ECS tasks. */
const FARGATE_VCPU_HOURLY_RATE = 0.04048
const FARGATE_GB_HOURLY_RATE = 0.004445

/** Lambda per-GB-second rate, converted to an hourly-equivalent baseline. */
const LAMBDA_GB_SECOND_RATE = 0.0000166667
const LAMBDA_BASELINE_INVOCATIONS_PER_HOUR = 3600 // ~1 req/sec baseline
const LAMBDA_AVG_DURATION_SECONDS = 0.3

/**
 * Compute the {hourly, daily, projectedMonthly} cost for a resource given
 * its service, configuration, and current request volume. Pure function —
 * no I/O, safe to unit test directly.
 */
export function calculateCost(
  service: CloudService,
  configuration: ResourceConfiguration,
  metrics: Pick<ResourceMetrics, 'requestsPerMinute'>,
): ResourceCost {
  let hourlyUsd: number

  if (service === 'ECS') {
    const taskCount = configuration.desiredCapacity ?? 1
    const vcpu = configuration.vcpu ?? 1
    const memoryGb = configuration.memoryGb ?? 2
    hourlyUsd = taskCount * (vcpu * FARGATE_VCPU_HOURLY_RATE + memoryGb * FARGATE_GB_HOURLY_RATE)
  } else if (service === 'LAMBDA') {
    const memoryGb = configuration.memoryGb ?? 0.5
    const invocationsPerHour = Math.max(metrics.requestsPerMinute * 60, LAMBDA_BASELINE_INVOCATIONS_PER_HOUR)
    hourlyUsd = invocationsPerHour * LAMBDA_AVG_DURATION_SECONDS * memoryGb * LAMBDA_GB_SECOND_RATE
  } else {
    const instanceType = configuration.instanceType ?? ''
    hourlyUsd = BASE_HOURLY_RATE[instanceType] ?? 0.05
  }

  hourlyUsd = Math.round(hourlyUsd * 10000) / 10000

  return {
    hourlyUsd,
    dailyUsd: Math.round(hourlyUsd * HOURS_PER_DAY * 100) / 100,
    projectedMonthlyUsd: Math.round(hourlyUsd * HOURS_PER_MONTH * 100) / 100,
  }
}

// ---------------------------------------------------------------------------
// Baseline ("NORMAL" scenario) metrics — services differ in what's realistic
// ---------------------------------------------------------------------------

function baselineMetrics(overrides: Partial<ResourceMetrics> = {}): ResourceMetrics {
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

// ---------------------------------------------------------------------------
// Resource factory
// ---------------------------------------------------------------------------

export interface SeedResourceInput {
  id: string
  name: string
  service: CloudService
  environment: CloudEnvironment
  region: string
  configuration: ResourceConfiguration
  metrics?: Partial<ResourceMetrics>
}

export function createResource(input: SeedResourceInput): SimulatedCloudResource {
  const metrics = baselineMetrics(input.metrics)

  return {
    id: input.id,
    name: input.name,
    service: input.service,
    environment: input.environment,
    region: input.region,
    status: 'running',
    configuration: input.configuration,
    metrics,
    cost: calculateCost(input.service, input.configuration, metrics),
    activeScenario: 'NORMAL',
    updatedAt: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Seed data — the 8 required resources
// ---------------------------------------------------------------------------

export function buildSeedResources(): SimulatedCloudResource[] {
  return [
    createResource({
      id: 'res-ec2-dev-01',
      name: 'dev-web-01',
      service: 'EC2',
      environment: 'development',
      region: 'us-east-1',
      configuration: { instanceType: 't3.small', vcpu: 2, memoryGb: 2 },
      metrics: { cpuPercent: 12, memoryPercent: 22, requestsPerMinute: 15 },
    }),
    createResource({
      id: 'res-ec2-staging-01',
      name: 'staging-web-01',
      service: 'EC2',
      environment: 'staging',
      region: 'us-east-1',
      configuration: { instanceType: 'm5.large', vcpu: 2, memoryGb: 8 },
      metrics: { cpuPercent: 20, memoryPercent: 35, requestsPerMinute: 60 },
    }),
    createResource({
      id: 'res-ec2-prod-01',
      name: 'prod-web-01',
      service: 'EC2',
      environment: 'production',
      region: 'us-east-1',
      configuration: { instanceType: 'm5.xlarge', vcpu: 4, memoryGb: 16 },
      metrics: { cpuPercent: 38, memoryPercent: 52, requestsPerMinute: 480 },
    }),
    createResource({
      id: 'res-rds-staging-01',
      name: 'staging-orders-db',
      service: 'RDS',
      environment: 'staging',
      region: 'us-east-1',
      configuration: { instanceType: 'db.t3.medium', vcpu: 2, memoryGb: 4 },
      metrics: { cpuPercent: 18, memoryPercent: 40, requestsPerMinute: 90 },
    }),
    createResource({
      id: 'res-rds-prod-01',
      name: 'prod-orders-db',
      service: 'RDS',
      environment: 'production',
      region: 'us-east-1',
      configuration: { instanceType: 'db.r5.xlarge', vcpu: 4, memoryGb: 32 },
      metrics: { cpuPercent: 42, memoryPercent: 58, requestsPerMinute: 620 },
    }),
    createResource({
      id: 'res-ecs-prod-01',
      name: 'prod-checkout-service',
      service: 'ECS',
      environment: 'production',
      region: 'us-east-1',
      configuration: { desiredCapacity: 3, minCapacity: 2, maxCapacity: 8, vcpu: 1, memoryGb: 2 },
      metrics: { cpuPercent: 33, memoryPercent: 47, requestsPerMinute: 900 },
    }),
    createResource({
      id: 'res-lambda-prod-01',
      name: 'prod-image-resizer',
      service: 'LAMBDA',
      environment: 'production',
      region: 'us-east-1',
      configuration: { memoryGb: 0.5 },
      metrics: { cpuPercent: 0, memoryPercent: 30, requestsPerMinute: 45, latencyMs: 180 },
    }),
    createResource({
      id: 'res-elasticache-prod-01',
      name: 'prod-session-cache',
      service: 'ELASTICACHE',
      environment: 'production',
      region: 'us-east-1',
      configuration: { instanceType: 'cache.r6g.large', vcpu: 2, memoryGb: 13.07 },
      metrics: { cpuPercent: 15, memoryPercent: 62, requestsPerMinute: 3200, latencyMs: 2 },
    }),
  ]
}
