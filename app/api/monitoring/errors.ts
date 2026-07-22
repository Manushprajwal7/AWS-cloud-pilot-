/**
 * Not a route itself (no exported HTTP method handlers), so Next.js won't
 * register it — a shared helper for the route handlers under
 * app/api/monitoring/, mirroring app/api/simulation/errors.ts's
 * handleSimulationError pattern.
 */

import { NextResponse } from 'next/server'

export class MonitoringConnectionFailedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MonitoringConnectionFailedError'
  }
}

export class MonitoringNotConnectedError extends Error {
  constructor() {
    super('No monitoring backend is currently connected')
    this.name = 'MonitoringNotConnectedError'
  }
}

export function handleMonitoringError(error: unknown): NextResponse {
  if (error instanceof MonitoringConnectionFailedError) {
    return NextResponse.json({ error: error.message }, { status: 502 })
  }
  if (error instanceof MonitoringNotConnectedError) {
    return NextResponse.json({ error: error.message }, { status: 409 })
  }
  const message = error instanceof Error ? error.message : 'Unknown error'
  return NextResponse.json({ error: message }, { status: 500 })
}
