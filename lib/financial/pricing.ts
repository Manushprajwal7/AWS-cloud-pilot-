/**
 * Deterministic pricing utilities shared by the anomaly-impact and
 * rightsizing modules. Wraps lib/simulation/resources.ts's calculateCost
 * (the single source of hourly-rate truth) and adds the daily/monthly/
 * annual breakdown financial reporting needs but the simulation domain
 * model itself doesn't.
 */

import { calculateCost as calculateResourceHourlyCost } from '@/lib/simulation/resources'
import type { CloudService, ResourceConfiguration, ResourceMetrics } from '@/lib/simulation/types'

export const HOURS_PER_DAY = 24
export const HOURS_PER_MONTH = 730
export const HOURS_PER_YEAR = 8760
export const DAYS_PER_MONTH = HOURS_PER_MONTH / HOURS_PER_DAY

export function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export interface CostBreakdown {
  hourlyUsd: number
  dailyUsd: number
  monthlyUsd: number
  annualUsd: number
}

export function toCostBreakdown(hourlyUsd: number): CostBreakdown {
  const hourly = Math.round(hourlyUsd * 10000) / 10000
  return {
    hourlyUsd: hourly,
    dailyUsd: round2(hourly * HOURS_PER_DAY),
    monthlyUsd: round2(hourly * HOURS_PER_MONTH),
    annualUsd: round2(hourly * HOURS_PER_YEAR),
  }
}

/**
 * Full cost breakdown for a hypothetical service/configuration/request
 * volume, without needing a live SimulatedCloudResource — used by
 * rightsizing.ts to price "what would this cost as a smaller instance."
 */
export function priceConfiguration(
  service: CloudService,
  configuration: ResourceConfiguration,
  metrics: Pick<ResourceMetrics, 'requestsPerMinute'>,
): CostBreakdown {
  const { hourlyUsd } = calculateResourceHourlyCost(service, configuration, metrics)
  return toCostBreakdown(hourlyUsd)
}
