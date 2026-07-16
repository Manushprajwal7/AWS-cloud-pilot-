/**
 * Parses the real `terraform show -json` output into the small summary
 * shape the UI/API actually needs. Only the fields CloudPilot uses are
 * validated (Terraform's full plan JSON schema is large and
 * version-dependent); everything else in the payload is ignored, not
 * trusted or re-derived.
 */

import { z } from 'zod'
import type { PlanSummary } from './types'

const resourceChangeSchema = z.object({
  address: z.string(),
  type: z.string(),
  change: z.object({
    actions: z.array(z.string()),
  }),
})

const planJsonSchema = z.object({
  resource_changes: z.array(resourceChangeSchema).optional().default([]),
})

export class PlanParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlanParseError'
  }
}

export function parseTerraformPlanJson(rawJson: string): PlanSummary {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch {
    throw new PlanParseError('terraform show -json produced invalid JSON')
  }

  const result = planJsonSchema.safeParse(parsed)
  if (!result.success) {
    throw new PlanParseError(`terraform plan JSON did not match the expected shape: ${result.error.message}`)
  }

  const resourceChanges = result.data.resource_changes.map((rc) => ({
    address: rc.address,
    type: rc.type,
    actions: rc.change.actions,
  }))

  const count = (action: string) => resourceChanges.filter((rc) => rc.actions.includes(action)).length

  return {
    creates: count('create'),
    updates: count('update'),
    deletes: count('delete'),
    noOps: count('no-op'),
    resourceChanges,
  }
}
