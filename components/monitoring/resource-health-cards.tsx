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
  running: 'text-ok',
  stopped: 'text-graphite',
  degraded: 'text-danger',
  optimizing: 'text-signal',
  failed: 'text-danger',
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
            className={`text-left p-3 rounded-sm border bg-panel transition-colors ${
              isSelected ? 'border-signal ring-1 ring-signal/30' : 'border-hairline hover:border-graphite'
            }`}
          >
            <div className="flex items-center justify-between mb-1 gap-2">
              <span className="text-[12px] font-semibold text-ink truncate">{resource.name}</span>
              <StatusIcon className={`w-4 h-4 flex-shrink-0 ${STATUS_COLOR[resource.status]}`} aria-hidden="true" />
            </div>
            <p className="text-[11px] font-mono text-graphite mb-2 capitalize">
              {resource.service} · {resource.environment}
            </p>
            <div className="flex items-center justify-between text-[11px] font-mono text-graphite">
              <span>CPU {resource.metrics.cpuPercent.toFixed(0)}%</span>
              <span>${resource.cost.projectedMonthlyUsd.toFixed(0)}/mo</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
