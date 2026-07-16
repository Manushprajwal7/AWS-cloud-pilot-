/**
 * Zod-validated payload shapes for every queue. Workers must call
 * `<schema>.parse(job.data)` before doing anything else — a job whose
 * payload doesn't match its schema should fail fast and loud rather than
 * silently operate on `undefined` fields.
 */

import { z } from 'zod'

export const QUEUE_NAMES = {
  SIMULATION: 'cloudpilot-simulation',
  TERRAFORM_VALIDATION: 'cloudpilot-terraform-validation',
  TERRAFORM_PLAN: 'cloudpilot-terraform-plan',
  TERRAFORM_EXECUTION: 'cloudpilot-terraform-execution',
  VERIFICATION: 'cloudpilot-verification',
  AUDIT: 'cloudpilot-audit',
} as const

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES]

// ---------------------------------------------------------------------------
// cloudpilot-simulation
// ---------------------------------------------------------------------------

export const simulationJobSchema = z.object({
  resourceId: z.string().min(1),
  scenario: z.enum(['NORMAL', 'CPU_SPIKE', 'IDLE_RESOURCE', 'MEMORY_LEAK', 'OVERPROVISIONED', 'COST_SPIKE', 'TRAFFIC_SURGE']),
  requestedAt: z.string().datetime(),
})

export type SimulationJobPayload = z.infer<typeof simulationJobSchema>

// ---------------------------------------------------------------------------
// cloudpilot-terraform-validation
// ---------------------------------------------------------------------------

export const terraformValidationJobSchema = z.object({
  remediationPlanId: z.string().min(1),
  terraformArtifactId: z.string().min(1),
  hcl: z.string().min(1),
})

export type TerraformValidationJobPayload = z.infer<typeof terraformValidationJobSchema>

// ---------------------------------------------------------------------------
// cloudpilot-terraform-plan
// ---------------------------------------------------------------------------

export const terraformPlanJobSchema = z.object({
  remediationPlanId: z.string().min(1),
  terraformArtifactId: z.string().min(1),
})

export type TerraformPlanJobPayload = z.infer<typeof terraformPlanJobSchema>

// ---------------------------------------------------------------------------
// cloudpilot-terraform-execution
// ---------------------------------------------------------------------------

export const terraformExecutionJobSchema = z.object({
  terraformArtifactId: z.string().min(1),
  terraformExecutionId: z.string().min(1),
  operation: z.enum(['apply', 'destroy']),
  /** Idempotency key — workers must no-op if this operation already completed for this key. */
  idempotencyKey: z.string().min(1),
})

export type TerraformExecutionJobPayload = z.infer<typeof terraformExecutionJobSchema>

// ---------------------------------------------------------------------------
// cloudpilot-verification
// ---------------------------------------------------------------------------

export const verificationJobSchema = z.object({
  terraformExecutionId: z.string().min(1),
})

export type VerificationJobPayload = z.infer<typeof verificationJobSchema>

// ---------------------------------------------------------------------------
// cloudpilot-audit
// ---------------------------------------------------------------------------

export const auditJobSchema = z.object({
  agentRunId: z.string().nullable(),
  actor: z.string().min(1),
  action: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type AuditJobPayload = z.infer<typeof auditJobSchema>

export const JOB_SCHEMA_BY_QUEUE = {
  [QUEUE_NAMES.SIMULATION]: simulationJobSchema,
  [QUEUE_NAMES.TERRAFORM_VALIDATION]: terraformValidationJobSchema,
  [QUEUE_NAMES.TERRAFORM_PLAN]: terraformPlanJobSchema,
  [QUEUE_NAMES.TERRAFORM_EXECUTION]: terraformExecutionJobSchema,
  [QUEUE_NAMES.VERIFICATION]: verificationJobSchema,
  [QUEUE_NAMES.AUDIT]: auditJobSchema,
} as const
