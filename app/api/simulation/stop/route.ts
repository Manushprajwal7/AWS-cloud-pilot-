import { NextResponse } from 'next/server'
import { tickEngine } from '@/lib/simulation/tick-engine'

export const runtime = 'nodejs'

/** POST /api/simulation/stop — stop the tick engine if it's running. */
export async function POST(): Promise<NextResponse> {
  tickEngine.stop()
  return NextResponse.json({ running: tickEngine.isRunning() })
}
