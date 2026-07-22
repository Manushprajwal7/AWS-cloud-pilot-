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
import { RESOURCE_TYPE_BY_SERVICE, type GeneratedTerraform } from './types'

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

/**
 * Amazon Linux 2 AMI (us-east-1), pinned rather than resolved via a live
 * `data "aws_ami"` lookup — the sandbox plan step runs with no AWS
 * credentials and no network (see lib/terraform/sandbox.ts), so a real
 * data-source query would always fail terraform plan.
 */
const PINNED_EC2_AMI_ID = 'ami-0c101f26f147fa7fd'

function baseAttributes(resource: SimulatedCloudResource): string[] {
  switch (resource.service) {
    case 'EC2':
      return [`  instance_type = "${resource.configuration.instanceType ?? 't3.small'}"`, `  ami           = "${PINNED_EC2_AMI_ID}"`]
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

  const changeSummary =
    `Countering sustained low utilization on ${resource.name} (cpuPercent=${resource.metrics.cpuPercent.toFixed(1)}%, ` +
    `memoryPercent=${resource.metrics.memoryPercent.toFixed(1)}%) by gracefully downgrading ${sizeAttribute} from ` +
    `${recommendation.currentInstanceType} to ${recommendation.recommendedInstanceType} — projected savings $${recommendation.monthlySavings.toFixed(2)}/mo.`

  return { hcl, resourceType: type, resourceAddress: `${type}.${name}`, action: 'RIGHTSIZE', changeSummary }
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

  const changeSummary =
    `Countering sustained low utilization on ${resource.name} (cpuPercent=${resource.metrics.cpuPercent.toFixed(1)}%) by ` +
    `gracefully scaling desired_count from ${recommendation.currentCapacity} to ${recommendation.recommendedCapacity} tasks — ` +
    `one task at a time, never below minCapacity — projected savings $${recommendation.monthlySavings.toFixed(2)}/mo.`

  return { hcl, resourceType: type, resourceAddress: `${type}.${name}`, action: 'SCALE_IN', changeSummary }
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

  const changeSummary =
    `Countering sustained high utilization on ${resource.name} (cpuPercent=${resource.metrics.cpuPercent.toFixed(1)}%) by ` +
    `scaling desired_count from ${recommendation.currentCapacity} to ${recommendation.recommendedCapacity} tasks — one task at a time, never above maxCapacity.`

  return { hcl, resourceType: type, resourceAddress: `${type}.${name}`, action: 'SCALE_OUT', changeSummary }
}

function generateScheduleOrStop(resource: SimulatedCloudResource, action: 'STOP' | 'SCHEDULE'): GeneratedTerraform {
  const type = RESOURCE_TYPE_BY_SERVICE[resource.service]
  const name = resourceLocalName(resource)
  const scheduleTagValue = action === 'STOP' ? 'stop-now' : 'stop-outside-business-hours'

  const hcl = buildResourceBlock(resource, [], { ...baseTags(resource), 'cloudpilot:schedule': scheduleTagValue })

  const changeSummary =
    action === 'STOP'
      ? `Countering idle/waste on ${resource.name} by tagging it for immediate stop via the external scheduler — Terraform has no ` +
        `declarative "stop this instance" primitive without a provisioner (banned by security-policy.ts), so this applies a tag an ` +
        `operator/scheduler acts on rather than an in-place resource mutation.`
      : `Countering off-hours waste on ${resource.name} by tagging it to stop outside business hours via the external scheduler.`

  return { hcl, resourceType: type, resourceAddress: `${type}.${name}`, action, changeSummary }
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
 * The sandbox intentionally runs `terraform plan` with no host AWS
 * credentials and no network access (see lib/terraform/sandbox.ts) — but
 * the real `aws` provider still validates its credential source by default
 * (including an EC2 instance-metadata check that times out with no
 * network), even for a plan that only creates brand-new resources with no
 * live API calls. skip_* disables that validation; the credentials
 * themselves are never embedded here — they're injected as
 * AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY env vars by the sandbox command
 * runner instead (lib/terraform/sandbox.ts), exactly as security-policy.ts's
 * no-credential-references rule requires ("credentials must come from the
 * environment/instance role, never be embedded in generated code") —
 * embedding them as HCL attributes here would trip that same policy.
 *
 * `changeSummary`, when given, is rendered as a comment header directly
 * above the resource — the real before/after values and rationale for this
 * specific remediation, documented in the .tf file itself rather than only
 * in the UI. generator.ts always splices a `lifecycle { create_before_destroy
 * = true }` block into the resource too, so the comment's claim about a
 * graceful, non-destructive change is actually backed by the HCL.
 *
 * When TERRAFORM_AWS_ENDPOINT is set (pointing at a LocalStack instance —
 * see docker-compose.yml's `localstack` service and .env.example), every
 * service endpoint is redirected there instead of real AWS, so `terraform
 * apply` actually succeeds against a real (local, free, zero-risk) AWS API
 * instead of failing authentication against the genuine one. Unset, apply
 * still genuinely reaches real AWS and fails — this app never has real AWS
 * write credentials, so that failure is honest, not a bug.
 */
export function wrapWithProviderBlock(hcl: string, changeSummary?: string): string {
  const localstackEndpoint = process.env.TERRAFORM_AWS_ENDPOINT

  const endpointsBlock = localstackEndpoint
    ? `

  endpoints {
    ec2         = "${localstackEndpoint}"
    rds         = "${localstackEndpoint}"
    ecs         = "${localstackEndpoint}"
    lambda      = "${localstackEndpoint}"
    elasticache = "${localstackEndpoint}"
  }`
    : ''

  const providerBlock = `provider "aws" {
  region                      = "us-east-1"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
  skip_region_validation      = true${endpointsBlock}
}`

  const header = changeSummary
    ? `# CloudPilot automated remediation\n# ${changeSummary}\n# lifecycle.create_before_destroy below ensures this change is never applied\n# by destroying the existing resource before its replacement exists.\n${localstackEndpoint ? '# Provider endpoints are redirected to LocalStack (TERRAFORM_AWS_ENDPOINT) so apply runs against a real, local, free AWS API.\n' : ''}\n`
    : ''

  return `${header}${requiredProvidersBlock()}\n\n${providerBlock}\n\n${hcl}\n`
}
