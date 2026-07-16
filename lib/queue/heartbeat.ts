/**
 * Lightweight liveness signal for worker processes (workers/*.ts run as
 * separate processes this Next.js app has no direct handle on). Each
 * worker SETs its own Redis key with a short TTL on an interval;
 * GET /api/dashboard/system-status reads these keys to report real
 * worker status — a worker that was never started, crashed, or lost its
 * Redis connection simply has no fresh key, which reads as "offline"
 * rather than a fabricated "running".
 */

import { redisConnection } from './connection'

const HEARTBEAT_KEY_PREFIX = 'cloudpilot:worker:heartbeat:'
const HEARTBEAT_TTL_SECONDS = 30
const HEARTBEAT_INTERVAL_MS = 10_000

export const WORKER_NAMES = ['terraform-worker', 'simulation-worker', 'verification-worker', 'audit-worker'] as const
export type WorkerName = (typeof WORKER_NAMES)[number]

async function recordWorkerHeartbeat(name: WorkerName): Promise<void> {
  await redisConnection.set(`${HEARTBEAT_KEY_PREFIX}${name}`, new Date().toISOString(), 'EX', HEARTBEAT_TTL_SECONDS)
}

/** Called once at worker startup. Returns a cleanup function to stop the interval on graceful shutdown. */
export function startHeartbeatLoop(name: WorkerName): () => void {
  void recordWorkerHeartbeat(name)
  const timer = setInterval(() => {
    void recordWorkerHeartbeat(name)
  }, HEARTBEAT_INTERVAL_MS)
  return () => clearInterval(timer)
}

export interface WorkerStatus {
  name: WorkerName
  online: boolean
  lastHeartbeatAt: string | null
}

export async function getWorkerStatuses(): Promise<WorkerStatus[]> {
  return Promise.all(
    WORKER_NAMES.map(async (name) => {
      const value = await redisConnection.get(`${HEARTBEAT_KEY_PREFIX}${name}`)
      return { name, online: value !== null, lastHeartbeatAt: value }
    }),
  )
}
