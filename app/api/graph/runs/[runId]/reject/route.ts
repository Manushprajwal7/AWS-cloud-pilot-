import { NextRequest, NextResponse } from 'next/server'
import { getAgentRun } from '@/lib/db/repositories/agent-run-repository'
import { auditNode } from '@/lib/langgraph/nodes/audit'
import { finalizeGraphRun } from '@/lib/langgraph/graph'
import type { GraphState } from '@/lib/langgraph/state'

/**
 * POST /api/graph/runs/:runId/reject — the human-approval gate's "Reject"
 * action for a run parked at awaitApproval. Runs auditWorker directly
 * (the same node the main graph would have used had autoApprovalWorker
 * rejected the plan itself) so the sandbox workspace is cleaned up and one
 * AuditEvent row is recorded, without ever calling terraformApplyWorker.
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

  const agentRun = await getAgentRun(runId)
  if (!agentRun) {
    return NextResponse.json({ error: `Run '${runId}' does not exist` }, { status: 404 })
  }
  if (agentRun.status !== 'awaiting_approval') {
    return NextResponse.json({ error: `Run '${runId}' is not awaiting approval (status: ${agentRun.status})` }, { status: 409 })
  }

  const rejectedState: GraphState = {
    ...state,
    approvalDecision: state.approvalDecision
      ? { ...state.approvalDecision, decision: 'rejected', reason: 'Rejected by user in terraform sandbox' }
      : null,
  }

  try {
    const auditUpdate = await auditNode(rejectedState)
    const finalState = { ...rejectedState, ...auditUpdate } as GraphState
    await finalizeGraphRun(runId, finalState)
    return NextResponse.json({ finalState })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown rejection failure'
    console.error(`[graph:${runId}] reject failed`, error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
