import { NextRequest, NextResponse } from 'next/server'
import { getAgentRun } from '@/lib/db/repositories/agent-run-repository'

/**
 * GET /api/graph/runs/:runId — the persisted record of a graph run,
 * including every AgentNodeRun captured so far. Reflects real database
 * state; a run still executing simply shows fewer completed node rows.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ runId: string }> }): Promise<Response> {
  const { runId } = await params

  const run = await getAgentRun(runId)
  if (!run) {
    return NextResponse.json({ error: `Run '${runId}' does not exist` }, { status: 404 })
  }

  return NextResponse.json({ run })
}
