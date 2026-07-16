/**
 * Domain model for deterministic anomaly detection. Every field here is
 * produced by rules.ts's threshold checks against real simulated metrics —
 * nothing in this module is ever populated by an LLM.
 */

export type AnomalyType =
  | 'SUSTAINED_CPU_SPIKE'
  | 'IDLE_RESOURCE'
  | 'MEMORY_LEAK'
  | 'OVERPROVISIONED'
  | 'COST_SPIKE'
  | 'TRAFFIC_SURGE'
  | 'ELEVATED_ERROR_RATE'

export const ALL_ANOMALY_TYPES: AnomalyType[] = [
  'SUSTAINED_CPU_SPIKE',
  'IDLE_RESOURCE',
  'MEMORY_LEAK',
  'OVERPROVISIONED',
  'COST_SPIKE',
  'TRAFFIC_SURGE',
  'ELEVATED_ERROR_RATE',
]

export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical'

export type AnomalyResolutionStatus = 'active' | 'resolved'

export type AnomalyResolutionReason = 'manual' | 'condition_cleared'

export interface AnomalyEvidence {
  metric: string
  observedValue: number
  threshold: number
  unit: string
  description: string
}

export interface Anomaly {
  id: string
  resourceId: string
  type: AnomalyType
  severity: AnomalySeverity
  /** 0-1, a deterministic function of how far past threshold and how consistently across the observed window — never an LLM-estimated confidence. */
  confidence: number
  evidence: AnomalyEvidence[]
  /** When this anomaly record was created (equal to firstObservedAt). */
  detectedAt: string
  firstObservedAt: string
  /** Updated every time the same condition re-evaluates true for this resource — this is how duplicate alerts are prevented. */
  lastObservedAt: string
  status: AnomalyResolutionStatus
  resolvedAt?: string
  resolutionReason?: AnomalyResolutionReason
}

export type AnomalyEventType = 'anomaly_detected' | 'anomaly_updated' | 'anomaly_resolved'

export interface AnomalyEvent {
  type: AnomalyEventType
  anomaly: Anomaly
}

export type AnomalyListener = (event: AnomalyEvent) => void

/** What a single rule evaluation produces when its condition is met. Rules return null when the condition isn't met. */
export interface RuleMatch {
  type: AnomalyType
  severity: AnomalySeverity
  confidence: number
  evidence: AnomalyEvidence[]
}
