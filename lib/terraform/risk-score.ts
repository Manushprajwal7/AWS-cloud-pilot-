/**
 * Deterministic 0-100 risk score for a Terraform plan. Pure arithmetic
 * over real plan-analysis inputs — no LLM, no randomness. Higher is
 * riskier; autoApprovalWorker uses this only as one more signal (the hard
 * rejection rules in environment-policy.ts do most of the actual gating).
 */

import type { CloudEnvironment } from '@/lib/simulation/types'

export interface RiskScoreInputs {
  createCount: number
  updateCount: number
  deleteCount: number
  replacementCount: number
  estimatedMonthlyCostChangeUsd: number
  environment: CloudEnvironment
}

const DELETE_WEIGHT = 40
const REPLACEMENT_WEIGHT = 25
const UPDATE_WEIGHT = 3
const PRODUCTION_WEIGHT = 20
const COST_INCREASE_WEIGHT = 15

export function calculateRiskScore(inputs: RiskScoreInputs): number {
  let score = 0
  score += inputs.deleteCount * DELETE_WEIGHT
  score += inputs.replacementCount * REPLACEMENT_WEIGHT
  score += inputs.updateCount * UPDATE_WEIGHT
  if (inputs.environment === 'production') score += PRODUCTION_WEIGHT
  if (inputs.estimatedMonthlyCostChangeUsd > 0) score += COST_INCREASE_WEIGHT

  return Math.max(0, Math.min(100, score))
}
