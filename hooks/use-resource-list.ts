'use client'

import { useMemo } from 'react'
import { useSimulationStream, type SimulationConnectionStatus } from './use-simulation-stream'
import type { CloudEnvironment, CloudService, SimulatedCloudResource } from '@/lib/simulation/types'

export interface UseResourceListOptions {
  environment?: CloudEnvironment
  service?: CloudService
}

export interface UseResourceListResult {
  resources: SimulatedCloudResource[]
  status: SimulationConnectionStatus
  engineRunning: boolean
  /** True only while we're still waiting on the first snapshot — not true just because the filtered list is empty. */
  isLoading: boolean
  reconnect: () => void
}

/** List (optionally filtered) simulated resources, backed by the shared live stream. */
export function useResourceList(options: UseResourceListOptions = {}): UseResourceListResult {
  const { resources, status, engineRunning, reconnect } = useSimulationStream()
  const { environment, service } = options

  const filtered = useMemo(
    () =>
      resources.filter((resource) => {
        if (environment && resource.environment !== environment) return false
        if (service && resource.service !== service) return false
        return true
      }),
    [resources, environment, service],
  )

  return {
    resources: filtered,
    status,
    engineRunning,
    isLoading: status === 'connecting' && resources.length === 0,
    reconnect,
  }
}
