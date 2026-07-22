import { describe, it, expect, beforeEach, vi } from 'vitest'
import { randomBytes } from 'node:crypto'

describe('credential-crypto', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.MONITORING_CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  })

  it('round-trips a JSON payload', async () => {
    const { encryptCredentials, decryptCredentials } = await import('./credential-crypto')
    const plaintext = JSON.stringify({ accessKeyId: 'AKIA123', secretAccessKey: 'shh', region: 'us-east-1' })

    const encrypted = encryptCredentials(plaintext)
    expect(encrypted).not.toContain('AKIA123')

    const decrypted = decryptCredentials(encrypted)
    expect(decrypted).toBe(plaintext)
  })

  it('produces a different ciphertext each time (random IV)', async () => {
    const { encryptCredentials } = await import('./credential-crypto')
    const a = encryptCredentials('{"a":1}')
    const b = encryptCredentials('{"a":1}')
    expect(a).not.toBe(b)
  })

  it('throws on a tampered payload', async () => {
    const { encryptCredentials, decryptCredentials } = await import('./credential-crypto')
    const encrypted = encryptCredentials('{"a":1}')
    const bytes = Buffer.from(encrypted, 'base64')
    bytes[bytes.length - 1] ^= 0xff // flip a bit in the ciphertext
    expect(() => decryptCredentials(bytes.toString('base64'))).toThrow()
  })

  it('throws a clear error when the encryption key env var is missing', async () => {
    delete process.env.MONITORING_CREDENTIALS_ENCRYPTION_KEY
    const { encryptCredentials } = await import('./credential-crypto')
    expect(() => encryptCredentials('{}')).toThrow(/MONITORING_CREDENTIALS_ENCRYPTION_KEY/)
  })

  it('throws a clear error when the key is the wrong length', async () => {
    process.env.MONITORING_CREDENTIALS_ENCRYPTION_KEY = Buffer.from('too-short').toString('base64')
    const { encryptCredentials } = await import('./credential-crypto')
    expect(() => encryptCredentials('{}')).toThrow(/32 bytes/)
  })
})
