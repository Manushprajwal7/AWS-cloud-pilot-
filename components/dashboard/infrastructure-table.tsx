'use client'

import {
  Search,
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
  Zap,
  Loader2,
  Check,
  X,
  RefreshCw,
  Activity,
} from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import { useResourceList } from '@/hooks/use-resource-list'
import { ConnectionStatusBadge } from '@/components/monitoring/connection-status-badge'
import { ChartEmptyState, ChartErrorState, ChartLoadingState } from '@/components/monitoring/chart-states'
import type { SimulatedCloudResource } from '@/lib/simulation/types'

type SortableColumn = 'id' | 'type' | 'cpu' | 'memory' | 'cost' | 'status'
type DiagnosticState = 'idle' | 'starting' | 'started' | 'error'

function resourceTypeLabel(resource: SimulatedCloudResource): string {
  const { service, configuration } = resource
  if (configuration.instanceType) return configuration.instanceType
  if (service === 'ECS') return `${configuration.desiredCapacity ?? 1} task(s)`
  if (service === 'LAMBDA') return `${configuration.memoryGb ?? 0.5}GB`
  return service
}

function SortHeader({
  label,
  value,
  sortBy,
  sortOrder,
  onSort,
}: {
  label: string
  value: SortableColumn
  sortBy: SortableColumn
  sortOrder: 'asc' | 'desc'
  onSort: (value: SortableColumn) => void
}) {
  return (
    <button
      onClick={() => onSort(value)}
      className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-graphite hover:text-ink transition-colors"
      aria-label={`Sort by ${label}${sortBy === value ? `, currently sorted ${sortOrder === 'asc' ? 'ascending' : 'descending'}` : ''}`}
    >
      {label}
      {sortBy === value ? (
        sortOrder === 'asc' ? (
          <ChevronUp className="w-3 h-3 text-signal" strokeWidth={2} />
        ) : (
          <ChevronDown className="w-3 h-3 text-signal" strokeWidth={2} />
        )
      ) : (
        <ArrowUpDown className="w-3 h-3 text-hairline" strokeWidth={2} />
      )}
    </button>
  )
}

const STATUS_COLOR: Record<string, string> = {
  running: 'bg-ok-soft text-ok',
  stopped: 'bg-subtle text-graphite',
  degraded: 'bg-danger-soft text-danger',
  optimizing: 'bg-signal-soft text-signal',
  failed: 'bg-danger-soft text-danger',
}

const ENV_COLOR: Record<string, string> = {
  production: 'bg-danger-soft text-danger',
  staging: 'bg-warn-soft text-warn',
  development: 'bg-info-soft text-info',
}

export function InfrastructureTable() {
  const { resources, status, isLoading, reconnect } = useResourceList()
  const [sortBy, setSortBy] = useState<SortableColumn>('cpu')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [diagnosticState, setDiagnosticState] = useState<Record<string, DiagnosticState>>({})

  const runDiagnostic = async (resourceId: string) => {
    setDiagnosticState((prev) => ({ ...prev, [resourceId]: 'starting' }))
    try {
      const response = await fetch('/api/graph/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resourceId }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setDiagnosticState((prev) => ({ ...prev, [resourceId]: 'started' }))
    } catch {
      setDiagnosticState((prev) => ({ ...prev, [resourceId]: 'error' }))
    }
  }

  const handleSort = (value: SortableColumn) => {
    if (sortBy === value) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(value)
      setSortOrder('desc')
    }
  }

  const rows = useMemo(() => {
    const filtered = search.trim()
      ? resources.filter(
          (r) =>
            r.name.toLowerCase().includes(search.toLowerCase()) ||
            r.id.toLowerCase().includes(search.toLowerCase()),
        )
      : resources

    const sorted = [...filtered].sort((a, b) => {
      let diff = 0
      switch (sortBy) {
        case 'id':
          diff = a.name.localeCompare(b.name)
          break
        case 'type':
          diff = resourceTypeLabel(a).localeCompare(resourceTypeLabel(b))
          break
        case 'cpu':
          diff = a.metrics.cpuPercent - b.metrics.cpuPercent
          break
        case 'memory':
          diff = a.metrics.memoryPercent - b.metrics.memoryPercent
          break
        case 'cost':
          diff = a.cost.projectedMonthlyUsd - b.cost.projectedMonthlyUsd
          break
        case 'status':
          diff = a.status.localeCompare(b.status)
          break
      }
      return sortOrder === 'asc' ? diff : -diff
    })

    return sorted
  }, [resources, search, sortBy, sortOrder])

  return (
    <div className="bg-panel border border-hairline shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-hairline flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h3 className="text-[10px] font-mono uppercase tracking-wider text-graphite whitespace-nowrap">Infrastructure Resources</h3>
          <ConnectionStatusBadge status={status} onReconnect={reconnect} />
        </div>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-graphite" strokeWidth={1.75} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search resources..."
            aria-label="Search resources by name or id"
            className="w-full pl-9 pr-8 py-1.5 border border-hairline rounded-sm bg-subtle text-[12px] placeholder-graphite/70 focus:outline-none focus:ring-1 focus:ring-signal focus:border-signal focus:bg-panel transition-all"
          />
          {search && (
            <button onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2">
              <X className="w-3.5 h-3.5 text-graphite" strokeWidth={1.75} />
            </button>
          )}
        </div>
        <button
          onClick={reconnect}
          className="p-1.5 text-graphite hover:text-ink hover:bg-subtle rounded-sm transition-colors flex-shrink-0"
          title="Refresh connection"
        >
          <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>
      </div>

      {status === 'disconnected' ? (
        <ChartErrorState message="Unable to load the resource inventory — the simulation stream is disconnected." onRetry={reconnect} heightClassName="h-48" />
      ) : isLoading ? (
        <ChartLoadingState heightClassName="h-48" />
      ) : rows.length === 0 ? (
        <ChartEmptyState message={search ? 'No resources match your search.' : 'No resources found.'} heightClassName="h-48" />
      ) : (
        <>
          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <caption className="sr-only">Live simulated infrastructure resources and their current metrics</caption>
              <thead className="border-b border-hairline">
                <tr>
                  <th scope="col" className="px-5 py-2.5 text-left">
                    <SortHeader label="Resource" value="id" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-left">
                    <SortHeader label="Type" value="type" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-left">
                    <SortHeader label="CPU%" value="cpu" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-left">
                    <SortHeader label="Memory%" value="memory" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-left">
                    <SortHeader label="Monthly Cost" value="cost" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-left">
                    <SortHeader label="Status" value="status" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-left font-mono text-[11px] uppercase tracking-wider text-graphite">Environment</th>
                  <th scope="col" className="px-5 py-2.5 text-left font-mono text-[11px] uppercase tracking-wider text-graphite">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {rows.map((resource) => {
                  const isExpanded = expandedId === resource.id
                  const diagState = diagnosticState[resource.id] ?? 'idle'

                  return (
                    <Fragment key={resource.id}>
                      <tr className="hover:bg-subtle transition-colors">
                        <td className="px-5 py-2.5">
                          <div className="font-medium text-ink">{resource.name}</div>
                          <div className="font-mono text-[11px] text-graphite">{resource.id}</div>
                        </td>
                        <td className="px-5 py-2.5 text-ink font-mono text-[12px]">{resourceTypeLabel(resource)}</td>
                        <td className="px-5 py-2.5 text-ink font-mono font-medium tabular-nums">{resource.metrics.cpuPercent.toFixed(1)}%</td>
                        <td className="px-5 py-2.5 text-ink font-mono font-medium tabular-nums">{resource.metrics.memoryPercent.toFixed(1)}%</td>
                        <td className="px-5 py-2.5 text-ink font-mono font-medium tabular-nums">
                          ${resource.cost.projectedMonthlyUsd.toFixed(2)}
                        </td>
                        <td className="px-5 py-2.5">
                          <span
                            className={`px-2 py-0.5 rounded-sm text-[10px] font-mono font-semibold inline-flex items-center gap-1 uppercase ${STATUS_COLOR[resource.status] ?? 'bg-subtle text-graphite'}`}
                          >
                            <span className="w-1 h-1 rounded-full bg-current"></span>
                            {resource.status}
                          </span>
                        </td>
                        <td className="px-5 py-2.5">
                          <span
                            className={`px-2 py-0.5 rounded-sm text-[10px] font-mono font-semibold uppercase ${ENV_COLOR[resource.environment] ?? 'bg-subtle text-graphite'}`}
                          >
                            {resource.environment}
                          </span>
                        </td>
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setExpandedId(isExpanded ? null : resource.id)}
                              className={`p-1 rounded-sm transition-colors ${isExpanded ? 'text-signal bg-signal-soft' : 'text-graphite hover:text-ink hover:bg-subtle'}`}
                              title="View metrics"
                            >
                              <Activity className="w-4 h-4" strokeWidth={1.75} />
                            </button>
                            <button
                              onClick={() => runDiagnostic(resource.id)}
                              disabled={diagState === 'starting'}
                              className={`p-1 rounded-sm transition-colors ${
                                diagState === 'started'
                                  ? 'text-ok'
                                  : diagState === 'error'
                                    ? 'text-danger'
                                    : 'text-graphite hover:text-ink hover:bg-subtle'
                              }`}
                              title={diagState === 'started' ? 'Diagnostic run started' : diagState === 'error' ? 'Failed to start — retry' : 'Run LangGraph diagnostic'}
                            >
                              {diagState === 'starting' ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : diagState === 'started' ? (
                                <Check className="w-4 h-4" strokeWidth={1.75} />
                              ) : (
                                <Zap className="w-4 h-4" strokeWidth={1.75} />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-subtle">
                          <td colSpan={7} className="px-5 py-4">
                            <div className="grid grid-cols-4 gap-4 text-[11px] font-mono">
                              <div>
                                <p className="uppercase tracking-wider text-graphite mb-1">Region / Scenario</p>
                                <p className="text-ink">{resource.region} · {resource.activeScenario.replace(/_/g, ' ')}</p>
                              </div>
                              <div>
                                <p className="uppercase tracking-wider text-graphite mb-1">Network I/O</p>
                                <p className="text-ink">{resource.metrics.networkInMb.toFixed(1)} MB in / {resource.metrics.networkOutMb.toFixed(1)} MB out</p>
                              </div>
                              <div>
                                <p className="uppercase tracking-wider text-graphite mb-1">Requests / Latency</p>
                                <p className="text-ink">{resource.metrics.requestsPerMinute.toFixed(0)} req/min · {resource.metrics.latencyMs.toFixed(0)}ms</p>
                              </div>
                              <div>
                                <p className="uppercase tracking-wider text-graphite mb-1">Error Rate / Idle</p>
                                <p className="text-ink">{resource.metrics.errorRatePercent.toFixed(2)}% · {resource.metrics.idleHours.toFixed(1)}h idle</p>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="px-5 py-2.5 border-t border-hairline text-[11px] font-mono text-graphite">
            Showing {rows.length} of {resources.length} resource{resources.length === 1 ? '' : 's'}
          </div>
        </>
      )}
    </div>
  )
}
