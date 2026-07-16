/**
 * Small helper for building consistent AnomalyEvidence entries — every rule
 * in rules.ts uses this instead of hand-assembling the shape itself.
 */

import type { AnomalyEvidence } from './types'

function round(value: number, precision = 2): number {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

export function buildEvidence(params: {
  metric: string
  observedValue: number
  threshold: number
  unit: string
  description: string
}): AnomalyEvidence {
  return {
    metric: params.metric,
    observedValue: round(params.observedValue),
    threshold: round(params.threshold),
    unit: params.unit,
    description: params.description,
  }
}
