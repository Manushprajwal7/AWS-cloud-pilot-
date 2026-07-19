'use client'

import { Activity, Loader2, PauseCircle, RefreshCw, WifiOff } from 'lucide-react'
import type { SimulationConnectionStatus } from '@/hooks/use-simulation-stream'

const STATUS_CONFIG: Record<
  SimulationConnectionStatus,
  { label: string; description: string; className: string; icon: typeof Activity; pulse?: boolean }
> = {
  connecting: {
    label: 'Connecting',
    description: 'Connecting to the live simulation stream…',
    className: 'bg-subtle text-graphite',
    icon: Loader2,
  },
  live: {
    label: 'Simulated Live',
    description: 'Receiving live simulated telemetry.',
    className: 'bg-ok-soft text-ok',
    icon: Activity,
    pulse: true,
  },
  paused: {
    label: 'Paused',
    description: 'Connected, but the simulation engine is stopped — metrics will not change until it is started again.',
    className: 'bg-warn-soft text-warn',
    icon: PauseCircle,
  },
  reconnecting: {
    label: 'Reconnecting',
    description: 'Connection to the simulation stream dropped — retrying…',
    className: 'bg-signal-soft text-signal',
    icon: Loader2,
  },
  disconnected: {
    label: 'Disconnected',
    description: 'Unable to reach the live simulation stream.',
    className: 'bg-danger-soft text-danger',
    icon: WifiOff,
  },
}

export function ConnectionStatusBadge({
  status,
  onReconnect,
}: {
  status: SimulationConnectionStatus
  onReconnect?: () => void
}) {
  const config = STATUS_CONFIG[status]
  const Icon = config.icon

  return (
    <div className="flex items-center gap-2" role="status" aria-live="polite">
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-[10px] font-mono font-semibold uppercase tracking-wide ${config.className}`}
        title={config.description}
      >
        <Icon className={`w-3 h-3 ${config.icon === Loader2 ? 'animate-spin' : ''} ${config.pulse ? 'animate-pulse' : ''}`} aria-hidden="true" />
        {config.label}
      </span>
      <span className="sr-only">{config.description}</span>
      {status === 'disconnected' && onReconnect && (
        <button
          type="button"
          onClick={onReconnect}
          className="inline-flex items-center gap-1 text-[11px] font-mono font-medium text-info hover:text-navy"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          Reconnect
        </button>
      )}
    </div>
  )
}
