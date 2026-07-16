/**
 * Pure metric generation: produces one realistic metric snapshot for a
 * resource given its active scenario. Randomness is injected (defaults to
 * Math.random) so callers — including the tick engine in Phase 3 — can
 * supply a seeded PRNG and get deterministic, testable output.
 */

import type { ResourceMetrics, ScenarioType } from './types'
import { getScenarioDefinition } from './scenarios'

export type RandomSource = () => number

const VARIANCE_FRACTION = 0.08 // +/- 8% jitter around the scenario target

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Apply +/- variance% jitter to a base value using the given random source,
 * then round to a sane precision for the metric's unit.
 */
function jitter(base: number, random: RandomSource, precision: number): number {
  const swing = base * VARIANCE_FRACTION
  const value = base + (random() * 2 - 1) * swing
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

export interface GenerateMetricsOptions {
  random?: RandomSource
  /** Previous metrics, used so idleHours/memory can build on the last value instead of resetting every call. */
  previousMetrics?: ResourceMetrics
}

/**
 * Generate one metric snapshot for a resource on the given scenario. This
 * is a single-shot "what would this resource look like right now" — the
 * tick engine (Phase 3) calls it repeatedly to produce a live series and
 * layers in progression/recovery behaviour on top.
 */
export function generateMetrics(scenario: ScenarioType, options: GenerateMetricsOptions = {}): ResourceMetrics {
  const random = options.random ?? Math.random
  const target = getScenarioDefinition(scenario).targetMetrics

  const cpuPercent = clamp(jitter(target.cpuPercent, random, 1), 0, 100)
  const memoryPercent = clamp(jitter(target.memoryPercent, random, 1), 0, 100)
  const networkInMb = Math.max(0, jitter(target.networkInMb, random, 2))
  const networkOutMb = Math.max(0, jitter(target.networkOutMb, random, 2))
  const requestsPerMinute = Math.max(0, Math.round(jitter(target.requestsPerMinute, random, 0)))
  const latencyMs = Math.max(0, jitter(target.latencyMs, random, 1))
  const errorRatePercent = clamp(jitter(target.errorRatePercent, random, 2), 0, 100)

  // idleHours accumulates while idle rather than jittering around a fixed
  // point — a resource that's been idle for 6 hours doesn't randomly drop
  // back to 1. Non-idle scenarios stay at 0.
  const idleHours =
    scenario === 'IDLE_RESOURCE' || scenario === 'OVERPROVISIONED'
      ? Math.max(target.idleHours, options.previousMetrics?.idleHours ?? 0)
      : 0

  return {
    cpuPercent,
    memoryPercent,
    networkInMb,
    networkOutMb,
    requestsPerMinute,
    latencyMs,
    errorRatePercent,
    idleHours,
  }
}
