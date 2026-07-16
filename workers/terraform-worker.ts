/**
 * Terraform pipeline worker process: validation -> plan -> execution.
 * This is where Terraform-shaped operations actually run — never inside a
 * Next.js request handler, per the Phase 6 requirement. There is no real
 * `terraform` binary or cloud account behind this (CloudPilot's
 * infrastructure is the deterministic simulation in lib/simulation/), so
 * "execute" here means: deterministically apply the plan to the
 * simulation store and persist a real TerraformExecution/RollbackRecord
 * trail — the queueing, retry, idempotency, and persistence semantics are
 * real even though the target infrastructure is simulated.
 *
 * Run with: pnpm worker:terraform (see package.json).
 */

import { Worker, type Job } from 'bullmq'
import { redisConnection } from '@/lib/queue/connection'
import { QUEUE_NAMES, terraformValidationJobSchema, terraformPlanJobSchema, terraformExecutionJobSchema } from '@/lib/queue/job-types'
import { enqueueVerificationJob } from '@/lib/queue/queues'
import { registerGracefulShutdown } from '@/lib/queue/shutdown'
import { startHeartbeatLoop } from '@/lib/queue/heartbeat'
import { prisma } from '@/lib/db/client'
import { simulationStore } from '@/lib/simulation/simulation-store'

const CONCURRENCY = Number(process.env.TERRAFORM_WORKER_CONCURRENCY ?? 2)

// ---------------------------------------------------------------------------
// validation: does the artifact's HCL look well-formed and non-empty?
// ---------------------------------------------------------------------------

async function processValidation(job: Job): Promise<{ valid: boolean; issues: string[] }> {
  const payload = terraformValidationJobSchema.parse(job.data)
  const issues: string[] = []

  if (!payload.hcl.trim()) issues.push('HCL body is empty')
  if (!/resource\s+"/.test(payload.hcl)) issues.push('no resource block found')

  const valid = issues.length === 0

  await prisma.policyDecision.create({
    data: {
      remediationPlanId: payload.remediationPlanId,
      decision: valid ? 'approved' : 'rejected',
      reason: valid ? 'HCL passed structural validation' : issues.join('; '),
      policyName: 'terraform-structural-validation',
    },
  })

  return { valid, issues }
}

// ---------------------------------------------------------------------------
// plan: attach a deterministic plan summary to the artifact
// ---------------------------------------------------------------------------

async function processPlan(job: Job): Promise<{ planned: boolean }> {
  const payload = terraformPlanJobSchema.parse(job.data)

  const artifact = await prisma.terraformArtifact.findUnique({ where: { id: payload.terraformArtifactId } })
  if (!artifact) throw new Error(`TerraformArtifact '${payload.terraformArtifactId}' not found`)

  const resourceBlocks = artifact.hcl.match(/resource\s+"[^"]+"\s+"[^"]+"/g) ?? []

  await prisma.terraformArtifact.update({
    where: { id: artifact.id },
    data: {
      planJson: {
        resourceChanges: resourceBlocks.map((block) => ({ address: block, action: 'update' })),
        plannedAt: new Date().toISOString(),
      },
    },
  })

  return { planned: true }
}

// ---------------------------------------------------------------------------
// execution: idempotent apply/destroy against the simulation store
// ---------------------------------------------------------------------------

async function processExecution(job: Job): Promise<{ status: string }> {
  const payload = terraformExecutionJobSchema.parse(job.data)

  const existing = await prisma.terraformExecution.findUnique({ where: { id: payload.terraformExecutionId } })
  if (!existing) throw new Error(`TerraformExecution '${payload.terraformExecutionId}' not found`)

  // Idempotency / duplicate-job prevention: a prior attempt for this exact
  // idempotencyKey already reached a terminal state, so replay is a no-op.
  if (existing.status === 'succeeded' || existing.status === 'failed') {
    return { status: existing.status }
  }

  const startedAt = new Date()
  await prisma.terraformExecution.update({
    where: { id: existing.id },
    data: { status: 'running', startedAt },
  })

  const artifact = await prisma.terraformArtifact.findUnique({
    where: { id: payload.terraformArtifactId },
    include: { remediationPlan: true },
  })
  if (!artifact) throw new Error(`TerraformArtifact '${payload.terraformArtifactId}' not found`)

  const logs: string[] = [`terraform ${payload.operation} started for artifact ${artifact.id} (idempotencyKey=${payload.idempotencyKey})`]

  try {
    const resource = simulationStore.getResource(artifact.remediationPlan.resourceId)
    if (!resource) throw new Error(`simulated resource '${artifact.remediationPlan.resourceId}' no longer exists`)

    if (payload.operation === 'apply' && artifact.remediationPlan.action === 'STOP') {
      simulationStore.updateResource(resource.id, { status: 'stopped' })
      logs.push(`resource '${resource.id}' transitioned to stopped`)
    } else {
      logs.push(`operation '${payload.operation}' recorded (no further simulated state change required for action '${artifact.remediationPlan.action}')`)
    }

    await prisma.terraformExecution.update({
      where: { id: existing.id },
      data: { status: 'succeeded', exitCode: 0, logs: logs.join('\n'), completedAt: new Date() },
    })

    await enqueueVerificationJob({ terraformExecutionId: existing.id }, { jobId: `verify-${existing.id}` })

    return { status: 'succeeded' }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown execution failure'
    logs.push(`ERROR: ${message}`)
    await prisma.terraformExecution.update({
      where: { id: existing.id },
      data: { status: 'failed', exitCode: 1, logs: logs.join('\n'), completedAt: new Date() },
    })
    throw error
  }
}

const validationWorker = new Worker(QUEUE_NAMES.TERRAFORM_VALIDATION, processValidation, {
  connection: redisConnection,
  concurrency: CONCURRENCY,
})

const planWorker = new Worker(QUEUE_NAMES.TERRAFORM_PLAN, processPlan, {
  connection: redisConnection,
  concurrency: CONCURRENCY,
})

const executionWorker = new Worker(QUEUE_NAMES.TERRAFORM_EXECUTION, processExecution, {
  connection: redisConnection,
  concurrency: 1, // apply/destroy against the same simulated resource must be serialized
})

for (const worker of [validationWorker, planWorker, executionWorker]) {
  worker.on('failed', (job, error) => {
    console.error(`[terraform-worker] job ${job?.id} (${job?.queueName}) failed:`, error.message)
  })
}

const stopHeartbeat = startHeartbeatLoop('terraform-worker')
registerGracefulShutdown([validationWorker, planWorker, executionWorker], 'terraform-worker', stopHeartbeat)

console.log(`[terraform-worker] listening on ${QUEUE_NAMES.TERRAFORM_VALIDATION}, ${QUEUE_NAMES.TERRAFORM_PLAN}, ${QUEUE_NAMES.TERRAFORM_EXECUTION}`)
