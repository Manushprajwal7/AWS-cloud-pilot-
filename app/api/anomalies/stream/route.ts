import { NextRequest } from 'next/server'
import { anomalyDetector } from '@/lib/anomalies/detector'
import type { AnomalyEvent } from '@/lib/anomalies/types'
import { enrichAnomaly, type EnrichedAnomaly } from '../enrich'

export const runtime = 'nodejs'

const HEARTBEAT_INTERVAL_MS = 10000

type StreamMessage =
  | { type: 'snapshot'; anomalies: EnrichedAnomaly[] }
  | { type: 'anomaly_event'; event: { type: AnomalyEvent['type']; anomaly: EnrichedAnomaly } }
  | { type: 'heartbeat'; timestamp: string }

/**
 * GET /api/anomalies/stream — SSE feed of live anomaly detection state.
 * Sends an initial snapshot of all active anomalies, then relays every
 * detection/update/resolution as it happens, plus a periodic heartbeat.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      function send(message: StreamMessage): void {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`))
      }

      send({ type: 'snapshot', anomalies: anomalyDetector.listAnomalies({ status: 'active' }).map(enrichAnomaly) })

      const unsubscribe = anomalyDetector.subscribe((event) => {
        send({ type: 'anomaly_event', event: { type: event.type, anomaly: enrichAnomaly(event.anomaly) } })
      })

      const heartbeat = setInterval(() => {
        send({ type: 'heartbeat', timestamp: new Date().toISOString() })
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
