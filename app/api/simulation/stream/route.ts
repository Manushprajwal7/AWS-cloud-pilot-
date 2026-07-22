import { NextRequest } from 'next/server'
import { connectionManager } from '@/lib/monitoring/connection-manager'
import { tickEngine } from '@/lib/simulation/tick-engine'
import type { SimulationStoreEvent, SimulatedCloudResource } from '@/lib/simulation/types'

export const runtime = 'nodejs'

const HEARTBEAT_INTERVAL_MS = 5000

type StreamMessage =
  | { type: 'snapshot'; resources: SimulatedCloudResource[]; running: boolean }
  | { type: 'store_event'; event: SimulationStoreEvent; running: boolean }
  | { type: 'heartbeat'; running: boolean; timestamp: string }

/**
 * GET /api/simulation/stream — SSE feed of live resource state from
 * whichever source is currently active: a connected monitoring backend, the
 * simulation engine, or (when neither is active) an empty snapshot.
 *
 * `running` still reflects the tick engine specifically (not "is any source
 * live") — that's what SimulationToggle's own button state depends on, and
 * conflating it with "monitoring connected" would make it show "Stop
 * Simulation" when there's nothing for that button to stop.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      function send(message: StreamMessage): void {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`))
      }

      let currentStore = connectionManager.getActiveStore()
      let unsubscribe = currentStore.subscribe((event) => {
        send({ type: 'store_event', event, running: tickEngine.isRunning() })
      })
      send({ type: 'snapshot', resources: currentStore.listResources(), running: tickEngine.isRunning() })

      // The active store can change mid-connection (a client connects to /
      // disconnects from a monitoring backend, or starts/stops the
      // simulation) — this connection subscribed to one store instance at
      // open time, so each heartbeat also checks whether the *authoritative*
      // store has changed and, if so, re-subscribes and pushes a fresh
      // snapshot instead of silently going stale.
      const heartbeat = setInterval(() => {
        const activeStore = connectionManager.getActiveStore()
        if (activeStore !== currentStore) {
          unsubscribe()
          currentStore = activeStore
          unsubscribe = currentStore.subscribe((event) => {
            send({ type: 'store_event', event, running: tickEngine.isRunning() })
          })
          send({ type: 'snapshot', resources: currentStore.listResources(), running: tickEngine.isRunning() })
        }
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
