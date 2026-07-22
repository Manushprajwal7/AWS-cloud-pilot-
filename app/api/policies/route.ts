import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'

export const dynamic = 'force-dynamic'

const CATEGORY_VALUES = ['cost', 'security', 'compliance', 'performance'] as const

const createPolicySchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  category: z.enum(CATEGORY_VALUES),
  rules: z.array(z.string()).default([]),
})

/**
 * GET /api/policies — the workspace's governance policies. Real Postgres
 * rows (Policy model), not a local mock list. Returns an empty list with
 * `dbAvailable: false` rather than a 500 if Postgres isn't reachable.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const policies = await prisma.policy.findMany({ orderBy: { createdAt: 'desc' } })
    return NextResponse.json({ dbAvailable: true, policies })
  } catch {
    return NextResponse.json({ dbAvailable: false, policies: [] })
  }
}

/** POST /api/policies — create a new policy. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
  }

  const parsed = createPolicySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body', details: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  const policy = await prisma.policy.create({ data: parsed.data })
  return NextResponse.json({ policy }, { status: 201 })
}
