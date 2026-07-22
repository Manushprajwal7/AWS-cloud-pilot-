'use client'

/**
 * The "Connect Monitoring Instance" modal: pick a provider, enter its
 * credentials, test, then connect. Credentials are POSTed straight to
 * /api/monitoring/{test,connect} and never touch localStorage or any other
 * client-side persistence — see lib/monitoring/credential-crypto.ts for how
 * they're encrypted server-side before Postgres ever sees them.
 */

import { useRef, useState } from 'react'
import { Cloud, Loader2, Plug, CheckCircle2, XCircle, Upload } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { MonitoringProvider } from '@/lib/monitoring/types'

interface MonitoringConnectionModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected: () => void
}

const PROVIDERS: { id: MonitoringProvider; label: string; sublabel: string }[] = [
  { id: 'AWS', label: 'AWS', sublabel: 'CloudWatch' },
  { id: 'GCP', label: 'GCP', sublabel: 'Cloud Ops' },
  { id: 'PROMETHEUS', label: 'Prometheus', sublabel: '' },
]

interface AwsForm {
  accessKeyId: string
  secretAccessKey: string
  region: string
  endpoint: string
}
interface GcpForm {
  mode: 'json' | 'fields'
  serviceAccountJson: string
  clientEmail: string
  privateKey: string
  projectId: string
  endpoint: string
}
interface PrometheusForm {
  serverUrl: string
  authMode: 'none' | 'basic' | 'bearer'
  username: string
  password: string
  bearerToken: string
}

const AWS_REGIONS = ['us-east-1', 'us-west-2', 'eu-west-1', 'eu-central-1', 'ap-southeast-1', 'ap-southeast-2']

const EMPTY_AWS: AwsForm = { accessKeyId: '', secretAccessKey: '', region: 'us-east-1', endpoint: '' }
const EMPTY_GCP: GcpForm = { mode: 'json', serviceAccountJson: '', clientEmail: '', privateKey: '', projectId: '', endpoint: '' }
const EMPTY_PROM: PrometheusForm = { serverUrl: 'http://localhost:9090', authMode: 'none', username: '', password: '', bearerToken: '' }

type TestState = { kind: 'idle' } | { kind: 'testing' } | { kind: 'ok'; message: string } | { kind: 'error'; message: string }

export function MonitoringConnectionModal({ open, onOpenChange, onConnected }: MonitoringConnectionModalProps) {
  const [step, setStep] = useState<'select' | 'credentials'>('select')
  const [provider, setProvider] = useState<MonitoringProvider | null>(null)
  const [aws, setAws] = useState<AwsForm>(EMPTY_AWS)
  const [gcp, setGcp] = useState<GcpForm>(EMPTY_GCP)
  const [prom, setProm] = useState<PrometheusForm>(EMPTY_PROM)
  const [testState, setTestState] = useState<TestState>({ kind: 'idle' })
  const [isConnecting, setIsConnecting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function reset(): void {
    setStep('select')
    setProvider(null)
    setAws(EMPTY_AWS)
    setGcp(EMPTY_GCP)
    setProm(EMPTY_PROM)
    setTestState({ kind: 'idle' })
    setIsConnecting(false)
  }

  function handleOpenChange(next: boolean): void {
    if (!next) reset()
    onOpenChange(next)
  }

  function selectProvider(p: MonitoringProvider): void {
    setProvider(p)
    setStep('credentials')
    setTestState({ kind: 'idle' })
  }

  function buildPayload(): { provider: MonitoringProvider; credentials: Record<string, unknown> } | null {
    if (provider === 'AWS') {
      if (!aws.accessKeyId || !aws.secretAccessKey || !aws.region) return null
      return { provider: 'AWS', credentials: { accessKeyId: aws.accessKeyId, secretAccessKey: aws.secretAccessKey, region: aws.region, endpoint: aws.endpoint || undefined } }
    }
    if (provider === 'GCP') {
      if (!gcp.projectId) return null
      if (gcp.mode === 'json') {
        if (!gcp.serviceAccountJson) return null
        return { provider: 'GCP', credentials: { serviceAccountJson: gcp.serviceAccountJson, projectId: gcp.projectId, endpoint: gcp.endpoint || undefined } }
      }
      if (!gcp.clientEmail || !gcp.privateKey) return null
      return { provider: 'GCP', credentials: { clientEmail: gcp.clientEmail, privateKey: gcp.privateKey, projectId: gcp.projectId, endpoint: gcp.endpoint || undefined } }
    }
    if (provider === 'PROMETHEUS') {
      if (!prom.serverUrl) return null
      return {
        provider: 'PROMETHEUS',
        credentials: {
          serverUrl: prom.serverUrl,
          username: prom.authMode === 'basic' ? prom.username : undefined,
          password: prom.authMode === 'basic' ? prom.password : undefined,
          bearerToken: prom.authMode === 'bearer' ? prom.bearerToken : undefined,
        },
      }
    }
    return null
  }

  async function handleTest(): Promise<void> {
    const payload = buildPayload()
    if (!payload) {
      setTestState({ kind: 'error', message: 'Fill in the required fields first.' })
      return
    }
    setTestState({ kind: 'testing' })
    try {
      const response = await fetch('/api/monitoring/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (response.ok && data.ok) {
        setTestState({ kind: 'ok', message: data.message })
      } else {
        setTestState({ kind: 'error', message: data.message ?? data.error ?? 'Connection test failed.' })
      }
    } catch (error) {
      setTestState({ kind: 'error', message: error instanceof Error ? error.message : 'Connection test failed.' })
    }
  }

  async function handleConnect(): Promise<void> {
    const payload = buildPayload()
    if (!payload) {
      setTestState({ kind: 'error', message: 'Fill in the required fields first.' })
      return
    }
    setIsConnecting(true)
    try {
      const response = await fetch('/api/monitoring/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (response.ok) {
        onConnected()
        handleOpenChange(false)
      } else {
        setTestState({ kind: 'error', message: data.error ?? 'Connect failed.' })
      }
    } catch (error) {
      setTestState({ kind: 'error', message: error instanceof Error ? error.message : 'Connect failed.' })
    } finally {
      setIsConnecting(false)
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setGcp((prev) => ({ ...prev, serviceAccountJson: String(reader.result ?? '') }))
    }
    reader.readAsText(file)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => handleOpenChange(next)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Plug className="h-4 w-4 text-signal" />
            <DialogTitle>Connect Monitoring Instance</DialogTitle>
          </div>
          <DialogDescription>
            {step === 'select' ? 'Step 1: select a monitoring service.' : 'Step 2: enter credentials, then test before connecting.'}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-5">
          {step === 'select' ? (
            <div className="grid grid-cols-3 gap-3">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectProvider(p.id)}
                  className="flex flex-col items-center gap-2 rounded-[10px] border border-hairline bg-subtle px-3 py-5 text-center transition-colors hover:border-signal hover:bg-signal-soft"
                >
                  <Cloud className="h-6 w-6 text-signal" strokeWidth={1.5} />
                  <span className="text-[13px] font-semibold text-ink">{p.label}</span>
                  {p.sublabel && <span className="text-[11px] text-graphite">{p.sublabel}</span>}
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {provider === 'AWS' && (
                <div className="space-y-3">
                  <Field label="Access Key ID">
                    <input type="text" value={aws.accessKeyId} onChange={(e) => setAws({ ...aws, accessKeyId: e.target.value })} className={inputClass} placeholder="AKIA..." autoComplete="off" />
                  </Field>
                  <Field label="Secret Access Key">
                    <input type="password" value={aws.secretAccessKey} onChange={(e) => setAws({ ...aws, secretAccessKey: e.target.value })} className={inputClass} autoComplete="off" />
                  </Field>
                  <Field label="Region">
                    <select value={aws.region} onChange={(e) => setAws({ ...aws, region: e.target.value })} className={inputClass}>
                      {AWS_REGIONS.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Custom endpoint URL (optional)">
                    <input type="text" value={aws.endpoint} onChange={(e) => setAws({ ...aws, endpoint: e.target.value })} className={inputClass} placeholder="https://..." />
                  </Field>
                </div>
              )}

              {provider === 'GCP' && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <ModeButton active={gcp.mode === 'json'} onClick={() => setGcp({ ...gcp, mode: 'json' })}>Service account JSON</ModeButton>
                    <ModeButton active={gcp.mode === 'fields'} onClick={() => setGcp({ ...gcp, mode: 'fields' })}>Email + private key</ModeButton>
                  </div>
                  {gcp.mode === 'json' ? (
                    <Field label="Service account JSON key file">
                      <div className="flex items-center gap-2">
                        <input ref={fileInputRef} type="file" accept="application/json" onChange={handleFileUpload} className="hidden" />
                        <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="gap-1.5">
                          <Upload className="h-3.5 w-3.5" /> Upload JSON
                        </Button>
                        {gcp.serviceAccountJson && <span className="text-[11px] text-ok">Loaded ({gcp.serviceAccountJson.length} chars)</span>}
                      </div>
                    </Field>
                  ) : (
                    <>
                      <Field label="Client email">
                        <input type="text" value={gcp.clientEmail} onChange={(e) => setGcp({ ...gcp, clientEmail: e.target.value })} className={inputClass} placeholder="name@project.iam.gserviceaccount.com" autoComplete="off" />
                      </Field>
                      <Field label="Private key">
                        <textarea value={gcp.privateKey} onChange={(e) => setGcp({ ...gcp, privateKey: e.target.value })} className={`${inputClass} h-24 resize-none font-mono text-[11px]`} placeholder="-----BEGIN PRIVATE KEY-----" />
                      </Field>
                    </>
                  )}
                  <Field label="Project ID">
                    <input type="text" value={gcp.projectId} onChange={(e) => setGcp({ ...gcp, projectId: e.target.value })} className={inputClass} autoComplete="off" />
                  </Field>
                  <Field label="Custom endpoint URL (optional)">
                    <input type="text" value={gcp.endpoint} onChange={(e) => setGcp({ ...gcp, endpoint: e.target.value })} className={inputClass} placeholder="https://..." />
                  </Field>
                </div>
              )}

              {provider === 'PROMETHEUS' && (
                <div className="space-y-3">
                  <Field label="Server URL">
                    <input type="text" value={prom.serverUrl} onChange={(e) => setProm({ ...prom, serverUrl: e.target.value })} className={inputClass} placeholder="http://localhost:9090" autoComplete="off" />
                  </Field>
                  <div className="flex gap-2">
                    <ModeButton active={prom.authMode === 'none'} onClick={() => setProm({ ...prom, authMode: 'none' })}>No auth</ModeButton>
                    <ModeButton active={prom.authMode === 'basic'} onClick={() => setProm({ ...prom, authMode: 'basic' })}>Basic auth</ModeButton>
                    <ModeButton active={prom.authMode === 'bearer'} onClick={() => setProm({ ...prom, authMode: 'bearer' })}>Bearer token</ModeButton>
                  </div>
                  {prom.authMode === 'basic' && (
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Username">
                        <input type="text" value={prom.username} onChange={(e) => setProm({ ...prom, username: e.target.value })} className={inputClass} autoComplete="off" />
                      </Field>
                      <Field label="Password">
                        <input type="password" value={prom.password} onChange={(e) => setProm({ ...prom, password: e.target.value })} className={inputClass} autoComplete="off" />
                      </Field>
                    </div>
                  )}
                  {prom.authMode === 'bearer' && (
                    <Field label="Bearer token">
                      <input type="password" value={prom.bearerToken} onChange={(e) => setProm({ ...prom, bearerToken: e.target.value })} className={inputClass} autoComplete="off" />
                    </Field>
                  )}
                </div>
              )}

              {testState.kind !== 'idle' && (
                <div
                  className={`flex items-start gap-2 rounded-[8px] px-3 py-2 text-[12px] ${
                    testState.kind === 'ok' ? 'bg-ok-soft text-ok' : testState.kind === 'error' ? 'bg-danger-soft text-danger' : 'bg-subtle text-graphite'
                  }`}
                >
                  {testState.kind === 'testing' && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
                  {testState.kind === 'ok' && <CheckCircle2 className="h-4 w-4 shrink-0" />}
                  {testState.kind === 'error' && <XCircle className="h-4 w-4 shrink-0" />}
                  <span>{testState.kind === 'testing' ? 'Testing connection…' : testState.message}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {step === 'credentials' && (
            <>
              <Button type="button" variant="ghost" onClick={() => setStep('select')} disabled={isConnecting}>
                Back
              </Button>
              <Button type="button" variant="outline" onClick={handleTest} disabled={testState.kind === 'testing' || isConnecting}>
                Test Connection
              </Button>
              <Button type="button" onClick={handleConnect} disabled={isConnecting} className="gap-1.5">
                {isConnecting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {isConnecting ? 'Connecting…' : 'Connect'}
              </Button>
            </>
          )}
          {step === 'select' && (
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const inputClass =
  'h-9 w-full rounded-[8px] border border-hairline bg-panel px-3 text-[13px] text-ink placeholder-graphite/60 focus:outline-none focus:ring-2 focus:ring-signal/30 focus:border-signal'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-graphite">{label}</span>
      {children}
    </label>
  )
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[8px] border px-3 py-1.5 text-[12px] font-medium transition-colors ${
        active ? 'border-signal bg-signal-soft text-signal' : 'border-hairline text-graphite hover:bg-subtle'
      }`}
    >
      {children}
    </button>
  )
}
