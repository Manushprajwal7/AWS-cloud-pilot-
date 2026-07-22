import { NextResponse } from 'next/server'
import { tickEngine } from '@/lib/simulation/tick-engine'
import { connectionManager } from '@/lib/monitoring/connection-manager'

export const runtime = 'nodejs'

/** POST /api/simulation/stop — stop the tick engine if it's running. */
export async function POST(): Promise<NextResponse> {
  tickEngine.stop()
  // Stopping the engine drops connectionManager.getActiveStore() to the
  // empty store (unless a monitoring backend is connected) — rebind the
  // anomaly detector so previously-detected anomalies clear along with
  // every other dashboard panel instead of staying frozen on screen.
  connectionManager.syncAnomalyDetectorBinding()
  return NextResponse.json({ running: tickEngine.isRunning() })
}
