import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'

export const dynamic = 'force-dynamic'

const CATEGORY_VALUES = ['cost', 'security', 'compliance', 'performance'] as const

const updatePolicySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  category: z.enum(CATEGORY_VALUES).optional(),
  rules: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
})

/** PATCH /api/policies/:id — edit fields and/or toggle enabled. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
  }

  const parsed = updatePolicySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body', details: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  try {
    const policy = await prisma.policy.update({ where: { id }, data: parsed.data })
    return NextResponse.json({ policy })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: `Policy '${id}' does not exist` }, { status: 404 })
    }
    throw error
  }
}

/** DELETE /api/policies/:id */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params

  try {
    await prisma.policy.delete({ where: { id } })
    return NextResponse.json({ deleted: true })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: `Policy '${id}' does not exist` }, { status: 404 })
    }
    throw error
  }
}
