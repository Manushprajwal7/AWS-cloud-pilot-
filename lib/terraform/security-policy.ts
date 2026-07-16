/**
 * Deterministic, regex-based security policies enforced against generated
 * Terraform text. Every rule here is a pure function over the HCL string —
 * no LLM involvement, so a policy result can never be talked out of by a
 * cleverly-worded prompt. staticSecurityWorker (../langgraph/nodes) runs
 * every rule and rejects the artifact if any of them find something.
 *
 * These are defense-in-depth: lib/terraform/templates.ts already only ever
 * emits allow-listed resource types with no provisioners, so in normal
 * operation nothing here should ever fire. It exists to catch a future
 * regression in generation, not because generation is expected to fail it.
 */

import { isAllowedProvider, isAllowedResourceType } from './provider-allowlist'
import type { SecurityFinding } from './types'

export interface SecurityPolicy {
  name: string
  description: string
  severity: SecurityFinding['severity']
  evaluate: (hcl: string) => SecurityFinding[]
}

function lineOf(hcl: string, index: number): number {
  return hcl.slice(0, index).split('\n').length
}

function findAllMatches(hcl: string, pattern: RegExp): SecurityFinding[] {
  const findings: SecurityFinding[] = []
  const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
  let match: RegExpExecArray | null
  while ((match = regex.exec(hcl)) !== null) {
    findings.push({ policyName: '', severity: 'high', message: match[0], line: lineOf(hcl, match.index) })
    if (match[0].length === 0) regex.lastIndex++
  }
  return findings
}

function makeRegexPolicy(
  name: string,
  description: string,
  severity: SecurityFinding['severity'],
  pattern: RegExp,
  message: string,
): SecurityPolicy {
  return {
    name,
    description,
    severity,
    evaluate: (hcl) =>
      findAllMatches(hcl, pattern).map((f) => ({ ...f, policyName: name, severity, message: `${message}: "${f.message.trim()}"` })),
  }
}

// ---------------------------------------------------------------------------
// Provisioners / remote code execution
// ---------------------------------------------------------------------------

const noProvisioners = makeRegexPolicy(
  'no-provisioners',
  'Provisioners are banned outright — they run arbitrary code outside Terraform\'s declarative model.',
  'critical',
  /provisioner\s+"[^"]+"/,
  'A provisioner block is not allowed',
)

const noLocalExec = makeRegexPolicy(
  'no-local-exec',
  'local-exec provisioners execute arbitrary shell commands on the machine running Terraform.',
  'critical',
  /provisioner\s+"local-exec"/,
  'local-exec provisioner is banned',
)

const noRemoteExec = makeRegexPolicy(
  'no-remote-exec',
  'remote-exec provisioners execute arbitrary shell commands on the target resource.',
  'critical',
  /provisioner\s+"remote-exec"/,
  'remote-exec provisioner is banned',
)

// ---------------------------------------------------------------------------
// Provider / resource-type restriction
// ---------------------------------------------------------------------------

function unsupportedProvidersPolicy(): SecurityPolicy {
  return {
    name: 'allowed-providers-only',
    description: 'Only the aws provider, and only allow-listed aws_* resource types, may appear.',
    severity: 'critical',
    evaluate: (hcl) => {
      const findings: SecurityFinding[] = []

      for (const match of hcl.matchAll(/provider\s+"([^"]+)"/g)) {
        const provider = match[1]
        if (!isAllowedProvider(provider)) {
          findings.push({
            policyName: 'allowed-providers-only',
            severity: 'critical',
            message: `Provider '${provider}' is not on the allowlist`,
            line: lineOf(hcl, match.index ?? 0),
          })
        }
      }

      for (const match of hcl.matchAll(/resource\s+"([^"]+)"\s+"[^"]+"/g)) {
        const resourceType = match[1]
        if (!isAllowedResourceType(resourceType)) {
          findings.push({
            policyName: 'allowed-providers-only',
            severity: 'critical',
            message: `Resource type '${resourceType}' is not on the allowlist`,
            line: lineOf(hcl, match.index ?? 0),
          })
        }
      }

      return findings
    },
  }
}

// ---------------------------------------------------------------------------
// Deletion / destructive directives
// ---------------------------------------------------------------------------

const noDeletionDirectives = makeRegexPolicy(
  'no-deletion-directives',
  'Removed blocks and force_destroy = true both allow Terraform to delete real infrastructure/data.',
  'critical',
  /\bremoved\s*\{|\bforce_destroy\s*=\s*true\b/,
  'Deletion directive found',
)

// ---------------------------------------------------------------------------
// IAM wildcard permissions
// ---------------------------------------------------------------------------

const noIamWildcards = makeRegexPolicy(
  'no-iam-wildcards',
  'Wildcard IAM actions/resources grant far more access than any single remediation needs.',
  'critical',
  /"Action"\s*:\s*"\*"|"Resource"\s*:\s*"\*"|actions\s*=\s*\[[^\]]*"\*"[^\]]*\]|resources\s*=\s*\[[^\]]*"\*"[^\]]*\]/,
  'Wildcard IAM permission found',
)

// ---------------------------------------------------------------------------
// Public ingress
// ---------------------------------------------------------------------------

const noPublicIngress = makeRegexPolicy(
  'no-public-ingress',
  'A CIDR of 0.0.0.0/0 or ::/0 on an ingress rule opens the resource to the entire internet.',
  'critical',
  /cidr_blocks\s*=\s*\[[^\]]*"0\.0\.0\.0\/0"[^\]]*\]|ipv6_cidr_blocks\s*=\s*\[[^\]]*"::\/0"[^\]]*\]/,
  'Public ingress CIDR found',
)

// ---------------------------------------------------------------------------
// Encryption / backup removal
// ---------------------------------------------------------------------------

const noEncryptionRemoval = makeRegexPolicy(
  'no-encryption-removal',
  'Disabling encryption on a resource that supports it is never a valid cost remediation.',
  'high',
  /\bstorage_encrypted\s*=\s*false\b|\bencrypted\s*=\s*false\b|\bkms_key_id\s*=\s*""/,
  'Encryption disabled or removed',
)

const noBackupRemoval = makeRegexPolicy(
  'no-backup-removal',
  'Zeroing backup retention or skipping final snapshots risks unrecoverable data loss.',
  'high',
  /\bbackup_retention_period\s*=\s*0\b|\bskip_final_snapshot\s*=\s*true\b|\bdeletion_protection\s*=\s*false\b/,
  'Backup/retention protection disabled',
)

// ---------------------------------------------------------------------------
// External data sources / arbitrary file writes
// ---------------------------------------------------------------------------

const noExternalDataSources = makeRegexPolicy(
  'no-external-data-sources',
  'The "external" data source shells out to an arbitrary program during plan/apply.',
  'critical',
  /data\s+"external"/,
  'External data source found',
)

const noArbitraryFileWrites = makeRegexPolicy(
  'no-arbitrary-file-writes',
  'local_file/local_sensitive_file resources write arbitrary content to the host filesystem.',
  'high',
  /resource\s+"local_(sensitive_)?file"/,
  'Arbitrary file-write resource found',
)

// ---------------------------------------------------------------------------
// Suspicious interpolation / credential references
// ---------------------------------------------------------------------------

const suspiciousInterpolation: SecurityPolicy = {
  name: 'no-suspicious-interpolation',
  description: 'Shell metacharacters inside a ${...} interpolation suggest a command-injection attempt.',
  severity: 'critical',
  evaluate: (hcl) => {
    const findings: SecurityFinding[] = []
    for (const match of hcl.matchAll(/\$\{[^}]*\}/g)) {
      const body = match[0]
      if (/[`;]|\$\(|&&|\|\|/.test(body)) {
        findings.push({
          policyName: 'no-suspicious-interpolation',
          severity: 'critical',
          message: `Suspicious interpolation: ${body}`,
          line: lineOf(hcl, match.index ?? 0),
        })
      }
    }
    return findings
  },
}

const noCredentialReferences = makeRegexPolicy(
  'no-credential-references',
  'Credentials must come from the environment/instance role, never be embedded in generated code.',
  'critical',
  /AKIA[0-9A-Z]{16}|aws_access_key_id\s*=\s*"[^"]|aws_secret_access_key\s*=\s*"[^"]|secret_key\s*=\s*"[^"$]/,
  'Embedded credential reference found',
)

export const SECURITY_POLICIES: SecurityPolicy[] = [
  noProvisioners,
  noLocalExec,
  noRemoteExec,
  unsupportedProvidersPolicy(),
  noDeletionDirectives,
  noIamWildcards,
  noPublicIngress,
  noEncryptionRemoval,
  noBackupRemoval,
  noExternalDataSources,
  noArbitraryFileWrites,
  suspiciousInterpolation,
  noCredentialReferences,
]
