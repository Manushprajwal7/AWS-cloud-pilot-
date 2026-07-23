import { NextRequest, NextResponse } from 'next/server'
import { getAgentRun, updateAgentRunStatus } from '@/lib/db/repositories/agent-run-repository'
import { applyContinuationGraph, APPLY_CONTINUATION_RECURSION_LIMIT } from '@/lib/langgraph/apply-continuation'
import { finalizeGraphRun } from '@/lib/langgraph/graph'
import type { GraphState } from '@/lib/langgraph/state'

/**
 * POST /api/graph/runs/:runId/apply — the human-approval gate's "Apply
 * Changes" action. A run that stopped at awaitApproval (status
 * 'awaiting_approval', see lib/langgraph/nodes/await-approval.ts) is
 * resumed here from exactly terraformApply onward, using the same
 * GraphState the client already has (delivered via the run's
 * run_completed SSE event) — nothing is re-fetched or re-generated, this
 * runs the identical approved artifact through terraformApplyWorker,
 * verificationWorker, and rollback/audit. terraformApplyWorker itself
 * still refuses to apply if the artifact/plan hashes don't match what
 * autoApprovalWorker actually approved, so a tampered client body cannot
 * force an apply against different code.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ runId: string }> }): Promise<Response> {
  const { runId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
  }

  const state = (body as { state?: GraphState } | null)?.state
  if (!state || typeof state !== 'object' || state.runId !== runId) {
    return NextResponse.json({ error: 'Request body must include the run\'s current state ({ state }), matching this runId' }, { status: 400 })
  }

  if (state.approvalDecision?.decision !== 'approved') {
    return NextResponse.json({ error: 'This plan was not approved — nothing to apply' }, { status: 400 })
  }

  const agentRun = await getAgentRun(runId)
  if (!agentRun) {
    return NextResponse.json({ error: `Run '${runId}' does not exist` }, { status: 404 })
  }
  if (agentRun.status !== 'awaiting_approval') {
    return NextResponse.json({ error: `Run '${runId}' is not awaiting approval (status: ${agentRun.status})` }, { status: 409 })
  }

  try {
    let finalState: GraphState | null = null
    for await (const chunk of await applyContinuationGraph.stream(state, {
      configurable: { thread_id: runId },
      recursionLimit: APPLY_CONTINUATION_RECURSION_LIMIT,
      streamMode: 'values',
    })) {
      finalState = chunk as GraphState
    }
    if (!finalState) {
      throw new Error('apply continuation produced no state')
    }

    await finalizeGraphRun(runId, finalState)
    return NextResponse.json({ finalState })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown apply failure'
    await updateAgentRunStatus(runId, 'failed', { error: message }).catch(() => undefined)
    console.error(`[graph:${runId}] apply continuation failed`, error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
