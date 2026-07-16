/**
 * Domain model for the simulated cloud infrastructure.
 * This is the single source of truth for resource shape — the server owns
 * it (lib/simulation/simulation-store.ts); UI components only ever render
 * data read from it, never generate or hold it themselves.
 */

export type CloudService = 'EC2' | 'RDS' | 'ECS' | 'LAMBDA' | 'ELASTICACHE'

export type CloudEnvironment = 'development' | 'staging' | 'production'

export type ResourceStatus = 'running' | 'stopped' | 'degraded' | 'optimizing' | 'failed'

export type ScenarioType =
  | 'NORMAL'
  | 'CPU_SPIKE'
  | 'IDLE_RESOURCE'
  | 'MEMORY_LEAK'
  | 'OVERPROVISIONED'
  | 'COST_SPIKE'
  | 'TRAFFIC_SURGE'

export interface ResourceConfiguration {
  instanceType?: string
  desiredCapacity?: number
  minCapacity?: number
  maxCapacity?: number
  memoryGb?: number
  vcpu?: number
}

export interface ResourceMetrics {
  cpuPercent: number
  memoryPercent: number
  networkInMb: number
  networkOutMb: number
  requestsPerMinute: number
  latencyMs: number
  errorRatePercent: number
  idleHours: number
}

export interface ResourceCost {
  hourlyUsd: number
  dailyUsd: number
  projectedMonthlyUsd: number
}

export interface SimulatedCloudResource {
  id: string
  name: string
  service: CloudService
  environment: CloudEnvironment
  region: string
  status: ResourceStatus

  configuration: ResourceConfiguration
  metrics: ResourceMetrics
  cost: ResourceCost

  activeScenario: ScenarioType
  updatedAt: string
}

export interface MetricSnapshot {
  resourceId: string
  timestamp: string
  metrics: ResourceMetrics
  cost: ResourceCost
}

export type SimulationStoreEventType =
  | 'resource_updated'
  | 'scenario_activated'
  | 'resource_reset'
  | 'metric_snapshot_saved'

export interface SimulationStoreEvent {
  type: SimulationStoreEventType
  resourceId: string
  resource: SimulatedCloudResource
}

export type SimulationStoreListener = (event: SimulationStoreEvent) => void
