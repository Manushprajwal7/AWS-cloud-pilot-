'use client'

import type { ReactNode } from 'react'
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SimulationConnectionStatus } from '@/hooks/use-simulation-stream'
import { ChartEmptyState, ChartErrorState, ChartLoadingState } from './chart-states'

export interface MetricChartSeriesConfig {
  key: string
  label: string
  color: string
}

export interface MetricChartPoint {
  timestamp: string
  [seriesKey: string]: number | string
}

export interface MetricChartProps {
  title: string
  unit: string
  data: MetricChartPoint[]
  series: MetricChartSeriesConfig[]
  status: SimulationConnectionStatus
  isLoading: boolean
  yDomain?: [number | 'auto', number | 'auto']
  onReconnect?: () => void
  valueFormatter?: (value: number) => string
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour12: false })
}

function defaultFormatter(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/**
 * A reusable, responsive, accessible time-series chart for one or more
 * ResourceMetrics fields. Handles loading/empty/error states itself so
 * every metric chart in the dashboard behaves consistently.
 */
export function MetricChart({
  title,
  unit,
  data,
  series,
  status,
  isLoading,
  yDomain,
  onReconnect,
  valueFormatter = defaultFormatter,
}: MetricChartProps) {
  const latest = data[data.length - 1]
  const summary =
    latest && series.length > 0
      ? series
          .map((s) => `${s.label} ${valueFormatter(Number(latest[s.key]))}${unit}`)
          .join(', ')
      : 'no data available'

  let body: ReactNode

  if (status === 'disconnected') {
    body = <ChartErrorState message="Lost connection to the live simulation stream." onRetry={onReconnect} />
  } else if (isLoading) {
    body = <ChartLoadingState />
  } else if (data.length === 0) {
    body = <ChartEmptyState message="Waiting for the first data point…" />
  } else {
    body = (
      <ResponsiveContainer width="100%" height={256}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`gradient-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={s.color} stopOpacity={0.35} />
                <stop offset="95%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="2 3" stroke="#DADADA" vertical={false} />
          <XAxis
            dataKey="timestamp"
            tickFormatter={formatTime}
            stroke="#5C6672"
            style={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}
            minTickGap={40}
          />
          <YAxis
            stroke="#5C6672"
            style={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}
            domain={yDomain ?? [0, 'auto']}
            allowDecimals
            tickFormatter={(v: number) => `${valueFormatter(v)}${unit}`}
            width={64}
          />
          <Tooltip
            labelFormatter={(label) => formatTime(String(label))}
            formatter={(value, name) => [`${valueFormatter(Number(value))}${unit}`, String(name)]}
            contentStyle={{ fontSize: '12px', borderRadius: '2px', border: '1px solid #DADADA', fontFamily: 'var(--font-mono)' }}
          />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }} />}
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              fill={`url(#gradient-${s.key})`}
              strokeWidth={2}
              isAnimationActive={false}
              dot={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    )
  }

  return (
    <figure className="bg-panel border border-hairline shadow-sm p-4" aria-label={`${title} chart`}>
      <figcaption className="flex items-center justify-between mb-2">
        <h4 className="text-[10px] font-mono uppercase tracking-wider text-graphite">{title}</h4>
        {latest && (
          <span className="text-[13px] font-mono font-bold text-ink">
            {series.length === 1 ? `${valueFormatter(Number(latest[series[0].key]))}${unit}` : null}
          </span>
        )}
      </figcaption>
      <p className="sr-only">
        {title}: latest reading {summary}. Showing the last {data.length} data point{data.length === 1 ? '' : 's'}.
      </p>
      <div aria-hidden="true">{body}</div>
    </figure>
  )
}
