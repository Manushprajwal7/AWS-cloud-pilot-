/**
 * Shared Redis connection for BullMQ, mirroring the singleton pattern used
 * by lib/db/client.ts. BullMQ requires maxRetriesPerRequest: null on the
 * ioredis connection it's handed — without it, blocking commands used
 * internally by Queue/Worker throw instead of waiting.
 */

import IORedis from 'ioredis'

const globalForRedis = globalThis as unknown as { redisConnection?: IORedis }

export function getRedisUrl(): string {
  return process.env.REDIS_URL || 'redis://localhost:6379'
}

function createRedisConnection(): IORedis {
  const connection = new IORedis(getRedisUrl(), {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  })

  connection.on('error', (error) => {
    console.error('[redis] connection error:', error.message)
  })
  connection.on('reconnecting', (delayMs: number) => {
    console.warn(`[redis] reconnecting in ${delayMs}ms...`)
  })
  connection.on('ready', () => {
    console.log('[redis] connection ready')
  })

  return connection
}

export function getRedisConnection(): IORedis {
  if (!globalForRedis.redisConnection) {
    globalForRedis.redisConnection = createRedisConnection()
  }
  return globalForRedis.redisConnection
}

export const redisConnection = getRedisConnection()

export async function closeRedisConnection(): Promise<void> {
  await redisConnection.quit()
}
