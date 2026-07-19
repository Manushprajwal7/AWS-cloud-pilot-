'use client'

import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react'

export function ChartLoadingState({ heightClassName = 'h-64' }: { heightClassName?: string }) {
  return (
    <div className={`${heightClassName} flex flex-col items-center justify-center gap-2 animate-pulse`} role="status" aria-label="Loading chart data">
      <div className="w-full h-full flex items-end gap-1.5 px-2 pb-2">
        {[40, 65, 50, 80, 55, 70, 45, 60].map((h, i) => (
          <div key={i} className="flex-1 bg-subtle rounded-t" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  )
}

export function ChartEmptyState({
  message = 'No data yet',
  heightClassName = 'h-64',
}: {
  message?: string
  heightClassName?: string
}) {
  return (
    <div className={`${heightClassName} flex flex-col items-center justify-center gap-2 text-graphite`}>
      <Inbox className="w-7 h-7" strokeWidth={1.5} aria-hidden="true" />
      <p className="text-[13px]">{message}</p>
    </div>
  )
}

export function ChartErrorState({
  message = 'Unable to load live data',
  onRetry,
  heightClassName = 'h-64',
}: {
  message?: string
  onRetry?: () => void
  heightClassName?: string
}) {
  return (
    <div className={`${heightClassName} flex flex-col items-center justify-center gap-3 text-danger`} role="alert">
      <AlertTriangle className="w-7 h-7" strokeWidth={1.5} aria-hidden="true" />
      <p className="text-[13px] text-center max-w-xs">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 text-[11px] font-mono font-medium px-2.5 py-1 border border-danger/30 rounded-sm hover:bg-danger-soft transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          Retry
        </button>
      )}
    </div>
  )
}
