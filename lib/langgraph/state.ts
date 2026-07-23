/**
 * Shared typed state for the CloudPilot LangGraph run:
 *
 *   monitor -> detectAnomaly -> diagnose -> calculateImpact -> planRemediation
 *     -> terraformGenerate -> staticSecurity
 *     -> [terraformFormat <-> terraformInit <-> terraformValidate <-> selfCorrection]*
 *     -> terraformPlan -> planPolicy -> autoApproval -> terraformApply
 *     -> verification -> [rollback | calculateRealizedSavings] -> audit
 *
 * The starred segment is a bounded loop: a correctable sandbox failure
 * routes to selfCorrection (max 3 attempts per run — MAX_CORRECTION_ATTEMPTS
 * below), which on success loops back to terraformFormat with corrected
 * code. verification always runs after apply (even if apply failed — that's
 * one of the conditions it checks) and its result decides whether rollback
 * or calculateRealizedSavings runs next. Every node reads and returns a
 * partial GraphState; LangGraph merges partial updates into the running
 * state using the reducers below. The run id is set once by the caller and
 * never overwritten by a node.
 */

import { Annotation } from '@langchain/langgraph'
import { z } from 'zod'
import type { Anomaly } from '@/lib/anomalies/types'
import type { MetricSnapshot, SimulatedCloudResource } from '@/lib/simulation/types'
import type { FinancialImpact } from '@/lib/financial/impact'
import type { GeneratedArtifact } from '@/lib/terraform/generator'
import type { AutoApprovalResult, PlanAnalysis, PlanSummary, SandboxCommandResult, StaticValidationResult } from '@/lib/terraform/types'
import type { CheckResult } from '@/lib/verification/health-checks'

export const MAX_CORRECTION_ATTEMPTS = 3

export const GRAPH_NODE_NAMES = [
  'monitor',
  'detectAnomaly',
  'diagnose',
  'calculateImpact',
  'planRemediation',
  'terraformGenerate',
  'staticSecurity',
  'terraformFormat',
  'terraformInit',
  'terraformValidate',
  'selfCorrection',
  'terraformPlan',
  'planPolicy',
  'autoApproval',
  'awaitApproval',
  'terraformApply',
  'verification',
  'rollback',
  'calculateRealizedSavings',
  'audit',
] as const

export type GraphNodeName = (typeof GRAPH_NODE_NAMES)[number]

export type GraphStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'no_anomaly'
  | 'rejected'
  | 'awaiting_approval'
  | 'applied'
  | 'rolled_back'

// ---------------------------------------------------------------------------
// Verification / rollback outcomes (Phase 9) — plain interfaces, not Zod
// schemas: nothing here is LLM output, every field traces back to a
// deterministic check in lib/verification/*.
// ---------------------------------------------------------------------------

export interface VerificationOutcome {
  passed: boolean
  checks: CheckResult[]
}

export interface RollbackOutcome {
  rolledBack: boolean
  reason: string
}

// ---------------------------------------------------------------------------
// Zod-validated structured output: diagnosis
// ---------------------------------------------------------------------------

export const diagnosisSchema = z.object({
  rootCause: z.string().min(1).describe('Concise root-cause statement for the anomaly'),
  explanation: z.string().min(1).describe('2-4 sentence explanation grounded in the supplied evidence'),
  confidence: z.number().min(0).max(1).describe('Model confidence in this diagnosis, 0-1'),
  affectedMetrics: z.array(z.string()).describe('Metric names this diagnosis is based on'),
  recommendedActionType: z
    .enum(['NO_ACTION', 'STOP', 'RIGHTSIZE', 'SCHEDULE', 'SCALE_OUT', 'SCALE_IN'])
    .describe('The category of remediation this diagnosis points to'),
})

export type Diagnosis = z.infer<typeof diagnosisSchema>

// ---------------------------------------------------------------------------
// Zod-validated structured output: remediation plan
// ---------------------------------------------------------------------------

export const remediationPlanSchema = z.object({
  action: z.enum(['NO_ACTION', 'STOP', 'RIGHTSIZE', 'SCHEDULE', 'SCALE_OUT', 'SCALE_IN']),
  rationale: z.string().min(1).describe('Why this action, referencing the diagnosis and financial impact'),
  riskLevel: z.enum(['low', 'medium', 'high']),
  requiresApproval: z.boolean().describe('Whether a human must approve before this plan is executed'),
  expectedMonthlySavingsUsd: z.number().min(0).nullable(),
})

export type RemediationPlanOutput = z.infer<typeof remediationPlanSchema>

// ---------------------------------------------------------------------------
// Node execution record (mirrors AgentNodeRun, kept in-state for the SSE
// stream so the client sees timing without a DB round trip per event)
// ---------------------------------------------------------------------------

export interface NodeExecutionRecord {
  node: GraphNodeName
  status: 'running' | 'completed' | 'failed' | 'skipped'
  startedAt: string
  completedAt?: string
  error?: string
}

function lastValueReducer<T>(_current: T, update: T): T {
  return update
}

export const GraphStateAnnotation = Annotation.Root({
  runId: Annotation<string>({ reducer: lastValueReducer, default: () => '' }),
  resourceId: Annotation<string>({ reducer: lastValueReducer, default: () => '' }),
  status: Annotation<GraphStatus>({ reducer: lastValueReducer, default: () => 'pending' }),
  currentNode: Annotation<GraphNodeName | null>({ reducer: lastValueReducer, default: () => null }),

  resource: Annotation<SimulatedCloudResource | null>({ reducer: lastValueReducer, default: () => null }),
  metricHistory: Annotation<MetricSnapshot[]>({ reducer: lastValueReducer, default: () => [] }),

  anomaly: Annotation<Anomaly | null>({ reducer: lastValueReducer, default: () => null }),
  diagnosis: Annotation<Diagnosis | null>({ reducer: lastValueReducer, default: () => null }),
  financialImpact: Annotation<FinancialImpact | null>({ reducer: lastValueReducer, default: () => null }),
  remediationPlan: Annotation<RemediationPlanOutput | null>({ reducer: lastValueReducer, default: () => null }),
  remediationPlanId: Annotation<string | null>({ reducer: lastValueReducer, default: () => null }),

  terraformArtifact: Annotation<GeneratedArtifact | null>({ reducer: lastValueReducer, default: () => null }),
  terraformArtifactId: Annotation<string | null>({ reducer: lastValueReducer, default: () => null }),
  securityValidation: Annotation<StaticValidationResult | null>({ reducer: lastValueReducer, default: () => null }),
  sandboxWorkspacePath: Annotation<string | null>({ reducer: lastValueReducer, default: () => null }),
  terraformExecutionId: Annotation<string | null>({ reducer: lastValueReducer, default: () => null }),
  sandboxCommandResults: Annotation<SandboxCommandResult[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
  planSummary: Annotation<PlanSummary | null>({ reducer: lastValueReducer, default: () => null }),

  correctionAttempts: Annotation<number>({ reducer: lastValueReducer, default: () => 0 }),
  planAnalysis: Annotation<PlanAnalysis | null>({ reducer: lastValueReducer, default: () => null }),
  approvalDecision: Annotation<AutoApprovalResult | null>({ reducer: lastValueReducer, default: () => null }),
  applySucceeded: Annotation<boolean>({ reducer: lastValueReducer, default: () => false }),
  applyExecutionId: Annotation<string | null>({ reducer: lastValueReducer, default: () => null }),

  preApplySnapshot: Annotation<SimulatedCloudResource | null>({ reducer: lastValueReducer, default: () => null }),
  verificationResult: Annotation<VerificationOutcome | null>({ reducer: lastValueReducer, default: () => null }),
  rollbackResult: Annotation<RollbackOutcome | null>({ reducer: lastValueReducer, default: () => null }),
  realizedSavingsUsd: Annotation<number | null>({ reducer: lastValueReducer, default: () => null }),

  nodeExecutions: Annotation<NodeExecutionRecord[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),

  error: Annotation<string | null>({ reducer: lastValueReducer, default: () => null }),
})

export type GraphState = typeof GraphStateAnnotation.State
export type GraphStateUpdate = typeof GraphStateAnnotation.Update
