import { NextRequest, NextResponse } from 'next/server'
import { monitoringCredentialsSchema } from '@/lib/monitoring/credential-schemas'
import { createAwsCloudWatchAdapter } from '@/lib/monitoring/providers/aws-cloudwatch'
import { createGcpMonitoringAdapter } from '@/lib/monitoring/providers/gcp-monitoring'
import { createPrometheusAdapter } from '@/lib/monitoring/providers/prometheus'
import { handleMonitoringError } from '../errors'

export const runtime = 'nodejs'

/** POST /api/monitoring/test — validate credentials against the real provider without persisting or connecting anything ("Step 3: Test Connection"). */
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
    const adapter =
      parsed.data.provider === 'AWS'
        ? createAwsCloudWatchAdapter(parsed.data.credentials)
        : parsed.data.provider === 'GCP'
          ? createGcpMonitoringAdapter(parsed.data.credentials)
          : createPrometheusAdapter(parsed.data.credentials)

    const result = await adapter.testConnection()
    return NextResponse.json(result, { status: result.ok ? 200 : 400 })
  } catch (error) {
    return handleMonitoringError(error)
  }
}
