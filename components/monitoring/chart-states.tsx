'use client'

import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react'

export function ChartLoadingState({ heightClassName = 'h-64' }: { heightClassName?: string }) {
  return (
    <div className={`${heightClassName} flex flex-col items-center justify-center gap-2 animate-pulse`} role="status" aria-label="Loading chart data">
      <div className="w-full h-full flex items-end gap-1.5 px-2 pb-2">
        {[40, 65, 50, 80, 55, 70, 45, 60].map((h, i) => (
          <div key={i} className="flex-1 bg-gray-200 rounded-t" style={{ height: `${h}%` }} />
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
    <div className={`${heightClassName} flex flex-col items-center justify-center gap-2 text-gray-400`}>
      <Inbox className="w-8 h-8" aria-hidden="true" />
      <p className="text-sm">{message}</p>
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
    <div className={`${heightClassName} flex flex-col items-center justify-center gap-3 text-red-600`} role="alert">
      <AlertTriangle className="w-8 h-8" aria-hidden="true" />
      <p className="text-sm text-center max-w-xs">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          Retry
        </button>
      )}
    </div>
  )
}
