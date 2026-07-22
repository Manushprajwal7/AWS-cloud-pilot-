/**
 * Owns "which resource store is currently authoritative" for the whole app:
 * a connected real-backend adapter, the simulation engine, or an empty
 * store when neither is active. Every read route
 * (app/api/simulation/stream, /api/simulation/resources*,
 * /api/dashboard/summary) and lib/anomalies/detector.ts's rebind() go
 * through getActiveStore() / connect() / disconnect() here instead of
 * importing simulationStore directly — see the plan doc for why this one
 * seam is enough to make the entire dashboard monitoring-aware without
 * touching individual components.
 *
 * globalThis-pinned for the same reason simulationStore/tickEngine are:
 * Next.js bundles instrumentation.ts and route handlers into separate
 * module registries, so a plain module-level singleton wouldn't actually be
 * shared between the boot-time reconnect and the API routes.
 */

import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import { simulationStore } from '@/lib/simulation/simulation-store'
import { tickEngine, type TickEngine } from '@/lib/simulation/tick-engine'
import { anomalyDetector, type AnomalyDetector } from '@/lib/anomalies/detector'
import { encryptCredentials, decryptCredentials } from './credential-crypto'
import { createAwsCloudWatchAdapter } from './providers/aws-cloudwatch'
import { createGcpMonitoringAdapter } from './providers/gcp-monitoring'
import { createPrometheusAdapter } from './providers/prometheus'
import type { MonitoringCredentialsInput } from './credential-schemas'
import type { ConnectionTestResult, MonitoringAdapter, MonitoringStatus, ReadableResourceStore } from './types'

const CONNECTION_ROW_ID = 'active'

const EMPTY_STORE: ReadableResourceStore = {
  listResources: () => [],
  getResource: () => undefined,
  getMetricHistory: () => [],
  subscribe: () => () => {},
}

function buildAdapter(input: MonitoringCredentialsInput): MonitoringAdapter {
  switch (input.provider) {
    case 'AWS':
      return createAwsCloudWatchAdapter(input.credentials)
    case 'GCP':
      return createGcpMonitoringAdapter(input.credentials)
    case 'PROMETHEUS':
      return createPrometheusAdapter(input.credentials)
  }
}

/** The non-secret half of a connection's config, persisted alongside the encrypted credentials for status display and boot-time reconnect bookkeeping. */
function publicConfig(input: MonitoringCredentialsInput): Prisma.InputJsonValue {
  switch (input.provider) {
    case 'AWS':
      return { region: input.credentials.region }
    case 'GCP':
      return { projectId: input.credentials.projectId }
    case 'PROMETHEUS':
      return { serverUrl: input.credentials.serverUrl }
  }
}

export interface ConnectionManager {
  connect(input: MonitoringCredentialsInput): Promise<ConnectionTestResult>
  disconnect(): Promise<void>
  getStatus(): MonitoringStatus
  getActiveStore(): ReadableResourceStore
  /** Restores a persisted connection on server boot. Never throws — logs and leaves the app on simulation if the stored credentials no longer work. */
  restoreFromDatabase(): Promise<void>
  /**
   * Re-binds the anomaly detector to whatever getActiveStore() currently
   * resolves to. connect()/disconnect() call this themselves; the
   * simulation start/stop routes (app/api/simulation/{start,stop}) call it
   * too, since starting/stopping the tick engine changes getActiveStore()'s
   * result but doesn't go through connect()/disconnect() at all — without
   * this, stopping the simulation would blank the resource stream but leave
   * stale anomalies (detected while it was running) visible forever.
   */
  syncAnomalyDetectorBinding(): void
}

export interface ConnectionManagerDeps {
  prisma: Pick<PrismaClient, 'monitoringConnection'>
  simulationStore: ReadableResourceStore
  tickEngine: Pick<TickEngine, 'isRunning'>
  anomalyDetector: Pick<AnomalyDetector, 'rebind'>
  buildAdapter: (input: MonitoringCredentialsInput) => MonitoringAdapter
}

const defaultDeps: ConnectionManagerDeps = { prisma, simulationStore, tickEngine, anomalyDetector, buildAdapter }

/**
 * Exported (not just the shared singleton below) so tests can construct an
 * isolated instance with fake deps — no real Postgres/AWS/GCP/Prometheus
 * calls — mirroring lib/simulation/simulation-store.ts's
 * createSimulationStore() test-isolation convention.
 */
export function createConnectionManager(deps: ConnectionManagerDeps = defaultDeps): ConnectionManager {
  const { prisma, simulationStore, tickEngine, anomalyDetector, buildAdapter } = deps
  let activeAdapter: MonitoringAdapter | null = null
  let connectedAt: string | null = null
  let lastError: string | null = null

  async function connect(input: MonitoringCredentialsInput): Promise<ConnectionTestResult> {
    const adapter = buildAdapter(input)
    const result = await adapter.testConnection()
    if (!result.ok) {
      lastError = result.message
      return result
    }

    activeAdapter?.stop()

    try {
      await prisma.monitoringConnection.upsert({
        where: { id: CONNECTION_ROW_ID },
        create: {
          id: CONNECTION_ROW_ID,
          provider: input.provider,
          status: 'connected',
          config: publicConfig(input),
          encryptedCredentials: encryptCredentials(JSON.stringify(input.credentials)),
        },
        update: {
          provider: input.provider,
          status: 'connected',
          config: publicConfig(input),
          encryptedCredentials: encryptCredentials(JSON.stringify(input.credentials)),
          lastError: null,
        },
      })
    } catch {
      // Postgres unreachable: still connect for this process's lifetime
      // (matches the rest of the app's "degrade, don't fail" DB convention —
      // see lib/db/client.ts's isDatabaseConfigured fallback) but note it
      // won't survive a restart.
    }

    adapter.start()
    activeAdapter = adapter
    connectedAt = new Date().toISOString()
    lastError = null
    syncAnomalyDetectorBinding()

    return result
  }

  async function disconnect(): Promise<void> {
    activeAdapter?.stop()
    activeAdapter = null
    connectedAt = null
    lastError = null
    syncAnomalyDetectorBinding()

    try {
      await prisma.monitoringConnection.delete({ where: { id: CONNECTION_ROW_ID } })
    } catch {
      // Row may not exist, or DB unreachable — either way there's nothing more to disconnect.
    }
  }

  function getStatus(): MonitoringStatus {
    if (!activeAdapter) {
      return { connected: false, lastError: lastError ?? undefined }
    }
    return {
      connected: true,
      provider: activeAdapter.provider,
      connectedAt: connectedAt ?? undefined,
    }
  }

  function getActiveStore(): ReadableResourceStore {
    if (activeAdapter) return activeAdapter.store
    if (tickEngine.isRunning()) return simulationStore
    return EMPTY_STORE
  }

  function syncAnomalyDetectorBinding(): void {
    anomalyDetector.rebind(getActiveStore())
  }

  async function restoreFromDatabase(): Promise<void> {
    try {
      const row = await prisma.monitoringConnection.findUnique({ where: { id: CONNECTION_ROW_ID } })
      if (!row) return

      const credentialsJson = decryptCredentials(row.encryptedCredentials)
      const input = { provider: row.provider, credentials: JSON.parse(credentialsJson) } as MonitoringCredentialsInput
      const adapter = buildAdapter(input)
      const result = await adapter.testConnection()
      if (!result.ok) {
        console.warn(`[monitoring] stored ${row.provider} connection failed to restore: ${result.message}`)
        return
      }

      adapter.start()
      activeAdapter = adapter
      connectedAt = row.connectedAt.toISOString()
      syncAnomalyDetectorBinding()
      console.log(`[monitoring] restored ${row.provider} connection from Postgres`)
    } catch (error) {
      console.warn('[monitoring] failed to restore persisted connection:', error instanceof Error ? error.message : error)
    }
  }

  return { connect, disconnect, getStatus, getActiveStore, restoreFromDatabase, syncAnomalyDetectorBinding }
}

const globalForConnectionManager = globalThis as unknown as { monitoringConnectionManager?: ConnectionManager }

export const connectionManager: ConnectionManager =
  globalForConnectionManager.monitoringConnectionManager ?? createConnectionManager()

globalForConnectionManager.monitoringConnectionManager = connectionManager
