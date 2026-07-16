'use client'

import {
  Search,
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
  MoreVertical,
  X,
  RefreshCw,
  Activity,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useResourceList } from '@/hooks/use-resource-list'
import { ConnectionStatusBadge } from '@/components/monitoring/connection-status-badge'
import { ChartEmptyState, ChartErrorState, ChartLoadingState } from '@/components/monitoring/chart-states'
import type { SimulatedCloudResource } from '@/lib/simulation/types'

type SortableColumn = 'id' | 'type' | 'cpu' | 'memory' | 'cost' | 'status'

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
      className="flex items-center gap-1 font-semibold text-gray-900 hover:text-orange-600"
      aria-label={`Sort by ${label}${sortBy === value ? `, currently sorted ${sortOrder === 'asc' ? 'ascending' : 'descending'}` : ''}`}
    >
      {label}
      {sortBy === value ? (
        sortOrder === 'asc' ? (
          <ChevronUp className="w-3.5 h-3.5" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5" />
        )
      ) : (
        <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
      )}
    </button>
  )
}

const STATUS_COLOR: Record<string, string> = {
  running: 'bg-green-100 text-green-800',
  stopped: 'bg-gray-100 text-gray-800',
  degraded: 'bg-red-100 text-red-800',
  optimizing: 'bg-orange-100 text-orange-800',
  failed: 'bg-red-200 text-red-900',
}

const ENV_COLOR: Record<string, string> = {
  production: 'bg-red-100 text-red-800',
  staging: 'bg-orange-100 text-orange-800',
  development: 'bg-blue-100 text-blue-800',
}

export function InfrastructureTable() {
  const { resources, status, isLoading, reconnect } = useResourceList()
  const [sortBy, setSortBy] = useState<SortableColumn>('cpu')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')

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
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-gray-900 text-sm whitespace-nowrap">Infrastructure Resources</h3>
          <ConnectionStatusBadge status={status} onReconnect={reconnect} />
        </div>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search resources..."
            aria-label="Search resources by name or id"
            className="w-full pl-9 pr-8 py-1.5 border border-gray-200 rounded-lg bg-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
          />
          {search && (
            <button onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2">
              <X className="w-3.5 h-3.5 text-gray-400" />
            </button>
          )}
        </div>
        <button
          onClick={reconnect}
          className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-200 rounded-lg transition-colors flex-shrink-0"
          title="Refresh connection"
        >
          <RefreshCw className="w-4 h-4" />
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
            <table className="w-full text-sm">
              <caption className="sr-only">Live simulated infrastructure resources and their current metrics</caption>
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left font-semibold text-gray-900">
                    <SortHeader label="Resource" value="id" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                  </th>
                  <th scope="col" className="px-6 py-3 text-left font-semibold text-gray-900">
                    <SortHeader label="Type" value="type" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                  </th>
                  <th scope="col" className="px-6 py-3 text-left font-semibold text-gray-900">
                    <SortHeader label="CPU%" value="cpu" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                  </th>
                  <th scope="col" className="px-6 py-3 text-left font-semibold text-gray-900">
                    <SortHeader label="Memory%" value="memory" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                  </th>
                  <th scope="col" className="px-6 py-3 text-left font-semibold text-gray-900">
                    <SortHeader label="Monthly Cost" value="cost" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                  </th>
                  <th scope="col" className="px-6 py-3 text-left font-semibold text-gray-900">
                    <SortHeader label="Status" value="status" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                  </th>
                  <th scope="col" className="px-6 py-3 text-left font-semibold text-gray-900">Environment</th>
                  <th scope="col" className="px-6 py-3 text-left font-semibold text-gray-900">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {rows.map((resource) => (
                  <tr key={resource.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-3">
                      <div className="font-medium text-gray-900">{resource.name}</div>
                      <div className="font-mono text-xs text-gray-500">{resource.id}</div>
                    </td>
                    <td className="px-6 py-3 text-gray-900">{resourceTypeLabel(resource)}</td>
                    <td className="px-6 py-3 text-gray-900 font-medium">{resource.metrics.cpuPercent.toFixed(1)}%</td>
                    <td className="px-6 py-3 text-gray-900 font-medium">{resource.metrics.memoryPercent.toFixed(1)}%</td>
                    <td className="px-6 py-3 text-gray-900 font-medium">
                      ${resource.cost.projectedMonthlyUsd.toFixed(2)}
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1 capitalize ${STATUS_COLOR[resource.status] ?? 'bg-gray-100 text-gray-800'}`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                        {resource.status}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${ENV_COLOR[resource.environment] ?? 'bg-gray-100 text-gray-800'}`}
                      >
                        {resource.environment}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-1">
                        <button className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors" title="View metrics">
                          <Activity className="w-4 h-4" />
                        </button>
                        <button className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors" title="More">
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 text-xs text-gray-600 font-medium">
            Showing {rows.length} of {resources.length} resource{resources.length === 1 ? '' : 's'}
          </div>
        </>
      )}
    </div>
  )
}
