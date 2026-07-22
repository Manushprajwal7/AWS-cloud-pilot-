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
  run_completed: 'text-info',
  run_completed_no_anomaly: 'text-graphite',
  run_failed: 'text-danger',
  remediation_applied: 'text-ok',
  remediation_rolled_back: 'text-signal',
  remediation_rejected_by_policy: 'text-warn',
  plan_rejected_by_policy: 'text-warn',
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
    <div className="bg-panel border border-hairline shadow-sm overflow-hidden h-full flex flex-col">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-hairline">
        <div className="flex items-center gap-2">
          <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
            {state === 'ready' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />}
            <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${state === 'ready' ? 'bg-ok' : 'bg-hairline'}`} />
          </span>
          <span className="text-[10px] font-mono uppercase tracking-wider text-graphite">Recent Activity — audit trail</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRefreshToken((t) => t + 1)}
            className="px-2.5 py-1 text-[11px] font-mono font-medium text-graphite border border-hairline rounded-sm hover:border-ink hover:text-ink transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className="w-3 h-3" strokeWidth={1.75} />
            Refresh
          </button>
          <button
            onClick={() => setCleared(true)}
            className="px-2.5 py-1 text-[11px] font-mono font-medium text-graphite border border-hairline rounded-sm hover:border-ink hover:text-ink transition-colors flex items-center gap-1.5"
          >
            <Trash2 className="w-3 h-3" strokeWidth={1.75} />
            Clear
          </button>
        </div>
      </div>

      <div className="max-h-96 overflow-y-auto bg-panel font-mono text-[11px]">
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
            <div key={event.id} className="px-5 py-2 border-b border-hairline last:border-0 hover:bg-subtle transition-colors">
              <span className="text-graphite">{new Date(event.createdAt).toLocaleTimeString()}</span>
              <span className={`ml-4 font-semibold ${ACTION_COLOR[event.action] ?? 'text-graphite'}`}>{event.action}</span>
              <span className="ml-4 text-ink">{summarize(event)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
