import { NextResponse } from 'next/server'
import { isDatabaseConfigured, prisma } from '@/lib/db/client'
import { redisConnection } from '@/lib/queue/connection'

export const dynamic = 'force-dynamic'

const DEPENDENCY_TIMEOUT_MS = 2000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))])
}

/**
 * GET /api/health — container liveness/readiness probe. Always returns 200
 * with `status: 'ok'` (the Next.js process itself is up) plus a real,
 * independently-checked status for each dependency — never a fabricated
 * "healthy" for a database or Redis connection that was never actually
 * probed. Used by docker-compose's healthcheck for the app service.
 */
export async function GET(): Promise<Response> {
  const [database, redis] = await Promise.all([
    isDatabaseConfigured()
      ? withTimeout(prisma.$queryRaw`SELECT 1`, DEPENDENCY_TIMEOUT_MS)
          .then(() => 'ok' as const)
          .catch((error: unknown) => ({ status: 'error' as const, message: error instanceof Error ? error.message : 'unknown error' }))
      : Promise.resolve({ status: 'not_configured' as const }),
    withTimeout(redisConnection.ping(), DEPENDENCY_TIMEOUT_MS)
      .then(() => 'ok' as const)
      .catch((error: unknown) => ({ status: 'error' as const, message: error instanceof Error ? error.message : 'unknown error' })),
  ])

  return NextResponse.json({ status: 'ok', dependencies: { database, redis } })
}
