/**
 * Scenario definitions: what each ScenarioType means, the target metric
 * baseline it drives a resource toward on activation, and the resource
 * status it implies. Continuous per-tick progression toward these targets
 * (spike ramp-up, recovery, idle-hour accumulation, etc.) is implemented by
 * lib/simulation/scenario-runners.ts — this module owns the static
 * definitions both the store and the tick engine build on.
 */

import type { ResourceMetrics, ResourceStatus, ScenarioType } from './types'

export interface ScenarioDefinition {
  type: ScenarioType
  label: string
  description: string
  /** Resource status implied while this scenario is active. */
  status: ResourceStatus
  /** Target metric values this scenario drives the resource toward. */
  targetMetrics: ResourceMetrics
}

export const SCENARIO_DEFINITIONS: Record<ScenarioType, ScenarioDefinition> = {
  NORMAL: {
    type: 'NORMAL',
    label: 'Normal',
    description: 'Steady-state operation within expected bounds.',
    status: 'running',
    targetMetrics: {
      cpuPercent: 25,
      memoryPercent: 40,
      networkInMb: 5,
      networkOutMb: 3,
      requestsPerMinute: 120,
      latencyMs: 45,
      errorRatePercent: 0.1,
      idleHours: 0,
    },
  },
  CPU_SPIKE: {
    type: 'CPU_SPIKE',
    label: 'CPU Spike',
    description: 'Sustained high CPU utilization, e.g. from a runaway process or load spike.',
    status: 'degraded',
    targetMetrics: {
      cpuPercent: 92,
      memoryPercent: 65,
      networkInMb: 20,
      networkOutMb: 15,
      requestsPerMinute: 600,
      latencyMs: 220,
      errorRatePercent: 2.5,
      idleHours: 0,
    },
  },
  IDLE_RESOURCE: {
    type: 'IDLE_RESOURCE',
    label: 'Idle Resource',
    description: 'Resource is provisioned but receiving negligible traffic — a termination/downsize candidate.',
    status: 'optimizing',
    targetMetrics: {
      cpuPercent: 2,
      memoryPercent: 15,
      networkInMb: 0.2,
      networkOutMb: 0.1,
      requestsPerMinute: 1,
      latencyMs: 10,
      errorRatePercent: 0,
      idleHours: 6,
    },
  },
  MEMORY_LEAK: {
    type: 'MEMORY_LEAK',
    label: 'Memory Leak',
    description: 'Memory usage climbs steadily without being released, eventually risking an OOM failure.',
    status: 'degraded',
    targetMetrics: {
      cpuPercent: 35,
      // Saturation, not a comfortable steady state — a leak climbs until
      // something reclaims the memory. scenario-runners.ts walks this axis up
      // linearly rather than easing into it; see MEMORY_LEAK_CLIMB_* there.
      memoryPercent: 99,
      networkInMb: 8,
      networkOutMb: 5,
      requestsPerMinute: 150,
      latencyMs: 90,
      errorRatePercent: 0.8,
      idleHours: 0,
    },
  },
  OVERPROVISIONED: {
    type: 'OVERPROVISIONED',
    label: 'Overprovisioned',
    description: 'Instance is sized far beyond what its actual load requires — a rightsizing candidate.',
    status: 'optimizing',
    targetMetrics: {
      cpuPercent: 8,
      memoryPercent: 18,
      networkInMb: 2,
      networkOutMb: 1,
      requestsPerMinute: 30,
      latencyMs: 25,
      errorRatePercent: 0,
      idleHours: 2,
    },
  },
  COST_SPIKE: {
    type: 'COST_SPIKE',
    label: 'Cost Spike',
    description: 'Request/data-transfer volume surges, driving up cost without a proportional traffic-surge latency hit.',
    status: 'optimizing',
    targetMetrics: {
      cpuPercent: 55,
      memoryPercent: 60,
      networkInMb: 120,
      networkOutMb: 95,
      requestsPerMinute: 2200,
      latencyMs: 60,
      errorRatePercent: 0.3,
      idleHours: 0,
    },
  },
  TRAFFIC_SURGE: {
    type: 'TRAFFIC_SURGE',
    label: 'Traffic Surge',
    description: 'A sudden, large increase in request volume that also degrades latency and error rate.',
    status: 'degraded',
    targetMetrics: {
      cpuPercent: 78,
      memoryPercent: 70,
      networkInMb: 200,
      networkOutMb: 160,
      requestsPerMinute: 5000,
      latencyMs: 180,
      errorRatePercent: 1.2,
      idleHours: 0,
    },
  },
}

export function getScenarioDefinition(scenario: ScenarioType): ScenarioDefinition {
  return SCENARIO_DEFINITIONS[scenario]
}

export function isValidScenario(value: string): value is ScenarioType {
  return value in SCENARIO_DEFINITIONS
}
