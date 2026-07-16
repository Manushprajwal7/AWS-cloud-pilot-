/**
 * Simulation worker: applies a scenario activation to the shared
 * simulationStore out-of-band from any HTTP request, so scenario injection
 * driven by the queue (rather than the direct POST /api/simulation/scenario
 * route) goes through the same retry/backoff/concurrency machinery as
 * every other background operation in this phase.
 *
 * Run with: pnpm worker:simulation (see package.json).
 */

import { Worker, type Job } from 'bullmq'
import { redisConnection } from '@/lib/queue/connection'
import { QUEUE_NAMES, simulationJobSchema } from '@/lib/queue/job-types'
import { registerGracefulShutdown } from '@/lib/queue/shutdown'
import { startHeartbeatLoop } from '@/lib/queue/heartbeat'
import { simulationStore, SimulationResourceNotFoundError } from '@/lib/simulation/simulation-store'

const CONCURRENCY = Number(process.env.SIMULATION_WORKER_CONCURRENCY ?? 4)

async function processSimulationJob(job: Job): Promise<{ resourceId: string; scenario: string }> {
  const payload = simulationJobSchema.parse(job.data)

  try {
    simulationStore.activateScenario(payload.resourceId, payload.scenario)
  } catch (error) {
    if (error instanceof SimulationResourceNotFoundError) {
      // Not retryable — the resource is gone, retrying won't change that.
      await job.discard()
    }
    throw error
  }

  return { resourceId: payload.resourceId, scenario: payload.scenario }
}

const worker = new Worker(QUEUE_NAMES.SIMULATION, processSimulationJob, {
  connection: redisConnection,
  concurrency: CONCURRENCY,
})

worker.on('failed', (job, error) => {
  console.error(`[simulation-worker] job ${job?.id} failed:`, error.message)
})

const stopHeartbeat = startHeartbeatLoop('simulation-worker')
registerGracefulShutdown([worker], 'simulation-worker', stopHeartbeat)

console.log(`[simulation-worker] listening on ${QUEUE_NAMES.SIMULATION}`)
