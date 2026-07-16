import { NextRequest } from 'next/server'
import { simulationStore } from '@/lib/simulation/simulation-store'
import { tickEngine } from '@/lib/simulation/tick-engine'
import type { SimulationStoreEvent } from '@/lib/simulation/types'

export const runtime = 'nodejs'

const HEARTBEAT_INTERVAL_MS = 5000

type StreamMessage =
  | { type: 'snapshot'; resources: ReturnType<typeof simulationStore.listResources>; running: boolean }
  | { type: 'store_event'; event: SimulationStoreEvent; running: boolean }
  | { type: 'heartbeat'; running: boolean; timestamp: string }

/**
 * GET /api/simulation/stream — SSE feed of live simulation state.
 *
 * Sends an initial full snapshot, then relays every simulationStore
 * mutation (resource updates, scenario activations, resets, metric
 * snapshots — including the ones the tick engine produces every tick) as
 * it happens, plus a periodic heartbeat carrying the engine's running
 * state so clients can distinguish "live," "paused" (engine stopped), and
 * "disconnected" (the connection itself dropped).
 */
export async function GET(request: NextRequest): Promise<Response> {
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      function send(message: StreamMessage): void {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`))
      }

      send({ type: 'snapshot', resources: simulationStore.listResources(), running: tickEngine.isRunning() })

      const unsubscribe = simulationStore.subscribe((event) => {
        send({ type: 'store_event', event, running: tickEngine.isRunning() })
      })

      const heartbeat = setInterval(() => {
        send({ type: 'heartbeat', running: tickEngine.isRunning(), timestamp: new Date().toISOString() })
      }, HEARTBEAT_INTERVAL_MS)

      const cleanup = () => {
        unsubscribe()
        clearInterval(heartbeat)
        try {
          controller.close()
        } catch {
          // already closed
        }
      }

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
