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

import React, { useRef, useState } from 'react';
import {
  Play,
  Square,
  Copy,
  Maximize2,
  Package,
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GraphVisualizer } from '@/components/graph-visualizer';

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

export function TerraformSandbox() {
  const [resourceId, setResourceId] = useState(DEFAULT_RESOURCE_ID);
  const [status, setStatus] = useState<RunStatus>('idle');
  const [logs, setLogs] = useState<ExecutionLogLine[]>([]);
  const [finalState, setFinalState] = useState<Record<string, unknown> | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [completedAt, setCompletedAt] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [scenario, setScenario] = useState<(typeof SCENARIOS)[number]>('CPU_SPIKE');
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [resourceDetails, setResourceDetails] = useState<Record<string, unknown> | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

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

  const codeLines = artifact ? artifact.hcl.split('\n') : [];

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
    <div ref={containerRef} className="space-y-4 bg-paper [&:fullscreen]:overflow-y-auto [&:fullscreen]:p-6">
      {/* Title Bar */}
      <div className="flex items-center justify-between border border-hairline bg-panel px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-sm bg-signal">
            <Package className="h-5 w-5 text-white" strokeWidth={1.75} />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold text-ink">Agentic Sandbox — Terraform Console</h2>
            <p className="text-[10px] font-mono uppercase tracking-wider text-graphite">LangGraph remediation runtime</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${statusColor[status]}`} />
            <div>
              <div className="text-[13px] font-semibold text-ink">{statusLabel[status]}</div>
              <div className="text-[11px] text-graphite font-mono">Approval and apply run automatically — no manual step</div>
            </div>
          </div>
          <Button variant="outline" size="sm" className="px-2.5 rounded-sm border-hairline" onClick={toggleFullscreen} title="Toggle fullscreen">
            <Maximize2 className="h-4 w-4 text-graphite" strokeWidth={1.75} />
          </Button>
        </div>
      </div>

      {/* Resource picker / scenario controls / issue banner */}
      <div className="border border-signal/25 bg-signal-soft px-6 py-4 space-y-3">
        <div className="flex gap-3">
          <div className="flex-shrink-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-sm bg-panel border border-signal/25">
              <BrainCircuit className="h-5 w-5 text-signal" strokeWidth={1.75} />
            </div>
          </div>
          <div className="flex-1">
            {finalState?.anomaly ? (
              <>
                <p className="font-semibold text-ink text-[13px]">
                  Detected {String((finalState.anomaly as { type: string }).type)} on {resourceId}.
                </p>
                <p className="mt-1 text-[13px] text-graphite">
                  {(finalState.diagnosis as { explanation?: string } | undefined)?.explanation ?? 'Generating remediation plan...'}
                </p>
              </>
            ) : (
              <p className="font-semibold text-ink text-[13px]">Run the LangGraph pipeline against a resource to generate a Terraform plan.</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
            disabled={status === 'running'}
            className="rounded-sm border border-signal/25 bg-panel px-3 py-1.5 text-[13px] font-mono text-ink disabled:opacity-50"
            placeholder="res-ec2-prod-01"
          />
          <select
            value={scenario}
            onChange={(e) => setScenario(e.target.value as (typeof SCENARIOS)[number])}
            className="rounded-sm border border-signal/25 bg-panel px-2 py-1.5 text-[13px] font-mono text-ink"
          >
            {SCENARIOS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" className="rounded-sm border-signal/25" onClick={startScenario}>
            Start Scenario
          </Button>
          <Button variant="outline" size="sm" onClick={resetSimulation} className="gap-1.5 rounded-sm border-signal/25">
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
            Reset Simulation
          </Button>
          <Button variant="outline" size="sm" onClick={openResourceDetails} className="gap-1.5 rounded-sm border-signal/25">
            <FolderSearch className="h-3.5 w-3.5" strokeWidth={1.75} />
            Open Resource Details
          </Button>
        </div>
        {actionMessage && <p className="text-[12px] text-graphite font-mono">{actionMessage}</p>}
        {resourceDetails && (
          <pre className="max-h-48 overflow-auto rounded-sm bg-panel border border-signal/25 p-3 text-[11px] font-mono text-ink">
            {JSON.stringify(resourceDetails, null, 2)}
          </pre>
        )}
        {detailsError && <p className="text-[12px] text-danger">Failed to load resource details: {detailsError}</p>}
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Left Column - Terraform Code */}
        <div className="col-span-12 lg:col-span-7 space-y-4">
          <div className="border border-hairline bg-panel">
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
              <span className="text-[11px] text-graphite font-mono">{artifact ? `sha256:${artifact.checksum.slice(0, 16)}…` : 'no artifact yet'}</span>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-graphite hover:text-ink rounded-sm"
                disabled={!artifact}
                onClick={() => artifact && navigator.clipboard.writeText(artifact.hcl)}
              >
                <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                Copy
              </Button>
            </div>

            {/* Code Editor */}
            <div className="overflow-hidden bg-subtle font-mono text-[13px] border-t border-hairline">
              <div className="max-h-80 overflow-auto">
                {artifact ? (
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

          {/* Static security decision */}
          {security && (
            <div className={`border-l-2 px-6 py-4 ${security.passed ? 'border-ok bg-ok-soft' : 'border-danger bg-danger-soft'}`}>
              <div className="flex items-center gap-2 font-semibold text-ink text-[13px]">
                {security.passed ? <ShieldCheck className="h-4 w-4 text-ok" strokeWidth={1.75} /> : <ShieldAlert className="h-4 w-4 text-danger" strokeWidth={1.75} />}
                {security.passed ? 'Static security policies passed' : `Rejected by static security policy (${security.findings.length} finding${security.findings.length === 1 ? '' : 's'})`}
              </div>
              {!security.passed && (
                <ul className="mt-2 space-y-1 text-[12px] text-graphite">
                  {security.findings.map((finding, idx) => (
                    <li key={idx} className="font-mono text-[11px]">
                      [{finding.severity}] {finding.policyName}: {finding.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Sandbox step results */}
          {sandboxResults.length > 0 && (
            <div className="border border-hairline bg-panel px-6 py-4">
              <div className="text-[10px] font-mono uppercase tracking-wider text-graphite mb-3">Sandbox Execution</div>
              <div className="flex flex-wrap gap-2">
                {sandboxSteps.map(({ command, label }) => {
                  const result = lastResultFor(command);
                  if (!result) return null;
                  const ok = result.exitCode === 0;
                  return (
                    <div key={command} className={`flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[11px] font-mono font-medium ${ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>
                      {ok ? <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} /> : <XCircle className="h-3.5 w-3.5" strokeWidth={1.75} />}
                      terraform {label} (exit {result.exitCode ?? 'n/a'}{result.timedOut ? ', timed out' : ''})
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Self-correction summary */}
          {correctionAttempts > 0 && (
            <div className="border-l-2 border-warn bg-warn-soft px-6 py-4">
              <div className="font-semibold text-ink text-[13px]">
                selfCorrectionAgent ran {correctionAttempts} time{correctionAttempts === 1 ? '' : 's'} (max 3 per run)
              </div>
              <p className="mt-1 text-[12px] text-graphite">See the execution log below for each attempt&apos;s strategy, hashes, and result.</p>
            </div>
          )}

          {/* Plan policy / auto-approval decision */}
          {approvalDecision && (
            <div className={`border-l-2 px-6 py-4 ${approvalDecision.decision === 'approved' ? 'border-ok bg-ok-soft' : 'border-danger bg-danger-soft'}`}>
              <div className="flex items-center gap-2 font-semibold text-ink text-[13px]">
                {approvalDecision.decision === 'approved' ? <ShieldCheck className="h-4 w-4 text-ok" strokeWidth={1.75} /> : <ShieldAlert className="h-4 w-4 text-danger" strokeWidth={1.75} />}
                autoApprovalWorker: {approvalDecision.decision} (risk score {approvalDecision.analysis.riskScore}/100)
              </div>
              <p className="mt-1 text-graphite font-mono text-[11px]">{approvalDecision.reason}</p>
              {approvalDecision.analysis.violations.length > 0 && (
                <ul className="mt-2 space-y-1 text-[12px] text-graphite">
                  {approvalDecision.analysis.violations.map((v, idx) => (
                    <li key={idx} className="font-mono text-[11px]">
                      • {v}
                    </li>
                  ))}
                </ul>
              )}
              {applySucceeded && <p className="mt-2 text-[12px] font-semibold text-info">terraformApplyWorker: apply succeeded</p>}
            </div>
          )}

          {/* Verification result */}
          {verificationResult && (
            <div className={`border-l-2 px-6 py-4 ${verificationResult.passed ? 'border-ok bg-ok-soft' : 'border-danger bg-danger-soft'}`}>
              <div className="flex items-center gap-2 font-semibold text-ink text-[13px]">
                {verificationResult.passed ? <ShieldCheck className="h-4 w-4 text-ok" strokeWidth={1.75} /> : <ShieldAlert className="h-4 w-4 text-danger" strokeWidth={1.75} />}
                verificationWorker: {verificationResult.passed ? 'all checks passed' : 'one or more checks failed'}
              </div>
              <ul className="mt-2 space-y-1 text-[12px] text-graphite">
                {verificationResult.checks.map((check, idx) => (
                  <li key={idx} className={`font-mono text-[11px] flex items-center gap-1.5 ${check.passed ? 'text-graphite' : 'text-danger'}`}>
                    {check.passed ? <CheckCircle2 className="h-3.5 w-3.5 text-ok flex-shrink-0" strokeWidth={1.75} /> : <XCircle className="h-3.5 w-3.5 text-danger flex-shrink-0" strokeWidth={1.75} />}
                    {check.name}: {check.details}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Rollback result */}
          {rollbackResult?.rolledBack && (
            <div className="border-l-2 border-warn bg-warn-soft px-6 py-4">
              <div className="flex items-center gap-2 font-semibold text-ink text-[13px]">
                <RotateCcw className="h-4 w-4 text-warn" strokeWidth={1.75} />
                rollbackWorker: restored the exact pre-apply simulation snapshot
              </div>
              <p className="mt-1 text-graphite font-mono text-[11px]">{rollbackResult.reason}</p>
            </div>
          )}

          {/* Metadata Footer */}
          <div className="border border-hairline bg-panel px-6 py-4">
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
            <Button onClick={runSandbox} disabled={status === 'running'} className="gap-2 bg-signal hover:bg-signal/90 text-white rounded-sm uppercase text-[12px] tracking-wide font-mono">
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

          {/* Graph visualizer */}
          <div className="border border-hairline bg-panel p-5">
            <h3 className="text-[10px] font-mono uppercase tracking-wider text-graphite mb-3">Graph Execution</h3>
            <GraphVisualizer runId={runId} />
          </div>

          {/* Cost Impact Section */}
          <div className="border border-hairline bg-panel p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-[10px] font-mono uppercase tracking-wider text-graphite">Cost Impact</h3>
                <span className="text-[11px] text-graphite font-mono">({remediationPlan ? remediationPlan.action : 'no plan yet'})</span>
                <Info className="h-3.5 w-3.5 text-graphite" strokeWidth={1.75} />
              </div>
            </div>

            <div className="flex items-center gap-px bg-hairline border border-hairline">
              <div className="flex-1 bg-danger-soft p-4">
                <div className="text-[10px] font-mono uppercase tracking-wider text-graphite">Current</div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-xl font-display font-semibold text-danger tabular-nums">{currentDaily !== null ? `$${currentDaily.toFixed(0)}` : '—'}</span>
                  <span className="text-[12px] text-graphite font-mono">/day</span>
                </div>
              </div>

              <div className="flex-1 bg-ok-soft p-4">
                <div className="text-[10px] font-mono uppercase tracking-wider text-graphite">After (Projected)</div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-xl font-display font-semibold text-ok tabular-nums">{afterDaily !== null ? `$${afterDaily.toFixed(0)}` : '—'}</span>
                  <span className="text-[12px] text-graphite font-mono">/day</span>
                </div>
              </div>

              <div className="flex-1 bg-signal-soft p-4">
                <div className="text-[10px] font-mono uppercase tracking-wider text-graphite">Projected Savings</div>
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
                  <span className="text-[12px] font-semibold text-ink">Cost Reduction</span>
                  <span className="text-[12px] font-mono font-bold text-signal">{savingsPercent}%</span>
                </div>
                <div className="h-1.5 w-full bg-hairline">
                  <div className="h-1.5 bg-signal" style={{ width: `${Math.min(100, savingsPercent)}%` }} />
                </div>
              </div>
            )}

            {realizedSavingsUsd !== null && (
              <div className="border-l-2 border-info bg-info-soft p-3 text-[13px]">
                <span className="font-semibold text-ink">Realized monthly savings: </span>
                <span className="font-mono font-bold text-info">${realizedSavingsUsd.toFixed(2)}</span>
              </div>
            )}
          </div>

          {/* Execution Logs */}
          <div className="border border-hairline bg-panel p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
                  {status === 'running' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal opacity-60" />}
                  <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${status === 'running' ? 'bg-signal' : 'bg-ok'}`} />
                </span>
                <span className="text-[10px] font-mono uppercase tracking-wider text-graphite">Execution Logs</span>
                <span className="text-[10px] text-graphite">(real terraform stdout/stderr)</span>
              </div>
              <button onClick={() => setLogs([])} className="flex items-center gap-1.5 border border-hairline px-2.5 py-1 text-[11px] font-mono font-medium text-graphite hover:border-ink hover:text-ink transition-colors">
                Clear Logs
              </button>
            </div>

            <div className="max-h-64 overflow-auto border border-hairline bg-subtle p-3 font-mono text-[11px]">
              {logs.length === 0 ? (
                <div className="py-6 text-center text-graphite">No logs yet.</div>
              ) : (
                logs.map((log, idx) => (
                  <div key={idx} className="flex gap-2 py-1">
                    <span className="flex-shrink-0 text-graphite">{log.time}</span>
                    <span className={log.status === 'error' ? 'text-danger' : log.status === 'in-progress' ? 'text-ink' : 'text-ok'}>{log.message}</span>
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
