/**
 * GCP adapter: Cloud Monitoring's `compute.googleapis.com/instance/cpu/
 * utilization` time series doubles as both resource discovery (its
 * `resource.labels.instance_id`/`zone` labels enumerate every monitored VM)
 * and the CPU metric itself — no separate Compute Engine API call needed.
 * memoryPercent/networkIn/networkOut/latencyMs/errorRatePercent/
 * requestsPerMinute have no metric queried here (would need per-metric-type
 * calls this pass doesn't make) and are reported as 0, not guessed.
 *
 * `service` is set to 'EC2' for the same structural reason documented in
 * prometheus.ts — this app's CloudService type is a closed, AWS-shaped enum
 * used by unrelated Terraform/pricing logic; it's reused only as the
 * closest "monitored compute instance" category so this resource renders
 * through the existing dashboard components unchanged.
 */

import { MetricServiceClient } from '@google-cloud/monitoring'
import type { SimulatedCloudResource, ResourceMetrics, ResourceCost } from '@/lib/simulation/types'
import type { ConnectionTestResult, GcpCredentials, MonitoringAdapter } from '../types'
import { createPollStore } from './poll-store'

const POLL_INTERVAL_MS = 60_000
const METRIC_LOOKBACK_MS = 10 * 60_000
const CPU_METRIC_TYPE = 'compute.googleapis.com/instance/cpu/utilization'

function resolveAuthCredentials(credentials: GcpCredentials): { client_email: string; private_key: string } {
  if (credentials.serviceAccountJson) {
    const parsed = JSON.parse(credentials.serviceAccountJson) as { client_email?: string; private_key?: string }
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error('Service account JSON is missing client_email/private_key')
    }
    return { client_email: parsed.client_email, private_key: parsed.private_key }
  }
  if (credentials.clientEmail && credentials.privateKey) {
    return { client_email: credentials.clientEmail, private_key: credentials.privateKey }
  }
  throw new Error('GCP credentials require either serviceAccountJson or clientEmail + privateKey')
}

function createClient(credentials: GcpCredentials): MetricServiceClient {
  const auth = resolveAuthCredentials(credentials)
  return new MetricServiceClient({
    projectId: credentials.projectId,
    apiEndpoint: credentials.endpoint,
    credentials: auth,
  })
}

function sanitizeId(instanceId: string): string {
  return `gcp-${instanceId}`
}

export function createGcpMonitoringAdapter(credentials: GcpCredentials): MonitoringAdapter {
  const store = createPollStore()
  const client = createClient(credentials)
  let timer: ReturnType<typeof setInterval> | null = null

  function projectName(): string {
    return `projects/${credentials.projectId}`
  }

  async function testConnection(): Promise<ConnectionTestResult> {
    try {
      const now = Math.floor(Date.now() / 1000)
      const [series] = await client.listTimeSeries({
        name: projectName(),
        filter: `metric.type = "${CPU_METRIC_TYPE}"`,
        interval: { startTime: { seconds: now - 300 }, endTime: { seconds: now } },
        view: 'HEADERS',
      })
      return { ok: true, message: `Connected to GCP Cloud Monitoring — ${series.length} instance${series.length === 1 ? '' : 's'} reporting CPU metrics.` }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Unable to authenticate with GCP Cloud Monitoring' }
    }
  }

  async function pollOnce(): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    const [series] = await client.listTimeSeries({
      name: projectName(),
      filter: `metric.type = "${CPU_METRIC_TYPE}"`,
      interval: { startTime: { seconds: now - METRIC_LOOKBACK_MS / 1000 }, endTime: { seconds: now } },
      view: 'FULL',
    })

    const resources: SimulatedCloudResource[] = series.map((entry) => {
      const labels = entry.resource?.labels ?? {}
      const instanceId = labels.instance_id ?? 'unknown-instance'
      const zone = labels.zone ?? credentials.projectId
      const latestPoint = entry.points?.[0]
      const cpuFraction = latestPoint?.value?.doubleValue ?? 0

      const metrics: ResourceMetrics = {
        cpuPercent: cpuFraction * 100,
        memoryPercent: 0,
        networkInMb: 0,
        networkOutMb: 0,
        requestsPerMinute: 0,
        latencyMs: 0,
        errorRatePercent: 0,
        idleHours: 0,
      }
      const cost: ResourceCost = { hourlyUsd: 0, dailyUsd: 0, projectedMonthlyUsd: 0 }

      return {
        id: sanitizeId(instanceId),
        name: instanceId,
        service: 'EC2',
        environment: 'production',
        region: zone,
        status: 'running',
        configuration: {},
        metrics,
        cost,
        activeScenario: 'NORMAL',
        updatedAt: new Date().toISOString(),
      }
    })

    store.applySnapshot(resources)
  }

  function start(): void {
    if (timer) return
    void pollOnce().catch(() => {})
    timer = setInterval(() => void pollOnce().catch(() => {}), POLL_INTERVAL_MS)
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  return { provider: 'GCP', testConnection, start, stop, store }
}
