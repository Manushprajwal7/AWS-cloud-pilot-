import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { simulationStore } from '@/lib/simulation/simulation-store'
import { handleSimulationError } from '../errors'

export const runtime = 'nodejs'

const resetRequestSchema = z.object({
  resourceId: z.string().min(1).optional(),
})

/**
 * POST /api/simulation/reset — reset one resource (body: { resourceId }),
 * or every resource back to its seed state if no resourceId is given.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown = {}
  try {
    const text = await request.text()
    body = text ? JSON.parse(text) : {}
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
  }

  const parsed = resetRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  try {
    if (parsed.data.resourceId) {
      const resource = simulationStore.resetResource(parsed.data.resourceId)
      return NextResponse.json({ resources: [resource] })
    }

    const resources = simulationStore.listResources().map((r) => simulationStore.resetResource(r.id))
    return NextResponse.json({ resources })
  } catch (error) {
    return handleSimulationError(error)
  }
}
