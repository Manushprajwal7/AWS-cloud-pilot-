/**
 * Deterministic, pure-JS whitespace normalization applied before hashing
 * and persistence. This is NOT a substitute for `terraform fmt` (which
 * requires the real binary and is run for real by terraformFormatWorker in
 * the sandbox) — it exists so two semantically-identical generations never
 * hash differently just because of trailing whitespace or line-ending
 * differences.
 */

export function normalizeTerraformCode(hcl: string): string {
  const normalizedLineEndings = hcl.replace(/\r\n/g, '\n')
  const trimmedLines = normalizedLineEndings
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')

  return `${trimmedLines.replace(/\n{3,}/g, '\n\n').trim()}\n`
}
