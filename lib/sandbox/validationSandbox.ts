/**
 * Validation Sandbox: Safe execution layer with policy checking
 * Simulates AWS policy validation and permission checks before tool execution
 * Designed for self-correction: errors are fed back to agent for autonomous fixing
 */

import { getInstanceById, getInstances } from '@/lib/mockAwsState'

/**
 * Policy violation error types that get fed back to the ReAct loop
 */
export interface PolicyViolationError {
  code: 'PermissionDenied' | 'PolicyViolation' | 'ValidationError' | 'AccessDenied'
  message: string
  details: {
    tool: string
    instanceId: string
    reason: string
    suggestion: string
  }
}

/**
 * Validation result returned to ReAct loop
 */
export interface ValidationResult {
  valid: boolean
  error?: PolicyViolationError
  warnings: string[]
}

/**
 * Check if an instance is production-tagged
 * Used to prevent accidental production terminations
 */
function isProductionInstance(instanceId: string): boolean {
  const instance = getInstanceById(instanceId)
  if (!instance) return false

  const environment = instance.tags?.['Environment'] || ''
  return environment.toLowerCase() === 'production'
}

/**
 * Check if an instance is critical (high CPU, critical role)
 */
function isCriticalInstance(instanceId: string): boolean {
  const instance = getInstanceById(instanceId)
  if (!instance) return false

  // Critical if: CPU > 85% OR tagged as production with CPU > 70%
  const isProd = instance.tags?.['Environment'] === 'production'
  const highCpu = instance.cpuUtilization > 70

  return (isProd && highCpu) || instance.cpuUtilization > 85
}

/**
 * Validate stop_instance action
 * Returns error if targeting production instance
 */
export function validateStopInstance(instanceId: string): ValidationResult {
  const instance = getInstanceById(instanceId)

  if (!instance) {
    return {
      valid: false,
      error: {
        code: 'ValidationError',
        message: 'Instance not found',
        details: {
          tool: 'stop_instance',
          instanceId,
          reason: `Instance ${instanceId} does not exist`,
          suggestion: 'Use get_instances to list valid instances and verify the ID',
        },
      },
      warnings: [],
    }
  }

  // SIMULATE POLICY VIOLATION: Prevent stopping production instances
  if (isProductionInstance(instanceId)) {
    return {
      valid: false,
      error: {
        code: 'PermissionDenied',
        message: `Access Denied: Cannot stop production instance`,
        details: {
          tool: 'stop_instance',
          instanceId,
          reason: `Instance ${instance.name} is tagged as Environment=production. AWS policy prevents stopping production resources without explicit approval.`,
          suggestion: `Consider these alternatives: (1) downsize the instance instead using modify_instance_type, (2) stop a non-production instance like ${getFirstDevInstance()?.name || 'dev-web-01'}, or (3) request production access from your cloud governance team.`,
        },
      },
      warnings: [],
    }
  }

  // Warning: stopping critical instance
  if (isCriticalInstance(instanceId)) {
    return {
      valid: true,
      warnings: [
        `⚠️ WARNING: Instance ${instance.name} has high CPU utilization (${instance.cpuUtilization.toFixed(1)}%). Stopping may cause service disruption. Consider downsizing instead.`,
      ],
    }
  }

  // Valid: safe to stop
  return {
    valid: true,
    warnings: [],
  }
}

/**
 * Validate modify_instance_type action
 * Returns error if targeting production instance with insufficient justification
 */
export function validateModifyInstanceType(instanceId: string, newType: string): ValidationResult {
  const instance = getInstanceById(instanceId)

  if (!instance) {
    return {
      valid: false,
      error: {
        code: 'ValidationError',
        message: 'Instance not found',
        details: {
          tool: 'modify_instance_type',
          instanceId,
          reason: `Instance ${instanceId} does not exist`,
          suggestion: 'Use get_instances to list valid instances and verify the ID',
        },
      },
      warnings: [],
    }
  }

  // Check if downsizing to a valid smaller type
  const typeSizes: Record<string, number> = {
    't3.micro': 1,
    't3.small': 2,
    't3.medium': 3,
    'm5.large': 4,
    'm5.xlarge': 5,
  }

  const currentSize = typeSizes[instance.type]
  const newSize = typeSizes[newType]

  if (newSize === undefined) {
    return {
      valid: false,
      error: {
        code: 'ValidationError',
        message: `Invalid target type: ${newType}`,
        details: {
          tool: 'modify_instance_type',
          instanceId,
          reason: `${newType} is not a valid instance type`,
          suggestion: 'Valid types are: t3.micro, t3.small, t3.medium, m5.large, m5.xlarge',
        },
      },
      warnings: [],
    }
  }

  if (newSize >= currentSize) {
    return {
      valid: false,
      error: {
        code: 'ValidationError',
        message: `Cannot upsize instance - this increases costs`,
        details: {
          tool: 'modify_instance_type',
          instanceId,
          reason: `Current type ${instance.type} is equal to or smaller than target type ${newType}`,
          suggestion: `To save costs, resize to a smaller type. Current: ${instance.type}. Smaller options: ${Object.keys(typeSizes)
            .filter((t) => typeSizes[t] < currentSize)
            .join(', ') || 'none available'}`,
        },
      },
      warnings: [],
    }
  }

  // SIMULATE POLICY VIOLATION: Warn when modifying production instance
  if (isProductionInstance(instanceId)) {
    return {
      valid: true,
      warnings: [
        `⚠️ COMPLIANCE: Modifying production instance ${instance.name} requires documentation. This change is allowed but will be logged for audit purposes.`,
        `Instance ${instance.name} has CPU ${instance.cpuUtilization.toFixed(1)}% - verify downsizing won't impact performance`,
      ],
    }
  }

  return {
    valid: true,
    warnings: [],
  }
}

/**
 * Validate terminate_instance action
 * Highest risk - multiple policy checks
 */
export function validateTerminateInstance(instanceId: string): ValidationResult {
  const instance = getInstanceById(instanceId)

  if (!instance) {
    return {
      valid: false,
      error: {
        code: 'ValidationError',
        message: 'Instance not found',
        details: {
          tool: 'terminate_instance',
          instanceId,
          reason: `Instance ${instanceId} does not exist`,
          suggestion: 'Use get_instances to list valid instances and verify the ID',
        },
      },
      warnings: [],
    }
  }

  // SIMULATE POLICY VIOLATION: Never terminate production instances
  if (isProductionInstance(instanceId)) {
    return {
      valid: false,
      error: {
        code: 'PermissionDenied',
        message: `Access Denied: Cannot terminate production instance`,
        details: {
          tool: 'terminate_instance',
          instanceId,
          reason: `Instance ${instance.name} is tagged as Environment=production. AWS policy PROHIBITS terminating production resources - this requires explicit incident approval.`,
          suggestion: `Production instances cannot be terminated. Consider: (1) stopping instead using stop_instance, (2) downsizing using modify_instance_type, or (3) requesting incident approval from cloud governance team.`,
        },
      },
      warnings: [],
    }
  }

  // Block terminating instances with high utilization
  if (isCriticalInstance(instanceId)) {
    return {
      valid: false,
      error: {
        code: 'PolicyViolation',
        message: `Cannot terminate active instance`,
        details: {
          tool: 'terminate_instance',
          instanceId,
          reason: `Instance ${instance.name} has CPU ${instance.cpuUtilization.toFixed(1)}% utilization, indicating active use`,
          suggestion: `Terminate only truly idle instances. Consider: (1) stopping first with stop_instance, (2) downsizing with modify_instance_type, or (3) investigating why this instance shows usage before termination.`,
        },
      },
      warnings: [],
    }
  }

  // Safe to terminate
  return {
    valid: true,
    warnings: [`⚠️ IRREVERSIBLE: Terminating ${instance.name} cannot be undone. Ensure this instance is no longer needed.`],
  }
}

/**
 * Get first development instance (for suggestions)
 */
function getFirstDevInstance() {
  const instances = getInstances()
  return instances.find((i) => i.tags?.['Environment'] !== 'production')
}

/**
 * Main validation entry point - routes to appropriate validator
 */
export function validateToolExecution(
  toolName: string,
  instanceId: string,
  newType?: string,
): ValidationResult {
  switch (toolName) {
    case 'stop_instance':
      return validateStopInstance(instanceId)
    case 'modify_instance_type':
      return validateModifyInstanceType(instanceId, newType || '')
    case 'terminate_instance':
      return validateTerminateInstance(instanceId)
    default:
      return { valid: true, warnings: [] }
  }
}
