import { NextResponse } from 'next/server'
import { anomalyDetector } from '@/lib/anomalies/detector'
import { handleAnomalyError } from '../../errors'
import { enrichAnomaly } from '../../enrich'

export const runtime = 'nodejs'

/** POST /api/anomalies/:id/resolve — manually resolve an active anomaly. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params

  try {
    const anomaly = anomalyDetector.resolveAnomaly(id)
    return NextResponse.json({ anomaly: enrichAnomaly(anomaly) })
  } catch (error) {
    return handleAnomalyError(error)
  }
}
