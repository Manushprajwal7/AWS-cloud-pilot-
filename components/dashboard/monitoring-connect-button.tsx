'use client'

/**
 * Header control for the real-monitoring connection (companion to
 * SimulationToggle — see header.tsx, which renders SimulationToggle only
 * when not connected, and always renders this). Shows "Connect Monitoring
 * Instance" until connected, then a "Connected to {provider} ✓" badge with
 * a Disconnect action.
 */

import { useState } from 'react'
import { BarChart3, Loader2, CheckCircle2, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MonitoringConnectionModal } from './monitoring-connection-modal'
import { useMonitoringStatus } from '@/hooks/use-monitoring-status'
import { useSimulationStream } from '@/hooks/use-simulation-stream'

const PROVIDER_LABEL: Record<string, string> = { AWS: 'AWS', GCP: 'GCP', PROMETHEUS: 'Prometheus' }

export function MonitoringConnectButton() {
  const { status, isLoading, refresh } = useMonitoringStatus()
  const { engineRunning } = useSimulationStream()
  const [modalOpen, setModalOpen] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)

  async function handleDisconnect(): Promise<void> {
    if (!window.confirm('Disconnect from the monitoring backend? The dashboard will fall back to simulation (if running) or an empty state.')) return
    setIsDisconnecting(true)
    try {
      await fetch('/api/monitoring/disconnect', { method: 'POST' })
      refresh()
    } finally {
      setIsDisconnecting(false)
    }
  }

  if (status.connected) {
    return (
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-sm border border-ok/30 bg-ok-soft px-3 py-2 text-[13px] font-medium font-mono text-ok">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Connected to {PROVIDER_LABEL[status.provider ?? ''] ?? status.provider} ✓
        </span>
        <Button type="button" variant="outline" size="sm" onClick={handleDisconnect} disabled={isDisconnecting} className="gap-1.5">
          {isDisconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
          Disconnect
        </Button>
      </div>
    )
  }

  return (
    <>
      <Button
        type="button"
        onClick={() => setModalOpen(true)}
        disabled={isLoading || engineRunning}
        title={engineRunning ? 'Stop the simulation before connecting a monitoring instance' : undefined}
        className="gap-1.5"
      >
        <BarChart3 className="h-3.5 w-3.5" />
        Connect Monitoring Instance
      </Button>
      <MonitoringConnectionModal open={modalOpen} onOpenChange={setModalOpen} onConnected={refresh} />
    </>
  )
}
