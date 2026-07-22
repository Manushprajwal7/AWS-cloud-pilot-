import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'

export const dynamic = 'force-dynamic'

const updateAutomationSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  trigger: z.string().optional(),
  action: z.string().optional(),
  status: z.enum(['active', 'paused', 'error']).optional(),
})

/** PATCH /api/automations/:id — edit fields and/or toggle status (active/paused). */
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

  const parsed = updateAutomationSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body', details: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  try {
    const automation = await prisma.automation.update({ where: { id }, data: parsed.data })
    return NextResponse.json({ automation })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: `Automation '${id}' does not exist` }, { status: 404 })
    }
    throw error
  }
}

/** DELETE /api/automations/:id */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params

  try {
    await prisma.automation.delete({ where: { id } })
    return NextResponse.json({ deleted: true })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: `Automation '${id}' does not exist` }, { status: 404 })
    }
    throw error
  }
}
