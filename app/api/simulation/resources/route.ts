import { NextResponse } from 'next/server'
import { simulationStore } from '@/lib/simulation/simulation-store'

export const runtime = 'nodejs'

/** GET /api/simulation/resources — list every simulated resource. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ resources: simulationStore.listResources() })
}
