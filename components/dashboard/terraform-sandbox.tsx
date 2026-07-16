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
    return [{ text: line, className: 'text-gray-500 italic' }];
  }

  const resourceMatch = line.match(/^(\s*)(resource)(\s+)("[^"]*")(\s+)("[^"]*")(\s*)(\{)?$/);
  if (resourceMatch) {
    const [, indent, keyword, sp1, type, sp2, name, sp3, brace] = resourceMatch;
    return [
      { text: indent, className: '' },
      { text: keyword, className: 'text-orange-400 font-semibold' },
      { text: sp1, className: '' },
      { text: type, className: 'text-emerald-400' },
      { text: sp2, className: '' },
      { text: name, className: 'text-emerald-400' },
      { text: sp3, className: '' },
      { text: brace ?? '', className: 'text-gray-300' },
    ];
  }

  const attrMatch = line.match(/^(\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*)(=)(\s*)(.+)$/);
  if (attrMatch) {
    const [, indent, key, sp1, eq, sp2, rawValue] = attrMatch;
    const braceSuffix = rawValue.match(/^(.*?)(\s*\{)?$/);
    const valueBody = braceSuffix ? braceSuffix[1] : rawValue;
    const brace = braceSuffix?.[2] ?? '';

    let valueClass = 'text-gray-300';
    if (/^".*"$/.test(valueBody)) valueClass = 'text-emerald-400';
    else if (/^(true|false)$/.test(valueBody)) valueClass = 'text-orange-400';
    else if (/^-?\d+(\.\d+)?$/.test(valueBody)) valueClass = 'text-orange-400';
    else if (/^var\./.test(valueBody)) valueClass = 'text-sky-400';

    return [
      { text: indent, className: '' },
      { text: key, className: 'text-sky-300' },
      { text: sp1, className: '' },
      { text: eq, className: 'text-gray-400' },
      { text: sp2, className: '' },
      { text: valueBody, className: valueClass },
      { text: brace, className: 'text-gray-300' },
    ];
  }

  return [{ text: line, className: 'text-gray-300' }];
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
        body: JSON.stringify({ resourceId, scenario }),
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
  const remediationPlan = finalState?.remediationPlan as { expectedMonthlySavingsUsd: number | null; action: string } | null | undefined;
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

  const statusLabel: Record<RunStatus, string> = {
    idle: 'Idle',
    running: 'Running',
    completed: 'Plan ready',
    rejected: 'Rejected by policy',
    failed: 'Failed',
    applied: 'Applied',
    rolled_back: 'Rolled back',
  };

  const statusColor: Record<RunStatus, string> = {
    idle: 'bg-gray-400',
    running: 'bg-orange-500',
    completed: 'bg-green-500',
    rejected: 'bg-red-500',
    failed: 'bg-red-500',
    applied: 'bg-blue-600',
    rolled_back: 'bg-purple-600',
  };

  const sandboxSteps: { command: string; label: string }[] = [
    { command: 'fmt', label: 'fmt' },
    { command: 'init', label: 'init' },
    { command: 'validate', label: 'validate' },
    { command: 'plan', label: 'plan' },
    { command: 'apply', label: 'apply' },
  ];

  return (
    <div className="space-y-4">
      {/* Title Bar */}
      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-500">
            <Package className="h-5 w-5 text-white" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">Agentic Sandbox - Terraform Console</h2>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={`h-2.5 w-2.5 rounded-full ${statusColor[status]}`} />
            <div>
              <div className="text-sm font-semibold text-gray-900">{statusLabel[status]}</div>
              <div className="text-xs text-gray-500">Approval and apply run automatically — no manual approve/reject step</div>
            </div>
          </div>
          <Button variant="outline" size="sm" className="px-2.5">
            <Maximize2 className="h-4 w-4 text-gray-600" />
          </Button>
        </div>
      </div>

      {/* Resource picker / scenario controls / issue banner */}
      <div className="rounded-lg border border-orange-200 bg-orange-50 px-6 py-4 space-y-3">
        <div className="flex gap-3">
          <div className="flex-shrink-0">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-orange-100">
              <BrainCircuit className="h-6 w-6 text-orange-500" />
            </div>
          </div>
          <div className="flex-1">
            {finalState?.anomaly ? (
              <>
                <p className="font-semibold text-gray-900">
                  Detected {String((finalState.anomaly as { type: string }).type)} on {resourceId}.
                </p>
                <p className="mt-1 text-sm text-gray-700">
                  {(finalState.diagnosis as { explanation?: string } | undefined)?.explanation ?? 'Generating remediation plan...'}
                </p>
              </>
            ) : (
              <p className="font-semibold text-gray-900">Run the LangGraph pipeline against a resource to generate a Terraform plan.</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
            disabled={status === 'running'}
            className="rounded border border-orange-200 bg-white px-3 py-1.5 text-sm text-gray-900 disabled:opacity-50"
            placeholder="res-ec2-prod-01"
          />
          <select
            value={scenario}
            onChange={(e) => setScenario(e.target.value as (typeof SCENARIOS)[number])}
            className="rounded border border-orange-200 bg-white px-2 py-1.5 text-sm text-gray-900"
          >
            {SCENARIOS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={startScenario}>
            Start Scenario
          </Button>
          <Button variant="outline" size="sm" onClick={resetSimulation} className="gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" />
            Reset Simulation
          </Button>
          <Button variant="outline" size="sm" onClick={openResourceDetails} className="gap-1.5">
            <FolderSearch className="h-3.5 w-3.5" />
            Open Resource Details
          </Button>
        </div>
        {actionMessage && <p className="text-xs text-gray-700">{actionMessage}</p>}
        {resourceDetails && (
          <pre className="max-h-48 overflow-auto rounded bg-white border border-orange-200 p-3 text-xs text-gray-800">
            {JSON.stringify(resourceDetails, null, 2)}
          </pre>
        )}
        {detailsError && <p className="text-xs text-red-600">Failed to load resource details: {detailsError}</p>}
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Left Column - Terraform Code */}
        <div className="col-span-12 lg:col-span-7 space-y-4">
          <div className="rounded-lg border border-gray-200 bg-white">
            <div className="flex items-center justify-between px-4 pt-3">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-900">Generated Terraform</span>
                <span className="text-xs text-gray-500">(Read-only)</span>
                <Info className="h-3.5 w-3.5 text-gray-400" />
              </div>
              <span className="flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-medium text-orange-600">
                <Sparkles className="h-3.5 w-3.5" />
                Generated by terraformGenerationAgent
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <span className="text-xs text-gray-500 font-mono">{artifact ? `sha256:${artifact.checksum.slice(0, 16)}…` : 'no artifact yet'}</span>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-gray-600"
                disabled={!artifact}
                onClick={() => artifact && navigator.clipboard.writeText(artifact.hcl)}
              >
                <Copy className="h-4 w-4" />
                Copy
              </Button>
            </div>

            {/* Code Editor */}
            <div className="overflow-hidden rounded-b-lg bg-gray-900 font-mono text-sm">
              <div className="max-h-80 overflow-auto">
                {artifact ? (
                  <div className="relative flex">
                    <div className="select-none border-r border-gray-700 bg-gray-800 px-3 py-4 text-right text-gray-500">
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
                  <div className="p-6 text-center text-sm text-gray-500">
                    {status === 'running' ? 'Waiting for terraformGenerationAgent to produce code…' : 'No Terraform code generated yet. Run the pipeline.'}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Static security decision */}
          {security && (
            <div className={`rounded-lg border px-6 py-4 ${security.passed ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
              <div className="flex items-center gap-2 font-semibold text-gray-900">
                {security.passed ? <ShieldCheck className="h-4 w-4 text-green-600" /> : <ShieldAlert className="h-4 w-4 text-red-600" />}
                {security.passed ? 'Static security policies passed' : `Rejected by static security policy (${security.findings.length} finding${security.findings.length === 1 ? '' : 's'})`}
              </div>
              {!security.passed && (
                <ul className="mt-2 space-y-1 text-sm text-gray-700">
                  {security.findings.map((finding, idx) => (
                    <li key={idx} className="font-mono text-xs">
                      [{finding.severity}] {finding.policyName}: {finding.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Sandbox step results */}
          {sandboxResults.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white px-6 py-4">
              <div className="font-semibold text-gray-900 mb-3">Sandbox Execution</div>
              <div className="flex flex-wrap gap-3">
                {sandboxSteps.map(({ command, label }) => {
                  const result = lastResultFor(command);
                  if (!result) return null;
                  const ok = result.exitCode === 0;
                  return (
                    <div key={command} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                      terraform {label} (exit {result.exitCode ?? 'n/a'}{result.timedOut ? ', timed out' : ''})
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Self-correction summary */}
          {correctionAttempts > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-6 py-4">
              <div className="font-semibold text-gray-900">
                selfCorrectionAgent ran {correctionAttempts} time{correctionAttempts === 1 ? '' : 's'} (max 3 per run)
              </div>
              <p className="mt-1 text-sm text-gray-700">See the execution log below for each attempt&apos;s strategy, hashes, and result.</p>
            </div>
          )}

          {/* Plan policy / auto-approval decision */}
          {approvalDecision && (
            <div className={`rounded-lg border px-6 py-4 ${approvalDecision.decision === 'approved' ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
              <div className="flex items-center gap-2 font-semibold text-gray-900">
                {approvalDecision.decision === 'approved' ? <ShieldCheck className="h-4 w-4 text-green-600" /> : <ShieldAlert className="h-4 w-4 text-red-600" />}
                autoApprovalWorker: {approvalDecision.decision} (risk score {approvalDecision.analysis.riskScore}/100)
              </div>
              <p className="mt-1 text-sm text-gray-700 font-mono text-xs">{approvalDecision.reason}</p>
              {approvalDecision.analysis.violations.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-gray-700">
                  {approvalDecision.analysis.violations.map((v, idx) => (
                    <li key={idx} className="font-mono text-xs">
                      • {v}
                    </li>
                  ))}
                </ul>
              )}
              {applySucceeded && <p className="mt-2 text-sm font-semibold text-blue-700">terraformApplyWorker: apply succeeded</p>}
            </div>
          )}

          {/* Verification result */}
          {verificationResult && (
            <div className={`rounded-lg border px-6 py-4 ${verificationResult.passed ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
              <div className="flex items-center gap-2 font-semibold text-gray-900">
                {verificationResult.passed ? <ShieldCheck className="h-4 w-4 text-green-600" /> : <ShieldAlert className="h-4 w-4 text-red-600" />}
                verificationWorker: {verificationResult.passed ? 'all checks passed' : 'one or more checks failed'}
              </div>
              <ul className="mt-2 space-y-1 text-sm text-gray-700">
                {verificationResult.checks.map((check, idx) => (
                  <li key={idx} className={`font-mono text-xs flex items-center gap-1.5 ${check.passed ? 'text-gray-700' : 'text-red-700'}`}>
                    {check.passed ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 flex-shrink-0" /> : <XCircle className="h-3.5 w-3.5 text-red-600 flex-shrink-0" />}
                    {check.name}: {check.details}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Rollback result */}
          {rollbackResult?.rolledBack && (
            <div className="rounded-lg border border-purple-200 bg-purple-50 px-6 py-4">
              <div className="flex items-center gap-2 font-semibold text-gray-900">
                <RotateCcw className="h-4 w-4 text-purple-600" />
                rollbackWorker: restored the exact pre-apply simulation snapshot
              </div>
              <p className="mt-1 text-sm text-gray-700 font-mono text-xs">{rollbackResult.reason}</p>
            </div>
          )}

          {/* Metadata Footer */}
          <div className="rounded-lg border border-gray-200 bg-white px-6 py-4">
            <div className="grid grid-cols-4 gap-4 text-xs">
              <div>
                <div className="flex items-center gap-1.5 font-semibold text-gray-500">
                  <ClipboardList className="h-3.5 w-3.5" />
                  Plan
                </div>
                <div className="mt-1 font-medium text-blue-600">
                  {planSummary ? `+${planSummary.creates} ~${planSummary.updates} -${planSummary.deletes}` : '—'}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 font-semibold text-gray-500">
                  <GitBranch className="h-3.5 w-3.5" />
                  Environment
                </div>
                <div className="mt-1">
                  {resource ? (
                    <span className="inline-block rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-gray-700">{resource.environment}</span>
                  ) : (
                    '—'
                  )}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 font-semibold text-gray-500">
                  <Globe className="h-3.5 w-3.5" />
                  Region
                </div>
                <div className="mt-1 font-medium text-blue-600">{resource?.region ?? '—'}</div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 font-semibold text-gray-500">
                  <Clock className="h-3.5 w-3.5" />
                  Completed
                </div>
                <div className="mt-1 font-medium text-gray-900">{completedAt ?? '—'}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="col-span-12 lg:col-span-5 space-y-4">
          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <Button onClick={runSandbox} disabled={status === 'running'} className="gap-2 bg-orange-500 hover:bg-orange-600 text-white">
              <Play className="h-4 w-4" />
              Trigger Graph Run
            </Button>
            <Button onClick={stopSandbox} disabled={status !== 'running'} className="gap-2 bg-gray-400 hover:bg-gray-500 text-white">
              <Square className="h-4 w-4" />
              Stop
            </Button>
          </div>

          {errorMessage && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>
          )}

          {/* Graph visualizer */}
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Graph Execution</h3>
            <GraphVisualizer runId={runId} />
          </div>

          {/* Cost Impact Section */}
          <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-gray-900">Cost Impact</h3>
                <span className="text-xs text-gray-500">({remediationPlan ? remediationPlan.action : 'no plan yet'})</span>
                <Info className="h-3.5 w-3.5 text-gray-400" />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex-1 rounded-lg border border-red-200 bg-red-50 p-4">
                <div className="text-xs font-semibold text-gray-600">Current</div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-red-600">{currentDaily !== null ? `$${currentDaily.toFixed(0)}` : '—'}</span>
                  <span className="text-sm text-gray-600">/day</span>
                </div>
              </div>

              <div className="flex-1 rounded-lg border border-green-200 bg-green-50 p-4">
                <div className="text-xs font-semibold text-gray-600">After (Projected)</div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-green-600">{afterDaily !== null ? `$${afterDaily.toFixed(0)}` : '—'}</span>
                  <span className="text-sm text-gray-600">/day</span>
                </div>
              </div>

              <div className="flex-1 rounded-lg border border-orange-200 bg-orange-50 p-4">
                <div className="text-xs font-semibold text-gray-600">Projected Savings</div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-orange-600">{savingsDaily !== null ? `$${savingsDaily.toFixed(0)}` : '—'}</span>
                  <span className="text-sm text-gray-600">/day</span>
                </div>
                <div className="mt-1 text-sm text-gray-600">{savingsPercent !== null ? `(${savingsPercent}%)` : ''}</div>
              </div>
            </div>

            {savingsPercent !== null && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-900">Cost Reduction</span>
                  <span className="text-sm font-bold text-orange-600">{savingsPercent}%</span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-gray-200">
                  <div className="h-2.5 rounded-full bg-gradient-to-r from-orange-400 to-orange-500" style={{ width: `${Math.min(100, savingsPercent)}%` }} />
                </div>
              </div>
            )}

            {realizedSavingsUsd !== null && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
                <span className="font-semibold text-gray-900">Realized monthly savings: </span>
                <span className="font-bold text-blue-700">${realizedSavingsUsd.toFixed(2)}</span>
              </div>
            )}
          </div>

          {/* Execution Logs */}
          <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${status === 'running' ? 'bg-orange-500' : 'bg-green-500'}`} />
                <span className="font-semibold text-gray-900">Execution Logs</span>
                <span className="text-xs text-gray-500">(real terraform stdout/stderr)</span>
              </div>
              <button onClick={() => setLogs([])} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                Clear Logs
              </button>
            </div>

            <div className="max-h-64 overflow-auto rounded-lg border border-gray-200 bg-gray-900 p-3 font-mono text-xs">
              {logs.length === 0 ? (
                <div className="py-6 text-center text-gray-500">No logs yet.</div>
              ) : (
                logs.map((log, idx) => (
                  <div key={idx} className="flex gap-2 py-1 text-gray-400">
                    <span className="flex-shrink-0 text-gray-600">{log.time}</span>
                    <span className={log.status === 'error' ? 'text-red-400' : log.status === 'in-progress' ? 'text-gray-300' : 'text-green-400'}>{log.message}</span>
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
