'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  LayoutDashboard,
  DollarSign,
  AlertCircle,
  Lightbulb,
  Database,
  Lock,
  Zap,
  FileText,
  Leaf,
  Settings,
  ChevronDown,
  ChevronLeft,
} from 'lucide-react'

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)

  const menuItems = [
    { icon: LayoutDashboard, label: 'Dashboard', href: '/dashboard', active: true },
    { icon: DollarSign, label: 'Cost Overview', href: '#' },
    { icon: AlertCircle, label: 'Anomalies', href: '#' },
    { icon: Lightbulb, label: 'Recommendations', href: '#' },
    { icon: Database, label: 'Resources', href: '#' },
    { icon: Lock, label: 'Policies', href: '#' },
    { icon: Zap, label: 'Automation', href: '#' },
    { icon: FileText, label: 'Reports', href: '#' },
    { icon: Leaf, label: 'Carbon Impact', href: '#' },
    { icon: Settings, label: 'Settings', href: '#' },
  ]

  const specialItems = [
    { icon: Database, label: 'Terraform Sandbox', href: '/terraform-sandbox', badge: 'New' },
  ]

  return (
    <div
      className={`fixed left-0 top-0 h-screen bg-white border-r border-gray-200 transition-all duration-300 z-50 flex flex-col ${
        collapsed ? 'w-20' : 'w-56'
      }`}
    >
      {/* Collapse Toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-6 bg-white border border-gray-200 rounded-full p-1 hover:bg-gray-100 transition-all z-10"
      >
        <ChevronLeft className={`w-4 h-4 transition-transform ${collapsed ? 'rotate-180' : ''}`} />
      </button>

      {/* Logo */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 flex-shrink-0 relative">
            <Image src="/aws-logo.png" alt="AWS" fill className="object-contain" />
          </div>
          {!collapsed && (
            <div>
              <div className="text-sm font-semibold text-gray-900">AWS</div>
              <div className="text-xs text-gray-600">CloudPilot</div>
            </div>
          )}
        </div>
      </div>

      {/* Menu Items */}
      <nav className="p-3 space-y-1 flex-1 overflow-y-auto max-h-[calc(100vh-280px)]">
        {menuItems.map((item) => {
          const Icon = item.icon
          return (
            <Link
              key={item.label}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                item.active
                  ? 'bg-orange-50 text-orange-600'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
              title={collapsed ? item.label : ''}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
            </Link>
          )
        })}

        {/* Special Items */}
        {!collapsed && specialItems.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-200 space-y-1">
            {specialItems.map((item) => {
              const Icon = item.icon
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
                  title={collapsed ? item.label : ''}
                >
                  <div className="flex items-center gap-3">
                    <Icon className="w-5 h-5 flex-shrink-0" />
                    <span className="text-sm font-medium">{item.label}</span>
                  </div>
                  {item.badge && (
                    <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-semibold">
                      {item.badge}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        )}
      </nav>

      {/* Account Section */}
      <div className="border-t border-gray-200 p-4 space-y-3 flex-shrink-0">
        <div className="bg-gray-50 rounded-lg p-3">
          {!collapsed && (
            <>
              <p className="text-xs font-semibold text-gray-600 mb-1">Account</p>
              <p className="text-sm font-medium text-gray-900 truncate">Production Account</p>
            </>
          )}
        </div>

        {/* Region */}
        <div>
          {!collapsed && (
            <>
              <p className="text-xs font-semibold text-gray-600 mb-2">Region</p>
              <button className="w-full flex items-center justify-between px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                <span className="text-gray-900 font-medium">us-east-1</span>
                <ChevronDown className="w-4 h-4 text-gray-400" />
              </button>
            </>
          )}
        </div>

        {/* Last Updated */}
        {!collapsed && (
          <div className="text-xs text-gray-500">
            <p className="font-semibold text-gray-600">Last Updated</p>
            <p className="text-gray-600">10:30:45.123 UTC</p>
          </div>
        )}

        {/* Status */}
        {!collapsed && (
          <div className="flex items-center gap-2 text-xs">
            <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0"></div>
            <span className="text-gray-600">All Systems Operational</span>
          </div>
        )}
      </div>
    </div>
  )
}
