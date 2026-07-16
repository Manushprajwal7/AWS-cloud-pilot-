import { NextResponse } from 'next/server'
import { tickEngine } from '@/lib/simulation/tick-engine'

export const runtime = 'nodejs'

/** POST /api/simulation/start — start the tick engine if it isn't already running. */
export async function POST(): Promise<NextResponse> {
  tickEngine.start()
  return NextResponse.json({ running: tickEngine.isRunning(), tickIntervalMs: tickEngine.getTickIntervalMs() })
}
