/**
 * Deterministic rightsizing, scheduled-shutdown, and scale-in
 * recommendations, and their projected cost impact. Every figure comes
 * from calculateCost() against a hypothetical smaller configuration —
 * never from an LLM. Groq may narrate these recommendations later; it must
 * never compute them.
 */

import { calculateCost } from '@/lib/simulation/resources'
import type { SimulatedCloudResource } from '@/lib/simulation/types'
import { DAYS_PER_MONTH, HOURS_PER_MONTH, round2, toCostBreakdown, type CostBreakdown } from './pricing'

// Ordered smallest -> largest, matching the sizing intuition already used
// in lib/tools/cloudTools.ts / lib/sandbox/validationSandbox.ts for EC2.
const EC2_SIZE_ORDER = ['t3.small', 'm5.large', 'm5.xlarge']
const RDS_SIZE_ORDER = ['db.t3.medium', 'db.r5.xlarge']

const SIZE_ORDER_BY_SERVICE: Partial<Record<string, string[]>> = {
  EC2: EC2_SIZE_ORDER,
  RDS: RDS_SIZE_ORDER,
}

const RIGHTSIZING_CPU_THRESHOLD = 30
const RIGHTSIZING_MEMORY_THRESHOLD = 30
const DEFAULT_OFF_HOURS_PER_DAY = 12
const SCALE_OUT_CPU_THRESHOLD = 80

export interface RightsizingRecommendation {
  resourceId: string
  currentInstanceType: string
  recommendedInstanceType: string
  currentCost: CostBreakdown
  projectedCost: CostBreakdown
  monthlySavings: number
}

/**
 * Recommend stepping down exactly one size, only when utilization is low
 * enough (both CPU and memory below threshold) to support it. Null when
 * the resource is already at the smallest known size, its type isn't in
 * the known size order, or utilization doesn't justify downsizing.
 */
export function recommendRightsizing(resource: SimulatedCloudResource): RightsizingRecommendation | null {
  const order = SIZE_ORDER_BY_SERVICE[resource.service]
  const currentType = resource.configuration.instanceType
  if (!order || !currentType) return null

  const index = order.indexOf(currentType)
  if (index <= 0) return null

  if (resource.metrics.cpuPercent >= RIGHTSIZING_CPU_THRESHOLD || resource.metrics.memoryPercent >= RIGHTSIZING_MEMORY_THRESHOLD) {
    return null
  }

  const recommendedType = order[index - 1]
  const currentCost = toCostBreakdown(resource.cost.hourlyUsd)
  const projected = calculateCost(resource.service, { ...resource.configuration, instanceType: recommendedType }, resource.metrics)
  const projectedCost = toCostBreakdown(projected.hourlyUsd)

  return {
    resourceId: resource.id,
    currentInstanceType: currentType,
    recommendedInstanceType: recommendedType,
    currentCost,
    projectedCost,
    monthlySavings: round2(currentCost.monthlyUsd - projectedCost.monthlyUsd),
  }
}

export interface ScheduledShutdownRecommendation {
  resourceId: string
  offHoursPerDay: number
  currentCost: CostBreakdown
  projectedCost: CostBreakdown
  monthlySavings: number
}

/** Cost impact of shutting a resource down for `offHoursPerDay` hours/day (e.g. non-production instances outside business hours). */
export function calculateScheduledShutdownSavings(
  resource: SimulatedCloudResource,
  offHoursPerDay = DEFAULT_OFF_HOURS_PER_DAY,
): ScheduledShutdownRecommendation {
  const currentCost = toCostBreakdown(resource.cost.hourlyUsd)
  const savedMonthly = resource.cost.hourlyUsd * offHoursPerDay * DAYS_PER_MONTH
  const projectedMonthly = Math.max(0, currentCost.monthlyUsd - savedMonthly)
  const projectedHourly = projectedMonthly / HOURS_PER_MONTH

  return {
    resourceId: resource.id,
    offHoursPerDay,
    currentCost,
    projectedCost: toCostBreakdown(projectedHourly),
    monthlySavings: round2(currentCost.monthlyUsd - projectedMonthly),
  }
}

export interface ScaleInRecommendation {
  resourceId: string
  currentCapacity: number
  recommendedCapacity: number
  currentCost: CostBreakdown
  projectedCost: CostBreakdown
  monthlySavings: number
}

/**
 * Recommend stepping desiredCapacity down by exactly one task (never below
 * minCapacity), only when utilization is low enough to justify it. A
 * single conservative step, not a jump straight to the floor.
 */
export function recommendScaleIn(resource: SimulatedCloudResource): ScaleInRecommendation | null {
  if (resource.service !== 'ECS') return null

  const { desiredCapacity, minCapacity } = resource.configuration
  if (desiredCapacity === undefined || minCapacity === undefined) return null
  if (resource.metrics.cpuPercent >= RIGHTSIZING_CPU_THRESHOLD) return null

  const recommendedCapacity = Math.max(minCapacity, desiredCapacity - 1)
  if (recommendedCapacity >= desiredCapacity) return null

  const currentCost = toCostBreakdown(resource.cost.hourlyUsd)
  const projected = calculateCost(resource.service, { ...resource.configuration, desiredCapacity: recommendedCapacity }, resource.metrics)
  const projectedCost = toCostBreakdown(projected.hourlyUsd)

  return {
    resourceId: resource.id,
    currentCapacity: desiredCapacity,
    recommendedCapacity,
    currentCost,
    projectedCost,
    monthlySavings: round2(currentCost.monthlyUsd - projectedCost.monthlyUsd),
  }
}

export interface ScaleOutRecommendation {
  resourceId: string
  currentCapacity: number
  recommendedCapacity: number
  currentCost: CostBreakdown
  projectedCost: CostBreakdown
}

/**
 * Recommend stepping desiredCapacity up by exactly one task (never above
 * maxCapacity), only when CPU utilization is high enough to justify it. A
 * single conservative step, mirroring recommendScaleIn's direction and
 * caution in reverse.
 */
export function recommendScaleOut(resource: SimulatedCloudResource): ScaleOutRecommendation | null {
  if (resource.service !== 'ECS') return null

  const { desiredCapacity, maxCapacity } = resource.configuration
  if (desiredCapacity === undefined || maxCapacity === undefined) return null
  if (resource.metrics.cpuPercent < SCALE_OUT_CPU_THRESHOLD) return null

  const recommendedCapacity = Math.min(maxCapacity, desiredCapacity + 1)
  if (recommendedCapacity <= desiredCapacity) return null

  const currentCost = toCostBreakdown(resource.cost.hourlyUsd)
  const projected = calculateCost(resource.service, { ...resource.configuration, desiredCapacity: recommendedCapacity }, resource.metrics)
  const projectedCost = toCostBreakdown(projected.hourlyUsd)

  return {
    resourceId: resource.id,
    currentCapacity: desiredCapacity,
    recommendedCapacity,
    currentCost,
    projectedCost,
  }
}

export type RemediationAction = 'NO_ACTION' | 'STOP' | 'RIGHTSIZE' | 'SCHEDULE' | 'SCALE_OUT' | 'SCALE_IN'

/**
 * Whether a deterministic Terraform template can actually be generated for
 * this action against the resource's current state. RIGHTSIZE, SCALE_IN,
 * and SCALE_OUT are only feasible when their respective
 * recommendRightsizing/recommendScaleIn/recommendScaleOut function actually
 * returns a recommendation (e.g. not when utilization doesn't justify the
 * change, or the resource is already at its smallest/largest size/capacity)
 * — lib/terraform/templates.ts throws UnsupportedRemediationError in
 * exactly those cases, so planRemediationNode must check this before
 * committing to an action the diagnosis LLM proposed, not after generation
 * already failed.
 */
export function isRemediationFeasible(resource: SimulatedCloudResource, action: RemediationAction): boolean {
  switch (action) {
    case 'RIGHTSIZE':
      return recommendRightsizing(resource) !== null
    case 'SCALE_IN':
      return recommendScaleIn(resource) !== null
    case 'SCALE_OUT':
      return recommendScaleOut(resource) !== null
    case 'STOP':
    case 'SCHEDULE':
      return true
    case 'NO_ACTION':
      return false
  }
}

/**
 * Expected monthly cost after applying a given remediation action. Falls
 * back to the resource's current cost when the action has no applicable
 * recommendation (e.g. RIGHTSIZE on an already-minimal instance, or
 * SCALE_OUT with no headroom) or isn't a savings action (NO_ACTION).
 * SCALE_OUT legitimately costs more, not less — expectedMonthlySavingsUsd
 * is clamped to 0 by planRemediationNode for that case.
 */
export function calculateExpectedPostRemediationCost(resource: SimulatedCloudResource, action: RemediationAction): number {
  switch (action) {
    case 'STOP':
      return 0
    case 'RIGHTSIZE': {
      const recommendation = recommendRightsizing(resource)
      return recommendation ? recommendation.projectedCost.monthlyUsd : resource.cost.projectedMonthlyUsd
    }
    case 'SCHEDULE':
      return calculateScheduledShutdownSavings(resource).projectedCost.monthlyUsd
    case 'SCALE_IN': {
      const recommendation = recommendScaleIn(resource)
      return recommendation ? recommendation.projectedCost.monthlyUsd : resource.cost.projectedMonthlyUsd
    }
    case 'SCALE_OUT': {
      const recommendation = recommendScaleOut(resource)
      return recommendation ? recommendation.projectedCost.monthlyUsd : resource.cost.projectedMonthlyUsd
    }
    case 'NO_ACTION':
    default:
      return resource.cost.projectedMonthlyUsd
  }
}
