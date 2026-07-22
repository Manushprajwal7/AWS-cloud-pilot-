import { describe, expect, it } from 'vitest'
import { routeAfterPlanRemediation, routeAfterVerification } from './routes'
import type { GraphState, RemediationPlanOutput } from './state'

function stateWith(overrides: Partial<GraphState>): GraphState {
  return overrides as GraphState
}

function planWith(action: RemediationPlanOutput['action']): RemediationPlanOutput {
  return { action, rationale: 'because', riskLevel: 'low', requiresApproval: false, expectedMonthlySavingsUsd: 0 }
}

describe('routeAfterPlanRemediation', () => {
  it('routes to audit on a node error, regardless of the plan', () => {
    expect(routeAfterPlanRemediation(stateWith({ error: 'boom', remediationPlan: planWith('RIGHTSIZE') }))).toBe('audit')
  })

  it('routes NO_ACTION straight to audit — terraformGenerate has no template for it', () => {
    expect(routeAfterPlanRemediation(stateWith({ remediationPlan: planWith('NO_ACTION') }))).toBe('audit')
  })

  it('routes actions with a real Terraform template on to terraformGenerate', () => {
    for (const action of ['RIGHTSIZE', 'SCALE_IN', 'SCALE_OUT', 'STOP', 'SCHEDULE'] as const) {
      expect(routeAfterPlanRemediation(stateWith({ remediationPlan: planWith(action) }))).toBe('terraformGenerate')
    }
  })
})

describe('routeAfterVerification', () => {
  it('routes to calculateRealizedSavings when verification passed', () => {
    expect(routeAfterVerification(stateWith({ verificationResult: { passed: true, checks: [] } }))).toBe('calculateRealizedSavings')
  })

  it('routes to rollback when verification failed, even though terraformApplyWorker had set state.error on a failed apply', () => {
    // verificationNode always clears error on its own success (see
    // lib/langgraph/nodes/verification.ts) — this reproduces the exact
    // state shape a failed apply leaves behind, to guard against that
    // clearing regressing and this router's `if (state.error)` guard
    // swallowing the rollback path again.
    expect(
      routeAfterVerification(
        stateWith({ error: null, verificationResult: { passed: false, checks: [{ name: 'terraform_apply_succeeded', passed: false, details: 'terraform apply failed' }] } }),
      ),
    ).toBe('rollback')
  })

  it('routes to audit when the verification node itself failed to run (state.error still set)', () => {
    expect(routeAfterVerification(stateWith({ error: 'verificationWorker crashed', verificationResult: undefined }))).toBe('audit')
  })
})
