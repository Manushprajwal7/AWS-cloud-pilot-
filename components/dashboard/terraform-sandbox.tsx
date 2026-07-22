'use client';

/**
 * Drives one real LangGraph run end-to-end (POST /api/graph/run, then the
 * SSE stream at /api/graph/runs/:runId/stream) and renders exactly what
 * came back — generated code, static security, per-step sandbox results,
 * risk/policy/approval, apply logs, correction history, verification,
 * rollback, and final anomaly resolution. Nothing here is a literal/mock
 * value: every field is either "not available yet" (before a run) or
 * sourced from a GraphState the server actually produced. There is no
 * approve/reject control — autoApprovalWorker's decision is final and
 * deterministic; this page only shows what it decided.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Square,
  Copy,
  Maximize2,
  BrainCircuit,
  Info,
  Sparkles,
  ClipboardList,
  GitBranch,
  Globe,
  Clock,
  ShieldAlert,
  ShieldCheck,
  RotateCcw,
  CheckCircle2,
  XCircle,
  FolderSearch,
  Server,
  Terminal,
  Zap,
  TrendingDown,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GraphPipelineRail } from '@/components/dashboard/graph-pipeline-rail';

type HclToken = { text: string; className: string };

function highlightHclLine(line: string): HclToken[] {
  const trimmed = line.trim();

  if (trimmed.startsWith('#')) {
    return [{ text: line, className: 'text-graphite italic' }];
  }

  const resourceMatch = line.match(/^(\s*)(resource)(\s+)("[^"]*")(\s+)("[^"]*")(\s*)(\{)?$/);
  if (resourceMatch) {
    const [, indent, keyword, sp1, type, sp2, name, sp3, brace] = resourceMatch;
    return [
      { text: indent, className: '' },
      { text: keyword, className: 'text-signal font-semibold' },
      { text: sp1, className: '' },
      { text: type, className: 'text-ok' },
      { text: sp2, className: '' },
      { text: name, className: 'text-ok' },
      { text: sp3, className: '' },
      { text: brace ?? '', className: 'text-ink' },
    ];
  }

  const attrMatch = line.match(/^(\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*)(=)(\s*)(.+)$/);
  if (attrMatch) {
    const [, indent, key, sp1, eq, sp2, rawValue] = attrMatch;
    const braceSuffix = rawValue.match(/^(.*?)(\s*\{)?$/);
    const valueBody = braceSuffix ? braceSuffix[1] : rawValue;
    const brace = braceSuffix?.[2] ?? '';

    let valueClass = 'text-ink';
    if (/^".*"$/.test(valueBody)) valueClass = 'text-ok'
    else if (/^(true|false)$/.test(valueBody)) valueClass = 'text-signal'
    else if (/^-?\d+(\.\d+)?$/.test(valueBody)) valueClass = 'text-signal'
    else if (/^var\./.test(valueBody)) valueClass = 'text-info'

    return [
      { text: indent, className: '' },
      { text: key, className: 'text-info' },
      { text: sp1, className: '' },
      { text: eq, className: 'text-graphite' },
      { text: sp2, className: '' },
      { text: valueBody, className: valueClass },
      { text: brace, className: 'text-ink' },
    ];
  }

  return [{ text: line, className: 'text-ink' }];
}

interface ExecutionLogLine {
  time: string;
  message: string;
  status: 'completed' | 'in-progress' | 'error';
}

type RunStatus = 'idle' | 'running' | 'completed' | 'rejected' | 'failed' | 'applied' | 'rolled_back';

const NODE_LABELS: Record<string, string> = {
  monitor: 'Reading live resource metrics',
  detectAnomaly: 'Evaluating anomaly rules',
  diagnose: 'Diagnosing root cause',
  calculateImpact: 'Calculating financial impact',
  planRemediation: 'Planning remediation',
  terraformGenerate: 'Generating Terraform',
  staticSecurity: 'Running static security policies',
  terraformFormat: 'terraform fmt -check',
  terraformInit: 'terraform init',
  terraformValidate: 'terraform validate',
  selfCorrection: 'selfCorrectionAgent',
  terraformPlan: 'terraform plan',
  planPolicy: 'Analyzing plan risk',
  autoApproval: 'Evaluating auto-approval policy',
  terraformApply: 'terraform apply',
  verification: 'Verifying remediation outcome',
  rollback: 'Rolling back to previous snapshot',
  calculateRealizedSavings: 'Calculating realized savings',
  audit: 'Recording audit trail',
};

const SCENARIOS = ['NORMAL', 'CPU_SPIKE', 'IDLE_RESOURCE', 'MEMORY_LEAK', 'OVERPROVISIONED', 'COST_SPIKE', 'TRAFFIC_SURGE'] as const;
const DEFAULT_RESOURCE_ID = 'res-ec2-prod-01';

interface SandboxCommandResult {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
}

interface CheckResult {
  name: string;
  passed: boolean;
  details: string;
}

interface SandboxResourceOption {
  id: string;
  name: string;
  service: string;
  environment: string;
  region: string;
  configuration?: { instanceType?: string };
}

const TIMELINE_TONE: Record<'ok' | 'danger' | 'warn' | 'info', { dot: string; ring: string; icon: string }> = {
  ok: { dot: 'bg-ok', ring: 'ring-ok/20', icon: 'text-ok' },
  danger: { dot: 'bg-danger', ring: 'ring-danger/20', icon: 'text-danger' },
  warn: { dot: 'bg-warn', ring: 'ring-warn/20', icon: 'text-warn' },
  info: { dot: 'bg-info', ring: 'ring-info/20', icon: 'text-info' },
};

/** One row of the Decision Trail — a connected vertical timeline of every real gate a plan passed through, in order. */
function TimelineRow({
  tone,
  icon: Icon,
  last = false,
  children,
}: {
  tone: 'ok' | 'danger' | 'warn' | 'info';
  icon: LucideIcon;
  last?: boolean;
  children: React.ReactNode;
}) {
  const style = TIMELINE_TONE[tone];
  return (
    <div className="relative flex gap-3.5 pl-0.5">
      <div className="relative flex flex-shrink-0 flex-col items-center">
        <span className={`flex h-6 w-6 items-center justify-center rounded-full ring-4 ${style.ring} bg-panel`}>
          <Icon className={`h-3.5 w-3.5 ${style.icon}`} strokeWidth={2} />
        </span>
        {!last && <span className="mt-1 w-px flex-1 bg-hairline" aria-hidden="true" />}
      </div>
      <div className="min-w-0 flex-1 pb-1">{children}</div>
    </div>
  );
}

export function TerraformSandbox() {
  const [resourceId, setResourceId] = useState(DEFAULT_RESOURCE_ID);
  const [availableResources, setAvailableResources] = useState<SandboxResourceOption[]>([]);
  const [resourcesLoadError, setResourcesLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<RunStatus>('idle');
  const [logs, setLogs] = useState<ExecutionLogLine[]>([]);
  const [finalState, setFinalState] = useState<Record<string, unknown> | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [completedAt, setCompletedAt] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [streamingHcl, setStreamingHcl] = useState('');
  const [scenario, setScenario] = useState<(typeof SCENARIOS)[number]>('CPU_SPIKE');
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [resourceDetails, setResourceDetails] = useState<Record<string, unknown> | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadResources(): Promise<void> {
      try {
        const response = await fetch('/api/simulation/resources');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const resources = (data.resources ?? []) as SandboxResourceOption[];
        if (cancelled) return;
        setAvailableResources(resources);
        if (resources.length > 0 && !resources.some((r) => r.id === resourceId)) {
          setResourceId(resources[0].id);
        }
      } catch (error) {
        if (!cancelled) setResourcesLoadError(error instanceof Error ? error.message : 'Unknown error');
      }
    }
    void loadResources();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resourcesByService = availableResources.reduce<Record<string, SandboxResourceOption[]>>((acc, resource) => {
    (acc[resource.service] ??= []).push(resource);
    return acc;
  }, {});
  const selectedResourceOption = availableResources.find((r) => r.id === resourceId);

  function toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void containerRef.current?.requestFullscreen();
    }
  }

  function pushLog(message: string, logStatus: ExecutionLogLine['status'] = 'completed'): void {
    setLogs((prev) => [...prev, { time: new Date().toLocaleTimeString(), message, status: logStatus }]);
  }

  async function runSandbox(): Promise<void> {
    if (status === 'running') return;
    setStatus('running');
    setLogs([]);
    setFinalState(null);
    setErrorMessage(null);
    setCompletedAt(null);
    setRunId(null);
    setStreamingHcl('');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const startResponse = await fetch('/api/graph/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resourceId }),
        signal: controller.signal,
      });

      if (!startResponse.ok) {
        const body = await startResponse.json().catch(() => ({ error: startResponse.statusText }));
        throw new Error(body.error || `Failed to start run: HTTP ${startResponse.status}`);
      }

      const { runId: startedRunId } = (await startResponse.json()) as { runId: string };
      setRunId(startedRunId);
      pushLog(`Run started (${startedRunId})`);

      const streamResponse = await fetch(`/api/graph/runs/${startedRunId}/stream`, { signal: controller.signal });
      if (!streamResponse.ok || !streamResponse.body) {
        throw new Error(`Stream responded with HTTP ${streamResponse.status}`);
      }

      const reader = streamResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith('data:')) continue;

          const event = JSON.parse(line.slice('data:'.length).trim());

          if (event.type === 'node_event') {
            const label = NODE_LABELS[event.record.node] ?? event.record.node;
            pushLog(
              `${label}${event.record.error ? ` — ${event.record.error}` : ''}`,
              event.record.status === 'failed' ? 'error' : 'completed',
            );
          } else if (event.type === 'command_output' && event.node === 'terraformGenerate') {
            setStreamingHcl((prev) => prev + String(event.chunk));
          } else if (event.type === 'command_output') {
            const nodeLabel = NODE_LABELS[event.node] ?? event.node;
            for (const outLine of String(event.chunk).split('\n').filter(Boolean)) {
              pushLog(`[${nodeLabel}] ${outLine}`, event.stream === 'stderr' ? 'error' : 'in-progress');
            }
          } else if (event.type === 'run_completed') {
            setFinalState(event.finalState);
            setCompletedAt(new Date().toLocaleString());
            const s = event.finalState.status;
            setStatus(s === 'rejected' || s === 'failed' || s === 'applied' || s === 'rolled_back' ? s : 'completed');
            return;
          } else if (event.type === 'run_failed') {
            setErrorMessage(event.error);
            setStatus('failed');
            return;
          }
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setErrorMessage(error instanceof Error ? error.message : 'Unknown error');
      setStatus('failed');
    }
  }

  function stopSandbox(): void {
    abortRef.current?.abort();
    setStatus('idle');
    pushLog('Run cancelled by user', 'error');
  }

  async function startScenario(): Promise<void> {
    setActionMessage(null);
    try {
      const response = await fetch('/api/simulation/scenario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // instant: true — the sandbox's next step is "Trigger Graph Run",
        // which reads the resource right away. Without this the tick engine
        // only ramps metrics gradually, so an immediate run can still see
        // stale metrics/anomalies from whatever scenario ran before.
        body: JSON.stringify({ resourceId, scenario, instant: true }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      setActionMessage(`Scenario '${scenario}' activated on ${resourceId}`);
    } catch (error) {
      setActionMessage(`Failed to start scenario: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async function resetSimulation(): Promise<void> {
    setActionMessage(null);
    try {
      const response = await fetch('/api/simulation/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resourceId }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      setActionMessage(`${resourceId} reset to its seed state`);
    } catch (error) {
      setActionMessage(`Failed to reset: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async function openResourceDetails(): Promise<void> {
    setDetailsError(null);
    setResourceDetails(null);
    try {
      const response = await fetch(`/api/simulation/resources/${resourceId}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setResourceDetails(data.resource ?? data);
    } catch (error) {
      setDetailsError(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  const artifact = finalState?.terraformArtifact as { hcl: string; checksum: string } | null | undefined;
  const security = finalState?.securityValidation as { passed: boolean; findings: { policyName: string; severity: string; message: string }[] } | null | undefined;
  const planSummary = finalState?.planSummary as { creates: number; updates: number; deletes: number; noOps: number } | null | undefined;
  const resource = finalState?.resource as { cost: { dailyUsd: number; projectedMonthlyUsd: number }; environment: string; region: string } | null | undefined;
  const remediationPlan = finalState?.remediationPlan as { expectedMonthlySavingsUsd: number | null; action: string; rationale: string } | null | undefined;
  const approvalDecision = finalState?.approvalDecision as
    | { decision: 'approved' | 'rejected'; reason: string; analysis: { riskScore: number; violations: string[] } }
    | null
    | undefined;
  const correctionAttempts = typeof finalState?.correctionAttempts === 'number' ? finalState.correctionAttempts : 0;
  const applySucceeded = Boolean(finalState?.applySucceeded);
  const sandboxResults = (finalState?.sandboxCommandResults as SandboxCommandResult[] | undefined) ?? [];
  const verificationResult = finalState?.verificationResult as { passed: boolean; checks: CheckResult[] } | null | undefined;
  const rollbackResult = finalState?.rollbackResult as { rolledBack: boolean; reason: string } | null | undefined;
  const realizedSavingsUsd = typeof finalState?.realizedSavingsUsd === 'number' ? finalState.realizedSavingsUsd : null;

  function lastResultFor(command: string): SandboxCommandResult | undefined {
    return [...sandboxResults].reverse().find((r) => r.command === command);
  }

  const displayHcl = artifact?.hcl ?? (streamingHcl || null);
  const codeLines = displayHcl ? displayHcl.split('\n') : [];

  const currentDaily = resource?.cost.dailyUsd ?? null;
  const savingsMonthly = remediationPlan?.expectedMonthlySavingsUsd ?? null;
  const savingsDaily = savingsMonthly !== null ? savingsMonthly / 30.4 : null;
  const afterDaily = currentDaily !== null && savingsDaily !== null ? Math.max(0, currentDaily - savingsDaily) : null;
  const savingsPercent = currentDaily && savingsDaily !== null && currentDaily > 0 ? Math.round((savingsDaily / currentDaily) * 100) : null;

  // A completed run with no Terraform template for its action (most commonly
  // NO_ACTION — no anomaly found, or the anomaly type/action isn't something
  // Terraform can remediate) is a legitimate, finished outcome, not a stuck
  // or failed run. "Plan ready" would be actively misleading here since no
  // plan exists; the Generated Terraform panel is correctly empty below.
  const noRemediationNeeded = status === 'completed' && !artifact && remediationPlan?.action === 'NO_ACTION';

  // Which Decision Trail rows actually render, in display order — used so
  // the connecting timeline line stops after whichever row is genuinely
  // last for this run, instead of always assuming rollback is last.
  const timelineRows: boolean[] = [
    Boolean(security),
    sandboxResults.length > 0,
    correctionAttempts > 0,
    Boolean(approvalDecision),
    Boolean(verificationResult),
    Boolean(rollbackResult?.rolledBack),
  ];
  const lastTimelineRowIndex = timelineRows.lastIndexOf(true);

  const statusLabel: Record<RunStatus, string> = {
    idle: 'Idle',
    running: 'Running',
    completed: noRemediationNeeded ? 'No action needed' : 'Plan ready',
    rejected: 'Rejected by policy',
    failed: 'Failed',
    applied: 'Applied',
    rolled_back: 'Rolled back',
  };

  const statusColor: Record<RunStatus, string> = {
    idle: 'bg-hairline',
    running: 'bg-signal',
    completed: 'bg-ok',
    rejected: 'bg-danger',
    failed: 'bg-danger',
    applied: 'bg-info',
    rolled_back: 'bg-warn',
  };

  const sandboxSteps: { command: string; label: string }[] = [
    { command: 'fmt', label: 'fmt' },
    { command: 'init', label: 'init' },
    { command: 'validate', label: 'validate' },
    { command: 'plan', label: 'plan' },
    { command: 'apply', label: 'apply' },
  ];

  return (
    <div ref={containerRef} className="space-y-5 bg-paper [&:fullscreen]:overflow-y-auto [&:fullscreen]:p-6">
      {/* Command bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border border-hairline bg-navy px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-sm bg-signal">
            <Terminal className="h-5 w-5 text-navy" strokeWidth={2} />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold text-white">Agentic Sandbox</h2>
            <p className="text-[10px] font-mono uppercase tracking-wider text-white/50">LangGraph remediation runtime · terraform console</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {selectedResourceOption && (
            <span className="hidden items-center gap-1.5 rounded-sm border border-white/15 bg-white/5 px-2.5 py-1.5 text-[11px] font-mono text-white/70 sm:flex">
              <Server className="h-3 w-3" strokeWidth={1.75} />
              {selectedResourceOption.name} · {selectedResourceOption.region}
            </span>
          )}
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${statusColor[status]} ${status === 'running' ? 'animate-pulse' : ''}`} />
            <div>
              <div className="text-[13px] font-semibold text-white">{statusLabel[status]}</div>
              <div className="text-[10px] text-white/45 font-mono">approval + apply run automatically</div>
            </div>
          </div>
          <Button variant="outline" size="sm" className="border-white/20 bg-transparent px-2.5 text-white/70 hover:bg-white/10 hover:text-white rounded-sm" onClick={toggleFullscreen} title="Toggle fullscreen">
            <Maximize2 className="h-4 w-4" strokeWidth={1.75} />
          </Button>
        </div>
      </div>

      {/* Signature: the live pipeline rail */}
      <GraphPipelineRail runId={runId} />

      {/* Finding banner */}
      <div className="flex gap-3 border-l-2 border-signal bg-signal-soft px-5 py-3.5">
        <BrainCircuit className="h-4 w-4 flex-shrink-0 text-signal mt-0.5" strokeWidth={1.75} />
        <div className="min-w-0">
          {finalState?.anomaly ? (
            <>
              <p className="font-semibold text-ink text-[13px]">
                Detected {String((finalState.anomaly as { type: string }).type).replace(/_/g, ' ').toLowerCase()} on {resourceId}
              </p>
              <p className="mt-0.5 text-[13px] text-graphite">
                {(finalState.diagnosis as { explanation?: string } | undefined)?.explanation ?? 'Generating remediation plan…'}
              </p>
            </>
          ) : (
            <p className="text-[13px] text-ink">Run the pipeline against a resource below to generate and evaluate a Terraform plan.</p>
          )}
        </div>
      </div>

      {/* Resource / scenario control strip */}
      <div className="flex flex-wrap items-center gap-2 border border-hairline bg-panel px-5 py-3.5">
        <span className="text-[10px] font-mono uppercase tracking-wider text-graphite mr-1">Target</span>
        {availableResources.length > 0 ? (
          <select
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
            disabled={status === 'running'}
            className="rounded-sm border border-hairline bg-subtle px-3 py-1.5 text-[13px] font-mono text-ink disabled:opacity-50 max-w-[280px]"
          >
            {Object.entries(resourcesByService).map(([service, resources]) => (
              <optgroup key={service} label={service}>
                {resources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {r.environment} · {r.configuration?.instanceType ?? r.id}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        ) : (
          <input
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
            disabled={status === 'running'}
            className="rounded-sm border border-hairline bg-subtle px-3 py-1.5 text-[13px] font-mono text-ink disabled:opacity-50"
            placeholder="res-ec2-prod-01"
          />
        )}
        {selectedResourceOption && (
          <span className="flex items-center gap-1.5 rounded-sm border border-hairline bg-subtle px-2.5 py-1 text-[10px] font-mono font-medium text-graphite">
            <Server className="h-3 w-3" strokeWidth={1.75} />
            {selectedResourceOption.service} · {selectedResourceOption.region}
          </span>
        )}

        <span className="mx-1 h-5 w-px bg-hairline" aria-hidden="true" />

        <span className="text-[10px] font-mono uppercase tracking-wider text-graphite mr-1">Inject scenario</span>
        <select
          value={scenario}
          onChange={(e) => setScenario(e.target.value as (typeof SCENARIOS)[number])}
          className="rounded-sm border border-hairline bg-subtle px-2 py-1.5 text-[13px] font-mono text-ink"
          title="Scenario to inject on the selected resource before the next run"
        >
          {SCENARIOS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Button variant="outline" size="sm" className="gap-1.5 rounded-sm border-hairline" onClick={startScenario}>
          <Zap className="h-3.5 w-3.5" strokeWidth={1.75} />
          Start Scenario
        </Button>
        <Button variant="outline" size="sm" onClick={resetSimulation} className="gap-1.5 rounded-sm border-hairline">
          <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
          Reset
        </Button>
        <Button variant="outline" size="sm" onClick={openResourceDetails} className="gap-1.5 rounded-sm border-hairline">
          <FolderSearch className="h-3.5 w-3.5" strokeWidth={1.75} />
          Resource Details
        </Button>

        {resourcesLoadError && (
          <p className="w-full text-[12px] text-danger font-mono">Failed to load resource list: {resourcesLoadError} — falling back to manual ID entry.</p>
        )}
        {actionMessage && <p className="w-full text-[12px] text-graphite font-mono">{actionMessage}</p>}
        {resourceDetails && (
          <pre className="max-h-48 w-full overflow-auto rounded-sm bg-subtle border border-hairline p-3 text-[11px] font-mono text-ink">
            {JSON.stringify(resourceDetails, null, 2)}
          </pre>
        )}
        {detailsError && <p className="w-full text-[12px] text-danger">Failed to load resource details: {detailsError}</p>}
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Left Column - Terraform Code */}
        <div className="col-span-12 lg:col-span-7 space-y-4">
          <div className="border border-hairline bg-panel shadow-sm">
            <div className="flex items-center justify-between px-4 pt-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-graphite">Generated Terraform</span>
                <span className="text-[10px] text-graphite">(Read-only)</span>
                <Info className="h-3.5 w-3.5 text-graphite" strokeWidth={1.75} />
              </div>
              <span className="flex items-center gap-1.5 rounded-sm border border-signal/25 bg-signal-soft px-2.5 py-1 text-[10px] font-mono font-medium text-signal">
                <Sparkles className="h-3 w-3" strokeWidth={1.75} />
                terraformGenerationAgent
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
              <span className="text-[11px] text-graphite font-mono">
                {artifact ? `sha256:${artifact.checksum.slice(0, 16)}…` : displayHcl ? 'streaming from Groq…' : 'no artifact yet'}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-graphite hover:text-ink rounded-sm"
                disabled={!displayHcl}
                onClick={() => displayHcl && navigator.clipboard.writeText(displayHcl)}
              >
                <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                Copy
              </Button>
            </div>

            {/* Code Editor */}
            <div className="overflow-hidden bg-subtle font-mono text-[13px] border-t border-hairline">
              <div className="max-h-80 overflow-auto">
                {displayHcl ? (
                  <div className="relative flex">
                    <div className="select-none border-r border-hairline bg-panel px-3 py-4 text-right text-graphite/60">
                      {codeLines.map((_, i) => (
                        <div key={i} className="leading-6">
                          {i + 1}
                        </div>
                      ))}
                    </div>
                    <pre className="flex-1 overflow-auto px-4 py-4">
                      <code>
                        {codeLines.map((line, i) => (
                          <div key={i} className="leading-6 whitespace-pre">
                            {highlightHclLine(line).map((token, j) => (
                              <span key={j} className={token.className}>
                                {token.text}
                              </span>
                            ))}
                            {line.length === 0 && ' '}
                          </div>
                        ))}
                      </code>
                    </pre>
                  </div>
                ) : (
                  <div className="p-6 text-center text-[13px] text-graphite">
                    {status === 'running' ? (
                      'Waiting for terraformGenerationAgent to produce code…'
                    ) : noRemediationNeeded ? (
                      <>
                        <p className="font-medium text-ink">No Terraform change generated — planningAgent recommended NO_ACTION.</p>
                        {remediationPlan?.rationale && <p className="mt-1">{remediationPlan.rationale}</p>}
                      </>
                    ) : (
                      'No Terraform code generated yet. Run the pipeline.'
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Decision trail — every real gate this plan passed through, in order */}
          {(security || sandboxResults.length > 0 || correctionAttempts > 0 || approvalDecision || verificationResult || rollbackResult?.rolledBack) && (
            <div className="border border-hairline bg-panel shadow-sm px-6 py-5">
              <div className="mb-4 text-[10px] font-mono uppercase tracking-wider text-graphite">Decision Trail</div>
              <div className="space-y-5">
                {security && (
                  <TimelineRow tone={security.passed ? 'ok' : 'danger'} icon={security.passed ? ShieldCheck : ShieldAlert} last={lastTimelineRowIndex === 0}>
                    <p className="font-semibold text-ink text-[13px]">
                      staticSecurityWorker: {security.passed ? 'policies passed' : `rejected (${security.findings.length} finding${security.findings.length === 1 ? '' : 's'})`}
                    </p>
                    {!security.passed && (
                      <ul className="mt-1.5 space-y-1 text-[11px] font-mono text-graphite">
                        {security.findings.map((finding, idx) => (
                          <li key={idx}>[{finding.severity}] {finding.policyName}: {finding.message}</li>
                        ))}
                      </ul>
                    )}
                  </TimelineRow>
                )}

                {sandboxResults.length > 0 && (
                  <TimelineRow tone="info" icon={ClipboardList} last={lastTimelineRowIndex === 1}>
                    <p className="font-semibold text-ink text-[13px]">Sandbox execution</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {sandboxSteps.map(({ command, label }) => {
                        const result = lastResultFor(command);
                        if (!result) return null;
                        const ok = result.exitCode === 0;
                        return (
                          <span key={command} className={`flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-[11px] font-mono font-medium ${ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>
                            {ok ? <CheckCircle2 className="h-3 w-3" strokeWidth={1.75} /> : <XCircle className="h-3 w-3" strokeWidth={1.75} />}
                            {label} (exit {result.exitCode ?? 'n/a'}{result.timedOut ? ', timed out' : ''})
                          </span>
                        );
                      })}
                    </div>
                  </TimelineRow>
                )}

                {correctionAttempts > 0 && (
                  <TimelineRow tone="warn" icon={RotateCcw} last={lastTimelineRowIndex === 2}>
                    <p className="font-semibold text-ink text-[13px]">
                      selfCorrectionAgent ran {correctionAttempts} time{correctionAttempts === 1 ? '' : 's'} <span className="font-normal text-graphite">(max 3 per run)</span>
                    </p>
                    <p className="mt-1 text-[12px] text-graphite">See the execution terminal for each attempt&apos;s strategy, hashes, and result.</p>
                  </TimelineRow>
                )}

                {approvalDecision && (
                  <TimelineRow tone={approvalDecision.decision === 'approved' ? 'ok' : 'danger'} icon={approvalDecision.decision === 'approved' ? ShieldCheck : ShieldAlert} last={lastTimelineRowIndex === 3}>
                    <p className="font-semibold text-ink text-[13px]">
                      autoApprovalWorker: {approvalDecision.decision} <span className="font-normal text-graphite">(risk score {approvalDecision.analysis.riskScore}/100)</span>
                    </p>
                    <p className="mt-1 text-graphite font-mono text-[11px]">{approvalDecision.reason}</p>
                    {approvalDecision.analysis.violations.length > 0 && (
                      <ul className="mt-1.5 space-y-1 text-[11px] font-mono text-graphite">
                        {approvalDecision.analysis.violations.map((v, idx) => (
                          <li key={idx}>• {v}</li>
                        ))}
                      </ul>
                    )}
                    {applySucceeded && <p className="mt-1.5 text-[12px] font-semibold text-info">terraformApplyWorker: apply succeeded</p>}
                  </TimelineRow>
                )}

                {verificationResult && (
                  <TimelineRow tone={verificationResult.passed ? 'ok' : 'danger'} icon={verificationResult.passed ? ShieldCheck : ShieldAlert} last={lastTimelineRowIndex === 4}>
                    <p className="font-semibold text-ink text-[13px]">
                      verificationWorker: {verificationResult.passed ? 'all checks passed' : 'one or more checks failed'}
                    </p>
                    <ul className="mt-1.5 space-y-1 text-[11px] font-mono">
                      {verificationResult.checks.map((check, idx) => (
                        <li key={idx} className={`flex items-center gap-1.5 ${check.passed ? 'text-graphite' : 'text-danger'}`}>
                          {check.passed ? <CheckCircle2 className="h-3 w-3 text-ok flex-shrink-0" strokeWidth={1.75} /> : <XCircle className="h-3 w-3 text-danger flex-shrink-0" strokeWidth={1.75} />}
                          {check.name}: {check.details}
                        </li>
                      ))}
                    </ul>
                  </TimelineRow>
                )}

                {rollbackResult?.rolledBack && (
                  <TimelineRow tone="warn" icon={RotateCcw} last={lastTimelineRowIndex === 5}>
                    <p className="font-semibold text-ink text-[13px]">rollbackWorker: restored the exact pre-apply snapshot</p>
                    <p className="mt-1 text-graphite font-mono text-[11px]">{rollbackResult.reason}</p>
                  </TimelineRow>
                )}
              </div>
            </div>
          )}

          {/* Metadata Footer */}
          <div className="border border-hairline bg-panel shadow-sm px-6 py-4">
            <div className="grid grid-cols-4 gap-4 text-[11px]">
              <div>
                <div className="flex items-center gap-1.5 font-mono uppercase tracking-wider text-graphite">
                  <ClipboardList className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Plan
                </div>
                <div className="mt-1 font-mono font-medium text-info">
                  {planSummary ? `+${planSummary.creates} ~${planSummary.updates} -${planSummary.deletes}` : '—'}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 font-mono uppercase tracking-wider text-graphite">
                  <GitBranch className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Environment
                </div>
                <div className="mt-1">
                  {resource ? (
                    <span className="inline-block border border-hairline bg-subtle px-2 py-0.5 text-ink font-mono">{resource.environment}</span>
                  ) : (
                    '—'
                  )}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 font-mono uppercase tracking-wider text-graphite">
                  <Globe className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Region
                </div>
                <div className="mt-1 font-mono font-medium text-info">{resource?.region ?? '—'}</div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 font-mono uppercase tracking-wider text-graphite">
                  <Clock className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Completed
                </div>
                <div className="mt-1 font-mono font-medium text-ink">{completedAt ?? '—'}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="col-span-12 lg:col-span-5 space-y-4">
          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <Button onClick={runSandbox} disabled={status === 'running'} className="gap-2 bg-signal hover:bg-signal/90 text-ink font-semibold rounded-sm uppercase text-[12px] tracking-wide font-mono">
              <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
              Trigger Graph Run
            </Button>
            <Button onClick={stopSandbox} disabled={status !== 'running'} className="gap-2 bg-panel border border-hairline hover:bg-subtle text-ink rounded-sm uppercase text-[12px] tracking-wide font-mono">
              <Square className="h-3.5 w-3.5" strokeWidth={1.75} />
              Stop
            </Button>
          </div>

          {errorMessage && (
            <div className="border-l-2 border-danger bg-danger-soft px-4 py-3 text-[13px] text-danger">{errorMessage}</div>
          )}

          {/* Cost Impact Section */}
          <div className="border border-hairline bg-panel shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-3.5 w-3.5 text-graphite" strokeWidth={1.75} />
                <h3 className="text-[10px] font-mono uppercase tracking-wider text-graphite">Cost Impact</h3>
                <span className="text-[11px] text-graphite font-mono">({remediationPlan ? remediationPlan.action : 'no plan yet'})</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-sm border border-hairline bg-hairline">
              <div className="bg-panel p-4">
                <div className="text-[10px] font-mono uppercase tracking-wider text-graphite">Current</div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-xl font-display font-semibold text-ink tabular-nums">{currentDaily !== null ? `$${currentDaily.toFixed(0)}` : '—'}</span>
                  <span className="text-[12px] text-graphite font-mono">/day</span>
                </div>
              </div>

              <div className="bg-ok-soft p-4">
                <div className="text-[10px] font-mono uppercase tracking-wider text-graphite">Projected</div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-xl font-display font-semibold text-ok tabular-nums">{afterDaily !== null ? `$${afterDaily.toFixed(0)}` : '—'}</span>
                  <span className="text-[12px] text-graphite font-mono">/day</span>
                </div>
              </div>

              <div className="bg-signal-soft p-4">
                <div className="text-[10px] font-mono uppercase tracking-wider text-graphite">Savings</div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-xl font-display font-semibold text-signal tabular-nums">{savingsDaily !== null ? `$${savingsDaily.toFixed(0)}` : '—'}</span>
                  <span className="text-[12px] text-graphite font-mono">/day</span>
                </div>
                <div className="mt-1 text-[11px] text-graphite font-mono">{savingsPercent !== null ? `(${savingsPercent}%)` : ''}</div>
              </div>
            </div>

            {savingsPercent !== null && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-ink">Cost reduction</span>
                  <span className="text-[12px] font-mono font-bold text-signal">{savingsPercent}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-hairline">
                  <div className="h-1.5 rounded-full bg-signal transition-[width] duration-500" style={{ width: `${Math.min(100, savingsPercent)}%` }} />
                </div>
              </div>
            )}

            {realizedSavingsUsd !== null && (
              <div className="flex items-center gap-2 border-l-2 border-info bg-info-soft p-3 text-[13px]">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-info" strokeWidth={1.75} />
                <span className="text-ink">Realized monthly savings: <span className="font-mono font-bold text-info">${realizedSavingsUsd.toFixed(2)}</span></span>
              </div>
            )}
          </div>

          {/* Execution Terminal */}
          <div className="border border-hairline bg-navy shadow-sm">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-danger/70" />
                  <span className="h-2 w-2 rounded-full bg-warn/70" />
                  <span className="h-2 w-2 rounded-full bg-ok/70" />
                </div>
                <span className="ml-2 text-[10px] font-mono uppercase tracking-wider text-white/50">terraform · stdout/stderr</span>
                {status === 'running' && (
                  <span className="flex items-center gap-1 text-[10px] font-mono text-signal">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal" /> live
                  </span>
                )}
              </div>
              <button onClick={() => setLogs([])} className="text-[11px] font-mono font-medium text-white/50 hover:text-white transition-colors">
                Clear
              </button>
            </div>

            <div className="max-h-64 overflow-auto p-4 font-mono text-[11px] leading-relaxed">
              {logs.length === 0 ? (
                <div className="py-8 text-center text-white/35">No logs yet — trigger a run to see real terraform output here.</div>
              ) : (
                logs.map((log, idx) => (
                  <div key={idx} className="flex gap-2 py-0.5">
                    <span className="flex-shrink-0 text-white/35">{log.time}</span>
                    <span className={log.status === 'error' ? 'text-danger' : log.status === 'in-progress' ? 'text-white/80' : 'text-ok'}>{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
