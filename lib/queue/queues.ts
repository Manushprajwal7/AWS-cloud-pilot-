/**
 * BullMQ Queue instances, one per QUEUE_NAMES entry, plus a single typed
 * enqueue helper that validates the payload against job-types.ts before
 * ever reaching Redis. Passing `jobId` (BullMQ dedups by id within a
 * queue) is how callers get duplicate-job prevention / idempotency — the
 * same idempotencyKey/logical key should always produce the same jobId.
 */

import { Queue, type JobsOptions } from 'bullmq'
import { redisConnection } from './connection'
import {
  QUEUE_NAMES,
  JOB_SCHEMA_BY_QUEUE,
  type AuditJobPayload,
  type QueueName,
  type SimulationJobPayload,
  type TerraformExecutionJobPayload,
  type TerraformPlanJobPayload,
  type TerraformValidationJobPayload,
  type VerificationJobPayload,
} from './job-types'

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 3600, count: 1000 },
  // Keep failed jobs around (failed-job storage) instead of discarding them.
  removeOnFail: { age: 86400 },
}

function createQueue(name: QueueName): Queue {
  return new Queue(name, { connection: redisConnection, defaultJobOptions: DEFAULT_JOB_OPTIONS })
}

export const simulationQueue = createQueue(QUEUE_NAMES.SIMULATION)
export const terraformValidationQueue = createQueue(QUEUE_NAMES.TERRAFORM_VALIDATION)
export const terraformPlanQueue = createQueue(QUEUE_NAMES.TERRAFORM_PLAN)
export const terraformExecutionQueue = createQueue(QUEUE_NAMES.TERRAFORM_EXECUTION)
export const verificationQueue = createQueue(QUEUE_NAMES.VERIFICATION)
export const auditQueue = createQueue(QUEUE_NAMES.AUDIT)

export const QUEUES_BY_NAME: Record<QueueName, Queue> = {
  [QUEUE_NAMES.SIMULATION]: simulationQueue,
  [QUEUE_NAMES.TERRAFORM_VALIDATION]: terraformValidationQueue,
  [QUEUE_NAMES.TERRAFORM_PLAN]: terraformPlanQueue,
  [QUEUE_NAMES.TERRAFORM_EXECUTION]: terraformExecutionQueue,
  [QUEUE_NAMES.VERIFICATION]: verificationQueue,
  [QUEUE_NAMES.AUDIT]: auditQueue,
}

export class JobPayloadValidationError extends Error {
  constructor(queue: QueueName, details: string) {
    super(`Invalid job payload for queue '${queue}': ${details}`)
    this.name = 'JobPayloadValidationError'
  }
}

interface EnqueueOptions {
  jobId?: string
  delayMs?: number
}

async function enqueue<TQueue extends QueueName>(
  queueName: TQueue,
  payload: unknown,
  options: EnqueueOptions = {},
) {
  const schema = JOB_SCHEMA_BY_QUEUE[queueName]
  const result = schema.safeParse(payload)
  if (!result.success) {
    throw new JobPayloadValidationError(queueName, result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  }

  const queue = QUEUES_BY_NAME[queueName]
  return queue.add(queueName, result.data, {
    jobId: options.jobId,
    delay: options.delayMs,
  })
}

export function enqueueSimulationJob(payload: SimulationJobPayload, options?: EnqueueOptions) {
  return enqueue(QUEUE_NAMES.SIMULATION, payload, options)
}

export function enqueueTerraformValidationJob(payload: TerraformValidationJobPayload, options?: EnqueueOptions) {
  return enqueue(QUEUE_NAMES.TERRAFORM_VALIDATION, payload, options)
}

export function enqueueTerraformPlanJob(payload: TerraformPlanJobPayload, options?: EnqueueOptions) {
  return enqueue(QUEUE_NAMES.TERRAFORM_PLAN, payload, options)
}

/** Idempotent by construction: jobId defaults to the caller-supplied idempotencyKey. */
export function enqueueTerraformExecutionJob(payload: TerraformExecutionJobPayload, options: EnqueueOptions = {}) {
  return enqueue(QUEUE_NAMES.TERRAFORM_EXECUTION, payload, { ...options, jobId: options.jobId ?? payload.idempotencyKey })
}

export function enqueueVerificationJob(payload: VerificationJobPayload, options?: EnqueueOptions) {
  return enqueue(QUEUE_NAMES.VERIFICATION, payload, options)
}

export function enqueueAuditJob(payload: AuditJobPayload, options?: EnqueueOptions) {
  return enqueue(QUEUE_NAMES.AUDIT, payload, options)
}

export async function closeAllQueues(): Promise<void> {
  await Promise.all(Object.values(QUEUES_BY_NAME).map((queue) => queue.close()))
}
