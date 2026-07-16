/**
 * The compiled CloudPilot graph:
 *
 *   START -> monitor -> detectAnomaly
 *     -> [diagnose -> calculateImpact -> planRemediation
 *         -> terraformGenerate -> staticSecurity
 *         -> [terraformFormat <-> terraformInit <-> terraformValidate <-> selfCorrection]*
 *         -> terraformPlan -> planPolicy -> autoApproval -> terraformApply
 *         -> verification -> [rollback | calculateRealizedSavings]]
 *     -> audit -> END
 *
 * The starred segment is a bounded loop (see MAX_CORRECTION_ATTEMPTS in
 * state.ts): a correctable sandbox failure routes to selfCorrection, which
 * on success loops back to terraformFormat with corrected code. Every
 * bracketed path only runs if the step that gates it succeeded (no
 * anomaly, no node error, a passing security decision, an approved plan);
 * otherwise routing skips straight to audit (routes.ts). Every node is
 * wrapped by withNodeInstrumentation so node-level timing, success/failure,
 * and persistence (AgentNodeRun rows) are handled once, generically,
 * rather than duplicated in each node module.
 */

import { StateGraph, START, END } from '@langchain/langgraph'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db/client'
import { completeNodeRun, createAgentRun, startNodeRun, updateAgentRunStatus } from '@/lib/db/repositories/agent-run-repository'
import { monitorNode } from './nodes/monitor'
import { detectAnomalyNode } from './nodes/detect-anomaly'
import { diagnoseNode } from './nodes/diagnose'
import { calculateImpactNode } from './nodes/calculate-impact'
import { planRemediationNode } from './nodes/plan-remediation'
import { terraformGenerateNode } from './nodes/terraform-generate'
import { staticSecurityNode } from './nodes/static-security'
import { terraformFormatNode } from './nodes/terraform-format'
import { terraformInitNode } from './nodes/terraform-init'
import { terraformValidateNode } from './nodes/terraform-validate'
import { selfCorrectionNode } from './nodes/self-correction'
import { terraformPlanNode } from './nodes/terraform-plan'
import { planPolicyNode } from './nodes/plan-policy'
import { autoApprovalNode } from './nodes/auto-approval'
import { terraformApplyNode } from './nodes/terraform-apply'
import { verificationNode } from './nodes/verification'
import { rollbackNode } from './nodes/rollback'
import { calculateRealizedSavingsNode } from './nodes/calculate-realized-savings'
import { auditNode } from './nodes/audit'
import {
  routeAfterAutoApproval,
  routeAfterCalculateImpact,
  routeAfterDetectAnomaly,
  routeAfterDiagnose,
  routeAfterMonitor,
  routeAfterPlanPolicy,
  routeAfterPlanRemediation,
  routeAfterSelfCorrection,
  routeAfterStaticSecurity,
  routeAfterTerraformApply,
  routeAfterTerraformFormat,
  routeAfterTerraformGenerate,
  routeAfterTerraformInit,
  routeAfterTerraformPlan,
  routeAfterTerraformValidate,
  routeAfterVerification,
} from './routes'
import { GraphStateAnnotation, type GraphNodeName, type GraphState, type GraphStateUpdate } from './state'

// Generous headroom for the correction loop: up to MAX_CORRECTION_ATTEMPTS
// (3) retries, each of which can re-walk terraformFormat -> terraformInit
// -> terraformValidate -> selfCorrection before looping back, on top of the
// ~15 linear nodes in the rest of the graph.
export const DEFAULT_RECURSION_LIMIT = 60

type NodeFn = (state: GraphState) => Promise<GraphStateUpdate>

/**
 * Wraps a node function with real, non-fabricated instrumentation: an
 * AgentNodeRun row is created before the node runs and closed out with its
 * actual status/duration/error after.
 *
 * Two distinct failure signals are handled:
 *  - A thrown error (a genuine bug/invariant violation — e.g. a required
 *    upstream field is missing) is caught here and converted into
 *    state.error so routing can send the run to auditWorker instead of
 *    LangGraph aborting the whole execution.
 *  - A normally-returned update with `error` set (a real, expected business
 *    outcome — e.g. `terraform validate` exited non-zero) is treated the
 *    same way for AgentNodeRun/nodeExecutions bookkeeping, but the node's
 *    own return value is preserved rather than discarded, since nodes like
 *    terraformFormatWorker set other fields (sandboxWorkspacePath, etc.)
 *    alongside `error` that later nodes (selfCorrectionAgent) depend on.
 *  A node like staticSecurityWorker that reports a negative *policy*
 *  outcome without setting `error` is not treated as a node failure here —
 *  that's a business decision, not a node error.
 */
function withNodeInstrumentation(node: GraphNodeName, fn: NodeFn): NodeFn {
  return async (state: GraphState): Promise<GraphStateUpdate> => {
    const startedAt = new Date()
    const startedAtIso = startedAt.toISOString()

    const agentRun = await prisma.agentRun.findUnique({ where: { runId: state.runId } })
    const nodeRun = agentRun ? await startNodeRun(agentRun.id, node, { resourceId: state.resourceId }) : null

    if (agentRun) {
      await updateAgentRunStatus(state.runId, 'running', { currentNode: node })
    }

    try {
      const update = await fn(state)
      // update.error's static type includes LangGraph's update-operator
      // wrapper shape; at runtime a node only ever returns a plain string
      // or null/undefined for this field (see GraphStateAnnotation's
      // lastValueReducer), so a plain-string check is safe here.
      const updateError = typeof update.error === 'string' ? update.error : undefined
      const failed = Boolean(updateError)

      if (nodeRun) {
        await completeNodeRun(nodeRun.id, {
          status: failed ? 'failed' : 'completed',
          output: update,
          error: updateError,
          startedAt,
        })
      }

      return {
        ...update,
        nodeExecutions: [
          {
            node,
            status: failed ? 'failed' : 'completed',
            startedAt: startedAtIso,
            completedAt: new Date().toISOString(),
            error: updateError,
          },
        ],
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown node failure'

      if (nodeRun) {
        await completeNodeRun(nodeRun.id, { status: 'failed', error: message, startedAt })
      }

      return {
        error: message,
        nodeExecutions: [
          { node, status: 'failed', startedAt: startedAtIso, completedAt: new Date().toISOString(), error: message },
        ],
      }
    }
  }
}

export function buildGraph() {
  const graph = new StateGraph(GraphStateAnnotation)
    .addNode('monitor', withNodeInstrumentation('monitor', monitorNode))
    .addNode('detectAnomaly', withNodeInstrumentation('detectAnomaly', detectAnomalyNode))
    .addNode('diagnose', withNodeInstrumentation('diagnose', diagnoseNode))
    .addNode('calculateImpact', withNodeInstrumentation('calculateImpact', calculateImpactNode))
    .addNode('planRemediation', withNodeInstrumentation('planRemediation', planRemediationNode))
    .addNode('terraformGenerate', withNodeInstrumentation('terraformGenerate', terraformGenerateNode))
    .addNode('staticSecurity', withNodeInstrumentation('staticSecurity', staticSecurityNode))
    .addNode('terraformFormat', withNodeInstrumentation('terraformFormat', terraformFormatNode))
    .addNode('terraformInit', withNodeInstrumentation('terraformInit', terraformInitNode))
    .addNode('terraformValidate', withNodeInstrumentation('terraformValidate', terraformValidateNode))
    .addNode('selfCorrection', withNodeInstrumentation('selfCorrection', selfCorrectionNode))
    .addNode('terraformPlan', withNodeInstrumentation('terraformPlan', terraformPlanNode))
    .addNode('planPolicy', withNodeInstrumentation('planPolicy', planPolicyNode))
    .addNode('autoApproval', withNodeInstrumentation('autoApproval', autoApprovalNode))
    .addNode('terraformApply', withNodeInstrumentation('terraformApply', terraformApplyNode))
    .addNode('verification', withNodeInstrumentation('verification', verificationNode))
    .addNode('rollback', withNodeInstrumentation('rollback', rollbackNode))
    .addNode('calculateRealizedSavings', withNodeInstrumentation('calculateRealizedSavings', calculateRealizedSavingsNode))
    .addNode('audit', withNodeInstrumentation('audit', auditNode))
    .addEdge(START, 'monitor')
    .addConditionalEdges('monitor', routeAfterMonitor, { detectAnomaly: 'detectAnomaly', audit: 'audit' })
    .addConditionalEdges('detectAnomaly', routeAfterDetectAnomaly, { diagnose: 'diagnose', audit: 'audit' })
    .addConditionalEdges('diagnose', routeAfterDiagnose, { calculateImpact: 'calculateImpact', audit: 'audit' })
    .addConditionalEdges('calculateImpact', routeAfterCalculateImpact, { planRemediation: 'planRemediation', audit: 'audit' })
    .addConditionalEdges('planRemediation', routeAfterPlanRemediation, { terraformGenerate: 'terraformGenerate', audit: 'audit' })
    .addConditionalEdges('terraformGenerate', routeAfterTerraformGenerate, { staticSecurity: 'staticSecurity', audit: 'audit' })
    .addConditionalEdges('staticSecurity', routeAfterStaticSecurity, { terraformFormat: 'terraformFormat', audit: 'audit' })
    .addConditionalEdges('terraformFormat', routeAfterTerraformFormat, {
      terraformInit: 'terraformInit',
      selfCorrection: 'selfCorrection',
      audit: 'audit',
    })
    .addConditionalEdges('terraformInit', routeAfterTerraformInit, {
      terraformValidate: 'terraformValidate',
      selfCorrection: 'selfCorrection',
      audit: 'audit',
    })
    .addConditionalEdges('terraformValidate', routeAfterTerraformValidate, {
      terraformPlan: 'terraformPlan',
      selfCorrection: 'selfCorrection',
      audit: 'audit',
    })
    .addConditionalEdges('selfCorrection', routeAfterSelfCorrection, { terraformFormat: 'terraformFormat', audit: 'audit' })
    .addConditionalEdges('terraformPlan', routeAfterTerraformPlan, { planPolicy: 'planPolicy', audit: 'audit' })
    .addConditionalEdges('planPolicy', routeAfterPlanPolicy, { autoApproval: 'autoApproval', audit: 'audit' })
    .addConditionalEdges('autoApproval', routeAfterAutoApproval, { terraformApply: 'terraformApply', audit: 'audit' })
    .addConditionalEdges('terraformApply', routeAfterTerraformApply, { verification: 'verification', audit: 'audit' })
    .addConditionalEdges('verification', routeAfterVerification, {
      rollback: 'rollback',
      calculateRealizedSavings: 'calculateRealizedSavings',
      audit: 'audit',
    })
    .addEdge('rollback', 'audit')
    .addEdge('calculateRealizedSavings', 'audit')
    .addEdge('audit', END)

  return graph.compile()
}

export const cloudPilotGraph = buildGraph()

export interface StartGraphRunOptions {
  resourceId: string
  runId?: string
  recursionLimit?: number
}

/**
 * Creates the AgentRun row and the initial GraphState for a new run. Split
 * out from the streaming/invoke call so app/api/graph/run and the SSE
 * stream route can share exactly the same setup.
 */
export async function initializeGraphRun(options: StartGraphRunOptions) {
  const runId = options.runId ?? randomUUID()

  await createAgentRun({ runId, input: { resourceId: options.resourceId } })

  const initialState: Partial<GraphState> = {
    runId,
    resourceId: options.resourceId,
    status: 'running',
  }

  return {
    runId,
    initialState,
    config: {
      configurable: { thread_id: runId },
      recursionLimit: options.recursionLimit ?? DEFAULT_RECURSION_LIMIT,
    },
  }
}

export async function finalizeGraphRun(runId: string, finalState: GraphState) {
  await updateAgentRunStatus(runId, finalState.status, {
    currentNode: null,
    output: {
      anomaly: finalState.anomaly,
      diagnosis: finalState.diagnosis,
      financialImpact: finalState.financialImpact,
      remediationPlan: finalState.remediationPlan,
      terraformArtifact: finalState.terraformArtifact,
      terraformArtifactId: finalState.terraformArtifactId,
      securityValidation: finalState.securityValidation,
      planSummary: finalState.planSummary,
      correctionAttempts: finalState.correctionAttempts,
      planAnalysis: finalState.planAnalysis,
      approvalDecision: finalState.approvalDecision,
      applySucceeded: finalState.applySucceeded,
      applyExecutionId: finalState.applyExecutionId,
      verificationResult: finalState.verificationResult,
      rollbackResult: finalState.rollbackResult,
      realizedSavingsUsd: finalState.realizedSavingsUsd,
    },
    error: finalState.error,
  })
}
