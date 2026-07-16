/**
 * Shared error-to-HTTP-response mapping for the /api/simulation/* routes.
 * Not a route itself (no GET/POST export), so Next.js won't register it.
 */

import { NextResponse } from 'next/server'
import { SimulationResourceNotFoundError, InvalidScenarioError } from '@/lib/simulation/simulation-store'

export function handleSimulationError(error: unknown): NextResponse {
  if (error instanceof SimulationResourceNotFoundError) {
    return NextResponse.json({ error: error.message, resourceId: error.resourceId }, { status: 404 })
  }

  if (error instanceof InvalidScenarioError) {
    return NextResponse.json({ error: error.message, scenario: error.scenario }, { status: 400 })
  }

  const message = error instanceof Error ? error.message : 'Unknown error'
  return NextResponse.json({ error: message }, { status: 500 })
}
