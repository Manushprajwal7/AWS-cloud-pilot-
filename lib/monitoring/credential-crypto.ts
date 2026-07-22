/**
 * Encrypts/decrypts monitoring-provider credentials before they touch
 * Postgres (see MonitoringConnection.encryptedCredentials). AES-256-GCM via
 * node:crypto — the same "no third-party crypto dependency" convention as
 * lib/terraform/hashing.ts's SHA-256 use. The encryption key never has a
 * default: a missing/malformed MONITORING_CREDENTIALS_ENCRYPTION_KEY fails
 * loudly rather than silently encrypting with a guessable key.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const KEY_LENGTH = 32

let cachedKey: Buffer | null = null

function getKey(): Buffer {
  if (cachedKey) return cachedKey

  const raw = process.env.MONITORING_CREDENTIALS_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'MONITORING_CREDENTIALS_ENCRYPTION_KEY is not set — required to store monitoring provider credentials. Generate one with `openssl rand -base64 32`.',
    )
  }

  const key = Buffer.from(raw, 'base64')
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `MONITORING_CREDENTIALS_ENCRYPTION_KEY must decode to exactly ${KEY_LENGTH} bytes (got ${key.length}) — generate one with \`openssl rand -base64 32\`.`,
    )
  }

  cachedKey = key
  return key
}

/** Encrypts a JSON-serializable credentials object into a single base64 payload (iv | authTag | ciphertext). */
export function encryptCredentials(plaintextJson: string): string {
  const key = getKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintextJson, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return Buffer.concat([iv, authTag, ciphertext]).toString('base64')
}

/** Reverses encryptCredentials. Throws if the key is wrong or the payload was tampered with (GCM auth-tag check). */
export function decryptCredentials(payload: string): string {
  const key = getKey()
  const raw = Buffer.from(payload, 'base64')
  const iv = raw.subarray(0, IV_LENGTH)
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16)
  const ciphertext = raw.subarray(IV_LENGTH + 16)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plaintext.toString('utf8')
}
