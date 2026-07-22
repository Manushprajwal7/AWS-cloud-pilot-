import { NextResponse } from 'next/server'
import { connectionManager } from '@/lib/monitoring/connection-manager'

export const runtime = 'nodejs'

/** GET /api/simulation/resources — list every resource from whichever source is currently active (simulation, a connected monitoring backend, or empty). */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ resources: connectionManager.getActiveStore().listResources() })
}
