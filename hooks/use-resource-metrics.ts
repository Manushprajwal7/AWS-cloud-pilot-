'use client'

import { useEffect, useRef, useState } from 'react'
import { useSimulationStream, type SimulationConnectionStatus } from './use-simulation-stream'
import type { ResourceCost, ResourceMetrics, SimulatedCloudResource } from '@/lib/simulation/types'

export interface MetricHistoryPoint {
  timestamp: string
  metrics: ResourceMetrics
  cost: ResourceCost
}

export interface UseResourceMetricsResult {
  resource: SimulatedCloudResource | undefined
  /** Bounded client-side history for this resource — the server doesn't expose a bulk-history endpoint, so this is built up live from stream events for as long as this hook has been mounted. */
  history: MetricHistoryPoint[]
  status: SimulationConnectionStatus
  engineRunning: boolean
  isLoading: boolean
  /** True once we've heard from the server and this id genuinely isn't a known resource. */
  notFound: boolean
  reconnect: () => void
}

// ~5 minutes of history at the tick engine's default 5s interval.
const HISTORY_WINDOW_SIZE = 60

function toPoint(resource: SimulatedCloudResource): MetricHistoryPoint {
  return { timestamp: resource.updatedAt, metrics: resource.metrics, cost: resource.cost }
}

/** Live metrics + a bounded rolling history window for a single resource. */
export function useResourceMetrics(resourceId: string | undefined): UseResourceMetricsResult {
  const { resources, status, engineRunning, reconnect } = useSimulationStream()
  const resource = resourceId ? resources.find((r) => r.id === resourceId) : undefined

  const [history, setHistory] = useState<MetricHistoryPoint[]>([])
  const lastTimestampRef = useRef<string | null>(null)
  const lastResourceIdRef = useRef<string | undefined>(resourceId)

  useEffect(() => {
    if (lastResourceIdRef.current !== resourceId) {
      // Switched which resource we're watching — start its window fresh
      // instead of mixing in another resource's history.
      lastResourceIdRef.current = resourceId
      lastTimestampRef.current = resource ? resource.updatedAt : null
      setHistory(resource ? [toPoint(resource)] : [])
      return
    }

    if (!resource || resource.updatedAt === lastTimestampRef.current) return

    lastTimestampRef.current = resource.updatedAt
    setHistory((prev) => {
      const next = [...prev, toPoint(resource)]
      return next.length > HISTORY_WINDOW_SIZE ? next.slice(next.length - HISTORY_WINDOW_SIZE) : next
    })
  }, [resource, resourceId])

  return {
    resource,
    history,
    status,
    engineRunning,
    isLoading: (status === 'connecting' || status === 'reconnecting') && !resource,
    notFound: (status === 'live' || status === 'paused') && !resource && resources.length > 0,
    reconnect,
  }
}
