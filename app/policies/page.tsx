'use client'

import { useState } from 'react'
import { Sidebar } from '@/components/dashboard/sidebar'
import { Header } from '@/components/dashboard/header'
import { Shield, Plus, Edit2, Trash2, ToggleRight, ToggleLeft, X } from 'lucide-react'

interface Policy {
  id: string
  name: string
  description: string
  category: 'cost' | 'security' | 'compliance' | 'performance'
  enabled: boolean
  rules: string[]
}

const MOCK_POLICIES: Policy[] = [
  {
    id: '1',
    name: 'Maximum Cost Per Resource',
    description: 'Enforce a maximum monthly cost limit per resource',
    category: 'cost',
    enabled: true,
    rules: ['$500/month maximum per resource', 'Alert on 80% threshold', 'Auto-shutdown on 100%'],
  },
  {
    id: '2',
    name: 'Production Environment Protection',
    description: 'Restrict changes to production resources',
    category: 'security',
    enabled: true,
    rules: ['Require manual approval', 'Limit to 2AM-6AM changes', 'Enforce backup before changes'],
  },
  {
    id: '3',
    name: 'Unused Resource Cleanup',
    description: 'Automatically remove resources with zero utilization',
    category: 'compliance',
    enabled: true,
    rules: ['30 days of zero CPU usage', '0% memory utilization', 'Auto-terminate unless tagged keep-alive'],
  },
  {
    id: '4',
    name: 'Reserved Instance Optimization',
    description: 'Automatically purchase RIs for long-running resources',
    category: 'cost',
    enabled: false,
    rules: ['Analyze 90-day patterns', 'Purchase 3-year RIs for 95%+ running', 'Coverage target: 80%+'],
  },
  {
    id: '5',
    name: 'Encryption Requirement',
    description: 'Ensure all data is encrypted at rest and in transit',
    category: 'security',
    enabled: true,
    rules: ['Enforce TLS 1.2+', 'Require KMS encryption', 'AES-256 minimum'],
  },
  {
    id: '6',
    name: 'Auto-Scaling Policies',
    description: 'Enable auto-scaling for appropriate workloads',
    category: 'performance',
    enabled: true,
    rules: ['Min 2 instances in prod', 'Scale up at 70% CPU', 'Scale down at 20% CPU', 'Max instances: 10'],
  },
]

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
  const [policies, setPolicies] = useState<Policy[]>(MOCK_POLICIES)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<PolicyFormState>(EMPTY_FORM)
  const [modalOpen, setModalOpen] = useState(false)

  const togglePolicy = (id: string) => {
    setPolicies(policies.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)))
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

  const deletePolicy = (id: string) => {
    if (!window.confirm('Delete this policy? This cannot be undone.')) return
    setPolicies(policies.filter((p) => p.id !== id))
    if (expandedId === id) setExpandedId(null)
  }

  const submitForm = () => {
    if (!form.name.trim()) return
    const rules = form.rulesText
      .split('\n')
      .map((r) => r.trim())
      .filter(Boolean)

    if (editingId) {
      setPolicies(
        policies.map((p) =>
          p.id === editingId
            ? { ...p, name: form.name, description: form.description, category: form.category, rules }
            : p
        )
      )
    } else {
      const newPolicy: Policy = {
        id: crypto.randomUUID(),
        name: form.name,
        description: form.description,
        category: form.category,
        enabled: true,
        rules,
      }
      setPolicies([newPolicy, ...policies])
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
      <div className="flex-1 flex flex-col ml-56 overflow-hidden">
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
                className="flex items-center gap-2 px-4 py-2 bg-signal hover:bg-signal text-white rounded-lg font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create Policy
              </button>
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-5 gap-4">
              <div className="bg-panel rounded-lg border border-hairline p-4">
                <p className="text-sm text-graphite mb-2">Total Policies</p>
                <p className="text-2xl font-bold text-ink">{policies.length}</p>
              </div>
              <div className="bg-panel rounded-lg border border-ok/25 bg-ok-soft p-4">
                <p className="text-sm text-ok font-medium mb-2">Enabled</p>
                <p className="text-2xl font-bold text-ok">{enabledCount}</p>
              </div>
              <div className="bg-panel rounded-lg border border-hairline p-4">
                <p className="text-sm text-graphite mb-2">Security</p>
                <p className="text-2xl font-bold text-ink">{categoryCount.security}</p>
              </div>
              <div className="bg-panel rounded-lg border border-hairline p-4">
                <p className="text-sm text-graphite mb-2">Cost</p>
                <p className="text-2xl font-bold text-ink">{categoryCount.cost}</p>
              </div>
              <div className="bg-panel rounded-lg border border-hairline p-4">
                <p className="text-sm text-graphite mb-2">Compliance</p>
                <p className="text-2xl font-bold text-ink">{categoryCount.compliance}</p>
              </div>
            </div>

            {/* Policies List */}
            {policies.length === 0 ? (
              <div className="bg-panel rounded-lg border border-hairline p-8 text-center">
                <Shield className="w-12 h-12 text-graphite/50 mx-auto mb-3" />
                <p className="text-lg font-semibold text-ink">No policies configured</p>
                <p className="text-graphite mt-1">Create one to get started</p>
              </div>
            ) : (
              <div className="space-y-3">
                {policies.map((policy) => {
                  const isExpanded = expandedId === policy.id

                  return (
                    <div key={policy.id} className="bg-panel rounded-lg border border-hairline overflow-hidden transition-all hover:border-signal/40">
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
            <div className="bg-panel rounded-lg border border-hairline p-6">
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
                className="px-4 py-2 text-sm font-medium bg-signal hover:bg-signal disabled:opacity-50 disabled:hover:bg-signal text-white rounded-lg transition-colors"
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
