'use client'

import { Search, Bell, ChevronDown, Menu, Server, AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { SimulationToggle } from './simulation-toggle'
import { useAnomalies } from '@/hooks/use-anomalies'
import { useResourceList } from '@/hooks/use-resource-list'

interface SearchResult {
  id: string
  label: string
  sublabel: string
  href: string
  kind: 'resource' | 'anomaly'
}

export function Header({ fullWidth = false, showBrand = false }: { fullWidth?: boolean; showBrand?: boolean }) {
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  const searchRef = useRef<HTMLDivElement>(null)
  const notifRef = useRef<HTMLDivElement>(null)
  const profileRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { resources } = useResourceList()
  const { anomalies } = useAnomalies()

  const alertCount = useMemo(
    () => anomalies.filter((a) => a.severity === 'critical' || a.severity === 'high').length,
    [anomalies],
  )

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []

    const resourceMatches: SearchResult[] = resources
      .filter((r) => r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q))
      .slice(0, 5)
      .map((r) => ({
        id: r.id,
        label: r.name,
        sublabel: `${r.service} • ${r.environment}`,
        href: `/resources?q=${encodeURIComponent(r.name)}`,
        kind: 'resource',
      }))

    const anomalyMatches: SearchResult[] = anomalies
      .filter((a) => a.resourceId.toLowerCase().includes(q) || a.type.toLowerCase().includes(q.replace(/\s+/g, '_')))
      .slice(0, 5)
      .map((a) => ({
        id: a.id,
        label: a.type.replace(/_/g, ' '),
        sublabel: a.resourceId,
        href: `/anomalies#${a.id}`,
        kind: 'anomaly',
      }))

    return [...resourceMatches, ...anomalyMatches]
  }, [query, resources, anomalies])

  // "/" focuses search from anywhere, unless already typing in a field.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== '/') return
      const target = e.target as HTMLElement
      const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      if (isTyping) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Close open dropdowns on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as Node
      if (searchRef.current && !searchRef.current.contains(target)) setSearchOpen(false)
      if (notifRef.current && !notifRef.current.contains(target)) setNotifOpen(false)
      if (profileRef.current && !profileRef.current.contains(target)) setProfileOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [])

  const recentAlerts = useMemo(
    () =>
      [...anomalies]
        .sort((a, b) => new Date(b.lastObservedAt).getTime() - new Date(a.lastObservedAt).getTime())
        .slice(0, 5),
    [anomalies],
  )

  return (
    <header
      className={`fixed top-0 right-0 h-16 bg-panel border-b border-hairline flex items-center justify-between px-6 z-40 transition-all duration-300 ${
        fullWidth ? 'left-0' : 'left-60'
      }`}
    >
      {showBrand && (
        <div className="flex items-center gap-3 mr-6 flex-shrink-0">
          <button className="p-1.5 hover:bg-subtle rounded-sm transition-colors">
            <Menu className="w-5 h-5 text-graphite" strokeWidth={1.75} />
          </button>
          <div className="flex items-center gap-2 leading-none">
            <div className="font-display font-semibold text-ink text-sm">CloudPilot</div>
            <div className="text-[10px] text-graphite font-mono">Autonomous FinOps</div>
          </div>
        </div>
      )}

      {/* Search Bar */}
      <div className="flex-1 max-w-2xl relative" ref={searchRef}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-graphite" strokeWidth={1.75} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSearchOpen(true)
            }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchOpen(false)
                inputRef.current?.blur()
              }
            }}
            placeholder="Search resources, metrics, costs, anomalies…"
            className="w-full pl-9 pr-8 py-2 border border-hairline rounded-sm bg-subtle text-[13px] placeholder-graphite/70 focus:outline-none focus:ring-1 focus:ring-signal focus:border-signal focus:bg-panel transition-all"
          />
          {!query && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-graphite border border-hairline rounded-sm px-1">/</span>
          )}
        </div>

        {searchOpen && query.trim() && (
          <div className="absolute left-0 right-0 mt-2 bg-panel border border-hairline rounded-sm shadow-[0_4px_16px_rgba(24,24,21,0.08)] overflow-hidden max-h-96 overflow-y-auto">
            {results.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-graphite">No matches for &quot;{query}&quot;</p>
            ) : (
              results.map((r) => (
                <Link
                  key={`${r.kind}-${r.id}`}
                  href={r.href}
                  onClick={() => setSearchOpen(false)}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-subtle transition-colors border-b border-hairline last:border-0"
                >
                  {r.kind === 'resource' ? (
                    <Server className="w-4 h-4 text-info flex-shrink-0" strokeWidth={1.75} />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-signal flex-shrink-0" strokeWidth={1.75} />
                  )}
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-ink truncate capitalize">{r.label}</p>
                    <p className="text-[11px] font-mono text-graphite truncate">{r.sublabel}</p>
                  </div>
                </Link>
              ))
            )}
          </div>
        )}
      </div>

      {/* Simulation Control */}
      <div className="ml-4">
        <SimulationToggle />
      </div>

      {/* Right Section */}
      <div className="flex items-center gap-3 ml-8">
        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setNotifOpen((v) => !v)}
            className="relative p-1.5 text-graphite hover:text-ink hover:bg-subtle rounded-sm transition-colors"
          >
            <Bell className="w-[18px] h-[18px]" strokeWidth={1.75} />
            {alertCount > 0 && (
              <div className="absolute -top-0.5 -right-0.5 w-[17px] h-[17px] bg-signal text-white rounded-full flex items-center justify-center text-[9px] font-mono font-bold">
                {alertCount > 9 ? '9+' : alertCount}
              </div>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 mt-2 w-80 bg-panel border border-hairline rounded-sm shadow-[0_4px_16px_rgba(24,24,21,0.08)] overflow-hidden z-50">
              <div className="px-4 py-3 border-b border-hairline flex items-center justify-between">
                <p className="text-[11px] font-mono uppercase tracking-wider text-graphite">Alerts</p>
                <span className="text-[11px] font-mono text-graphite">{alertCount} critical/high</span>
              </div>
              {recentAlerts.length === 0 ? (
                <p className="px-4 py-4 text-[13px] text-graphite">No active anomalies</p>
              ) : (
                <div className="max-h-80 overflow-y-auto">
                  {recentAlerts.map((a) => (
                    <Link
                      key={a.id}
                      href={`/anomalies#${a.id}`}
                      onClick={() => setNotifOpen(false)}
                      className="block px-4 py-2.5 hover:bg-subtle border-b border-hairline last:border-0 transition-colors"
                    >
                      <p className="text-[13px] font-medium text-ink capitalize">{a.type.replace(/_/g, ' ')}</p>
                      <p className="text-[11px] font-mono text-graphite">{a.resourceId}</p>
                    </Link>
                  ))}
                </div>
              )}
              <Link
                href="/anomalies"
                onClick={() => setNotifOpen(false)}
                className="block text-center text-[12px] font-medium text-signal hover:text-ink py-2 border-t border-hairline transition-colors"
              >
                View all anomalies
              </Link>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-hairline"></div>

        {/* Profile Section */}
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => setProfileOpen((v) => !v)}
            className="flex items-center gap-2 p-1 hover:bg-subtle rounded-sm transition-colors"
          >
            <div className="w-8 h-8 bg-signal text-white rounded-sm flex items-center justify-center font-mono font-semibold text-xs">
              DA
            </div>
            <ChevronDown className={`w-3.5 h-3.5 text-graphite transition-transform ${profileOpen ? 'rotate-180' : ''}`} />
          </button>

          {profileOpen && (
            <div className="absolute right-0 mt-2 w-56 bg-panel border border-hairline rounded-sm shadow-[0_4px_16px_rgba(24,24,21,0.08)] overflow-hidden z-50">
              <div className="px-4 py-3 border-b border-hairline">
                <p className="text-[13px] font-medium text-ink">Production Account</p>
                <p className="text-[11px] font-mono text-graphite">us-east-1</p>
              </div>
              <div className="px-4 py-2.5 text-[11px] text-graphite">
                Demo environment — no authentication is configured.
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
