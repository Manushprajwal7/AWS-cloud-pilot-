import { NextRequest, NextResponse } from 'next/server'
import { simulationStore } from '@/lib/simulation/simulation-store'
import { graphRunRequestSchema } from '@/lib/langgraph/schemas'
import { startGraphRun } from '@/lib/langgraph/run-registry'

/**
 * POST /api/graph/run — starts one real LangGraph execution for a
 * resource and returns immediately with the runId; the run keeps
 * executing in the background. Clients watch progress via
 * GET /api/graph/runs/:runId/stream or poll GET /api/graph/runs/:runId.
 * This route never blocks on the LLM-backed nodes (diagnose/planRemediation).
 */
export async function POST(request: NextRequest): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
  }

  const parsed = graphRunRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body', details: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  const resource = simulationStore.getResource(parsed.data.resourceId)
  if (!resource) {
    return NextResponse.json({ error: `Resource '${parsed.data.resourceId}' does not exist` }, { status: 404 })
  }

  let started: Awaited<ReturnType<typeof startGraphRun>>
  try {
    started = await startGraphRun({ resourceId: parsed.data.resourceId })
  } catch (error) {
    // initializeGraphRun persists the AgentRun row before the graph starts
    // streaming; if Postgres is unreachable that throws here, synchronously,
    // before there's anything to stream. Surface it the same way the rest of
    // the API reports a down database instead of a raw 500.
    console.error('[graph:run] failed to start — database unreachable?', error)
    return NextResponse.json(
      { error: 'Unable to start the graph run — the database is unreachable. Is Postgres running?' },
      { status: 503 },
    )
  }

  const { runId, done } = started

  // Surface node-level failures in server logs even though the client
  // isn't awaiting this promise; subscribers to the stream route already
  // receive the run_failed event.
  done.catch((error) => {
    console.error(`[graph:${runId}] run failed`, error)
  })

  return NextResponse.json({ runId, status: 'running' }, { status: 202 })
}
