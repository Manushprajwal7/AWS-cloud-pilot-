import { NextResponse } from 'next/server'
import { tickEngine } from '@/lib/simulation/tick-engine'
import { connectionManager } from '@/lib/monitoring/connection-manager'

export const runtime = 'nodejs'

/** POST /api/simulation/start — start the tick engine if it isn't already running. */
export async function POST(): Promise<NextResponse> {
  tickEngine.start()
  // Starting the engine changes what connectionManager.getActiveStore()
  // resolves to (from the empty store back to simulationStore) — the
  // anomaly detector's subscription has to follow that or it keeps
  // evaluating a store nothing is writing to.
  connectionManager.syncAnomalyDetectorBinding()
  return NextResponse.json({ running: tickEngine.isRunning(), tickIntervalMs: tickEngine.getTickIntervalMs() })
}
