'use client'

import { useState } from 'react'
import { Play, RotateCcw, Square } from 'lucide-react'
import { useResourceList } from '@/hooks/use-resource-list'
import { useResourceMetrics, type MetricHistoryPoint } from '@/hooks/use-resource-metrics'
import { ConnectionStatusBadge } from './connection-status-badge'
import { ResourceHealthCards } from './resource-health-cards'
import { MetricChart, type MetricChartPoint } from './metric-chart'
import { ChartEmptyState } from './chart-states'

function toChartPoints(history: MetricHistoryPoint[]): MetricChartPoint[] {
  return history.map((point) => ({
    timestamp: point.timestamp,
    cpuPercent: point.metrics.cpuPercent,
    memoryPercent: point.metrics.memoryPercent,
    networkInMb: point.metrics.networkInMb,
    networkOutMb: point.metrics.networkOutMb,
    requestsPerMinute: point.metrics.requestsPerMinute,
    latencyMs: point.metrics.latencyMs,
    errorRatePercent: point.metrics.errorRatePercent,
    hourlyUsd: point.cost.hourlyUsd,
  }))
}

async function callSimulationAction(action: 'start' | 'stop' | 'reset'): Promise<void> {
  await fetch(`/api/simulation/${action}`, {
    method: 'POST',
    headers: action === 'reset' ? { 'Content-Type': 'application/json' } : undefined,
    body: action === 'reset' ? '{}' : undefined,
  })
}

export function TelemetryPanel() {
  const { resources, status, engineRunning, reconnect } = useResourceList()
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [actionPending, setActionPending] = useState<'start' | 'stop' | 'reset' | null>(null)

  const runAction = async (action: 'start' | 'stop' | 'reset') => {
    setActionPending(action)
    try {
      await callSimulationAction(action)
    } finally {
      setActionPending(null)
    }
  }

  // Default to the first resource until the user explicitly picks one —
  // derived at render time rather than via an effect + setState, so there's
  // no extra render cascade while waiting on the initial snapshot.
  const effectiveSelectedId = selectedId ?? resources[0]?.id

  const { resource, history, isLoading, status: metricsStatus } = useResourceMetrics(effectiveSelectedId)
  const chartData = toChartPoints(history)

  return (
    <div className="bg-panel border border-hairline">
      <div className="px-5 py-3.5 border-b border-hairline flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[10px] font-mono uppercase tracking-wider text-graphite">Live Telemetry</h3>
        <div className="flex items-center gap-3">
          <ConnectionStatusBadge status={status} onReconnect={reconnect} />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => runAction(engineRunning ? 'stop' : 'start')}
              disabled={actionPending !== null || status === 'disconnected'}
              className="inline-flex items-center gap-1.5 text-[11px] font-mono font-medium px-2.5 py-1 border border-hairline rounded-sm hover:bg-subtle hover:border-ink disabled:opacity-50 transition-colors"
            >
              {engineRunning ? <Square className="w-3 h-3" aria-hidden="true" /> : <Play className="w-3 h-3" aria-hidden="true" />}
              {engineRunning ? 'Stop simulation' : 'Start simulation'}
            </button>
            <button
              type="button"
              onClick={() => runAction('reset')}
              disabled={actionPending !== null || status === 'disconnected'}
              className="inline-flex items-center gap-1.5 text-[11px] font-mono font-medium px-2.5 py-1 border border-hairline rounded-sm hover:bg-subtle hover:border-ink disabled:opacity-50 transition-colors"
            >
              <RotateCcw className="w-3 h-3" aria-hidden="true" />
              Reset
            </button>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-5">
        <ResourceHealthCards selectedId={effectiveSelectedId} onSelect={setSelectedId} />

        {resources.length > 0 && (
          <div className="flex items-center gap-3">
            <label htmlFor="telemetry-resource-select" className="text-[13px] font-medium text-ink">
              Viewing telemetry for
            </label>
            <select
              id="telemetry-resource-select"
              value={effectiveSelectedId ?? ''}
              onChange={(e) => setSelectedId(e.target.value)}
              className="text-[13px] font-mono border border-hairline rounded-sm px-3 py-1.5 bg-panel text-ink focus:outline-none focus:ring-1 focus:ring-signal"
            >
              {resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.service})
                </option>
              ))}
            </select>
            {resource && (
              <span className="text-[11px] font-mono text-graphite">
                Last updated {new Date(resource.updatedAt).toLocaleTimeString(undefined, { hour12: false })}
              </span>
            )}
          </div>
        )}

        {resources.length === 0 && status !== 'connecting' ? (
          <ChartEmptyState message="No resources are being simulated yet." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <MetricChart
              title="CPU Utilization"
              unit="%"
              data={chartData}
              series={[{ key: 'cpuPercent', label: 'CPU', color: '#FF9900' }]}
              status={metricsStatus}
              isLoading={isLoading}
              yDomain={[0, 100]}
              onReconnect={reconnect}
            />
            <MetricChart
              title="Memory Utilization"
              unit="%"
              data={chartData}
              series={[{ key: 'memoryPercent', label: 'Memory', color: '#146EB4' }]}
              status={metricsStatus}
              isLoading={isLoading}
              yDomain={[0, 100]}
              onReconnect={reconnect}
            />
            <MetricChart
              title="Network Traffic"
              unit=" Mb"
              data={chartData}
              series={[
                { key: 'networkInMb', label: 'In', color: '#037F51' },
                { key: 'networkOutMb', label: 'Out', color: '#232F3E' },
              ]}
              status={metricsStatus}
              isLoading={isLoading}
              onReconnect={reconnect}
            />
            <MetricChart
              title="Requests"
              unit=" req/min"
              data={chartData}
              series={[{ key: 'requestsPerMinute', label: 'Requests', color: '#146EB4' }]}
              status={metricsStatus}
              isLoading={isLoading}
              onReconnect={reconnect}
            />
            <MetricChart
              title="Latency"
              unit=" ms"
              data={chartData}
              series={[{ key: 'latencyMs', label: 'Latency', color: '#B36A00' }]}
              status={metricsStatus}
              isLoading={isLoading}
              onReconnect={reconnect}
            />
            <MetricChart
              title="Error Rate"
              unit="%"
              data={chartData}
              series={[{ key: 'errorRatePercent', label: 'Error Rate', color: '#D13212' }]}
              status={metricsStatus}
              isLoading={isLoading}
              yDomain={[0, 'auto']}
              onReconnect={reconnect}
            />
          </div>
        )}
      </div>
    </div>
  )
}
