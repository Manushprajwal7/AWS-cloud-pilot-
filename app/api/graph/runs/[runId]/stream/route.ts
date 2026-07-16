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

  const existingRun = await getAgentRun(runId)
  if (!existingRun) {
    return new Response(JSON.stringify({ error: `Run '${runId}' does not exist` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      function send(payload: unknown): void {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }

      let closed = false
      const cleanup = () => {
        if (closed) return
        closed = true
        unsubscribe()
        clearInterval(heartbeat)
        try {
          controller.close()
        } catch {
          // already closed
        }
      }

      const unsubscribe = subscribeToRun(runId, (event: GraphRunEvent) => {
        send(event)
        if (event.type === 'run_completed' || event.type === 'run_failed') {
          cleanup()
        }
      })

      const heartbeat = setInterval(() => {
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
