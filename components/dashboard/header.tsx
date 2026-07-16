'use client'

import { Search, Bell, Sun, Moon, ChevronDown, Menu } from 'lucide-react'
import { useState } from 'react'

export function Header({ fullWidth = false, showBrand = false }: { fullWidth?: boolean; showBrand?: boolean }) {
  const [isDark, setIsDark] = useState(true)

  return (
    <header
      className={`fixed top-0 right-0 h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 z-40 transition-all duration-300 ${
        fullWidth ? 'left-0' : 'left-56'
      }`}
    >
      {showBrand && (
        <div className="flex items-center gap-3 mr-6 flex-shrink-0">
          <button className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <Menu className="w-5 h-5 text-gray-700" />
          </button>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-gray-900 tracking-tight">aws</span>
            <div className="leading-tight">
              <div className="text-sm font-bold text-gray-900">CloudPilot</div>
              <div className="text-[11px] text-gray-500">Autonomous FinOps &amp; Optimizer</div>
            </div>
          </div>
        </div>
      )}

      {/* Search Bar */}
      <div className="flex-1 max-w-2xl">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search for resources, metrics, costs, anomalies..."
            className="w-full pl-10 pr-8 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">/</span>
        </div>
      </div>

      {/* Right Section */}
      <div className="flex items-center gap-3 ml-8">
        {/* Notification Badge */}
        <button className="relative p-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors">
          <Bell className="w-5 h-5" />
          <div className="absolute -top-1 -right-1 w-5 h-5 bg-orange-500 text-white rounded-full flex items-center justify-center text-xs font-bold">
            3
          </div>
        </button>

        {/* Theme Toggle */}
        <Sun className="w-5 h-5 text-gray-500" />
        <button
          onClick={() => setIsDark(!isDark)}
          className={`w-12 h-6 rounded-full relative transition-colors flex-shrink-0 ${
            isDark ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-300 hover:bg-gray-400'
          }`}
        >
          <div
            className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all ${
              isDark ? 'right-0.5' : 'left-0.5'
            }`}
          ></div>
        </button>
        <Moon className="w-5 h-5 text-gray-500" />

        {/* Divider */}
        <div className="w-px h-6 bg-gray-200"></div>

        {/* Profile Section */}
        <button className="flex items-center gap-2 p-1 hover:bg-gray-100 rounded-lg transition-colors">
          <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-sm hover:bg-blue-700">
            DA
          </div>
          <ChevronDown className="w-4 h-4 text-gray-400" />
        </button>
      </div>
    </header>
  )
}
