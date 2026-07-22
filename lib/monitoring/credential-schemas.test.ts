import { describe, it, expect } from 'vitest'
import { monitoringCredentialsSchema } from './credential-schemas'

describe('monitoringCredentialsSchema', () => {
  it('accepts valid AWS credentials', () => {
    const result = monitoringCredentialsSchema.safeParse({
      provider: 'AWS',
      credentials: { accessKeyId: 'AKIA123', secretAccessKey: 'shh', region: 'us-east-1' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects AWS credentials missing a region', () => {
    const result = monitoringCredentialsSchema.safeParse({
      provider: 'AWS',
      credentials: { accessKeyId: 'AKIA123', secretAccessKey: 'shh' },
    })
    expect(result.success).toBe(false)
  })

  it('accepts GCP credentials via serviceAccountJson', () => {
    const result = monitoringCredentialsSchema.safeParse({
      provider: 'GCP',
      credentials: { serviceAccountJson: '{"client_email":"a@b.com","private_key":"x"}', projectId: 'my-project' },
    })
    expect(result.success).toBe(true)
  })

  it('accepts GCP credentials via clientEmail + privateKey', () => {
    const result = monitoringCredentialsSchema.safeParse({
      provider: 'GCP',
      credentials: { clientEmail: 'a@b.com', privateKey: 'x', projectId: 'my-project' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects GCP credentials with neither auth mode', () => {
    const result = monitoringCredentialsSchema.safeParse({
      provider: 'GCP',
      credentials: { projectId: 'my-project' },
    })
    expect(result.success).toBe(false)
  })

  it('accepts a bare Prometheus server URL', () => {
    const result = monitoringCredentialsSchema.safeParse({
      provider: 'PROMETHEUS',
      credentials: { serverUrl: 'http://localhost:9090' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid Prometheus server URL', () => {
    const result = monitoringCredentialsSchema.safeParse({
      provider: 'PROMETHEUS',
      credentials: { serverUrl: 'not-a-url' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown provider', () => {
    const result = monitoringCredentialsSchema.safeParse({
      provider: 'AZURE',
      credentials: {},
    })
    expect(result.success).toBe(false)
  })
})
