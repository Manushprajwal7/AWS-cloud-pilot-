/**
 * Shared contract for real monitoring-backend integration (AWS CloudWatch,
 * GCP Cloud Monitoring, Prometheus). Adapters normalize whatever a provider
 * actually returns into the exact same SimulatedCloudResource/ResourceMetrics
 * shapes the simulation engine already produces — that's what lets every
 * existing dashboard component render real data with zero changes. A field a
 * provider genuinely can't supply is reported as 0, never fabricated; see
 * each provider module's doc comment for which fields that applies to.
 */

import type {
  MetricSnapshot,
  SimulatedCloudResource,
  SimulationStoreListener,
} from '@/lib/simulation/types'

export type MonitoringProvider = 'AWS' | 'GCP' | 'PROMETHEUS'

/**
 * The read-only subset of lib/simulation/simulation-store.ts's
 * `SimulationStore` that every dashboard-facing route actually needs
 * (listResources/getResource/getMetricHistory/subscribe — never the
 * simulation-only mutators like activateScenario/resetResource).
 * `SimulationStore` is declared to extend this explicitly; monitoring
 * adapters' stores satisfy it structurally.
 */
export interface ReadableResourceStore {
  listResources(): SimulatedCloudResource[]
  getResource(id: string): SimulatedCloudResource | undefined
  getMetricHistory(id: string): MetricSnapshot[]
  subscribe(listener: SimulationStoreListener): () => void
}

export interface ConnectionTestResult {
  ok: boolean
  message: string
}

export interface MonitoringAdapter {
  readonly provider: MonitoringProvider
  /** Cheap, side-effect-free credential/reachability check (no polling started). */
  testConnection(): Promise<ConnectionTestResult>
  /** Begins polling the real backend on an interval and populating `store`. */
  start(): void
  stop(): void
  readonly store: ReadableResourceStore
}

// --- Per-provider credential/config shapes -----------------------------

export interface AwsCredentials {
  accessKeyId: string
  secretAccessKey: string
  region: string
  endpoint?: string
}

export interface GcpCredentials {
  /** Either the full service-account JSON (as a string) or clientEmail+privateKey. */
  serviceAccountJson?: string
  clientEmail?: string
  privateKey?: string
  projectId: string
  endpoint?: string
}

export interface PrometheusCredentials {
  serverUrl: string
  username?: string
  password?: string
  bearerToken?: string
  headers?: Record<string, string>
}

export interface MonitoringStatus {
  connected: boolean
  provider?: MonitoringProvider
  connectedAt?: string
  lastPolledAt?: string
  lastError?: string
}
