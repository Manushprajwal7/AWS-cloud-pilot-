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
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold text-gray-900 text-sm">Live Telemetry</h3>
        <div className="flex items-center gap-3">
          <ConnectionStatusBadge status={status} onReconnect={reconnect} />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => runAction(engineRunning ? 'stop' : 'start')}
              disabled={actionPending !== null || status === 'disconnected'}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50 transition-colors"
            >
              {engineRunning ? <Square className="w-3.5 h-3.5" aria-hidden="true" /> : <Play className="w-3.5 h-3.5" aria-hidden="true" />}
              {engineRunning ? 'Stop simulation' : 'Start simulation'}
            </button>
            <button
              type="button"
              onClick={() => runAction('reset')}
              disabled={actionPending !== null || status === 'disconnected'}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              Reset
            </button>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        <ResourceHealthCards selectedId={effectiveSelectedId} onSelect={setSelectedId} />

        {resources.length > 0 && (
          <div className="flex items-center gap-3">
            <label htmlFor="telemetry-resource-select" className="text-sm font-medium text-gray-700">
              Viewing telemetry for
            </label>
            <select
              id="telemetry-resource-select"
              value={effectiveSelectedId ?? ''}
              onChange={(e) => setSelectedId(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              {resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.service})
                </option>
              ))}
            </select>
            {resource && (
              <span className="text-xs text-gray-500">
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
              series={[{ key: 'cpuPercent', label: 'CPU', color: '#f97316' }]}
              status={metricsStatus}
              isLoading={isLoading}
              yDomain={[0, 100]}
              onReconnect={reconnect}
            />
            <MetricChart
              title="Memory Utilization"
              unit="%"
              data={chartData}
              series={[{ key: 'memoryPercent', label: 'Memory', color: '#3b82f6' }]}
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
                { key: 'networkInMb', label: 'In', color: '#10b981' },
                { key: 'networkOutMb', label: 'Out', color: '#6366f1' },
              ]}
              status={metricsStatus}
              isLoading={isLoading}
              onReconnect={reconnect}
            />
            <MetricChart
              title="Requests"
              unit=" req/min"
              data={chartData}
              series={[{ key: 'requestsPerMinute', label: 'Requests', color: '#8b5cf6' }]}
              status={metricsStatus}
              isLoading={isLoading}
              onReconnect={reconnect}
            />
            <MetricChart
              title="Latency"
              unit=" ms"
              data={chartData}
              series={[{ key: 'latencyMs', label: 'Latency', color: '#ec4899' }]}
              status={metricsStatus}
              isLoading={isLoading}
              onReconnect={reconnect}
            />
            <MetricChart
              title="Error Rate"
              unit="%"
              data={chartData}
              series={[{ key: 'errorRatePercent', label: 'Error Rate', color: '#ef4444' }]}
              status={metricsStatus}
              isLoading={isLoading}
              yDomain={[0, 'auto']}
              onReconnect={reconnect}
            />
            <MetricChart
              title="Cost"
              unit="/hr"
              data={chartData}
              series={[{ key: 'hourlyUsd', label: 'Hourly cost', color: '#f59e0b' }]}
              status={metricsStatus}
              isLoading={isLoading}
              onReconnect={reconnect}
              valueFormatter={(v) => `$${v.toFixed(4)}`}
            />
          </div>
        )}
      </div>
    </div>
  )
}
