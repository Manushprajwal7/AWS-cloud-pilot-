/**
 * Audit worker: persists AuditEvent rows enqueued via enqueueAuditJob, so
 * callers (e.g. the terraform worker recording a policy decision, or a
 * future admin action) don't need direct Prisma access or block on a DB
 * write on their own hot path.
 *
 * Run with: pnpm worker:audit (see package.json).
 */

import { Worker, type Job } from 'bullmq'
import { redisConnection } from '@/lib/queue/connection'
import { QUEUE_NAMES, auditJobSchema } from '@/lib/queue/job-types'
import { registerGracefulShutdown } from '@/lib/queue/shutdown'
import { startHeartbeatLoop } from '@/lib/queue/heartbeat'
import { prisma } from '@/lib/db/client'

const CONCURRENCY = Number(process.env.AUDIT_WORKER_CONCURRENCY ?? 8)

async function processAuditJob(job: Job): Promise<{ auditEventId: string }> {
  const payload = auditJobSchema.parse(job.data)

  const event = await prisma.auditEvent.create({
    data: {
      agentRunId: payload.agentRunId,
      actor: payload.actor,
      action: payload.action,
      entityType: payload.entityType,
      entityId: payload.entityId,
      metadata: payload.metadata as object | undefined,
    },
  })

  return { auditEventId: event.id }
}

const worker = new Worker(QUEUE_NAMES.AUDIT, processAuditJob, {
  connection: redisConnection,
  concurrency: CONCURRENCY,
})

worker.on('failed', (job, error) => {
  console.error(`[audit-worker] job ${job?.id} failed:`, error.message)
})

const stopHeartbeat = startHeartbeatLoop('audit-worker')
registerGracefulShutdown([worker], 'audit-worker', stopHeartbeat)

console.log(`[audit-worker] listening on ${QUEUE_NAMES.AUDIT}`)
