import { NextResponse } from 'next/server'
import { QUEUES_BY_NAME } from '@/lib/queue/queues'
import { getWorkerStatuses } from '@/lib/queue/heartbeat'

export const dynamic = 'force-dynamic'

const REDIS_TIMEOUT_MS = 3000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Redis call timed out')), ms)),
  ])
}

/**
 * GET /api/dashboard/system-status — real BullMQ job counts per queue and
 * real worker liveness (via lib/queue/heartbeat.ts). If Redis isn't
 * reachable, both come back empty with `redisAvailable: false` — never a
 * fabricated "online"/"idle". The shared Redis connection is configured
 * with unlimited retries for the workers' sake (BullMQ requires it for
 * blocking commands), so this route races every call against a short
 * timeout rather than letting a down Redis hang the dashboard.
 */
export async function GET(): Promise<Response> {
  try {
    const [queueEntries, workers] = await withTimeout(
      Promise.all([
        Promise.all(
          Object.entries(QUEUES_BY_NAME).map(async ([name, queue]) => {
            const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed')
            return [name, counts] as const
          }),
        ),
        getWorkerStatuses(),
      ]),
      REDIS_TIMEOUT_MS,
    )

    return NextResponse.json({
      redisAvailable: true,
      queues: Object.fromEntries(queueEntries),
      workers,
    })
  } catch {
    return NextResponse.json({ redisAvailable: false, queues: {}, workers: [] })
  }
}
