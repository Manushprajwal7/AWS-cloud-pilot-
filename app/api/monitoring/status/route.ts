import { NextResponse } from 'next/server'
import { connectionManager } from '@/lib/monitoring/connection-manager'

export const dynamic = 'force-dynamic'

/** GET /api/monitoring/status — public-safe connection status (no credentials). */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(connectionManager.getStatus())
}
