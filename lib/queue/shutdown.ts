/**
 * Shared graceful-shutdown wiring for worker processes: on SIGTERM/SIGINT,
 * stop pulling new jobs and let in-flight jobs finish (Worker#close waits
 * for active jobs) before closing the Redis connection and exiting.
 */

import type { Worker } from 'bullmq'
import { closeRedisConnection } from './connection'

export function registerGracefulShutdown(workers: Worker[], label: string, onShutdown?: () => void): void {
  let shuttingDown = false

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return
    shuttingDown = true

    console.log(`[${label}] received ${signal}, closing ${workers.length} worker(s)...`)
    onShutdown?.()
    await Promise.all(workers.map((worker) => worker.close()))
    await closeRedisConnection()
    console.log(`[${label}] shutdown complete`)
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}
