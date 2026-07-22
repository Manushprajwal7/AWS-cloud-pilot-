'use client'

import { useEffect, useState } from 'react'
import { Sidebar } from '@/components/dashboard/sidebar'
import { Header } from '@/components/dashboard/header'
import { Shield, Plus, Edit2, Trash2, ToggleRight, ToggleLeft, X } from 'lucide-react'
import { ChartEmptyState, ChartErrorState, ChartLoadingState } from '@/components/monitoring/chart-states'

interface Policy {
  id: string
  name: string
  description: string
  category: 'cost' | 'security' | 'compliance' | 'performance'
  enabled: boolean
  rules: string[]
}

type LoadState = 'loading' | 'ready' | 'error' | 'db_unavailable'

const CATEGORY_COLOR: Record<string, string> = {
  cost: 'bg-signal-soft text-signal',
  security: 'bg-danger-soft text-danger',
  compliance: 'bg-info-soft text-info',
  performance: 'bg-ok-soft text-ok',
}

const CATEGORIES = ['cost', 'security', 'compliance', 'performance'] as const

interface PolicyFormState {
  name: string
  description: string
  category: Policy['category']
  rulesText: string
}

const EMPTY_FORM: PolicyFormState = { name: '', description: '', category: 'cost', rulesText: '' }

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const [refreshToken, setRefreshToken] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<PolicyFormState>(EMPTY_FORM)
  const [modalOpen, setModalOpen] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      try {
        const response = await fetch('/api/policies')
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json()
        if (cancelled) return
        if (!data.dbAvailable) {
          setState('db_unavailable')
          return
        }
        setPolicies(data.policies)
        setState('ready')
      } catch {
        if (!cancelled) setState('error')
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [refreshToken])

  const togglePolicy = async (id: string) => {
    const target = policies.find((p) => p.id === id)
    if (!target) return
    setPolicies(policies.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)))
    const response = await fetch(`/api/policies/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !target.enabled }),
    })
    if (!response.ok) setPolicies(policies)
  }

  const openCreate = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setModalOpen(true)
  }

  const openEdit = (policy: Policy) => {
    setEditingId(policy.id)
    setForm({
      name: policy.name,
      description: policy.description,
      category: policy.category,
      rulesText: policy.rules.join('\n'),
    })
    setModalOpen(true)
  }

  const deletePolicy = async (id: string) => {
    if (!window.confirm('Delete this policy? This cannot be undone.')) return
    const response = await fetch(`/api/policies/${id}`, { method: 'DELETE' })
    if (!response.ok) return
    setPolicies((items) => items.filter((p) => p.id !== id))
    if (expandedId === id) setExpandedId(null)
  }

  const submitForm = async () => {
    if (!form.name.trim()) return
    const rules = form.rulesText
      .split('\n')
      .map((r) => r.trim())
      .filter(Boolean)

    if (editingId) {
      const response = await fetch(`/api/policies/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, description: form.description, category: form.category, rules }),
      })
      if (response.ok) {
        const { policy } = await response.json()
        setPolicies((items) => items.map((p) => (p.id === editingId ? policy : p)))
      }
    } else {
      const response = await fetch('/api/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, description: form.description, category: form.category, rules }),
      })
      if (response.ok) {
        const { policy } = await response.json()
        setPolicies((items) => [policy, ...items])
      }
    }

    setModalOpen(false)
    setForm(EMPTY_FORM)
    setEditingId(null)
  }

  const enabledCount = policies.filter((p) => p.enabled).length
  const categoryCount = {
    cost: policies.filter((p) => p.category === 'cost').length,
    security: policies.filter((p) => p.category === 'security').length,
    compliance: policies.filter((p) => p.category === 'compliance').length,
    performance: policies.filter((p) => p.category === 'performance').length,
  }

  return (
    <div className="flex h-screen w-screen bg-paper overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col ml-60 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto pt-16">
          <div className="w-full px-6 py-6 space-y-6">
            {/* Page Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-ink">Policies</h1>
                <p className="text-graphite mt-1">Governance rules and compliance policies</p>
              </div>
              <button
                onClick={openCreate}
                className="flex items-center gap-2 px-4 py-2 bg-signal hover:bg-signal/90 text-ink font-semibold rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create Policy
              </button>
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-5 gap-4">
              <div className="bg-panel rounded-lg border border-hairline shadow-sm p-4">
                <p className="text-sm text-graphite mb-2">Total Policies</p>
                <p className="text-2xl font-bold text-ink">{policies.length}</p>
              </div>
              <div className="bg-panel rounded-lg border border-ok/25 bg-ok-soft shadow-sm p-4">
                <p className="text-sm text-ok font-medium mb-2">Enabled</p>
                <p className="text-2xl font-bold text-ok">{enabledCount}</p>
              </div>
              <div className="bg-panel rounded-lg border border-hairline shadow-sm p-4">
                <p className="text-sm text-graphite mb-2">Security</p>
                <p className="text-2xl font-bold text-ink">{categoryCount.security}</p>
              </div>
              <div className="bg-panel rounded-lg border border-hairline shadow-sm p-4">
                <p className="text-sm text-graphite mb-2">Cost</p>
                <p className="text-2xl font-bold text-ink">{categoryCount.cost}</p>
              </div>
              <div className="bg-panel rounded-lg border border-hairline shadow-sm p-4">
                <p className="text-sm text-graphite mb-2">Compliance</p>
                <p className="text-2xl font-bold text-ink">{categoryCount.compliance}</p>
              </div>
            </div>

            {/* Policies List */}
            {state === 'loading' ? (
              <div className="bg-panel rounded-lg border border-hairline shadow-sm p-8">
                <ChartLoadingState heightClassName="h-40" />
              </div>
            ) : state === 'error' ? (
              <div className="bg-panel rounded-lg border border-hairline shadow-sm p-8">
                <ChartErrorState message="Unable to load policies." onRetry={() => setRefreshToken((t) => t + 1)} heightClassName="h-40" />
              </div>
            ) : state === 'db_unavailable' ? (
              <div className="bg-panel rounded-lg border border-hairline shadow-sm p-8">
                <ChartErrorState message="Database unavailable — policies require Postgres to be configured." heightClassName="h-40" />
              </div>
            ) : policies.length === 0 ? (
              <div className="bg-panel rounded-lg border border-hairline shadow-sm p-8 text-center">
                <ChartEmptyState message="No policies configured yet. Create one to get started." heightClassName="h-40" />
              </div>
            ) : (
              <div className="space-y-3">
                {policies.map((policy) => {
                  const isExpanded = expandedId === policy.id

                  return (
                    <div key={policy.id} className="bg-panel rounded-lg border border-hairline shadow-sm overflow-hidden transition-all hover:border-signal/40 hover:shadow-md">
                      <div className="px-6 py-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <h3 className="text-lg font-semibold text-ink">{policy.name}</h3>
                              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${CATEGORY_COLOR[policy.category]}`}>
                                {policy.category}
                              </span>
                            </div>
                            <p className="text-sm text-graphite">{policy.description}</p>
                          </div>

                          <div className="flex items-center gap-2 ml-4">
                            <button
                              onClick={() => togglePolicy(policy.id)}
                              className="p-2 hover:bg-subtle rounded-lg transition-colors"
                              title={policy.enabled ? 'Disable policy' : 'Enable policy'}
                            >
                              {policy.enabled ? (
                                <ToggleRight className="w-5 h-5 text-ok" />
                              ) : (
                                <ToggleLeft className="w-5 h-5 text-graphite" />
                              )}
                            </button>
                            <button
                              onClick={() => setExpandedId(isExpanded ? null : policy.id)}
                              className="p-2 hover:bg-subtle rounded-lg transition-colors"
                              title="View details"
                            >
                              <Shield className="w-5 h-5 text-graphite" />
                            </button>
                            <button
                              onClick={() => openEdit(policy)}
                              className="p-2 hover:bg-subtle rounded-lg transition-colors"
                              title="Edit"
                            >
                              <Edit2 className="w-4 h-4 text-graphite" />
                            </button>
                            <button
                              onClick={() => deletePolicy(policy.id)}
                              className="p-2 hover:bg-danger-soft rounded-lg transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4 text-graphite hover:text-danger" />
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="mt-4 pt-4 border-t border-hairline">
                            <p className="text-xs font-semibold text-graphite mb-2">Rules:</p>
                            {policy.rules.length === 0 ? (
                              <p className="text-sm text-graphite">No rules defined.</p>
                            ) : (
                              <ul className="space-y-2">
                                {policy.rules.map((rule, idx) => (
                                  <li key={idx} className="text-sm text-graphite flex items-start gap-2">
                                    <span className="text-signal font-bold">•</span>
                                    <span>{rule}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Policy Categories */}
            <div className="bg-panel rounded-lg border border-hairline shadow-sm p-6">
              <h3 className="text-lg font-semibold text-ink mb-4">Policy Categories</h3>
              <div className="grid grid-cols-2 gap-4">
                {Object.entries(CATEGORY_COLOR).map(([category, color]) => (
                  <div key={category} className={`p-4 rounded-lg ${color} flex items-center justify-between`}>
                    <div>
                      <p className="font-semibold capitalize">{category}</p>
                      <p className="text-sm opacity-75">{categoryCount[category as keyof typeof categoryCount]} policies</p>
                    </div>
                    <Shield className="w-6 h-6 opacity-50" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Create/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-panel rounded-lg shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
              <h2 className="text-lg font-semibold text-ink">
                {editingId ? 'Edit Policy' : 'Create Policy'}
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
                  placeholder="e.g. Maximum Cost Per Resource"
                  className="w-full px-3 py-2 border border-hairline rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-signal"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-graphite mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="What does this policy enforce?"
                  className="w-full px-3 py-2 border border-hairline rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-signal h-20 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-graphite mb-1">Category</label>
                <div className="flex gap-2">
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setForm({ ...form, category: cat })}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
                        form.category === cat ? CATEGORY_COLOR[cat] : 'bg-subtle text-graphite hover:bg-subtle'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-graphite mb-1">Rules (one per line)</label>
                <textarea
                  value={form.rulesText}
                  onChange={(e) => setForm({ ...form, rulesText: e.target.value })}
                  placeholder={'e.g. $500/month maximum per resource\nAlert on 80% threshold'}
                  className="w-full px-3 py-2 border border-hairline rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-signal h-24 resize-none"
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
                className="px-4 py-2 text-sm font-semibold bg-signal hover:bg-signal/90 disabled:opacity-50 text-ink rounded-lg transition-colors"
              >
                {editingId ? 'Save Changes' : 'Create Policy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
