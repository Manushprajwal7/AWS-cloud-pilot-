'use server'

import {
  resetInfrastructure,
  stopInstance,
  startInstance,
  getInstances,
  calculateTotalSpend,
  calculateEstimatedWaste,
  getAnomalies,
} from '@/lib/mockAwsState'

export interface InfrastructureState {
  instances: ReturnType<typeof getInstances>
  totalSpend: number
  estimatedWaste: number
  anomalyCount: number
}

/**
 * Reset the mock infrastructure to default state
 */
export async function resetInfrastructureAction(): Promise<InfrastructureState> {
  resetInfrastructure()

  return {
    instances: getInstances(),
    totalSpend: calculateTotalSpend(),
    estimatedWaste: calculateEstimatedWaste(),
    anomalyCount: getAnomalies().length,
  }
}

/**
 * Stop a specific instance
 */
export async function stopInstanceAction(instanceId: string): Promise<{
  success: boolean
  message: string
  state?: InfrastructureState
}> {
  const instance = stopInstance(instanceId)

  if (!instance) {
    return {
      success: false,
      message: `Failed to stop instance ${instanceId}. It may not exist or already be stopped.`,
    }
  }

  return {
    success: true,
    message: `Stopped instance ${instance.name}`,
    state: {
      instances: getInstances(),
      totalSpend: calculateTotalSpend(),
      estimatedWaste: calculateEstimatedWaste(),
      anomalyCount: getAnomalies().length,
    },
  }
}

/**
 * Start a specific instance
 */
export async function startInstanceAction(instanceId: string): Promise<{
  success: boolean
  message: string
  state?: InfrastructureState
}> {
  const instance = startInstance(instanceId)

  if (!instance) {
    return {
      success: false,
      message: `Failed to start instance ${instanceId}. It may not exist or already be running.`,
    }
  }

  return {
    success: true,
    message: `Started instance ${instance.name}`,
    state: {
      instances: getInstances(),
      totalSpend: calculateTotalSpend(),
      estimatedWaste: calculateEstimatedWaste(),
      anomalyCount: getAnomalies().length,
    },
  }
}

/**
 * Get current infrastructure state
 */
export async function getInfrastructureStateAction(): Promise<InfrastructureState> {
  return {
    instances: getInstances(),
    totalSpend: calculateTotalSpend(),
    estimatedWaste: calculateEstimatedWaste(),
    anomalyCount: getAnomalies().length,
  }
}
