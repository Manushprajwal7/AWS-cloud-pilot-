import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { anomalyDetector } from '@/lib/anomalies/detector'
import { ALL_ANOMALY_TYPES } from '@/lib/anomalies/types'
import { enrichAnomaly } from './enrich'

export const runtime = 'nodejs'

const listAnomaliesQuerySchema = z.object({
  status: z.enum(['active', 'resolved']).optional(),
  resourceId: z.string().min(1).optional(),
  type: z.enum(ALL_ANOMALY_TYPES).optional(),
})

/** GET /api/anomalies?status=active|resolved&resourceId=...&type=... */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams
  const parsed = listAnomaliesQuerySchema.safeParse({
    status: params.get('status') ?? undefined,
    resourceId: params.get('resourceId') ?? undefined,
    type: params.get('type') ?? undefined,
  })

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters', details: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  const anomalies = anomalyDetector.listAnomalies(parsed.data).map(enrichAnomaly)

  return NextResponse.json({ anomalies })
}
