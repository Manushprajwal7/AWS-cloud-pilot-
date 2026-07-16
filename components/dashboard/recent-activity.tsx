'use client'

/**
 * Replaces the old CloudWatchLogs component, which rendered ten literal
 * hardcoded log lines that never changed. This fetches the real audit
 * trail (one AuditEvent row per graph-run outcome — auditWorker, Phase 6)
 * and polls for new ones. Nothing here is fabricated: an empty result
 * really means no graph runs have completed yet.
 */

import { useEffect, useState } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import { ChartEmptyState, ChartErrorState, ChartLoadingState } from '@/components/monitoring/chart-states'

interface AuditEventRow {
  id: string
  actor: string
  action: string
  entityType: string
  entityId: string
  metadata: Record<string, unknown> | null
  createdAt: string
}

type LoadState = 'loading' | 'ready' | 'error' | 'db_unavailable'

const POLL_INTERVAL_MS = 15000

const ACTION_COLOR: Record<string, string> = {
  run_completed: 'text-blue-600',
  run_completed_no_anomaly: 'text-gray-500',
  run_failed: 'text-red-600',
  remediation_applied: 'text-green-600',
  remediation_rolled_back: 'text-purple-600',
  remediation_rejected_by_policy: 'text-orange-600',
  plan_rejected_by_policy: 'text-orange-600',
}

function summarize(event: AuditEventRow): string {
  const meta = event.metadata ?? {}
  const resourceId = typeof meta.resourceId === 'string' ? meta.resourceId : event.entityId
  return `${event.action.replace(/_/g, ' ')} — ${resourceId}`
}

export function RecentActivity() {
  const [events, setEvents] = useState<AuditEventRow[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [cleared, setCleared] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const response = await fetch('/api/audit-events?limit=25');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (cancelled) return;
        if (!data.dbAvailable) {
          setState('db_unavailable');
          return;
        }
        setEvents(data.events);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    }

    void load();
    const interval = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [refreshToken]);

  const visibleEvents = cleared ? [] : events;

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${state === 'ready' ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
          <span className="font-semibold text-gray-900 text-sm">Recent Activity (real audit trail)</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setRefreshToken((t) => t + 1)}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          <button
            onClick={() => setCleared(true)}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear
          </button>
        </div>
      </div>

      <div className="max-h-96 overflow-y-auto bg-white font-mono text-xs">
        {state === 'loading' ? (
          <ChartLoadingState heightClassName="h-48" />
        ) : state === 'error' ? (
          <ChartErrorState message="Unable to load the audit trail." onRetry={() => setRefreshToken((t) => t + 1)} heightClassName="h-48" />
        ) : state === 'db_unavailable' ? (
          <ChartErrorState message="Database unavailable — audit trail requires Postgres to be configured." heightClassName="h-48" />
        ) : visibleEvents.length === 0 ? (
          <ChartEmptyState message="No graph runs have completed yet." heightClassName="h-48" />
        ) : (
          visibleEvents.map((event) => (
            <div key={event.id} className="px-6 py-2 border-b border-gray-100 hover:bg-gray-50 transition-colors">
              <span className="text-gray-400">{new Date(event.createdAt).toLocaleTimeString()}</span>
              <span className={`ml-4 font-bold ${ACTION_COLOR[event.action] ?? 'text-gray-600'}`}>{event.action}</span>
              <span className="ml-4 text-gray-700">{summarize(event)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
