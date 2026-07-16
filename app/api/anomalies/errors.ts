/**
 * Shared error-to-HTTP-response mapping for the /api/anomalies/* routes.
 * Not a route itself (no GET/POST export), so Next.js won't register it.
 */

import { NextResponse } from 'next/server'
import { AnomalyNotFoundError } from '@/lib/anomalies/detector'

export function handleAnomalyError(error: unknown): NextResponse {
  if (error instanceof AnomalyNotFoundError) {
    return NextResponse.json({ error: error.message, anomalyId: error.anomalyId }, { status: 404 })
  }

  const message = error instanceof Error ? error.message : 'Unknown error'
  return NextResponse.json({ error: message }, { status: 500 })
}
