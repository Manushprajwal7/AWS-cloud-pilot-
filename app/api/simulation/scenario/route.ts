import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { tickEngine } from '@/lib/simulation/tick-engine'
import { handleSimulationError } from '../errors'

export const runtime = 'nodejs'

const SCENARIO_VALUES = [
  'NORMAL',
  'CPU_SPIKE',
  'IDLE_RESOURCE',
  'MEMORY_LEAK',
  'OVERPROVISIONED',
  'COST_SPIKE',
  'TRAFFIC_SURGE',
] as const

const scenarioRequestSchema = z.object({
  resourceId: z.string().min(1),
  scenario: z.enum(SCENARIO_VALUES),
})

/**
 * POST /api/simulation/scenario — set a resource's target scenario.
 * This does NOT snap metrics instantly; it hands off to the tick engine,
 * which carries the resource's current metrics toward the new scenario's
 * target over subsequent ticks (ramp up, or recovery back to NORMAL).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
  }

  const parsed = scenarioRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  try {
    const resource = tickEngine.setResourceScenario(parsed.data.resourceId, parsed.data.scenario)
    return NextResponse.json({ resource })
  } catch (error) {
    return handleSimulationError(error)
  }
}
