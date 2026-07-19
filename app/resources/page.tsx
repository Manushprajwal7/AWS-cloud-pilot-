'use client'

import { Fragment, Suspense, useMemo, useState } from 'react'
import { Sidebar } from '@/components/dashboard/sidebar'
import { Header } from '@/components/dashboard/header'
import { useResourceList } from '@/hooks/use-resource-list'
import { useSearchParams } from 'next/navigation'
import { Search, ChevronUp, ChevronDown, ArrowUpDown, Activity, Zap, Loader2, Check, X } from 'lucide-react'
import type { SimulatedCloudResource } from '@/lib/simulation/types'

type SortableColumn = 'name' | 'type' | 'service' | 'cpu' | 'memory' | 'cost' | 'status' | 'environment'
type DiagnosticState = 'idle' | 'starting' | 'started' | 'error'

function resourceTypeLabel(resource: SimulatedCloudResource): string {
  const { service, configuration } = resource
  if (configuration.instanceType) return configuration.instanceType
  if (service === 'ECS') return `${configuration.desiredCapacity ?? 1} task(s)`
  if (service === 'LAMBDA') return `${configuration.memoryGb ?? 0.5}GB`
  return service
}

const STATUS_COLOR: Record<string, string> = {
  running: 'bg-ok-soft text-ok',
  stopped: 'bg-subtle text-ink',
  degraded: 'bg-danger-soft text-danger',
  optimizing: 'bg-signal-soft text-signal',
  failed: 'bg-danger-soft text-danger',
}

const ENV_COLOR: Record<string, string> = {
  production: 'bg-danger-soft text-danger',
  staging: 'bg-signal-soft text-signal',
  development: 'bg-info-soft text-info',
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
      className="flex items-center gap-1 font-semibold text-ink hover:text-signal"
    >
      {label}
      {sortBy === value ? (
        sortOrder === 'asc' ? (
          <ChevronUp className="w-3.5 h-3.5" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5" />
        )
      ) : (
        <ArrowUpDown className="w-3.5 h-3.5 text-graphite" />
      )}
    </button>
  )
}

function ResourcesPageInner() {
  const { resources } = useResourceList()
  const searchParams = useSearchParams()
  const [sortBy, setSortBy] = useState<SortableColumn>('cost')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '')
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
        case 'name':
          diff = a.name.localeCompare(b.name)
          break
        case 'type':
          diff = resourceTypeLabel(a).localeCompare(resourceTypeLabel(b))
          break
        case 'service':
          diff = a.service.localeCompare(b.service)
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
        case 'environment':
          diff = a.environment.localeCompare(b.environment)
          break
      }
      return sortOrder === 'asc' ? diff : -diff
    })

    return sorted
  }, [resources, search, sortBy, sortOrder])

  return (
    <div className="flex h-screen w-screen bg-paper overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col ml-56 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto pt-16">
          <div className="w-full px-6 py-6 space-y-6">
            {/* Page Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-ink">Resources</h1>
                <p className="text-graphite mt-1">Manage and monitor all infrastructure resources</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-ink">{resources.length}</p>
                <p className="text-sm text-graphite">Total resources</p>
              </div>
            </div>

            {/* Search Bar */}
            <div className="bg-panel rounded-lg border border-hairline p-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-graphite" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search resources by name or ID..."
                  className="w-full pl-9 pr-8 py-2 border border-hairline rounded-lg bg-panel text-sm placeholder-graphite/70 focus:outline-none focus:ring-2 focus:ring-signal focus:border-transparent"
                />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2">
                    <X className="w-3.5 h-3.5 text-graphite hover:text-graphite" />
                  </button>
                )}
              </div>
            </div>

            {/* Resources Table */}
            <div className="bg-panel rounded-lg border border-hairline overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-subtle border-b border-hairline">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left">
                        <SortHeader label="Resource" value="name" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                      </th>
                      <th scope="col" className="px-6 py-3 text-left">
                        <SortHeader label="Service" value="service" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                      </th>
                      <th scope="col" className="px-6 py-3 text-left">
                        <SortHeader label="Type" value="type" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                      </th>
                      <th scope="col" className="px-6 py-3 text-left">
                        <SortHeader label="CPU%" value="cpu" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                      </th>
                      <th scope="col" className="px-6 py-3 text-left">
                        <SortHeader label="Memory%" value="memory" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                      </th>
                      <th scope="col" className="px-6 py-3 text-left">
                        <SortHeader label="Monthly Cost" value="cost" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                      </th>
                      <th scope="col" className="px-6 py-3 text-left">
                        <SortHeader label="Status" value="status" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                      </th>
                      <th scope="col" className="px-6 py-3 text-left">
                        <SortHeader label="Environment" value="environment" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                      </th>
                      <th scope="col" className="px-6 py-3 text-left font-semibold text-ink">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {rows.map((resource) => {
                      const isExpanded = expandedId === resource.id
                      const diagState = diagnosticState[resource.id] ?? 'idle'

                      return (
                        <Fragment key={resource.id}>
                          <tr className="hover:bg-subtle transition-colors">
                            <td className="px-6 py-3">
                              <div className="font-medium text-ink">{resource.name}</div>
                              <div className="font-mono text-xs text-graphite">{resource.id}</div>
                            </td>
                            <td className="px-6 py-3 text-ink font-medium">{resource.service}</td>
                            <td className="px-6 py-3 text-ink">{resourceTypeLabel(resource)}</td>
                            <td className="px-6 py-3 text-ink font-medium">{resource.metrics.cpuPercent.toFixed(1)}%</td>
                            <td className="px-6 py-3 text-ink font-medium">{resource.metrics.memoryPercent.toFixed(1)}%</td>
                            <td className="px-6 py-3 text-ink font-medium">${resource.cost.projectedMonthlyUsd.toFixed(2)}</td>
                            <td className="px-6 py-3">
                              <span
                                className={`px-2.5 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1 capitalize ${
                                  STATUS_COLOR[resource.status] ?? 'bg-subtle text-ink'
                                }`}
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                                {resource.status}
                              </span>
                            </td>
                            <td className="px-6 py-3">
                              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${ENV_COLOR[resource.environment] ?? 'bg-subtle text-ink'}`}>
                                {resource.environment}
                              </span>
                            </td>
                            <td className="px-6 py-3">
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => setExpandedId(isExpanded ? null : resource.id)}
                                  className={`p-1 rounded transition-colors ${isExpanded ? 'text-signal bg-signal-soft' : 'text-graphite hover:text-graphite hover:bg-subtle'}`}
                                  title="View details"
                                >
                                  <Activity className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => runDiagnostic(resource.id)}
                                  disabled={diagState === 'starting'}
                                  className={`p-1 rounded transition-colors ${
                                    diagState === 'started'
                                      ? 'text-ok'
                                      : diagState === 'error'
                                        ? 'text-danger'
                                        : 'text-graphite hover:text-graphite hover:bg-subtle'
                                  }`}
                                  title={diagState === 'started' ? 'Diagnostic run started' : diagState === 'error' ? 'Failed to start — retry' : 'Run LangGraph diagnostic'}
                                >
                                  {diagState === 'starting' ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : diagState === 'started' ? (
                                    <Check className="w-4 h-4" />
                                  ) : (
                                    <Zap className="w-4 h-4" />
                                  )}
                                </button>
                              </div>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-subtle">
                              <td colSpan={9} className="px-6 py-4">
                                <div className="grid grid-cols-4 gap-4 text-xs">
                                  <div>
                                    <p className="font-semibold text-graphite mb-1">Region / Scenario</p>
                                    <p className="text-ink">{resource.region} · {resource.activeScenario.replace(/_/g, ' ')}</p>
                                  </div>
                                  <div>
                                    <p className="font-semibold text-graphite mb-1">Network I/O</p>
                                    <p className="text-ink">{resource.metrics.networkInMb.toFixed(1)} MB in / {resource.metrics.networkOutMb.toFixed(1)} MB out</p>
                                  </div>
                                  <div>
                                    <p className="font-semibold text-graphite mb-1">Requests / Latency</p>
                                    <p className="text-ink">{resource.metrics.requestsPerMinute.toFixed(0)} req/min · {resource.metrics.latencyMs.toFixed(0)}ms</p>
                                  </div>
                                  <div>
                                    <p className="font-semibold text-graphite mb-1">Error Rate / Idle</p>
                                    <p className="text-ink">{resource.metrics.errorRatePercent.toFixed(2)}% · {resource.metrics.idleHours.toFixed(1)}h idle</p>
                                  </div>
                                  <div>
                                    <p className="font-semibold text-graphite mb-1">Hourly / Daily Cost</p>
                                    <p className="text-ink">${resource.cost.hourlyUsd.toFixed(3)}/hr · ${resource.cost.dailyUsd.toFixed(2)}/day</p>
                                  </div>
                                  {resource.configuration.instanceType && (
                                    <div>
                                      <p className="font-semibold text-graphite mb-1">Instance Type</p>
                                      <p className="text-ink">{resource.configuration.instanceType}</p>
                                    </div>
                                  )}
                                  {resource.configuration.desiredCapacity !== undefined && (
                                    <div>
                                      <p className="font-semibold text-graphite mb-1">Capacity</p>
                                      <p className="text-ink">
                                        {resource.configuration.desiredCapacity} desired ({resource.configuration.minCapacity}–{resource.configuration.maxCapacity})
                                      </p>
                                    </div>
                                  )}
                                  <div>
                                    <p className="font-semibold text-graphite mb-1">Last Updated</p>
                                    <p className="text-ink">{new Date(resource.updatedAt).toLocaleTimeString()}</p>
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
              <div className="px-6 py-3 border-t border-hairline bg-subtle text-xs text-graphite font-medium">
                Showing {rows.length} of {resources.length} resource{resources.length === 1 ? '' : 's'}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

export default function ResourcesPage() {
  return (
    <Suspense fallback={null}>
      <ResourcesPageInner />
    </Suspense>
  )
}
