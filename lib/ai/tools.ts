/**
 * AI-facing tool registry: wraps the raw AWS mock actions in lib/tools/cloudTools.ts
 * with the Groq function-calling schema and the deterministic validation sandbox.
 */

import type { ZodTypeAny } from 'zod'
import {
  getInstancesTool,
  getCostMetricsTool,
  getAnomaliesTool,
  stopInstanceTool,
  modifyInstanceTypeTool,
  terminateInstanceTool,
  generateReportTool,
} from '@/lib/tools/cloudTools'
import { validateToolExecution } from '@/lib/sandbox/validationSandbox'
import type { GroqToolDefinition } from '@/lib/ai/groq'

export interface AgentTool {
  name: string
  description: string
  schema?: ZodTypeAny
  execute: (input: string | Record<string, unknown>) => Promise<string>
}

export const toolMap: Record<string, AgentTool> = {
  get_instances: getInstancesTool,
  get_cost_metrics: getCostMetricsTool,
  get_anomalies: getAnomaliesTool,
  stop_instance: stopInstanceTool,
  modify_instance_type: modifyInstanceTypeTool,
  terminate_instance: terminateInstanceTool,
  generate_optimization_report: generateReportTool,
}

export const STATE_MUTATING_TOOLS = ['stop_instance', 'terminate_instance', 'modify_instance_type'] as const

export function isStateMutatingTool(toolName: string): boolean {
  return (STATE_MUTATING_TOOLS as readonly string[]).includes(toolName)
}

/**
 * Build the Groq/OpenAI-compatible function-calling tool definitions
 * for every registered tool.
 */
export function buildToolDefinitions(): GroqToolDefinition[] {
  return Object.values(toolMap).map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties:
          tool.name === 'modify_instance_type'
            ? {
                instance_id: { type: 'string', description: 'EC2 instance ID' },
                new_type: {
                  type: 'string',
                  enum: ['t3.micro', 't3.small', 't3.medium', 'm5.large', 'm5.xlarge'],
                  description: 'Target instance type',
                },
              }
            : ['stop_instance', 'terminate_instance'].includes(tool.name)
              ? {
                  instance_id: { type: 'string', description: 'EC2 instance ID' },
                }
              : {},
        required:
          tool.name === 'modify_instance_type'
            ? ['instance_id', 'new_type']
            : ['stop_instance', 'terminate_instance'].includes(tool.name)
              ? ['instance_id']
              : [],
      },
    },
  }))
}

export interface ToolExecutionResult {
  result: string
  correctionNeeded: boolean
}

/**
 * Execute a tool by name, routing state-mutating tools through the
 * deterministic validation sandbox first. Never calls an LLM to decide
 * whether an action is safe.
 */
export async function executeTool(toolName: string, toolInput: Record<string, unknown>): Promise<ToolExecutionResult> {
  const tool = toolMap[toolName]
  if (!tool) {
    return {
      result: `[VALIDATION_ERROR] Unknown tool '${toolName}'`,
      correctionNeeded: true,
    }
  }

  try {
    if (isStateMutatingTool(toolName)) {
      const instanceId = String(toolInput.instance_id || toolInput.instanceId || '')

      if (!instanceId) {
        return {
          result: `[VALIDATION_ERROR] Missing instance_id parameter for ${toolName}`,
          correctionNeeded: true,
        }
      }

      const newType = toolInput.new_type ? String(toolInput.new_type) : undefined
      const validation = validateToolExecution(toolName, instanceId, newType)

      if (!validation.valid && validation.error) {
        return {
          result: `[POLICY_VIOLATION]
Tool: ${validation.error.details.tool}
Instance: ${validation.error.details.instanceId}
Error: ${validation.error.message}
Reason: ${validation.error.details.reason}
Suggestion: ${validation.error.details.suggestion}`,
          correctionNeeded: true,
        }
      }

      if (validation.warnings.length > 0) {
        console.log(`[cloudpilot] Validation warnings for ${toolName}:`, validation.warnings)
      }
    }

    let result: string

    if (toolName === 'stop_instance' || toolName === 'terminate_instance') {
      const instanceId = String(toolInput.instance_id || toolInput.instanceId || '')
      result = await tool.execute(instanceId)
    } else if (toolName === 'modify_instance_type') {
      const instanceId = String(toolInput.instance_id || toolInput.instanceId || '')
      const newType = String(toolInput.new_type || toolInput.newType || '')

      if (!newType) {
        return {
          result: '[VALIDATION_ERROR] Missing new_type parameter',
          correctionNeeded: true,
        }
      }

      result = await tool.execute({ instance_id: instanceId, new_type: newType })
    } else {
      result = await tool.execute({})
    }

    return {
      result,
      correctionNeeded: false,
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    return {
      result: `[EXECUTION_ERROR] ${errorMsg}`,
      correctionNeeded: true,
    }
  }
}
