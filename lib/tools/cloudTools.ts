/**
 * LangChain tool definitions for the FinOps agent
 * These tools allow the AI to interact with mock AWS infrastructure
 * Each tool includes explicit schema for validation and type safety
 */

import {
  stopInstance,
  terminateInstance,
  modifyInstanceType,
  getInstances,
  getAnomalies,
  getInstanceById,
  calculateTotalSpend,
  calculateEstimatedWaste,
} from '@/lib/mockAwsState'
import { instanceIdSchema, modifyInstanceSchema, emptySchema } from '@/lib/ai/schemas'

/**
 * Tool: Get all running instances
 */
export const getInstancesTool = {
  name: 'get_instances',
  description: 'Retrieve all EC2 instances in the mock AWS environment with their utilization metrics',
  schema: emptySchema,
  async execute(): Promise<string> {
    const instances = getInstances()
    const summary = instances
      .map(
        (i) =>
          `${i.name} (${i.instanceId}): CPU=${i.cpuUtilization.toFixed(1)}%, Memory=${i.memoryUtilization}%, $${i.hourlyRate}/hr, State=${i.state}`,
      )
      .join('\n')
    return `Found ${instances.length} instances:\n${summary}`
  },
}

/**
 * Tool: Get cost metrics
 */
export const getCostMetricsTool = {
  name: 'get_cost_metrics',
  description: 'Get current cloud spend, estimated waste, and cost analysis for the infrastructure',
  schema: emptySchema,
  async execute(): Promise<string> {
    const totalSpend = calculateTotalSpend()
    const estimatedWaste = calculateEstimatedWaste()
    const wastePercentage = ((estimatedWaste / totalSpend) * 100).toFixed(1)

    return `Cost Metrics:
- Total Monthly Spend: $${totalSpend.toFixed(2)}
- Estimated Monthly Waste: $${estimatedWaste.toFixed(2)} (${wastePercentage}%)
- Optimization Potential: $${(estimatedWaste * 12).toFixed(2)}/year`
  },
}

/**
 * Tool: Get anomalies (idle or over-utilized instances)
 */
export const getAnomaliesTool = {
  name: 'get_anomalies',
  description: 'Identify instances with utilization anomalies (very high or very low CPU usage). Look for the idle instance with ~1.8% CPU.',
  schema: emptySchema,
  async execute(): Promise<string> {
    const anomalies = getAnomalies()

    if (anomalies.length === 0) {
      return 'No anomalies detected. All instances have normal utilization patterns.'
    }

    const anomalyDetails = anomalies
      .map((a) => {
        if (a.cpuUtilization < 5) {
          return `[IDLE] ${a.name} (${a.instanceId}): ${a.cpuUtilization.toFixed(1)}% CPU - Candidate for termination or downsizing`
        }
        return `[HIGH CPU] ${a.name} (${a.instanceId}): ${a.cpuUtilization.toFixed(1)}% CPU - Possible bottleneck`
      })
      .join('\n')

    return `Detected ${anomalies.length} anomalies:\n${anomalyDetails}`
  },
}

/**
 * PRIMARY TOOL: Stop an instance (optimization action)
 * This directly mutates mockAwsState by changing instance state to 'stopped'
 */
export const stopInstanceTool = {
  name: 'stop_instance',
  description:
    'CRITICAL ACTION: Stop a running EC2 instance to reduce costs. Use this for idle or underutilized instances (< 5% CPU). This directly mutates the infrastructure state.',
  schema: instanceIdSchema,
  async execute(input: string | Record<string, unknown>): Promise<string> {
    const instanceId = typeof input === 'string' ? input : String(input.instance_id ?? '')

    const instance = getInstanceById(instanceId)
    if (!instance) {
      return `Error: Instance ${instanceId} not found. Check get_instances tool first.`
    }

    if (instance.state === 'stopped') {
      return `Warning: Instance ${instance.name} is already stopped.`
    }

    if (instance.cpuUtilization > 20) {
      return `Warning: Instance ${instance.name} has ${instance.cpuUtilization.toFixed(1)}% CPU utilization. Stopping might impact workloads. Consider monitoring first.`
    }

    const result = stopInstance(instanceId)
    if (result) {
      const monthlySavings = (result.hourlyRate * 730).toFixed(2)
      return `✓ [STATE MUTATED] Successfully stopped instance ${result.name} (${instanceId}). Infrastructure state updated. Potential monthly savings: $${monthlySavings}`
    }

    return `Error: Could not stop instance ${instanceId}.`
  },
}

/**
 * PRIMARY TOOL: Modify instance type (resize/downsize)
 * This directly mutates mockAwsState by changing the instance type and hourly rate
 */
export const modifyInstanceTypeTool = {
  name: 'modify_instance_type',
  description:
    'CRITICAL ACTION: Resize an EC2 instance to a different type. Use this for right-sizing underutilized instances. This directly mutates the infrastructure state by updating the instance type and cost.',
  schema: modifyInstanceSchema,
  async execute(input: string | Record<string, unknown>): Promise<string> {
    const instanceId = typeof input === 'string' ? input : String(input.instance_id ?? '')
    const newType = typeof input === 'string' ? '' : String(input.new_type ?? '')

    const instance = getInstanceById(instanceId)
    if (!instance) {
      return `Error: Instance ${instanceId} not found. Check get_instances tool first.`
    }

    if (instance.type === newType) {
      return `Warning: Instance ${instance.name} is already of type ${newType}.`
    }

    const validTypes = modifyInstanceSchema.shape.new_type.options
    if (!(validTypes as readonly string[]).includes(newType)) {
      return `Error: '${newType}' is not a valid instance type. Valid types: ${validTypes.join(', ')}`
    }

    const result = modifyInstanceType(instanceId, newType as (typeof validTypes)[number])
    if (result) {
      const oldCost = (instance.hourlyRate * 730).toFixed(2)
      const newCost = (result.hourlyRate * 730).toFixed(2)
      const monthlySavings = (parseFloat(oldCost) - parseFloat(newCost)).toFixed(2)

      return `✓ [STATE MUTATED] Successfully modified instance ${result.name} from ${instance.type} to ${newType}. Infrastructure state updated. Monthly cost: $${oldCost} → $${newCost} (saves $${monthlySavings})`
    }

    return `Error: Could not modify instance type for ${instanceId}`
  },
}

/**
 * Tool: Terminate an instance (permanent removal)
 */
export const terminateInstanceTool = {
  name: 'terminate_instance',
  description:
    'Permanently terminate an EC2 instance. Use only for idle instances no longer needed. CAUTION: This action is irreversible and directly mutates the infrastructure state.',
  schema: instanceIdSchema,
  async execute(input: string | Record<string, unknown>): Promise<string> {
    const instanceId = typeof input === 'string' ? input : String(input.instance_id ?? '')

    const instance = getInstanceById(instanceId)
    if (!instance) {
      return `Error: Instance ${instanceId} not found`
    }

    if (instance.cpuUtilization > 50) {
      return `Warning: Refusing to terminate ${instance.name}. High CPU utilization (${instance.cpuUtilization.toFixed(1)}%) suggests this instance is actively being used.`
    }

    const result = terminateInstance(instanceId)
    if (result) {
      const annualSavings = (result.hourlyRate * 730 * 12).toFixed(2)
      return `✓ [STATE MUTATED] Successfully terminated instance ${result.name} (${instanceId}). Infrastructure state updated. Annual savings: $${annualSavings}`
    }

    return `Error: Could not terminate instance ${instanceId}`
  },
}

/**
 * Tool: Generate optimization report
 */
export const generateReportTool = {
  name: 'generate_optimization_report',
  description:
    'Generate a comprehensive FinOps optimization report analyzing all instances and opportunities',
  schema: emptySchema,
  async execute(): Promise<string> {
    const instances = getInstances()
    const anomalies = getAnomalies()
    const totalSpend = calculateTotalSpend()
    const estimatedWaste = calculateEstimatedWaste()

    const runningInstances = instances.filter((i) => i.state === 'running')
    const stoppedInstances = instances.filter((i) => i.state === 'stopped')

    const report = `
╔════════════════════════════════════════════════════════════════╗
║           AWS CloudPilot FinOps Optimization Report            ║
╚════════════════════════════════════════════════════════════════╝

📊 INFRASTRUCTURE OVERVIEW:
  • Total Instances: ${instances.length}
  • Running: ${runningInstances.length}
  • Stopped: ${stoppedInstances.length}
  • Total Monthly Spend: $${totalSpend.toFixed(2)}
  • Estimated Monthly Waste: $${estimatedWaste.toFixed(2)}
  • Waste Percentage: ${((estimatedWaste / totalSpend) * 100).toFixed(1)}%

🚨 ANOMALIES DETECTED: ${anomalies.length}
${anomalies.length > 0 ? anomalies.map((a) => `  • ${a.name} (${a.instanceId}): ${a.cpuUtilization.toFixed(1)}% CPU utilization`).join('\n') : '  • None detected'}

💡 RECOMMENDATIONS:
  1. Review and terminate or downsize underutilized instances (< 10% CPU)
  2. Consider reserved instances for predictable workloads
  3. Implement auto-scaling for variable workloads
  4. Evaluate multi-region optimization opportunities

📈 POTENTIAL ANNUAL SAVINGS: $${(estimatedWaste * 12).toFixed(2)}
    `

    return report
  },
}

/**
 * Export all tools as an array
 */
export const tools = [
  getInstancesTool,
  getCostMetricsTool,
  getAnomaliesTool,
  stopInstanceTool,
  modifyInstanceTypeTool,
  terminateInstanceTool,
  generateReportTool,
]
