import { NextResponse } from 'next/server'
import { connectionManager } from '@/lib/monitoring/connection-manager'
import { anomalyDetector } from '@/lib/anomalies/detector'
import { prisma } from '@/lib/db/client'
import { enrichAnomaly } from '@/app/api/anomalies/enrich'

export const dynamic = 'force-dynamic'

const DB_TIMEOUT_MS = 3000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Database call timed out')), ms)),
  ])
}

/**
 * GET /api/dashboard/summary — real aggregate figures for the dashboard.
 * Spend/waste/anomaly counts come from whichever resource store is
 * currently active (a connected monitoring backend, the simulation engine,
 * or empty — see lib/monitoring/connection-manager.ts), the same source
 * MetricsCards already uses via /api/simulation/stream. Savings and run
 * counts come from Postgres; if the database isn't reachable in this
 * environment, those fields come back null with `dbAvailable: false` rather
 * than a fabricated number or a hard 500 — the rest of the summary is still
 * real and still returned.
 */
export async function GET(): Promise<Response> {
  const resources = connectionManager.getActiveStore().listResources()
  const activeAnomalies = anomalyDetector.listAnomalies({ status: 'active' }).map(enrichAnomaly)
  const resolvedAnomalies = anomalyDetector.listAnomalies({ status: 'resolved' })

  const totalMonthlySpend = resources.reduce((sum, r) => sum + r.cost.projectedMonthlyUsd, 0)
  const estimatedMonthlyWaste = activeAnomalies.reduce((sum, a) => sum + (a.financialImpact?.estimatedWaste.monthlyUsd ?? 0), 0)

  const resourceHealth = resources.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {})

  let dbAvailable = true
  let potentialMonthlySavingsUsd: number | null = null
  let realizedMonthlySavingsUsd: number | null = null
  let activeGraphRuns: number | null = null
  let failedGraphRuns: number | null = null
  let completedGraphRuns: number | null = null

  try {
    const [potentialAgg, realizedAgg, active, failed, completed] = await withTimeout(
      Promise.all([
        prisma.remediationPlan.aggregate({ _sum: { expectedMonthlySavingsUsd: true }, where: { realizedMonthlySavingsUsd: null } }),
        prisma.remediationPlan.aggregate({ _sum: { realizedMonthlySavingsUsd: true } }),
        prisma.agentRun.count({ where: { status: 'running' } }),
        prisma.agentRun.count({ where: { status: 'failed' } }),
        prisma.agentRun.count({ where: { status: { in: ['completed', 'applied', 'no_anomaly'] } } }),
      ]),
      DB_TIMEOUT_MS,
    )
    potentialMonthlySavingsUsd = potentialAgg._sum.expectedMonthlySavingsUsd ?? 0
    realizedMonthlySavingsUsd = realizedAgg._sum.realizedMonthlySavingsUsd ?? 0
    activeGraphRuns = active
    failedGraphRuns = failed
    completedGraphRuns = completed
  } catch {
    dbAvailable = false
  }

  return NextResponse.json({
    dbAvailable,
    totalMonthlySpend,
    estimatedMonthlyWaste,
    potentialMonthlySavingsUsd,
    realizedMonthlySavingsUsd,
    activeAnomalies: activeAnomalies.length,
    resolvedAnomalies: resolvedAnomalies.length,
    activeGraphRuns,
    failedGraphRuns,
    completedGraphRuns,
    resourceHealth,
    totalResources: resources.length,
  })
}
