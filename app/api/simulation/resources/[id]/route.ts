import { NextResponse } from 'next/server'
import { simulationStore } from '@/lib/simulation/simulation-store'

export const runtime = 'nodejs'

/** GET /api/simulation/resources/:id — a single simulated resource. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params
  const resource = simulationStore.getResource(id)

  if (!resource) {
    return NextResponse.json({ error: `Simulated resource '${id}' does not exist`, resourceId: id }, { status: 404 })
  }

  return NextResponse.json({ resource })
}
