'use client'

import { useEffect, useMemo, useState } from 'react'
import { Sidebar } from '@/components/dashboard/sidebar'
import { Header } from '@/components/dashboard/header'
import { ChartErrorState, ChartLoadingState } from '@/components/monitoring/chart-states'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  BrainCircuit,
  Calculator,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  CloudCog,
  Code2,
  DatabaseZap,
  Edit2,
  FileCode2,
  GitBranch,
  History,
  Layers3,
  LockKeyhole,
  Network,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SearchCheck,
  Send,
  ShieldCheck,
  Terminal,
  Trash2,
  X,
  Zap,
} from 'lucide-react'

interface Automation {
  id: string
  name: string
  description: string
  trigger: string
  action: string
  status: 'active' | 'paused' | 'error'
  lastRunAt: string | null
  nextRunAt: string | null
  runCount: number
}

type LoadState = 'loading' | 'ready' | 'error' | 'db_unavailable'

function formatRelativeTime(iso: string | null, direction: 'past' | 'future'): string | undefined {
  if (!iso) return undefined
  const deltaMs = new Date(iso).getTime() - Date.now()
  const absMs = Math.abs(deltaMs)
  const minutes = Math.round(absMs / 60_000)
  const hours = Math.round(absMs / 3_600_000)
  const days = Math.round(absMs / 86_400_000)

  const magnitude = minutes < 60 ? `${minutes} minute${minutes === 1 ? '' : 's'}` : hours < 24 ? `${hours} hour${hours === 1 ? '' : 's'}` : `${days} day${days === 1 ? '' : 's'}`

  return direction === 'past' ? `${magnitude} ago` : `${magnitude} from now`
}

type NodeKind = 'deterministic' | 'llm' | 'terraform' | 'exit'

interface PipelineNode {
  id: string
  label: string
  description: string
  kind: NodeKind
  icon: LucideIcon
}

interface PipelinePhase {
  number: string
  eyebrow: string
  title: string
  summary: string
  accent: string
  nodes: PipelineNode[]
}

const PIPELINE_PHASES: PipelinePhase[] = [
  {
    number: '01',
    eyebrow: 'Sense',
    title: 'Find the signal',
    summary: 'Observe the target, then make the first deterministic decision.',
    accent: 'blue',
    nodes: [
      { id: 'monitor', label: 'monitor', description: 'Pull current metrics for the target resource.', kind: 'deterministic', icon: Activity },
      { id: 'detectAnomaly', label: 'detectAnomaly', description: 'Threshold check. A clean resource skips to audit.', kind: 'deterministic', icon: SearchCheck },
    ],
  },
  {
    number: '02',
    eyebrow: 'Reason',
    title: 'Build a case',
    summary: 'Turn a metric spike into an explainable remediation plan.',
    accent: 'violet',
    nodes: [
      { id: 'diagnose', label: 'diagnose', description: 'Groq returns root cause, confidence, and action.', kind: 'llm', icon: BrainCircuit },
      { id: 'calculateImpact', label: 'calculateImpact', description: 'Project cost or risk impact with plain arithmetic.', kind: 'deterministic', icon: Calculator },
      { id: 'planRemediation', label: 'planRemediation', description: 'Groq produces the structured execution plan.', kind: 'llm', icon: GitBranch },
    ],
  },
  {
    number: '03',
    eyebrow: 'Generate · verify',
    title: 'Make it safe to run',
    summary: 'Constrain, scan, correct, and plan the Terraform before apply.',
    accent: 'amber',
    nodes: [
      { id: 'terraformGenerate', label: 'terraformGenerate', description: 'Stream HCL against a fixed resource spec.', kind: 'llm', icon: FileCode2 },
      { id: 'staticSecurity', label: 'staticSecurity', description: 'Scan generated HCL before it reaches a CLI.', kind: 'deterministic', icon: ShieldCheck },
      { id: 'terraformFormat', label: 'terraformFormat', description: 'Format in a sandboxed Terraform subprocess.', kind: 'terraform', icon: Terminal },
      { id: 'terraformValidate', label: 'terraformValidate', description: 'Validate syntax and provider assumptions.', kind: 'terraform', icon: BadgeCheck },
      { id: 'selfCorrection', label: 'selfCorrection', description: 'Patch failures and re-enter the loop, max 3 times.', kind: 'llm', icon: RotateCcw },
      { id: 'terraformPlan', label: 'terraformPlan', description: 'Run a credential-stripped, output-capped plan.', kind: 'terraform', icon: Code2 },
    ],
  },
  {
    number: '04',
    eyebrow: 'Gate · apply',
    title: 'Earn the change',
    summary: 'Two deterministic gates decide if infrastructure can move.',
    accent: 'orange',
    nodes: [
      { id: 'planPolicy', label: 'planPolicy', description: 'Check the plan diff against policy.', kind: 'deterministic', icon: LockKeyhole },
      { id: 'autoApproval', label: 'autoApproval', description: 'Record whether a human is required.', kind: 'deterministic', icon: ShieldCheck },
      { id: 'terraformApply', label: 'terraformApply', description: 'The only node that changes infrastructure.', kind: 'terraform', icon: CloudCog },
    ],
  },
  {
    number: '05',
    eyebrow: 'Confirm',
    title: 'Prove the outcome',
    summary: 'Re-check health, anomaly signals, and cost after the change.',
    accent: 'green',
    nodes: [
      { id: 'verification', label: 'verification', description: 'Write a VerificationResult and choose an exit.', kind: 'deterministic', icon: Network },
      { id: 'rollback', label: 'rollback', description: 'Revert the change when verification fails.', kind: 'exit', icon: RotateCcw },
      { id: 'calculateRealizedSavings', label: 'calculateRealizedSavings', description: 'Compute the delivered improvement on success.', kind: 'exit', icon: ArrowUpRight },
    ],
  },
  {
    number: '06',
    eyebrow: 'Close out',
    title: 'Leave a record',
    summary: 'Every branch converges into one durable audit event.',
    accent: 'slate',
    nodes: [
      { id: 'audit', label: 'audit', description: 'Write AuditEvent, then end the run.', kind: 'deterministic', icon: History },
    ],
  },
]

const KIND_CONFIG: Record<NodeKind, { label: string; className: string; iconClass: string }> = {
  deterministic: { label: 'plain code', className: 'border-[#9bc6ec] bg-[#f1f7fd]', iconClass: 'bg-[#dcecfb] text-[#146eb4]' },
  llm: { label: 'Groq · Llama 3.3 70B', className: 'border-[#c8b9f2] bg-[#f7f4fe]', iconClass: 'bg-[#e9e0fd] text-[#6b43b5]' },
  terraform: { label: 'Terraform CLI', className: 'border-[#f4c988] bg-[#fff8eb]', iconClass: 'bg-[#ffebc7] text-[#a85e00]' },
  exit: { label: 'exit path', className: 'border-[#9bd6ba] bg-[#f1fbf5]', iconClass: 'bg-[#ddf3e7] text-[#037f51]' },
}

const ACCENT_CONFIG: Record<string, { dot: string; text: string; rail: string; wash: string }> = {
  blue: { dot: 'bg-[#146eb4]', text: 'text-[#146eb4]', rail: 'bg-[#d8eaf8]', wash: 'bg-[#f4f9fd]' },
  violet: { dot: 'bg-[#6b43b5]', text: 'text-[#6b43b5]', rail: 'bg-[#e8e0fa]', wash: 'bg-[#faf8ff]' },
  amber: { dot: 'bg-[#a85e00]', text: 'text-[#a85e00]', rail: 'bg-[#ffebc7]', wash: 'bg-[#fffaf1]' },
  orange: { dot: 'bg-[#d26400]', text: 'text-[#d26400]', rail: 'bg-[#ffe2c8]', wash: 'bg-[#fff8f2]' },
  green: { dot: 'bg-[#037f51]', text: 'text-[#037f51]', rail: 'bg-[#daf0e3]', wash: 'bg-[#f4fbf7]' },
  slate: { dot: 'bg-[#4b5968]', text: 'text-[#4b5968]', rail: 'bg-[#e6e9ed]', wash: 'bg-[#f7f8f9]' },
}

const STATUS_CONFIG = {
  active: { label: 'Active', color: 'text-[#037f51]', bg: 'bg-[#e7f5ed]', icon: CheckCircle2 },
  paused: { label: 'Paused', color: 'text-[#5c6672]', bg: 'bg-[#f2f2f2]', icon: Pause },
  error: { label: 'Needs attention', color: 'text-[#d13212]', bg: 'bg-[#fdecea]', icon: AlertCircle },
}

interface AutomationFormState {
  name: string
  description: string
  trigger: string
  action: string
}

const EMPTY_FORM: AutomationFormState = { name: '', description: '', trigger: '', action: '' }

function Kicker({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`font-mono text-[10px] font-semibold uppercase tracking-[0.16em] ${className}`}>{children}</span>
}

const SYSTEM_FLOW = [
  {
    number: '01',
    title: 'SIMULATION TICK ENGINE',
    description: 'Generates CPU spikes, idle cycles, and memory leaks.',
    handoff: 'Live state updates',
    icon: Activity,
    accent: 'border-[#9bc6ec] bg-[#f4f9fd]',
    iconClass: 'bg-[#dcecfb] text-[#146eb4]',
    badge: 'source / simulation',
  },
  {
    number: '02',
    title: 'CLOUDWATCH / PROMETHEUS UI',
    description: 'Recharts plot fluctuating live paths and surface anomaly signals.',
    handoff: 'Anomaly alert triggers',
    icon: Network,
    accent: 'border-[#c8b9f2] bg-[#faf8ff]',
    iconClass: 'bg-[#e9e0fd] text-[#6b43b5]',
    badge: 'observe / diagnose',
  },
  {
    number: '03',
    title: 'TERRAFORM RUNTIME SANDBOX',
    description: 'Streaming code writer → plan → apply → verification and resolution.',
    handoff: 'Resolution + audit',
    icon: Terminal,
    accent: 'border-[#f4c988] bg-[#fffaf1]',
    iconClass: 'bg-[#ffebc7] text-[#a85e00]',
    badge: 'generate / execute',
  },
]

function SystemFlowDiagram() {
  return (
    <section className="mb-8 rounded-[20px] border border-[#d6dde4] bg-white p-4 shadow-[0_8px_24px_rgba(35,47,62,0.05)] md:p-7" aria-labelledby="system-flow-title">
      <div className="mb-6 flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <Kicker className="text-[#146eb4]">System flow / top-level mental model</Kicker>
          <h2 id="system-flow-title" className="mt-1 font-display text-[24px] font-semibold tracking-[-0.05em] text-[#172333] md:text-[28px]">From live signal to safe resolution</h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-[1.55] text-[#5c6672]">The UI can be understood as one directional handoff: simulation creates state, observability turns it into an alert, and the sandbox proves the fix.</p>
        </div>
        <div className="inline-flex items-center gap-2 self-start rounded-full border border-[#d6dde4] bg-[#f7f8f9] px-3 py-1.5 font-mono text-[10px] text-[#5c6672] md:self-auto"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#037f51]" /> live control path</div>
      </div>

      <div className="mx-auto max-w-4xl">
        {SYSTEM_FLOW.map((stage, index) => {
          const Icon = stage.icon
          return (
            <div key={stage.number}>
              <article className={`relative overflow-hidden rounded-[14px] border-2 ${stage.accent} px-4 py-4 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(35,47,62,0.08)] md:px-6 md:py-5`}>
                <div className="absolute right-0 top-0 h-full w-1/3 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.45))]" />
                <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3.5 md:gap-4">
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] ${stage.iconClass}`}><Icon className="h-5 w-5" strokeWidth={1.8} /></span>
                    <div className="min-w-0">
                      <div className="mb-1.5 flex flex-wrap items-center gap-2"><span className="font-mono text-[10px] font-bold tracking-[0.12em] text-[#7b8792]">{stage.number}</span><span className="h-1 w-1 rounded-full bg-[#b7bfc8]" /><span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#7b8792]">{stage.badge}</span></div>
                      <h3 className="font-display text-[15px] font-bold tracking-[0.02em] text-[#172333] md:text-[17px]">{stage.title}</h3>
                      <p className="mt-1.5 text-[12px] leading-[1.5] text-[#5c6672] md:text-[13px]">{stage.description}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 rounded-[9px] border border-white/80 bg-white/60 px-3 py-2 font-mono text-[10px] text-[#405064] sm:max-w-[190px]"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#ff9900]" />{stage.handoff}</div>
                </div>
              </article>
              {index < SYSTEM_FLOW.length - 1 && <div className="flex flex-col items-center py-2.5" aria-hidden="true"><div className="h-4 w-px bg-[#b7bfc8]" /><span className="flex items-center gap-1.5 rounded-full border border-[#d6dde4] bg-[#f7f8f9] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.08em] text-[#5c6672]"><ArrowDown className="h-3 w-3 text-[#146eb4]" /> {stage.handoff}</span><div className="h-4 w-px bg-[#b7bfc8]" /></div>}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function PipelineNodeCard({ node, selected, onSelect }: { node: PipelineNode; selected: boolean; onSelect: () => void }) {
  const config = KIND_CONFIG[node.kind]
  const Icon = node.icon

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group relative w-full rounded-[12px] border px-3.5 py-3 text-left transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(35,47,62,0.08)] focus-visible:ring-2 focus-visible:ring-[#ff9900] ${config.className} ${selected ? 'ring-2 ring-[#ff9900] ring-offset-2' : ''}`}
      aria-pressed={selected}
    >
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] ${config.iconClass}`}>
          <Icon className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] font-semibold tracking-tight text-[#232f3e]">{node.label}</span>
            <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-[#8b96a3] transition-transform duration-200 ${selected ? 'translate-x-0.5 text-[#ff9900]' : 'group-hover:translate-x-0.5'}`} />
          </span>
          <span className="mt-1 block text-[11px] leading-[1.4] text-[#5c6672]">{node.description}</span>
          <span className="mt-2 inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[#7d8995]">
            <CircleDot className="h-2.5 w-2.5" /> {config.label}
          </span>
        </span>
      </div>
    </button>
  )
}

function PhaseRail({ phase, selectedId, onSelect }: { phase: PipelinePhase; selectedId: string; onSelect: (node: PipelineNode) => void }) {
  const accent = ACCENT_CONFIG[phase.accent]

  return (
    <section className="relative grid grid-cols-[34px_minmax(0,1fr)] gap-3 md:grid-cols-[48px_minmax(0,1fr)] md:gap-4">
      <div className="relative flex flex-col items-center">
        <span className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-4 border-[#0f1823] ${accent.dot} font-mono text-[9px] font-bold text-white shadow-[0_0_0_1px_rgba(255,255,255,0.15)] md:h-9 md:w-9`}>{phase.number}</span>
        <span className={`absolute top-8 bottom-[-24px] w-px ${accent.rail} last:hidden`} />
      </div>
      <div className={`rounded-[16px] border border-[#dce2e8] ${accent.wash} p-3.5 md:p-4`}>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <Kicker className={accent.text}>{phase.eyebrow}</Kicker>
            <h3 className="mt-1 font-display text-[19px] font-semibold tracking-[-0.04em] text-[#172333] md:text-[21px]">{phase.title}</h3>
          </div>
          <p className="max-w-[260px] text-right text-[11px] leading-[1.45] text-[#6b7683]">{phase.summary}</p>
        </div>
        <div className={`grid gap-2.5 ${phase.nodes.length > 3 ? 'md:grid-cols-2 xl:grid-cols-3' : phase.nodes.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
          {phase.nodes.map((node) => (
            <PipelineNodeCard key={node.id} node={node} selected={selectedId === node.id} onSelect={() => onSelect(node)} />
          ))}
        </div>
        {phase.number === '03' && (
          <div className="mt-3 flex items-center gap-2 rounded-[10px] border border-dashed border-[#e6b96e] bg-[#fffdf8] px-3 py-2 font-mono text-[10px] text-[#a85e00]">
            <RotateCcw className="h-3.5 w-3.5" />
            <span><strong className="font-semibold">sandbox loop</strong> · validation failure re-enters at format · capped at 3 passes</span>
          </div>
        )}
      </div>
    </section>
  )
}

export default function AutomationPage() {
  const [automations, setAutomations] = useState<Automation[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const [refreshToken, setRefreshToken] = useState(0)
  const [selectedNode, setSelectedNode] = useState<PipelineNode>(PIPELINE_PHASES[0].nodes[0])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<AutomationFormState>(EMPTY_FORM)
  const [modalOpen, setModalOpen] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      try {
        const response = await fetch('/api/automations')
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json()
        if (cancelled) return
        if (!data.dbAvailable) {
          setState('db_unavailable')
          return
        }
        setAutomations(data.automations)
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

  const toggleStatus = async (id: string) => {
    const target = automations.find((item) => item.id === id)
    if (!target) return
    const nextStatus = target.status === 'active' ? 'paused' : 'active'
    setAutomations((items) => items.map((item) => item.id === id ? { ...item, status: nextStatus } : item))
    const response = await fetch(`/api/automations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    })
    if (!response.ok) setAutomations(automations)
  }

  const openCreate = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setModalOpen(true)
  }

  const openEdit = (automation: Automation) => {
    setEditingId(automation.id)
    setForm({ name: automation.name, description: automation.description, trigger: automation.trigger, action: automation.action })
    setModalOpen(true)
  }

  const deleteAutomation = async (id: string) => {
    if (!window.confirm('Delete this automation? This cannot be undone.')) return
    const response = await fetch(`/api/automations/${id}`, { method: 'DELETE' })
    if (!response.ok) return
    setAutomations((items) => items.filter((item) => item.id !== id))
    if (expandedId === id) setExpandedId(null)
  }

  const submitForm = async () => {
    if (!form.name.trim()) return
    if (editingId) {
      const response = await fetch(`/api/automations/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (response.ok) {
        const { automation } = await response.json()
        setAutomations((items) => items.map((item) => item.id === editingId ? automation : item))
      }
    } else {
      const response = await fetch('/api/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (response.ok) {
        const { automation } = await response.json()
        setAutomations((items) => [automation, ...items])
      }
    }
    setModalOpen(false)
    setForm(EMPTY_FORM)
    setEditingId(null)
  }

  const activeCount = automations.filter((item) => item.status === 'active').length
  const pausedCount = automations.filter((item) => item.status === 'paused').length
  const errorCount = automations.filter((item) => item.status === 'error').length
  const selectedConfig = KIND_CONFIG[selectedNode.kind]

  const ledgerRows = useMemo(() => [
    ['AgentRun', 'before the first node', '1 row / run', 'running'],
    ['AgentNodeRun', 'withNodeInstrumentation', '1 row / node', 'streaming'],
    ['RemediationPlan', 'planRemediation', 'structured plan', 'persisted'],
    ['TerraformArtifact → Execution', 'terraformGenerate + CLI', 'fmt / init / validate / plan / apply', 'sandboxed'],
    ['VerificationResult', 'verification', 'health + savings proof', 'persisted'],
    ['PolicyDecision · PlanApproval · AuditEvent', 'gate + close out', 'decision trail', 'immutable'],
  ], [])

  return (
    <div className="min-h-screen w-full bg-[#f7f8f9] text-[#172333]">
      <Sidebar />
      <div className="ml-60 flex min-h-screen flex-col max-[900px]:ml-0">
        <Header />
        <main className="flex-1 overflow-y-auto pt-16">
          <div className="mx-auto max-w-[1500px] px-5 py-7 md:px-8 md:py-9 xl:px-10">
            <div className="mb-7 flex flex-col justify-between gap-6 xl:flex-row xl:items-end">
              <div className="max-w-3xl">
                <div className="mb-4 flex items-center gap-2 text-[#5c6672]">
                  <Kicker>Automation / runtime schematic</Kicker>
                  <span className="h-1 w-1 rounded-full bg-[#ff9900]" />
                  <Kicker className="text-[#146eb4]">v1.4 · cloudPilotGraph</Kicker>
                </div>
                <h1 className="max-w-3xl font-display text-[clamp(2.15rem,4vw,4rem)] font-semibold leading-[0.98] tracking-[-0.065em] text-[#101a28]">Every run has a route.<br /><span className="text-[#146eb4]">Every decision leaves a mark.</span></h1>
                <p className="mt-4 max-w-2xl text-[15px] leading-[1.6] text-[#5c6672]">An end-to-end trace of the agentic pipeline that watches infrastructure, diagnoses problems, writes and applies Terraform, then verifies the outcome.</p>
              </div>
                <div className="flex shrink-0 items-center gap-3 rounded-[14px] border border-[#d6dde4] bg-white px-3.5 py-3 shadow-[0_5px_18px_rgba(35,47,62,0.04)]">
                  <span className="relative flex h-8 w-8 items-center justify-center rounded-[9px] bg-[#e7f5ed] text-[#037f51]"><span className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-[#037f51]/35" /><span className="relative h-2 w-2 rounded-full bg-[#037f51]" /></span>
                  <div><Kicker className="text-[#037f51]">Runtime online</Kicker><p className="mt-0.5 font-mono text-[11px] text-[#5c6672]">SSE connected · 10s heartbeat</p></div>
                </div>
              </div>

            <SystemFlowDiagram />

            <section className="overflow-hidden rounded-[20px] bg-[#0f1823] shadow-[0_20px_60px_rgba(15,24,35,0.17)]">
              <div className="border-b border-white/10 px-5 py-4 md:px-7">
                <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" /><span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" /><span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" /></div>
                    <span className="font-mono text-[11px] text-white/60">cloudpilot / agentic-pipeline.trace</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-white/55"><span className="rounded-full border border-white/10 px-2.5 py-1">POST /api/graph/run</span><ArrowRight className="h-3 w-3" /><span className="rounded-full border border-[#ff9900]/40 bg-[#ff9900]/10 px-2.5 py-1 text-[#ffbb54]">202 · async</span></div>
                </div>
              </div>
              <div className="grid gap-6 p-4 md:p-7 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.6fr)] xl:gap-8">
                <div className="relative overflow-hidden rounded-[16px] border border-white/10 bg-[#121f2d] p-4 md:p-5">
                  <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:32px_32px]" />
                  <div className="relative mb-5 flex flex-wrap items-center justify-between gap-3">
                    <div><Kicker className="text-[#7eb9ed]">Live execution map</Kicker><p className="mt-1 text-[12px] text-white/55">The graph can exit early, loop for correction, or roll back.</p></div>
                    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1.5 font-mono text-[9px] text-white/55"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#28c840]" /> node snapshots + token bus</div>
                  </div>
                  <div className="relative space-y-4">
                    {PIPELINE_PHASES.map((phase, index) => (
                      <div key={phase.number} className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-3 md:grid-cols-[34px_minmax(0,1fr)] md:gap-4">
                        <div className="relative flex justify-center"><span className={`z-10 mt-3 h-2.5 w-2.5 rounded-full ${ACCENT_CONFIG[phase.accent].dot} ring-4 ring-[#121f2d]`} />{index < PIPELINE_PHASES.length - 1 && <span className="absolute top-6 bottom-[-18px] w-px bg-white/10" />}</div>
                        <div className="min-w-0">
                          <div className="mb-2 flex items-baseline gap-2"><span className="font-mono text-[10px] font-semibold text-white/35">{phase.number}</span><span className={`font-mono text-[11px] font-semibold uppercase tracking-[0.15em] ${ACCENT_CONFIG[phase.accent].text}`}>{phase.eyebrow}</span><span className="hidden text-[10px] text-white/35 sm:inline">— {phase.title}</span></div>
                          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                            {phase.nodes.map((node) => <button key={node.id} type="button" onClick={() => setSelectedNode(node)} className={`group flex min-h-[66px] items-center gap-2.5 rounded-[10px] border px-2.5 py-2 text-left transition-[transform,border-color,background-color] duration-200 hover:-translate-y-0.5 hover:border-white/25 ${selectedNode.id === node.id ? 'border-[#ff9900]/80 bg-[#ff9900]/10' : 'border-white/10 bg-white/[0.035]'}`}><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] ${KIND_CONFIG[node.kind].iconClass}`}><node.icon className="h-3.5 w-3.5" /></span><span className="min-w-0"><span className="block truncate font-mono text-[10px] text-white/85">{node.label}</span><span className="mt-1 block truncate text-[9px] text-white/35">{KIND_CONFIG[node.kind].label}</span></span></button>)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="rounded-[16px] border border-white/10 bg-[#172638] p-5">
                    <div className="flex items-center justify-between gap-3"><Kicker className="text-[#ffb64c]">Selected node</Kicker><span className={`rounded-full border border-white/10 px-2 py-1 font-mono text-[9px] ${selectedConfig.iconClass.split(' ')[1]}`}>{selectedConfig.label}</span></div>
                    <div className="mt-5 flex items-start gap-3"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] ${selectedConfig.iconClass}`}><selectedNode.icon className="h-5 w-5" /></span><div className="min-w-0"><h2 className="break-words font-mono text-[15px] font-semibold text-white">{selectedNode.label}</h2><p className="mt-2 text-[12px] leading-[1.55] text-white/55">{selectedNode.description}</p></div></div>
                    <div className="mt-5 grid grid-cols-2 gap-2 border-t border-white/10 pt-4"><div><Kicker className="text-white/35">emits</Kicker><p className="mt-1 font-mono text-[10px] text-white/70">node_event</p></div><div><Kicker className="text-white/35">guardrail</Kicker><p className="mt-1 font-mono text-[10px] text-white/70">Zod / policy</p></div></div>
                  </div>
                  <div className="rounded-[16px] border border-[#ff9900]/25 bg-[#ff9900]/[0.09] p-5"><div className="flex items-center gap-2 text-[#ffb64c]"><Send className="h-4 w-4" /><Kicker className="text-[#ffb64c]">Run button → stream</Kicker></div><p className="mt-3 text-[12px] leading-[1.55] text-white/60">The route returns its <span className="font-mono text-white/90">runId</span> immediately. The Graph Runs panel listens to SSE and replays buffered events before staying live.</p><div className="mt-4 flex items-center gap-2 font-mono text-[10px] text-[#ffca7a]"><span className="rounded border border-[#ff9900]/30 px-2 py-1">/api/graph/runs/:runId/stream</span><ArrowUpRight className="h-3 w-3" /></div></div>
                  <div className="grid grid-cols-3 gap-2"><div className="rounded-[12px] border border-white/10 bg-white/[0.04] p-3"><Kicker className="text-white/35">transport</Kicker><p className="mt-1 font-mono text-[12px] text-white">SSE</p></div><div className="rounded-[12px] border border-white/10 bg-white/[0.04] p-3"><Kicker className="text-white/35">buses</Kicker><p className="mt-1 font-mono text-[12px] text-white">2 live</p></div><div className="rounded-[12px] border border-white/10 bg-white/[0.04] p-3"><Kicker className="text-white/35">retries</Kicker><p className="mt-1 font-mono text-[12px] text-white">3 max</p></div></div>
                </div>
              </div>
            </section>

            <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1.42fr)_minmax(320px,0.58fr)]">
              <section>
                <div className="mb-5 flex items-end justify-between gap-4"><div><Kicker className="text-[#146eb4]">Expanded trace</Kicker><h2 className="mt-1 font-display text-2xl font-semibold tracking-[-0.045em] text-[#172333]">What happens in each phase</h2></div><div className="hidden items-center gap-2 text-[10px] text-[#5c6672] md:flex"><span className="h-2 w-2 rounded-full bg-[#146eb4]" /> deterministic <span className="ml-2 h-2 w-2 rounded-full bg-[#6b43b5]" /> model <span className="ml-2 h-2 w-2 rounded-full bg-[#a85e00]" /> CLI</div></div>
                <div className="space-y-4">{PIPELINE_PHASES.map((phase) => <PhaseRail key={phase.number} phase={phase} selectedId={selectedNode.id} onSelect={setSelectedNode} />)}</div>
              </section>

              <aside className="space-y-5">
                <section className="rounded-[16px] border border-[#d6dde4] bg-white p-5 shadow-[0_5px_18px_rgba(35,47,62,0.04)]"><div className="flex items-center justify-between"><div><Kicker className="text-[#5c6672]">Exit logic</Kicker><h2 className="mt-1 font-display text-[20px] font-semibold tracking-[-0.04em] text-[#172333]">One route. Three endings.</h2></div><GitBranch className="h-5 w-5 text-[#146eb4]" /></div><div className="mt-5 space-y-3"><div className="flex gap-3 rounded-[11px] border border-[#bfe2cd] bg-[#f3fbf6] p-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#ddf3e7] text-[#037f51]"><Check className="h-4 w-4" /></span><div><p className="text-[12px] font-semibold text-[#037f51]">Success · savings realized</p><p className="mt-1 text-[11px] leading-[1.45] text-[#5c6672]">Verification passes and the realized improvement is computed.</p></div></div><div className="flex gap-3 rounded-[11px] border border-[#f3cf9d] bg-[#fffaf1] p-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#ffebc7] text-[#a85e00]"><LockKeyhole className="h-4 w-4" /></span><div><p className="text-[12px] font-semibold text-[#a85e00]">Skip · policy rejection</p><p className="mt-1 text-[11px] leading-[1.45] text-[#5c6672]">No apply. A failed gate converges straight into audit.</p></div></div><div className="flex gap-3 rounded-[11px] border border-[#efc2bb] bg-[#fff7f5] p-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#fdecea] text-[#d13212]"><RotateCcw className="h-4 w-4" /></span><div><p className="text-[12px] font-semibold text-[#d13212]">Rollback · verification failed</p><p className="mt-1 text-[11px] leading-[1.45] text-[#5c6672]">The change is reverted and a RollbackRecord is written.</p></div></div></div></section>

                <section className="rounded-[16px] border border-[#d6dde4] bg-[#eef5fb] p-5"><div className="flex items-center gap-2 text-[#146eb4]"><DatabaseZap className="h-4 w-4" /><Kicker className="text-[#146eb4]">Runtime contract</Kicker></div><p className="mt-3 text-[12px] leading-[1.6] text-[#405064]">The real graph is triggered from the Run button in Graph Terminal on dashboard, resources, and recommendations. This page’s schedules are stored in Postgres via /api/automations but don’t call the graph themselves.</p><div className="mt-4 flex items-center gap-2 font-mono text-[10px] text-[#146eb4]"><span className="rounded border border-[#9bc6ec] bg-white/60 px-2 py-1">globalThis event buses</span><span className="rounded border border-[#9bc6ec] bg-white/60 px-2 py-1">SSE replay</span></div></section>

                <section className="rounded-[16px] border border-[#d6dde4] bg-white p-5 shadow-[0_5px_18px_rgba(35,47,62,0.04)]"><div className="flex items-center justify-between"><div><Kicker className="text-[#5c6672]">Persistent ledger</Kicker><h2 className="mt-1 font-display text-[20px] font-semibold tracking-[-0.04em] text-[#172333]">What gets written down</h2></div><Layers3 className="h-5 w-5 text-[#4b5968]" /></div><div className="mt-4 overflow-hidden rounded-[10px] border border-[#e2e6eb]">{ledgerRows.map(([table, writtenBy, shape, state], index) => <div key={table} className={`grid grid-cols-[1fr_auto] gap-3 px-3 py-2.5 ${index !== ledgerRows.length - 1 ? 'border-b border-[#e9edf0]' : ''}`}><div><p className="font-mono text-[10px] font-semibold text-[#273749]">{table}</p><p className="mt-0.5 text-[10px] text-[#7b8792]">{writtenBy}</p></div><div className="text-right"><p className="font-mono text-[9px] text-[#146eb4]">{shape}</p><p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[#a0a9b3]">{state}</p></div></div>)}</div></section>
              </aside>
            </div>

            <section className="mt-10 border-t border-[#d6dde4] pt-8">
              <div className="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><div className="flex items-center gap-2"><Kicker className="text-[#ff9900]">Schedule registry</Kicker></div><h2 className="mt-1 font-display text-2xl font-semibold tracking-[-0.045em] text-[#172333]">Scheduled automations</h2><p className="mt-1 max-w-2xl text-[13px] text-[#5c6672]">Convenient cron-style rules for the workspace, persisted in Postgres. They do not call the graph; real agent runs appear in Graph Runs.</p></div><button type="button" onClick={openCreate} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[10px] bg-[#ff9900] px-4 py-2.5 text-[12px] font-semibold text-[#1e242b] transition-[transform,background-color] duration-150 hover:bg-[#f28b00] active:scale-[0.98]"><Plus className="h-4 w-4" /> Create rule</button></div>
              <div className="mb-5 grid grid-cols-2 gap-2 md:grid-cols-4"><div className="rounded-[12px] border border-[#d6dde4] bg-white p-3.5"><Kicker className="text-[#5c6672]">total rules</Kicker><p className="mt-1 font-display text-2xl font-semibold text-[#172333]">{automations.length}</p></div><div className="rounded-[12px] border border-[#bfe2cd] bg-[#f3fbf6] p-3.5"><Kicker className="text-[#037f51]">active</Kicker><p className="mt-1 font-display text-2xl font-semibold text-[#037f51]">{activeCount}</p></div><div className="rounded-[12px] border border-[#d6dde4] bg-white p-3.5"><Kicker className="text-[#5c6672]">paused</Kicker><p className="mt-1 font-display text-2xl font-semibold text-[#172333]">{pausedCount}</p></div><div className="rounded-[12px] border border-[#f0c3bb] bg-[#fff7f5] p-3.5"><Kicker className="text-[#d13212]">attention</Kicker><p className="mt-1 font-display text-2xl font-semibold text-[#d13212]">{errorCount}</p></div></div>
              {state === 'loading' ? <div className="rounded-[16px] border border-[#d6dde4] bg-white px-6 py-10"><ChartLoadingState heightClassName="h-32" /></div> : state === 'error' ? <div className="rounded-[16px] border border-[#d6dde4] bg-white px-6 py-10"><ChartErrorState message="Unable to load automations." onRetry={() => setRefreshToken((t) => t + 1)} heightClassName="h-32" /></div> : state === 'db_unavailable' ? <div className="rounded-[16px] border border-[#d6dde4] bg-white px-6 py-10"><ChartErrorState message="Database unavailable — automations require Postgres to be configured." heightClassName="h-32" /></div> : automations.length === 0 ? <div className="rounded-[16px] border border-dashed border-[#c4ccd5] bg-white px-6 py-14 text-center"><Zap className="mx-auto h-8 w-8 text-[#ff9900]" /><p className="mt-3 font-display text-lg font-semibold text-[#172333]">No schedules yet</p><p className="mt-1 text-[13px] text-[#5c6672]">Create a rule to document an operating habit.</p></div> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{automations.map((automation) => { const status = STATUS_CONFIG[automation.status]; const StatusIcon = status.icon; const isExpanded = expandedId === automation.id; return <article key={automation.id} className="group rounded-[16px] border border-[#d6dde4] bg-white p-4 shadow-[0_4px_14px_rgba(35,47,62,0.03)] transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-[#b7c4d0] hover:shadow-[0_10px_24px_rgba(35,47,62,0.07)]"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] ${status.bg}`}><Zap className={`h-4 w-4 ${status.color}`} /></div><div className="min-w-0"><h3 className="truncate font-display text-[15px] font-semibold tracking-[-0.025em] text-[#172333]">{automation.name}</h3><div className={`mt-1 flex items-center gap-1.5 text-[10px] font-medium ${status.color}`}><StatusIcon className="h-3.5 w-3.5" /> {status.label}</div></div></div><div className="flex shrink-0 items-center gap-0.5"><button type="button" onClick={() => toggleStatus(automation.id)} className="flex h-9 w-9 items-center justify-center rounded-[8px] text-[#7b8792] transition-colors hover:bg-[#f2f2f2] hover:text-[#037f51]" aria-label={automation.status === 'active' ? `Pause ${automation.name}` : `Resume ${automation.name}`}>{automation.status === 'active' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button><button type="button" onClick={() => openEdit(automation)} className="flex h-9 w-9 items-center justify-center rounded-[8px] text-[#7b8792] transition-colors hover:bg-[#f2f2f2] hover:text-[#172333]" aria-label={`Edit ${automation.name}`}><Edit2 className="h-4 w-4" /></button><button type="button" onClick={() => deleteAutomation(automation.id)} className="flex h-9 w-9 items-center justify-center rounded-[8px] text-[#7b8792] transition-colors hover:bg-[#fff0ed] hover:text-[#d13212]" aria-label={`Delete ${automation.name}`}><Trash2 className="h-4 w-4" /></button></div></div><p className="mt-3 min-h-[36px] text-[12px] leading-[1.5] text-[#5c6672]">{automation.description}</p><div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-[9px] bg-[#f5f8fa] px-2.5 py-2"><Kicker className="text-[#89939d]">trigger</Kicker><p className="mt-1 truncate font-mono text-[10px] text-[#405064]">{automation.trigger}</p></div><div className="rounded-[9px] bg-[#f5f8fa] px-2.5 py-2"><Kicker className="text-[#89939d]">runs</Kicker><p className="mt-1 font-mono text-[10px] text-[#405064]">{automation.runCount.toLocaleString()}</p></div></div>{isExpanded && <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[#e9edf0] pt-3"><div><Kicker className="text-[#89939d]">next run</Kicker><p className="mt-1 text-[11px] text-[#405064]">{formatRelativeTime(automation.nextRunAt, 'future') || 'Not scheduled'}</p></div><div><Kicker className="text-[#89939d]">action</Kicker><p className="mt-1 text-[11px] text-[#405064]">{automation.action}</p></div>{automation.status === 'error' && <div className="col-span-2 rounded-[8px] bg-[#fff0ed] px-2.5 py-2 text-[10px] text-[#d13212]">API connection failed · review this rule before resuming.</div>}</div>}<button type="button" onClick={() => setExpandedId(isExpanded ? null : automation.id)} className="mt-4 inline-flex min-h-[32px] items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[#146eb4] transition-colors hover:text-[#0b4f80]">{isExpanded ? 'Hide details' : 'View details'}<ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} /></button></article> })}</div>}
            </section>
          </div>
        </main>
      </div>

      {modalOpen && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0f1823]/45 px-4 py-6 backdrop-blur-[2px]"><div role="dialog" aria-modal="true" aria-labelledby="automation-dialog-title" className="w-full max-w-lg rounded-[18px] border border-[#d6dde4] bg-white shadow-[0_24px_70px_rgba(15,24,35,0.22)]"><div className="flex items-center justify-between border-b border-[#e4e8ec] px-5 py-4"><div><Kicker className="text-[#ff9900]">Local registry</Kicker><h2 id="automation-dialog-title" className="mt-1 font-display text-lg font-semibold text-[#172333]">{editingId ? 'Edit automation rule' : 'Create automation rule'}</h2></div><button type="button" onClick={() => setModalOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-[8px] text-[#7b8792] transition-colors hover:bg-[#f2f2f2]" aria-label="Close dialog"><X className="h-5 w-5" /></button></div><div className="space-y-4 px-5 py-5"><label className="block"><span className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5c6672]">Name</span><input autoFocus type="text" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Auto-terminate idle resources" className="h-11 w-full rounded-[9px] border border-[#c4ccd5] bg-white px-3 text-[13px] text-[#172333] placeholder:text-[#9aa4ae] focus:border-[#ff9900] focus:outline-none focus:ring-2 focus:ring-[#ff9900]/20" /></label><label className="block"><span className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5c6672]">Description</span><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What does this automation do?" className="h-24 w-full resize-none rounded-[9px] border border-[#c4ccd5] bg-white px-3 py-2.5 text-[13px] text-[#172333] placeholder:text-[#9aa4ae] focus:border-[#ff9900] focus:outline-none focus:ring-2 focus:ring-[#ff9900]/20" /></label><div className="grid gap-4 sm:grid-cols-2"><label className="block"><span className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5c6672]">Trigger</span><input type="text" value={form.trigger} onChange={(event) => setForm({ ...form, trigger: event.target.value })} placeholder="Daily at 2:00 AM UTC" className="h-11 w-full rounded-[9px] border border-[#c4ccd5] bg-white px-3 text-[13px] text-[#172333] placeholder:text-[#9aa4ae] focus:border-[#ff9900] focus:outline-none focus:ring-2 focus:ring-[#ff9900]/20" /></label><label className="block"><span className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5c6672]">Action</span><input type="text" value={form.action} onChange={(event) => setForm({ ...form, action: event.target.value })} placeholder="Terminate idle resources" className="h-11 w-full rounded-[9px] border border-[#c4ccd5] bg-white px-3 text-[13px] text-[#172333] placeholder:text-[#9aa4ae] focus:border-[#ff9900] focus:outline-none focus:ring-2 focus:ring-[#ff9900]/20" /></label></div></div><div className="flex items-center justify-end gap-2 border-t border-[#e4e8ec] px-5 py-4"><button type="button" onClick={() => setModalOpen(false)} className="min-h-[42px] rounded-[9px] px-4 text-[12px] font-medium text-[#5c6672] transition-colors hover:bg-[#f2f2f2]">Cancel</button><button type="button" onClick={submitForm} disabled={!form.name.trim()} className="inline-flex min-h-[42px] items-center gap-2 rounded-[9px] bg-[#ff9900] px-4 text-[12px] font-semibold text-[#1e242b] transition-[transform,background-color] duration-150 hover:bg-[#f28b00] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">{editingId ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{editingId ? 'Save changes' : 'Create rule'}</button></div></div></div>}
    </div>
  )
}
