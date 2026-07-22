import { NextResponse } from 'next/server'
import { connectionManager } from '@/lib/monitoring/connection-manager'

export const runtime = 'nodejs'

/** POST /api/monitoring/disconnect — stops the active adapter and falls the dashboard back to simulation/empty. */
export async function POST(): Promise<NextResponse> {
  await connectionManager.disconnect()
  return NextResponse.json({ status: connectionManager.getStatus() })
}
