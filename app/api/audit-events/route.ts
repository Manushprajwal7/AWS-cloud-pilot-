import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { limitQuerySchema } from '@/lib/api/pagination'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const querySchema = limitQuerySchema(DEFAULT_LIMIT, MAX_LIMIT)

/**
 * GET /api/audit-events?limit=20 — the most recent real AuditEvent rows
 * (auditWorker writes exactly one per graph run outcome — see
 * lib/langgraph/nodes/audit.ts). Returns an empty list with
 * `dbAvailable: false` rather than a 500 if Postgres isn't reachable.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const parsed = querySchema.safeParse(request.nextUrl.searchParams.get('limit'))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid limit parameter' }, { status: 400 })
  }

  try {
    const events = await prisma.auditEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: parsed.data,
    })
    return NextResponse.json({ dbAvailable: true, events })
  } catch {
    return NextResponse.json({ dbAvailable: false, events: [] })
  }
}
