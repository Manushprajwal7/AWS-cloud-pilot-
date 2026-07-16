'use client'

import { AlertTriangle, CheckCircle2, PauseCircle, Wrench, XCircle } from 'lucide-react'
import { useResourceList } from '@/hooks/use-resource-list'
import type { ResourceStatus } from '@/lib/simulation/types'
import { ChartEmptyState, ChartErrorState, ChartLoadingState } from './chart-states'

const STATUS_ICON: Record<ResourceStatus, typeof CheckCircle2> = {
  running: CheckCircle2,
  stopped: PauseCircle,
  degraded: AlertTriangle,
  optimizing: Wrench,
  failed: XCircle,
}

const STATUS_COLOR: Record<ResourceStatus, string> = {
  running: 'text-green-600',
  stopped: 'text-gray-400',
  degraded: 'text-red-600',
  optimizing: 'text-orange-500',
  failed: 'text-red-700',
}

export function ResourceHealthCards({
  selectedId,
  onSelect,
}: {
  selectedId?: string
  onSelect?: (id: string) => void
}) {
  const { resources, status, isLoading, reconnect } = useResourceList()

  if (status === 'disconnected') {
    return <ChartErrorState message="Unable to load resource health — the simulation stream is disconnected." onRetry={reconnect} heightClassName="h-32" />
  }

  if (isLoading) {
    return <ChartLoadingState heightClassName="h-32" />
  }

  if (resources.length === 0) {
    return <ChartEmptyState message="No resources are being simulated." heightClassName="h-32" />
  }

  return (
    <div role="list" aria-label="Resource health" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {resources.map((resource) => {
        const StatusIcon = STATUS_ICON[resource.status]
        const isSelected = resource.id === selectedId

        return (
          <button
            key={resource.id}
            type="button"
            aria-pressed={isSelected}
            aria-label={`${resource.name}, ${resource.service}, status ${resource.status}, CPU ${resource.metrics.cpuPercent.toFixed(0)} percent, ${resource.cost.projectedMonthlyUsd.toFixed(0)} dollars per month`}
            onClick={() => onSelect?.(resource.id)}
            className={`text-left p-3 rounded-lg border bg-white transition-colors ${
              isSelected ? 'border-orange-400 ring-2 ring-orange-100' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center justify-between mb-1 gap-2">
              <span className="text-xs font-semibold text-gray-900 truncate">{resource.name}</span>
              <StatusIcon className={`w-4 h-4 flex-shrink-0 ${STATUS_COLOR[resource.status]}`} aria-hidden="true" />
            </div>
            <p className="text-[11px] text-gray-500 mb-2 capitalize">
              {resource.service} · {resource.environment}
            </p>
            <div className="flex items-center justify-between text-xs text-gray-600">
              <span>CPU {resource.metrics.cpuPercent.toFixed(0)}%</span>
              <span>${resource.cost.projectedMonthlyUsd.toFixed(0)}/mo</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
