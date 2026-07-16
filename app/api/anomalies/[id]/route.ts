import { NextResponse } from 'next/server'
import { anomalyDetector } from '@/lib/anomalies/detector'
import { enrichAnomaly } from '../enrich'

export const runtime = 'nodejs'

/** GET /api/anomalies/:id */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params
  const anomaly = anomalyDetector.getAnomaly(id)

  if (!anomaly) {
    return NextResponse.json({ error: `Anomaly '${id}' does not exist`, anomalyId: id }, { status: 404 })
  }

  return NextResponse.json({ anomaly: enrichAnomaly(anomaly) })
}
