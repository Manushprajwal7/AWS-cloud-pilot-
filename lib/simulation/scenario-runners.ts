/**
 * Per-tick metric progression. Where metric-generator.ts produces a
 * single-shot "what would this look like right now" snapshot,
 * stepResourceMetrics here moves a resource's *current* metrics some
 * fraction of the way toward its scenario's target on every tick — that's
 * what makes a CPU spike ramp up instead of teleporting, a memory leak
 * climb gradually, and a resource recover smoothly when its scenario
 * changes back to NORMAL (recovery is just "approach the NORMAL target,"
 * the same mechanism as every other scenario, not a special case).
 */

import type { ResourceMetrics, ScenarioType } from './types'
import { getScenarioDefinition } from './scenarios'
import { clamp, type RandomSource } from './metric-generator'

/** Fraction of the remaining distance to the target closed per tick. Higher = faster ramp. */
const APPROACH_RATE: Record<ScenarioType, number> = {
  NORMAL: 0.25,
  CPU_SPIKE: 0.35,
  IDLE_RESOURCE: 0.2,
  // Deliberately slow — a memory leak should visibly climb over many ticks,
  // not jump to its target on the first one.
  MEMORY_LEAK: 0.06,
  OVERPROVISIONED: 0.15,
  COST_SPIKE: 0.25,
  TRAFFIC_SURGE: 0.4,
}

// Per-tick jitter is intentionally smaller than metric-generator's one-shot
// jitter — a continuous tick series should look smooth, not noisy.
const TICK_JITTER_FRACTION = 0.03

const MS_PER_HOUR = 3_600_000

// A memory leak plateaus just short of 100% instead of visually pegging the
// gauge at the ceiling forever, which reads as "about to fail," not "failed."
const MEMORY_LEAK_CEILING_PERCENT = 99

function round(value: number, precision: number): number {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

function approach(
  current: number,
  target: number,
  rate: number,
  random: RandomSource,
  min: number,
  max: number,
): number {
  const stepped = current + (target - current) * rate
  const swing = Math.max(Math.abs(target), 1) * TICK_JITTER_FRACTION
  const jittered = stepped + (random() * 2 - 1) * swing
  return clamp(jittered, min, max)
}

export interface TickStepOptions {
  random: RandomSource
  tickIntervalMs: number
}

/**
 * Compute the next tick's metrics for a resource, given its current metrics
 * and active scenario. Pure and deterministic for a given random source —
 * no store access, no I/O.
 */
export function stepResourceMetrics(
  current: ResourceMetrics,
  scenario: ScenarioType,
  options: TickStepOptions,
): ResourceMetrics {
  const { random, tickIntervalMs } = options
  const target = getScenarioDefinition(scenario).targetMetrics
  const rate = APPROACH_RATE[scenario]
  const memoryCeiling = scenario === 'MEMORY_LEAK' ? MEMORY_LEAK_CEILING_PERCENT : 100

  const cpuPercent = approach(current.cpuPercent, target.cpuPercent, rate, random, 0, 100)
  const memoryPercent = approach(current.memoryPercent, target.memoryPercent, rate, random, 0, memoryCeiling)
  const networkInMb = approach(current.networkInMb, target.networkInMb, rate, random, 0, Number.POSITIVE_INFINITY)
  const networkOutMb = approach(current.networkOutMb, target.networkOutMb, rate, random, 0, Number.POSITIVE_INFINITY)
  const requestsPerMinute = Math.round(
    approach(current.requestsPerMinute, target.requestsPerMinute, rate, random, 0, Number.POSITIVE_INFINITY),
  )
  const latencyMs = approach(current.latencyMs, target.latencyMs, rate, random, 0, Number.POSITIVE_INFINITY)
  const errorRatePercent = approach(current.errorRatePercent, target.errorRatePercent, rate, random, 0, 100)

  const isIdleLike = scenario === 'IDLE_RESOURCE' || scenario === 'OVERPROVISIONED'
  const idleHoursDelta = tickIntervalMs / MS_PER_HOUR
  const idleHours = isIdleLike
    ? current.idleHours + idleHoursDelta
    : Math.max(0, current.idleHours - idleHoursDelta)

  return {
    cpuPercent: round(cpuPercent, 1),
    memoryPercent: round(memoryPercent, 1),
    networkInMb: round(networkInMb, 2),
    networkOutMb: round(networkOutMb, 2),
    requestsPerMinute,
    latencyMs: round(latencyMs, 1),
    errorRatePercent: round(errorRatePercent, 2),
    idleHours: round(idleHours, 3),
  }
}
