/**
 * Shared types for the Terraform generation/validation/sandbox pipeline
 * (Phase 7). lib/terraform/* never imports from lib/langgraph/* — the graph
 * nodes in lib/langgraph/nodes/terraform-*.ts are thin adapters that call
 * into this package and translate the result into GraphState.
 */

import type { CloudService } from '@/lib/simulation/types'
import type { RemediationAction } from '@/lib/financial/rightsizing'

export type TerraformResourceType =
  | 'aws_instance'
  | 'aws_db_instance'
  | 'aws_ecs_service'
  | 'aws_lambda_function'
  | 'aws_elasticache_cluster'

export const RESOURCE_TYPE_BY_SERVICE: Record<CloudService, TerraformResourceType> = {
  EC2: 'aws_instance',
  RDS: 'aws_db_instance',
  ECS: 'aws_ecs_service',
  LAMBDA: 'aws_lambda_function',
  ELASTICACHE: 'aws_elasticache_cluster',
}

export interface GeneratedTerraform {
  hcl: string
  resourceType: TerraformResourceType
  resourceAddress: string
  action: RemediationAction
  /**
   * Real before/after values driving this specific change (e.g. "instance_type:
   * m5.xlarge (CPU 8.0%, memory 18.0%) -> m5.large") — never fabricated,
   * computed from the same lib/financial/rightsizing.ts recommendation that
   * produced the attribute change itself. Rendered as a comment header in
   * the generated .tf file (see generator.ts) so the graceful-downgrade
   * rationale is documented directly in the code, not just in the UI.
   */
  changeSummary: string
}

export interface NormalizedTerraform {
  hcl: string
  checksum: string
}

export interface SecurityFinding {
  policyName: string
  severity: 'critical' | 'high' | 'medium'
  message: string
  /** 1-indexed line number in the HCL the finding was found on, when known. */
  line?: number
}

export interface StaticValidationResult {
  passed: boolean
  findings: SecurityFinding[]
}

export type SandboxCommand = 'fmt' | 'fmt-fix' | 'init' | 'validate' | 'plan' | 'show' | 'apply'

export interface SandboxCommandResult {
  command: SandboxCommand
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  durationMs: number
}

export interface PlanResourceChange {
  address: string
  type: string
  actions: string[]
}

export interface PlanSummary {
  creates: number
  updates: number
  deletes: number
  noOps: number
  resourceChanges: PlanResourceChange[]
}

export interface PlanAnalysis {
  createCount: number
  updateCount: number
  deleteCount: number
  replacementCount: number
  affectedResourceCount: number
  estimatedMonthlyCostChangeUsd: number
  riskScore: number
  violations: string[]
}

export type ApprovalDecision = 'approved' | 'rejected'

export interface AutoApprovalResult {
  decision: ApprovalDecision
  reason: string
  codeHash: string
  planHash: string
  analysis: PlanAnalysis
}

export type CorrectionResult = 'corrected' | 'rejected' | 'failed'
