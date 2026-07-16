/**
 * Deterministic post-apply health checks against the simulated resource's
 * real, current state (lib/simulation). No LLM, no heuristics — every
 * check is a plain comparison against a fixed threshold or the resource's
 * pre-apply snapshot.
 */

import type { RemediationAction } from '@/lib/financial/rightsizing'
import type { SimulatedCloudResource } from '@/lib/simulation/types'

export interface CheckResult {
  name: string
  passed: boolean
  details: string
}

const CRITICAL_CPU_THRESHOLD = 95
const CRITICAL_MEMORY_THRESHOLD = 95

/** STOP/SCHEDULE intentionally drive the resource toward 'stopped'; every other action expects it to stay healthy and running. */
export function checkResourceHealth(resource: SimulatedCloudResource, action: RemediationAction): CheckResult {
  if (resource.status === 'failed') {
    return { name: 'resource_health', passed: false, details: `resource status is 'failed'` }
  }

  if (action === 'STOP' || action === 'SCHEDULE') {
    return { name: 'resource_health', passed: true, details: `resource status is '${resource.status}' (expected for ${action})` }
  }

  const passed = resource.status === 'running' || resource.status === 'optimizing'
  return {
    name: 'resource_health',
    passed,
    details: passed ? `resource status is '${resource.status}'` : `unexpected status '${resource.status}' for action ${action}`,
  }
}

export function checkResourceAvailability(resource: SimulatedCloudResource, action: RemediationAction): CheckResult {
  if (action === 'STOP' && resource.status === 'stopped') {
    return { name: 'resource_availability', passed: true, details: 'resource intentionally stopped' }
  }
  const passed = resource.status !== 'degraded' && resource.status !== 'failed'
  return {
    name: 'resource_availability',
    passed,
    details: passed ? 'resource is available' : `resource is unavailable (status='${resource.status}')`,
  }
}

export function checkErrorRate(current: SimulatedCloudResource, baseline: SimulatedCloudResource): CheckResult {
  const passed = current.metrics.errorRatePercent <= baseline.metrics.errorRatePercent + 0.5
  return {
    name: 'error_rate',
    passed,
    details: `error rate ${current.metrics.errorRatePercent.toFixed(2)}% vs pre-apply baseline ${baseline.metrics.errorRatePercent.toFixed(2)}%`,
  }
}

export function checkCpuUtilization(resource: SimulatedCloudResource): CheckResult {
  const passed = resource.metrics.cpuPercent < CRITICAL_CPU_THRESHOLD
  return {
    name: 'cpu_utilization',
    passed,
    details: `CPU at ${resource.metrics.cpuPercent.toFixed(1)}% (critical threshold ${CRITICAL_CPU_THRESHOLD}%)`,
  }
}

export function checkMemoryUtilization(resource: SimulatedCloudResource): CheckResult {
  const passed = resource.metrics.memoryPercent < CRITICAL_MEMORY_THRESHOLD
  return {
    name: 'memory_utilization',
    passed,
    details: `Memory at ${resource.metrics.memoryPercent.toFixed(1)}% (critical threshold ${CRITICAL_MEMORY_THRESHOLD}%)`,
  }
}

/** Apply should only ever change status/configuration/metrics/cost for the target resource — identity fields must never move. */
export function checkNoUnexpectedSideEffects(baseline: SimulatedCloudResource, current: SimulatedCloudResource): CheckResult {
  const passed = baseline.id === current.id && baseline.service === current.service && baseline.region === current.region && baseline.environment === current.environment
  return {
    name: 'no_unexpected_side_effects',
    passed,
    details: passed ? 'resource identity unchanged' : 'resource identity fields changed unexpectedly (id/service/region/environment)',
  }
}
