import { describe, expect, it } from 'vitest'
import { routeAfterPlanRemediation } from './routes'
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
