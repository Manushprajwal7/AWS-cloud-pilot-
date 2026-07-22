import { NextRequest } from 'next/server'
import { getAgentRun } from '@/lib/db/repositories/agent-run-repository'
import { subscribeToRun, type GraphRunEvent } from '@/lib/langgraph/run-registry'

export const runtime = 'nodejs'

const HEARTBEAT_INTERVAL_MS = 10000

/**
 * GET /api/graph/runs/:runId/stream — SSE feed of real LangGraph execution
 * events for one run (node_event per completed node, then run_completed or
 * run_failed). Connects the terminal UI to actual graph.stream() output;
 * no event here is synthesized on a timer except the keep-alive heartbeat.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }): Promise<Response> {
  const { runId } = await params
  const encoder = new TextEncoder()

  let existingRun: Awaited<ReturnType<typeof getAgentRun>>
  try {
    existingRun = await getAgentRun(runId)
  } catch (error) {
    console.error('[graph:stream] failed to look up run — database unreachable?', error)
    return new Response(JSON.stringify({ error: 'The database is unreachable — is Postgres running?' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (!existingRun) {
    return new Response(JSON.stringify({ error: `Run '${runId}' does not exist` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // subscribeToRun replays its buffered events synchronously, so a run
      // that already finished emits run_completed *during* the subscribe call
      // below — before it has returned an unsubscribe handle and before the
      // heartbeat exists. Both must therefore be nullable and declared up
      // front: closing over `const`s assigned after the subscribe threw
      // "Cannot access 'unsubscribe' before initialization" and turned every
      // fast run's stream into an HTTP 500.
      let closed = false
      let unsubscribe: (() => void) | null = null
      let heartbeat: ReturnType<typeof setInterval> | null = null

      function send(payload: unknown): void {
        if (closed) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }

      const cleanup = () => {
        if (closed) return
        closed = true
        if (heartbeat) {
          clearInterval(heartbeat)
          heartbeat = null
        }
        unsubscribe?.()
        try {
          controller.close()
        } catch {
          // already closed
        }
      }

      const dispose = subscribeToRun(runId, (event: GraphRunEvent) => {
        send(event)
        if (event.type === 'run_completed' || event.type === 'run_failed') {
          cleanup()
        }
      })

      if (closed) {
        // The replay above already delivered a terminal event and closed the
        // stream; cleanup couldn't unsubscribe because `dispose` didn't exist
        // yet, so drop the listener here instead of leaking it.
        dispose()
        return
      }

      unsubscribe = dispose

      heartbeat = setInterval(() => {
        send({ type: 'heartbeat', timestamp: new Date().toISOString() })
      }, HEARTBEAT_INTERVAL_MS)

      request.signal.addEventListener('abort', cleanup)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
