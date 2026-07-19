'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  DollarSign,
  AlertCircle,
  Lightbulb,
  Database,
  Lock,
  Zap,
  ChevronDown,
  ChevronLeft,
} from 'lucide-react'

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname()

  const menuItems = [
    { icon: LayoutDashboard, label: 'Dashboard', href: '/dashboard' },
    { icon: Database, label: 'Terraform Sandbox', href: '/terraform-sandbox', badge: 'New' },
    { icon: DollarSign, label: 'Cost Overview', href: '/cost-overview' },
    { icon: AlertCircle, label: 'Anomalies', href: '/anomalies' },
    { icon: Lightbulb, label: 'Recommendations', href: '/recommendations' },
    { icon: Database, label: 'Resources', href: '/resources' },
    { icon: Lock, label: 'Policies', href: '/policies' },
    { icon: Zap, label: 'Automation', href: '/automation' },
  ]

  return (
    <div
      className={`fixed left-0 top-0 h-screen bg-panel border-r border-hairline transition-all duration-300 z-50 flex flex-col ${
        collapsed ? 'w-[72px]' : 'w-60'
      }`}
    >
      {/* Collapse Toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-7 bg-panel border border-hairline rounded-full p-1 hover:border-ink transition-colors z-10"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <ChevronLeft className={`w-3.5 h-3.5 text-graphite transition-transform ${collapsed ? 'rotate-180' : ''}`} />
      </button>

      {/* Logo */}
      <div className="h-16 flex items-center px-4 border-b border-hairline">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 flex-shrink-0 relative">
            <Image src="/aws-logo.png" alt="AWS" fill className="object-contain" />
          </div>
          {!collapsed && (
            <div className="leading-none">
              <div className="font-display font-semibold text-[13px] text-ink tracking-tight">CloudPilot</div>
              <div className="text-[10px] text-graphite font-mono tracking-wide mt-0.5">FINOPS CONTROL</div>
            </div>
          )}
        </div>
      </div>

      {/* Menu Items */}
      <nav className="p-2.5 space-y-0.5 flex-1 overflow-y-auto">
        {menuItems.map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href
          return (
            <Link
              key={item.label}
              href={item.href}
              className={`group relative flex items-center justify-between gap-3 px-3 py-2 rounded-sm transition-colors ${
                isActive ? 'bg-signal-soft text-signal' : 'text-graphite hover:bg-subtle hover:text-ink'
              }`}
              title={collapsed ? item.label : ''}
            >
              {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] bg-signal" />}
              <div className="flex items-center gap-3">
                <Icon className="w-[17px] h-[17px] flex-shrink-0" strokeWidth={1.75} />
                {!collapsed && <span className="text-[13px] font-medium">{item.label}</span>}
              </div>
              {!collapsed && item.badge && (
                <span className="text-[9px] uppercase tracking-wide bg-signal text-white px-1.5 py-0.5 rounded-sm font-mono font-semibold">
                  {item.badge}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Account Section */}
      <div className="border-t border-hairline p-3.5 space-y-3 flex-shrink-0">
        {!collapsed && (
          <div className="border border-hairline rounded-sm p-2.5">
            <p className="text-[9px] font-mono uppercase tracking-wider text-graphite mb-1">Account</p>
            <p className="text-[13px] font-medium text-ink truncate">Production Account</p>
          </div>
        )}

        {/* Region */}
        {!collapsed && (
          <div>
            <p className="text-[9px] font-mono uppercase tracking-wider text-graphite mb-1.5">Region</p>
            <button className="w-full flex items-center justify-between px-2.5 py-1.5 text-[13px] border border-hairline rounded-sm hover:border-ink transition-colors">
              <span className="text-ink font-mono font-medium">us-east-1</span>
              <ChevronDown className="w-3.5 h-3.5 text-graphite" />
            </button>
          </div>
        )}

        {/* Status */}
        {!collapsed && (
          <div className="flex items-center gap-2 text-[11px] font-mono pt-0.5">
            <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-ok" />
            </span>
            <span className="text-graphite">All systems operational</span>
          </div>
        )}
      </div>
    </div>
  )
}
