'use client'

import { useEffect, useState } from 'react'
import type { MonitoringStatus } from '@/lib/monitoring/types'

const DEFAULT_STATUS: MonitoringStatus = { connected: false }

/**
 * Connection-badge state for the header. Deliberately not a 3rd SSE
 * external-store like use-simulation-stream/use-anomalies — the resource
 * *data* is already real-time via the existing simulation stream (which now
 * reads through connectionManager), so this only needs to be accurate to
 * the second: fetch on mount, and refresh() after connect/disconnect
 * actions for an immediate UI update.
 */
export function useMonitoringStatus() {
  const [status, setStatus] = useState<MonitoringStatus>(DEFAULT_STATUS)
  const [isLoading, setIsLoading] = useState(true)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      try {
        const response = await fetch('/api/monitoring/status')
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = (await response.json()) as MonitoringStatus
        if (!cancelled) setStatus(data)
      } catch {
        if (!cancelled) setStatus(DEFAULT_STATUS)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [refreshToken])

  function refresh(): void {
    setRefreshToken((t) => t + 1)
  }

  return { status, isLoading, refresh }
}
