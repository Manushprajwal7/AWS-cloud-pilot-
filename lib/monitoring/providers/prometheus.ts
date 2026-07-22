/**
 * Prometheus adapter. Resource discovery is the `up` metric's `instance`
 * label (Prometheus's own convention for "what is this server scraping").
 * Metrics are best-effort PromQL against standard node_exporter metric
 * names — an arbitrary Prometheus server has no fixed metric-naming
 * standard, so any metric node_exporter doesn't expose on that target comes
 * back as 0 rather than a guessed/fabricated value (never silently invented).
 *
 * `service` is set to 'EC2' (this app's CloudService type is a closed,
 * AWS-shaped enum used elsewhere for Terraform/pricing logic — see
 * lib/simulation/types.ts) purely as the closest "monitored compute
 * instance" category so this resource renders through the existing
 * dashboard components unchanged. The target's real identity (name, region)
 * comes straight from Prometheus's own labels — nothing about *which*
 * server this is is fabricated, only the coarse taxonomy field.
 */

import type { SimulatedCloudResource, ResourceMetrics, ResourceCost } from '@/lib/simulation/types'
import type { ConnectionTestResult, MonitoringAdapter, PrometheusCredentials } from '../types'
import { createPollStore } from './poll-store'

const POLL_INTERVAL_MS = 30_000
const QUERY_TIMEOUT_MS = 10_000

interface PromVector {
  status: string
  data?: { resultType: string; result: Array<{ metric: Record<string, string>; value: [number, string] }> }
  error?: string
}

function buildHeaders(credentials: PrometheusCredentials): Record<string, string> {
  const headers: Record<string, string> = { ...credentials.headers }
  if (credentials.bearerToken) {
    headers.Authorization = `Bearer ${credentials.bearerToken}`
  } else if (credentials.username) {
    headers.Authorization = `Basic ${Buffer.from(`${credentials.username}:${credentials.password ?? ''}`).toString('base64')}`
  }
  return headers
}

async function queryInstant(credentials: PrometheusCredentials, promql: string): Promise<PromVector> {
  const url = `${credentials.serverUrl.replace(/\/$/, '')}/api/v1/query?query=${encodeURIComponent(promql)}`
  const response = await fetch(url, {
    headers: buildHeaders(credentials),
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
  })
  const body = (await response.json()) as PromVector
  if (!response.ok || body.status !== 'success') {
    throw new Error(body.error ?? `Prometheus query failed with HTTP ${response.status}`)
  }
  return body
}

function firstValue(vector: PromVector, labelKey: string, labelValue: string): number {
  const series = vector.data?.result.find((r) => r.metric[labelKey] === labelValue)
  if (!series) return 0
  const parsed = Number(series.value[1])
  return Number.isFinite(parsed) ? parsed : 0
}

function sanitizeId(instance: string): string {
  return `prom-${instance.replace(/[^a-zA-Z0-9]/g, '-')}`
}

function buildResource(instance: string, job: string, metrics: ResourceMetrics): SimulatedCloudResource {
  const cost: ResourceCost = { hourlyUsd: 0, dailyUsd: 0, projectedMonthlyUsd: 0 }
  return {
    id: sanitizeId(instance),
    name: instance,
    service: 'EC2',
    environment: 'production',
    region: job || 'prometheus',
    status: 'running',
    configuration: {},
    metrics,
    cost,
    activeScenario: 'NORMAL',
    updatedAt: new Date().toISOString(),
  }
}

export function createPrometheusAdapter(credentials: PrometheusCredentials): MonitoringAdapter {
  const store = createPollStore()
  let timer: ReturnType<typeof setInterval> | null = null

  async function testConnection(): Promise<ConnectionTestResult> {
    try {
      const up = await queryInstant(credentials, 'up')
      const targetCount = up.data?.result.length ?? 0
      return { ok: true, message: `Connected to Prometheus — ${targetCount} target${targetCount === 1 ? '' : 's'} found.` }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Unable to reach Prometheus server' }
    }
  }

  async function pollOnce(): Promise<void> {
    const up = await queryInstant(credentials, 'up')
    const targets = (up.data?.result ?? []).filter((r) => r.value[1] === '1')

    const [cpuIdle, memAvailable, memTotal, netIn, netOut] = await Promise.all([
      queryInstant(credentials, '100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[2m])) * 100)').catch(() => ({ status: 'success' }) as PromVector),
      queryInstant(credentials, 'node_memory_MemAvailable_bytes').catch(() => ({ status: 'success' }) as PromVector),
      queryInstant(credentials, 'node_memory_MemTotal_bytes').catch(() => ({ status: 'success' }) as PromVector),
      queryInstant(credentials, 'rate(node_network_receive_bytes_total[2m])').catch(() => ({ status: 'success' }) as PromVector),
      queryInstant(credentials, 'rate(node_network_transmit_bytes_total[2m])').catch(() => ({ status: 'success' }) as PromVector),
    ])

    const resources = targets.map((target) => {
      const instance = target.metric.instance
      const job = target.metric.job
      const memAvail = firstValue(memAvailable, 'instance', instance)
      const memTot = firstValue(memTotal, 'instance', instance)

      const metrics: ResourceMetrics = {
        cpuPercent: firstValue(cpuIdle, 'instance', instance),
        memoryPercent: memTot > 0 ? ((memTot - memAvail) / memTot) * 100 : 0,
        networkInMb: firstValue(netIn, 'instance', instance) / (1024 * 1024),
        networkOutMb: firstValue(netOut, 'instance', instance) / (1024 * 1024),
        requestsPerMinute: 0,
        latencyMs: 0,
        errorRatePercent: 0,
        idleHours: 0,
      }

      return buildResource(instance, job, metrics)
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

  return { provider: 'PROMETHEUS', testConnection, start, stop, store }
}
