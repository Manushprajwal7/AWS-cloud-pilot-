/**
 * Deterministic anomaly rules. Each rule inspects a resource's current
 * state and its recent metric history (from simulationStore.getMetricHistory)
 * and returns a RuleMatch when its condition is met, or null otherwise.
 * No LLM involvement anywhere in this file — see lib/anomalies/detector.ts
 * for how these get turned into persisted, deduplicated Anomaly records.
 */

import type { MetricSnapshot, SimulatedCloudResource } from '@/lib/simulation/types'
import type { RuleMatch } from './types'
import { buildEvidence } from './evidence'
import { confidenceFromRatio, severityFromRatio } from './severity'

export type AnomalyRule = (resource: SimulatedCloudResource, history: MetricSnapshot[]) => RuleMatch | null

function lastN<T>(items: T[], n: number): T[] {
  return items.slice(Math.max(0, items.length - n))
}

// ---------------------------------------------------------------------------
// 1. Sustained CPU spike — cpuPercent must stay at/above threshold across the
//    whole observed window, not just spike momentarily.
// ---------------------------------------------------------------------------

const CPU_SPIKE_THRESHOLD = 80
const CPU_SPIKE_WINDOW = 3

export const sustainedCpuSpikeRule: AnomalyRule = (_resource, history) => {
  const window = lastN(history, CPU_SPIKE_WINDOW)
  if (window.length < CPU_SPIKE_WINDOW) return null

  const overThreshold = window.filter((point) => point.metrics.cpuPercent >= CPU_SPIKE_THRESHOLD)
  if (overThreshold.length < window.length) return null

  const current = window[window.length - 1].metrics.cpuPercent
  const ratio = current / CPU_SPIKE_THRESHOLD

  return {
    type: 'SUSTAINED_CPU_SPIKE',
    severity: severityFromRatio(ratio),
    confidence: confidenceFromRatio(ratio, overThreshold.length / window.length),
    evidence: [
      buildEvidence({
        metric: 'cpuPercent',
        observedValue: current,
        threshold: CPU_SPIKE_THRESHOLD,
        unit: '%',
        description: `CPU utilization has stayed at or above ${CPU_SPIKE_THRESHOLD}% for the last ${window.length} readings (currently ${current.toFixed(1)}%).`,
      }),
    ],
  }
}

// ---------------------------------------------------------------------------
// 2. Idle resource — near-zero CPU and request volume while still "running."
//    idleHours already encodes duration (lib/simulation/scenario-runners.ts
//    accumulates it by real elapsed time), so a single reading is enough.
// ---------------------------------------------------------------------------

const IDLE_CPU_THRESHOLD = 5
const IDLE_REQUESTS_THRESHOLD = 5
// Deliberately small relative to a real "this has been idle for a while"
// intuition: idleHours accumulates in real wall-clock hours (see
// lib/simulation/scenario-runners.ts) against the tick engine's default 5s
// interval, so a 1-hour threshold would take 720 ticks to ever fire. 0.05h
// (~3 minutes, ~36 ticks) still requires sustained idleness rather than a
// single reading, while staying observable within a normal demo session.
const IDLE_MIN_HOURS = 0.05

export const idleResourceRule: AnomalyRule = (resource, history) => {
  const current = history.length > 0 ? history[history.length - 1].metrics : resource.metrics
  if (resource.status === 'stopped') return null
  if (current.cpuPercent >= IDLE_CPU_THRESHOLD) return null
  if (current.requestsPerMinute >= IDLE_REQUESTS_THRESHOLD) return null
  if (current.idleHours < IDLE_MIN_HOURS) return null

  const ratio = IDLE_CPU_THRESHOLD / Math.max(current.cpuPercent, 0.1)

  return {
    type: 'IDLE_RESOURCE',
    severity: current.idleHours >= 6 ? 'high' : current.idleHours >= 3 ? 'medium' : 'low',
    confidence: confidenceFromRatio(ratio),
    evidence: [
      buildEvidence({
        metric: 'cpuPercent',
        observedValue: current.cpuPercent,
        threshold: IDLE_CPU_THRESHOLD,
        unit: '%',
        description: `CPU utilization is only ${current.cpuPercent.toFixed(1)}%, below the ${IDLE_CPU_THRESHOLD}% idle threshold.`,
      }),
      buildEvidence({
        metric: 'idleHours',
        observedValue: current.idleHours,
        threshold: IDLE_MIN_HOURS,
        unit: 'hours',
        description: `Resource has been idle for ${current.idleHours.toFixed(1)} hours.`,
      }),
    ],
  }
}

// ---------------------------------------------------------------------------
// 3. Memory leak — memoryPercent both above threshold AND trending upward
//    across the window (distinguishes a leak from merely "high but stable").
// ---------------------------------------------------------------------------

const MEMORY_LEAK_THRESHOLD = 85
const MEMORY_LEAK_MIN_INCREASE = 10
const MEMORY_LEAK_WINDOW = 5

export const memoryLeakRule: AnomalyRule = (_resource, history) => {
  const window = lastN(history, MEMORY_LEAK_WINDOW)
  if (window.length < MEMORY_LEAK_WINDOW) return null

  const current = window[window.length - 1].metrics.memoryPercent
  const earliest = window[0].metrics.memoryPercent
  if (current < MEMORY_LEAK_THRESHOLD) return null

  const increase = current - earliest
  if (increase < MEMORY_LEAK_MIN_INCREASE) return null

  const ratio = current / MEMORY_LEAK_THRESHOLD

  return {
    type: 'MEMORY_LEAK',
    severity: severityFromRatio(ratio),
    confidence: confidenceFromRatio(ratio, Math.min(1, increase / 30)),
    evidence: [
      buildEvidence({
        metric: 'memoryPercent',
        observedValue: current,
        threshold: MEMORY_LEAK_THRESHOLD,
        unit: '%',
        description: `Memory utilization climbed from ${earliest.toFixed(1)}% to ${current.toFixed(1)}% over the last ${window.length} readings.`,
      }),
    ],
  }
}

// ---------------------------------------------------------------------------
// 4. Overprovisioned — low CPU and memory while still serving real traffic
//    (the "still serving traffic" floor is what distinguishes this from
//    IDLE_RESOURCE, which requires near-zero traffic).
// ---------------------------------------------------------------------------

const OVERPROVISIONED_CPU_THRESHOLD = 15
const OVERPROVISIONED_MEMORY_THRESHOLD = 25
const OVERPROVISIONED_MIN_REQUESTS = 10
const OVERPROVISIONED_WINDOW = 3

export const overprovisionedRule: AnomalyRule = (resource, history) => {
  if (resource.service === 'LAMBDA') return null // no fixed "instance size" to right-size in this model

  const window = lastN(history, OVERPROVISIONED_WINDOW)
  if (window.length < OVERPROVISIONED_WINDOW) return null

  const matching = window.filter(
    (point) =>
      point.metrics.cpuPercent < OVERPROVISIONED_CPU_THRESHOLD &&
      point.metrics.memoryPercent < OVERPROVISIONED_MEMORY_THRESHOLD &&
      point.metrics.requestsPerMinute >= OVERPROVISIONED_MIN_REQUESTS,
  )
  if (matching.length < window.length) return null

  const current = window[window.length - 1].metrics
  const ratio = OVERPROVISIONED_CPU_THRESHOLD / Math.max(current.cpuPercent, 0.1)

  return {
    type: 'OVERPROVISIONED',
    severity: severityFromRatio(ratio),
    confidence: confidenceFromRatio(ratio, matching.length / window.length),
    evidence: [
      buildEvidence({
        metric: 'cpuPercent',
        observedValue: current.cpuPercent,
        threshold: OVERPROVISIONED_CPU_THRESHOLD,
        unit: '%',
        description: `CPU (${current.cpuPercent.toFixed(1)}%) and memory (${current.memoryPercent.toFixed(1)}%) utilization are both low while still serving ${current.requestsPerMinute} req/min — this resource looks larger than it needs to be.`,
      }),
    ],
  }
}

// ---------------------------------------------------------------------------
// 5. Cost spike — hourly cost significantly above this resource's own recent
//    baseline (relative, not an absolute dollar threshold).
// ---------------------------------------------------------------------------

const COST_SPIKE_WINDOW = 5
const COST_SPIKE_RATIO_THRESHOLD = 1.5

export const costSpikeRule: AnomalyRule = (_resource, history) => {
  const window = lastN(history, COST_SPIKE_WINDOW)
  if (window.length < COST_SPIKE_WINDOW) return null

  const baseline = window[0].cost.hourlyUsd
  const current = window[window.length - 1].cost.hourlyUsd
  if (baseline <= 0) return null

  const ratio = current / baseline
  if (ratio < COST_SPIKE_RATIO_THRESHOLD) return null

  return {
    type: 'COST_SPIKE',
    severity: severityFromRatio(ratio),
    confidence: confidenceFromRatio(ratio),
    evidence: [
      buildEvidence({
        metric: 'hourlyUsd',
        observedValue: current,
        threshold: baseline * COST_SPIKE_RATIO_THRESHOLD,
        unit: 'USD/hr',
        description: `Hourly cost rose from $${baseline.toFixed(4)} to $${current.toFixed(4)} (${((ratio - 1) * 100).toFixed(0)}% increase) over the last ${window.length} readings.`,
      }),
    ],
  }
}

// ---------------------------------------------------------------------------
// 6. Traffic surge — request volume far above this resource's own recent
//    baseline, with an absolute floor so tiny-baseline noise can't trip it.
// ---------------------------------------------------------------------------

const TRAFFIC_SURGE_WINDOW = 5
const TRAFFIC_SURGE_RATIO_THRESHOLD = 3
const TRAFFIC_SURGE_MIN_ABSOLUTE = 200

export const trafficSurgeRule: AnomalyRule = (_resource, history) => {
  const window = lastN(history, TRAFFIC_SURGE_WINDOW)
  if (window.length < TRAFFIC_SURGE_WINDOW) return null

  const baseline = window[0].metrics.requestsPerMinute
  const current = window[window.length - 1].metrics.requestsPerMinute
  if (current < TRAFFIC_SURGE_MIN_ABSOLUTE) return null

  const ratio = baseline > 0 ? current / baseline : current
  if (ratio < TRAFFIC_SURGE_RATIO_THRESHOLD) return null

  const normalizedRatio = ratio / TRAFFIC_SURGE_RATIO_THRESHOLD

  return {
    type: 'TRAFFIC_SURGE',
    severity: severityFromRatio(normalizedRatio),
    confidence: confidenceFromRatio(normalizedRatio),
    evidence: [
      buildEvidence({
        metric: 'requestsPerMinute',
        observedValue: current,
        threshold: baseline * TRAFFIC_SURGE_RATIO_THRESHOLD,
        unit: 'req/min',
        description: `Request volume rose from ${baseline.toFixed(0)} to ${current.toFixed(0)} req/min (${ratio.toFixed(1)}x) over the last ${window.length} readings.`,
      }),
    ],
  }
}

// ---------------------------------------------------------------------------
// 7. Elevated error rate — sustained across at least 2 consecutive readings
//    so a single transient blip doesn't trigger an alert.
// ---------------------------------------------------------------------------

const ERROR_RATE_THRESHOLD = 1.0
const ERROR_RATE_WINDOW = 2

export const elevatedErrorRateRule: AnomalyRule = (_resource, history) => {
  const window = lastN(history, ERROR_RATE_WINDOW)
  if (window.length < ERROR_RATE_WINDOW) return null

  const matching = window.filter((point) => point.metrics.errorRatePercent >= ERROR_RATE_THRESHOLD)
  if (matching.length < window.length) return null

  const current = window[window.length - 1].metrics.errorRatePercent
  const ratio = current / ERROR_RATE_THRESHOLD

  return {
    type: 'ELEVATED_ERROR_RATE',
    severity: severityFromRatio(ratio),
    confidence: confidenceFromRatio(ratio, matching.length / window.length),
    evidence: [
      buildEvidence({
        metric: 'errorRatePercent',
        observedValue: current,
        threshold: ERROR_RATE_THRESHOLD,
        unit: '%',
        description: `Error rate has been at or above ${ERROR_RATE_THRESHOLD}% for the last ${window.length} readings (currently ${current.toFixed(2)}%).`,
      }),
    ],
  }
}

export const ANOMALY_RULES: AnomalyRule[] = [
  sustainedCpuSpikeRule,
  idleResourceRule,
  memoryLeakRule,
  overprovisionedRule,
  costSpikeRule,
  trafficSurgeRule,
  elevatedErrorRateRule,
]
