import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'

export const dynamic = 'force-dynamic'

const createAutomationSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  trigger: z.string().default('Manual trigger'),
  action: z.string().default('No action configured'),
})

/**
 * GET /api/automations — the workspace's automation rules. Real Postgres
 * rows (Automation model), not the local mock list this page used to seed
 * itself with. Returns an empty list with `dbAvailable: false` rather than
 * a 500 if Postgres isn't reachable.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const automations = await prisma.automation.findMany({ orderBy: { createdAt: 'desc' } })
    return NextResponse.json({ dbAvailable: true, automations })
  } catch {
    return NextResponse.json({ dbAvailable: false, automations: [] })
  }
}

/** POST /api/automations — create a new automation rule. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
  }

  const parsed = createAutomationSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body', details: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  const automation = await prisma.automation.create({ data: parsed.data })
  return NextResponse.json({ automation }, { status: 201 })
}
