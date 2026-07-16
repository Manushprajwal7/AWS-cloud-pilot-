import { NextRequest, NextResponse } from 'next/server'
import { listAgentRuns } from '@/lib/db/repositories/agent-run-repository'
import { limitQuerySchema } from '@/lib/api/pagination'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50
const querySchema = limitQuerySchema(DEFAULT_LIMIT, MAX_LIMIT)

/** GET /api/graph/runs?limit=10 — the most recent real graph runs, for the dashboard's recent-runs panel. */
export async function GET(request: NextRequest): Promise<Response> {
  const parsed = querySchema.safeParse(request.nextUrl.searchParams.get('limit'))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid limit parameter' }, { status: 400 })
  }

  try {
    const runs = await listAgentRuns(parsed.data)
    return NextResponse.json({ dbAvailable: true, runs })
  } catch {
    return NextResponse.json({ dbAvailable: false, runs: [] })
  }
}
