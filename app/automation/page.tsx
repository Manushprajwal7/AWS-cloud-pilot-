'use client'

import { useState } from 'react'
import { Sidebar } from '@/components/dashboard/sidebar'
import { Header } from '@/components/dashboard/header'
import { Zap, Plus, Edit2, Trash2, Play, Pause, CheckCircle2, AlertCircle, Clock, X } from 'lucide-react'

interface Automation {
  id: string
  name: string
  description: string
  trigger: string
  action: string
  status: 'active' | 'paused' | 'error'
  lastRun?: string
  nextRun?: string
  runCount: number
}

const MOCK_AUTOMATIONS: Automation[] = [
  {
    id: '1',
    name: 'Auto-terminate idle resources',
    description: 'Automatically terminate resources with zero CPU utilization for 30+ days',
    trigger: 'Daily at 2:00 AM UTC',
    action: 'Terminate idle resources',
    status: 'active',
    lastRun: '2 hours ago',
    nextRun: '22 hours from now',
    runCount: 1247,
  },
  {
    id: '2',
    name: 'Scale down non-production',
    description: 'Reduce instance sizes in staging and development during off-hours',
    trigger: 'Weekdays 8:00 PM - 6:00 AM',
    action: 'Scale down to smaller instances',
    status: 'active',
    lastRun: '3 hours ago',
    nextRun: '15 hours from now',
    runCount: 892,
  },
  {
    id: '3',
    name: 'Rightsizing recommendations',
    description: 'Analyze resource utilization and recommend instance type changes',
    trigger: 'Every Sunday at 3:00 AM',
    action: 'Generate and apply rightsizing',
    status: 'active',
    lastRun: '3 days ago',
    nextRun: '4 days from now',
    runCount: 156,
  },
  {
    id: '4',
    name: 'Database backups',
    description: 'Create daily backups of production databases',
    trigger: 'Daily at 1:00 AM UTC',
    action: 'Create database snapshots',
    status: 'active',
    lastRun: '1 day ago',
    nextRun: '23 hours from now',
    runCount: 543,
  },
  {
    id: '5',
    name: 'Cost alert notifications',
    description: 'Send alerts when daily costs exceed threshold',
    trigger: 'Every hour',
    action: 'Send Slack notification',
    status: 'paused',
    lastRun: '2 weeks ago',
    runCount: 432,
  },
  {
    id: '6',
    name: 'Reserved instance optimization',
    description: 'Automatically purchase RIs for long-running resources',
    trigger: 'Monthly on 1st',
    action: 'Purchase reserved instances',
    status: 'error',
    lastRun: '1 month ago',
    runCount: 12,
  },
]

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle2; color: string; bgColor: string }> = {
  active: { icon: CheckCircle2, color: 'text-ok', bgColor: 'bg-ok-soft' },
  paused: { icon: Pause, color: 'text-graphite', bgColor: 'bg-subtle' },
  error: { icon: AlertCircle, color: 'text-danger', bgColor: 'bg-danger-soft' },
}

interface AutomationFormState {
  name: string
  description: string
  trigger: string
  action: string
}

const EMPTY_FORM: AutomationFormState = { name: '', description: '', trigger: '', action: '' }

export default function AutomationPage() {
  const [automations, setAutomations] = useState<Automation[]>(MOCK_AUTOMATIONS)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<AutomationFormState>(EMPTY_FORM)
  const [modalOpen, setModalOpen] = useState(false)

  const toggleStatus = (id: string) => {
    setAutomations(
      automations.map((a) =>
        a.id === id
          ? { ...a, status: a.status === 'active' ? 'paused' : 'active' }
          : a
      )
    )
  }

  const openCreate = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setModalOpen(true)
  }

  const openEdit = (automation: Automation) => {
    setEditingId(automation.id)
    setForm({
      name: automation.name,
      description: automation.description,
      trigger: automation.trigger,
      action: automation.action,
    })
    setModalOpen(true)
  }

  const deleteAutomation = (id: string) => {
    if (!window.confirm('Delete this automation? This cannot be undone.')) return
    setAutomations(automations.filter((a) => a.id !== id))
    if (expandedId === id) setExpandedId(null)
  }

  const submitForm = () => {
    if (!form.name.trim()) return

    if (editingId) {
      setAutomations(
        automations.map((a) =>
          a.id === editingId
            ? { ...a, name: form.name, description: form.description, trigger: form.trigger, action: form.action }
            : a
        )
      )
    } else {
      const newAutomation: Automation = {
        id: crypto.randomUUID(),
        name: form.name,
        description: form.description,
        trigger: form.trigger || 'Manual trigger',
        action: form.action || 'No action configured',
        status: 'active',
        runCount: 0,
      }
      setAutomations([newAutomation, ...automations])
    }

    setModalOpen(false)
    setForm(EMPTY_FORM)
    setEditingId(null)
  }

  const statusCount = {
    active: automations.filter((a) => a.status === 'active').length,
    paused: automations.filter((a) => a.status === 'paused').length,
    error: automations.filter((a) => a.status === 'error').length,
  }

  const totalRuns = automations.reduce((sum, a) => sum + a.runCount, 0)

  return (
    <div className="flex h-screen w-screen bg-paper overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col ml-56 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto pt-16">
          <div className="w-full px-6 py-6 space-y-6">
            {/* Page Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-ink">Automation</h1>
                <p className="text-graphite mt-1">Manage automated optimization and maintenance tasks</p>
              </div>
              <button
                onClick={openCreate}
                className="flex items-center gap-2 px-4 py-2 bg-signal hover:bg-signal text-white rounded-lg font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create Automation
              </button>
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-5 gap-4">
              <div className="bg-panel rounded-lg border border-hairline p-4">
                <p className="text-sm text-graphite mb-2">Total Automations</p>
                <p className="text-2xl font-bold text-ink">{automations.length}</p>
              </div>
              <div className="bg-panel rounded-lg border border-ok/25 bg-ok-soft p-4">
                <p className="text-sm text-ok font-medium mb-2">Active</p>
                <p className="text-2xl font-bold text-ok">{statusCount.active}</p>
              </div>
              <div className="bg-panel rounded-lg border border-hairline p-4">
                <p className="text-sm text-graphite mb-2">Paused</p>
                <p className="text-2xl font-bold text-ink">{statusCount.paused}</p>
              </div>
              <div className="bg-panel rounded-lg border border-danger/25 bg-danger-soft p-4">
                <p className="text-sm text-danger font-medium mb-2">Errors</p>
                <p className="text-2xl font-bold text-danger">{statusCount.error}</p>
              </div>
              <div className="bg-panel rounded-lg border border-info/25 bg-info-soft p-4">
                <p className="text-sm text-info font-medium mb-2">Total Runs</p>
                <p className="text-2xl font-bold text-info">{totalRuns.toLocaleString()}</p>
              </div>
            </div>

            {/* Automations List */}
            {automations.length === 0 ? (
              <div className="bg-panel rounded-lg border border-hairline p-8 text-center">
                <Zap className="w-12 h-12 text-graphite/50 mx-auto mb-3" />
                <p className="text-lg font-semibold text-ink">No automations configured</p>
                <p className="text-graphite mt-1">Create one to get started</p>
              </div>
            ) : (
              <div className="space-y-3">
                {automations.map((automation) => {
                  const isExpanded = expandedId === automation.id
                  const statusConfig = STATUS_CONFIG[automation.status]
                  const StatusIcon = statusConfig.icon

                  return (
                    <div key={automation.id} className="bg-panel rounded-lg border border-hairline overflow-hidden transition-all hover:border-signal/40">
                      <div className="px-6 py-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${statusConfig.bgColor}`}>
                                <Zap className={`w-5 h-5 ${statusConfig.color}`} />
                              </div>
                              <div>
                                <h3 className="text-lg font-semibold text-ink">{automation.name}</h3>
                                <div className="flex items-center gap-2">
                                  <StatusIcon className={`w-4 h-4 ${statusConfig.color}`} />
                                  <span className={`text-sm font-medium ${statusConfig.color} capitalize`}>
                                    {automation.status}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <p className="text-sm text-graphite ml-13">{automation.description}</p>
                          </div>

                          <div className="flex items-center gap-2 ml-4">
                            <button
                              onClick={() => toggleStatus(automation.id)}
                              className="p-2 hover:bg-subtle rounded-lg transition-colors"
                              title={automation.status === 'active' ? 'Pause automation' : 'Resume automation'}
                            >
                              {automation.status === 'active' ? (
                                <Play className="w-4 h-4 text-ok" />
                              ) : (
                                <Pause className="w-4 h-4 text-graphite" />
                              )}
                            </button>
                            <button
                              onClick={() => openEdit(automation)}
                              className="p-2 hover:bg-subtle rounded-lg transition-colors"
                              title="Edit"
                            >
                              <Edit2 className="w-4 h-4 text-graphite" />
                            </button>
                            <button
                              onClick={() => deleteAutomation(automation.id)}
                              className="p-2 hover:bg-danger-soft rounded-lg transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4 text-graphite hover:text-danger" />
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="mt-4 pt-4 border-t border-hairline grid grid-cols-3 gap-4">
                            <div className="bg-info-soft rounded-lg p-3 border border-info/25">
                              <div className="flex items-center gap-2 mb-2">
                                <Clock className="w-4 h-4 text-info" />
                                <p className="text-xs font-semibold text-info">Trigger</p>
                              </div>
                              <p className="text-sm text-info font-medium">{automation.trigger}</p>
                            </div>

                            <div className="bg-ok-soft rounded-lg p-3 border border-ok/25">
                              <p className="text-xs font-semibold text-ok mb-2">Action</p>
                              <p className="text-sm text-ok font-medium">{automation.action}</p>
                            </div>

                            <div className="bg-signal-soft rounded-lg p-3 border border-signal/25">
                              <p className="text-xs font-semibold text-signal mb-2">Execution History</p>
                              <p className="text-sm text-signal font-medium">{automation.runCount.toLocaleString()} runs</p>
                            </div>

                            {automation.lastRun && (
                              <div className="bg-subtle rounded-lg p-3 border border-hairline">
                                <p className="text-xs font-semibold text-graphite mb-1">Last Run</p>
                                <p className="text-sm text-ink">{automation.lastRun}</p>
                              </div>
                            )}

                            {automation.nextRun && (
                              <div className="bg-subtle rounded-lg p-3 border border-hairline">
                                <p className="text-xs font-semibold text-graphite mb-1">Next Run</p>
                                <p className="text-sm text-ink">{automation.nextRun}</p>
                              </div>
                            )}

                            {automation.status === 'error' && (
                              <div className="bg-danger-soft rounded-lg p-3 border border-danger/25">
                                <p className="text-xs font-semibold text-danger mb-1">Error</p>
                                <p className="text-sm text-danger">API connection failed</p>
                              </div>
                            )}
                          </div>
                        )}

                        <button
                          onClick={() => setExpandedId(isExpanded ? null : automation.id)}
                          className="mt-3 text-sm font-medium text-signal hover:text-signal transition-colors"
                        >
                          {isExpanded ? 'Hide details' : 'View details'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Create/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-panel rounded-lg shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
              <h2 className="text-lg font-semibold text-ink">
                {editingId ? 'Edit Automation' : 'Create Automation'}
              </h2>
              <button onClick={() => setModalOpen(false)} className="p-1 hover:bg-subtle rounded-lg">
                <X className="w-5 h-5 text-graphite" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-graphite mb-1">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Auto-terminate idle resources"
                  className="w-full px-3 py-2 border border-hairline rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-signal"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-graphite mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="What does this automation do?"
                  className="w-full px-3 py-2 border border-hairline rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-signal h-20 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-graphite mb-1">Trigger</label>
                <input
                  type="text"
                  value={form.trigger}
                  onChange={(e) => setForm({ ...form, trigger: e.target.value })}
                  placeholder="e.g. Daily at 2:00 AM UTC"
                  className="w-full px-3 py-2 border border-hairline rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-signal"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-graphite mb-1">Action</label>
                <input
                  type="text"
                  value={form.action}
                  onChange={(e) => setForm({ ...form, action: e.target.value })}
                  placeholder="e.g. Terminate idle resources"
                  className="w-full px-3 py-2 border border-hairline rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-signal"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-hairline">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-graphite hover:bg-subtle rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitForm}
                disabled={!form.name.trim()}
                className="px-4 py-2 text-sm font-medium bg-signal hover:bg-signal disabled:opacity-50 disabled:hover:bg-signal text-white rounded-lg transition-colors"
              >
                {editingId ? 'Save Changes' : 'Create Automation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
