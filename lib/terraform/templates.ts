/**
 * Deterministic HCL assembly. Every value that ends up in generated code
 * comes from a real, computed input (the resource's current configuration,
 * or a deterministic recommendation from lib/financial/rightsizing.ts) —
 * this module never asks an LLM for a value, only for the narrative fields
 * that live alongside the plan (see nodes/terraform-generate.ts). Terraform
 * doesn't have a declarative "stop this instance" primitive without a
 * provisioner (which is banned outright — see security-policy.ts), so STOP
 * and SCHEDULE are represented the same real-world way ops teams already
 * do it without Terraform provisioners: a tag an external scheduler acts
 * on, not an in-place resource mutation.
 */

import type { SimulatedCloudResource } from '@/lib/simulation/types'
import { recommendRightsizing, recommendScaleIn, recommendScaleOut, type RemediationAction } from '@/lib/financial/rightsizing'
import { requiredProvidersBlock } from './provider-allowlist'
import { RESOURCE_TYPE_BY_SERVICE, type GeneratedTerraform, type TerraformResourceType } from './types'

export class UnsupportedRemediationError extends Error {
  constructor(action: RemediationAction, service: string) {
    super(`No Terraform template is defined for action '${action}' on service '${service}'`)
    this.name = 'UnsupportedRemediationError'
  }
}

function resourceLocalName(resource: SimulatedCloudResource): string {
  return resource.id.replace(/[^a-zA-Z0-9_]/g, '_')
}

/**
 * `terraform fmt` aligns every `=` in a contiguous block of assignments to
 * the widest key — generating anything less means terraformFormatWorker
 * fails on the very first attempt of every single run and has to burn a
 * selfCorrectionAgent cycle just to reformat whitespace, never a real fix.
 */
function tagsBlock(tags: Record<string, string>): string {
  const entries = Object.entries(tags).map(([key, value]) => [`"${key}"`, `"${value}"`] as const)
  const keyWidth = Math.max(...entries.map(([key]) => key.length))
  const lines = entries.map(([key, value]) => `    ${key.padEnd(keyWidth)} = ${value}`)
  return `  tags = {\n${lines.join('\n')}\n  }`
}

function baseAttributes(resource: SimulatedCloudResource): string[] {
  switch (resource.service) {
    case 'EC2':
      return [`  instance_type = "${resource.configuration.instanceType ?? 't3.small'}"`, `  ami           = data.aws_ami.approved.id`]
    case 'RDS':
      return [`  instance_class = "${resource.configuration.instanceType ?? 'db.t3.medium'}"`, `  engine         = "postgres"`]
    case 'ECS':
      return [`  desired_count = ${resource.configuration.desiredCapacity ?? 1}`, `  launch_type   = "FARGATE"`]
    case 'LAMBDA':
      return [`  memory_size = ${resource.configuration.memoryGb ? Math.round(resource.configuration.memoryGb * 1024) : 512}`, `  runtime     = "nodejs20.x"`]
    case 'ELASTICACHE':
      return [`  node_type = "${resource.configuration.instanceType ?? 'cache.t3.small'}"`]
  }
}

function buildResourceBlock(resource: SimulatedCloudResource, extraAttributes: string[], tags: Record<string, string>): string {
  const type = RESOURCE_TYPE_BY_SERVICE[resource.service]
  const name = resourceLocalName(resource)
  const attributes = [...baseAttributes(resource), ...extraAttributes, tagsBlock(tags)]

  return `resource "${type}" "${name}" {
${attributes.join('\n')}
}`
}

function baseTags(resource: SimulatedCloudResource): Record<string, string> {
  return {
    Name: resource.name,
    Environment: resource.environment,
    ManagedBy: 'cloudpilot',
  }
}

function generateRightsize(resource: SimulatedCloudResource): GeneratedTerraform {
  const recommendation = recommendRightsizing(resource)
  if (!recommendation) {
    throw new UnsupportedRemediationError('RIGHTSIZE', resource.service)
  }

  const sizeAttribute = resource.service === 'RDS' ? 'instance_class' : 'instance_type'
  const extra = [`  ${sizeAttribute} = "${recommendation.recommendedInstanceType}"`]
  // Overrides the size already in baseAttributes — Terraform HCL takes the
  // last-declared value textually in our own renderer below.
  const type = RESOURCE_TYPE_BY_SERVICE[resource.service]
  const name = resourceLocalName(resource)
  const attributes = baseAttributes(resource)
    .filter((line) => !line.trim().startsWith(sizeAttribute))
    .concat(extra)
    .concat(tagsBlock(baseTags(resource)))

  const hcl = `resource "${type}" "${name}" {
${attributes.join('\n')}
}`

  return { hcl, resourceType: type, resourceAddress: `${type}.${name}`, action: 'RIGHTSIZE' }
}

function generateScaleIn(resource: SimulatedCloudResource): GeneratedTerraform {
  const recommendation = recommendScaleIn(resource)
  if (!recommendation) {
    throw new UnsupportedRemediationError('SCALE_IN', resource.service)
  }

  const type = RESOURCE_TYPE_BY_SERVICE[resource.service]
  const name = resourceLocalName(resource)
  const attributes = baseAttributes(resource)
    .filter((line) => !line.trim().startsWith('desired_count'))
    .concat([`  desired_count = ${recommendation.recommendedCapacity}`])
    .concat(tagsBlock(baseTags(resource)))

  const hcl = `resource "${type}" "${name}" {
${attributes.join('\n')}
}`

  return { hcl, resourceType: type, resourceAddress: `${type}.${name}`, action: 'SCALE_IN' }
}

function generateScaleOut(resource: SimulatedCloudResource): GeneratedTerraform {
  const recommendation = recommendScaleOut(resource)
  if (!recommendation) {
    throw new UnsupportedRemediationError('SCALE_OUT', resource.service)
  }

  const type = RESOURCE_TYPE_BY_SERVICE[resource.service]
  const name = resourceLocalName(resource)
  const attributes = baseAttributes(resource)
    .filter((line) => !line.trim().startsWith('desired_count'))
    .concat([`  desired_count = ${recommendation.recommendedCapacity}`])
    .concat(tagsBlock(baseTags(resource)))

  const hcl = `resource "${type}" "${name}" {
${attributes.join('\n')}
}`

  return { hcl, resourceType: type, resourceAddress: `${type}.${name}`, action: 'SCALE_OUT' }
}

function generateScheduleOrStop(resource: SimulatedCloudResource, action: 'STOP' | 'SCHEDULE'): GeneratedTerraform {
  const type = RESOURCE_TYPE_BY_SERVICE[resource.service]
  const name = resourceLocalName(resource)
  const scheduleTagValue = action === 'STOP' ? 'stop-now' : 'stop-outside-business-hours'

  const hcl = buildResourceBlock(resource, [], { ...baseTags(resource), 'cloudpilot:schedule': scheduleTagValue })

  return { hcl, resourceType: type, resourceAddress: `${type}.${name}`, action }
}

/**
 * NO_ACTION has no defined Terraform template — there's nothing to change.
 * It throws so the graph node fails loudly rather than silently emitting a
 * no-op plan.
 */
export function generateTerraformForAction(resource: SimulatedCloudResource, action: RemediationAction): GeneratedTerraform {
  switch (action) {
    case 'RIGHTSIZE':
      return generateRightsize(resource)
    case 'SCALE_IN':
      return generateScaleIn(resource)
    case 'SCALE_OUT':
      return generateScaleOut(resource)
    case 'STOP':
      return generateScheduleOrStop(resource, 'STOP')
    case 'SCHEDULE':
      return generateScheduleOrStop(resource, 'SCHEDULE')
    case 'NO_ACTION':
      throw new UnsupportedRemediationError(action, resource.service)
  }
}

/**
 * Standard (non-external) AWS data sources a resource block references and
 * that must therefore also be present in the file, or `terraform validate`
 * fails on an undeclared reference. Only aws_instance needs this today
 * (it references data.aws_ami.approved for its ami argument).
 */
export function dataBlocksFor(resourceType: TerraformResourceType): string {
  if (resourceType !== 'aws_instance') return ''

  return `data "aws_ami" "approved" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["amzn2-ami-hvm-*-x86_64-gp2"]
  }
}

`
}

export function wrapWithProviderBlock(hcl: string, resourceType: TerraformResourceType): string {
  return `${requiredProvidersBlock()}\n\nprovider "aws" {\n  region = "us-east-1"\n}\n\n${dataBlocksFor(resourceType)}${hcl}\n`
}
