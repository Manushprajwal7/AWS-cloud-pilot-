/**
 * The only providers and resource types CloudPilot is allowed to generate
 * or accept. static-validator.ts rejects anything outside this list
 * regardless of what the LLM (or a hand-crafted payload) asks for —
 * generation itself never emits anything outside it either
 * (generator.ts/templates.ts only ever build from RESOURCE_TYPE_BY_SERVICE
 * in types.ts, which is a subset of ALLOWED_RESOURCE_TYPES below).
 */

import type { TerraformResourceType } from './types'

export const ALLOWED_PROVIDERS = ['aws'] as const

export const ALLOWED_RESOURCE_TYPES: readonly TerraformResourceType[] = [
  'aws_instance',
  'aws_db_instance',
  'aws_ecs_service',
  'aws_lambda_function',
  'aws_elasticache_cluster',
]

export function isAllowedProvider(provider: string): boolean {
  return (ALLOWED_PROVIDERS as readonly string[]).includes(provider)
}

export function isAllowedResourceType(resourceType: string): boolean {
  return (ALLOWED_RESOURCE_TYPES as readonly string[]).includes(resourceType)
}

const REQUIRED_PROVIDER_SOURCE = 'hashicorp/aws'
const PINNED_PROVIDER_VERSION = '~> 5.0'

export function requiredProvidersBlock(): string {
  return `terraform {
  required_providers {
    aws = {
      source  = "${REQUIRED_PROVIDER_SOURCE}"
      version = "${PINNED_PROVIDER_VERSION}"
    }
  }
}`
}
