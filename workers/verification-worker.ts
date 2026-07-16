/**
 * Verification worker: after a TerraformExecution finishes, checks that
 * the simulated resource actually ended up in the state the remediation
 * plan expected, and records the result. If verification fails, opens a
 * RollbackRecord rather than silently accepting drift.
 *
 * Run with: pnpm worker:verification (see package.json).
 */

import { Worker, type Job } from 'bullmq'
import { redisConnection } from '@/lib/queue/connection'
import { QUEUE_NAMES, verificationJobSchema } from '@/lib/queue/job-types'
import { registerGracefulShutdown } from '@/lib/queue/shutdown'
import { startHeartbeatLoop } from '@/lib/queue/heartbeat'
import { prisma } from '@/lib/db/client'
import { simulationStore } from '@/lib/simulation/simulation-store'

const CONCURRENCY = Number(process.env.VERIFICATION_WORKER_CONCURRENCY ?? 4)

async function processVerification(job: Job): Promise<{ passed: boolean }> {
  const payload = verificationJobSchema.parse(job.data)

  // Idempotency: if this execution already has a verification result, don't record a duplicate.
  const existingResult = await prisma.verificationResult.findFirst({
    where: { terraformExecutionId: payload.terraformExecutionId, checkName: 'post-apply-resource-state' },
  })
  if (existingResult) {
    return { passed: existingResult.passed }
  }

  const execution = await prisma.terraformExecution.findUnique({
    where: { id: payload.terraformExecutionId },
    include: { terraformArtifact: { include: { remediationPlan: true } } },
  })
  if (!execution) throw new Error(`TerraformExecution '${payload.terraformExecutionId}' not found`)

  const plan = execution.terraformArtifact.remediationPlan
  const resource = simulationStore.getResource(plan.resourceId)

  let passed = false
  const details: Record<string, unknown> = { action: plan.action, resourceId: plan.resourceId }

  if (!resource) {
    details.reason = 'resource no longer exists in simulation store'
  } else if (plan.action === 'STOP') {
    passed = resource.status === 'stopped'
    details.observedStatus = resource.status
  } else {
    // No stronger invariant defined for this action type yet — apply
    // succeeding (execution.status === 'succeeded') is the pass condition.
    passed = execution.status === 'succeeded'
    details.observedStatus = resource.status
  }

  await prisma.verificationResult.create({
    data: {
      terraformExecutionId: execution.id,
      checkName: 'post-apply-resource-state',
      passed,
      details: details as object,
    },
  })

  if (!passed) {
    await prisma.rollbackRecord.create({
      data: {
        terraformExecutionId: execution.id,
        reason: `verification failed: ${JSON.stringify(details)}`,
        status: 'pending',
      },
    })
  }

  return { passed }
}

const worker = new Worker(QUEUE_NAMES.VERIFICATION, processVerification, {
  connection: redisConnection,
  concurrency: CONCURRENCY,
})

worker.on('failed', (job, error) => {
  console.error(`[verification-worker] job ${job?.id} failed:`, error.message)
})

const stopHeartbeat = startHeartbeatLoop('verification-worker')
registerGracefulShutdown([worker], 'verification-worker', stopHeartbeat)

console.log(`[verification-worker] listening on ${QUEUE_NAMES.VERIFICATION}`)
