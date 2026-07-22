import { NextRequest, NextResponse } from 'next/server'
import { monitoringCredentialsSchema } from '@/lib/monitoring/credential-schemas'
import { connectionManager } from '@/lib/monitoring/connection-manager'
import { handleMonitoringError } from '../errors'

export const runtime = 'nodejs'

/**
 * POST /api/monitoring/connect — validates + tests credentials, and on
 * success persists them (encrypted) and switches the whole dashboard's
 * active resource store to this provider. Never echoes credentials back.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
  }

  const parsed = monitoringCredentialsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const result = await connectionManager.connect(parsed.data)
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400 })
    }
    return NextResponse.json({ status: connectionManager.getStatus(), message: result.message })
  } catch (error) {
    return handleMonitoringError(error)
  }
}
