/**
 * In-memory representation of mock AWS infrastructure
 * This simulates a real AWS environment with EC2 instances
 */

export interface AwsInstance {
  instanceId: string
  type: 't3.micro' | 't3.small' | 't3.medium' | 'm5.large' | 'm5.xlarge'
  cpuUtilization: number // percentage
  memoryUtilization: number // percentage
  hourlyRate: number // in USD
  region: string
  state: 'running' | 'stopped' | 'terminated'
  launchTime: Date
  name: string
  tags?: Record<string, string> // Tags for environment, cost-center, etc.
}

// Initialize mock AWS instances
let mockInstances: AwsInstance[] = [
  {
    instanceId: 'i-0abc123def456789a',
    type: 't3.micro',
    cpuUtilization: 1.8, // Idle instance for optimization
    memoryUtilization: 12,
    hourlyRate: 0.0104,
    region: 'us-east-1',
    state: 'running',
    launchTime: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    name: 'dev-web-01',
  },
  {
    instanceId: 'i-0abc123def456789b',
    type: 't3.small',
    cpuUtilization: 45.2,
    memoryUtilization: 68,
    hourlyRate: 0.0208,
    region: 'us-east-1',
    state: 'running',
    launchTime: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    name: 'prod-api-01',
    tags: { Environment: 'production', CostCenter: 'platform' },
  },
  {
    instanceId: 'i-0abc123def456789c',
    type: 't3.medium',
    cpuUtilization: 78.5,
    memoryUtilization: 82,
    hourlyRate: 0.0416,
    region: 'eu-west-1',
    state: 'running',
    launchTime: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
    name: 'prod-db-01',
    tags: { Environment: 'production', CostCenter: 'database' },
  },
  {
    instanceId: 'i-0abc123def456789d',
    type: 'm5.large',
    cpuUtilization: 92.1,
    memoryUtilization: 88,
    hourlyRate: 0.096,
    region: 'us-west-2',
    state: 'running',
    tags: { Environment: 'production', CostCenter: 'analytics' },
    launchTime: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
    name: 'analytics-server',
  },
  {
    instanceId: 'i-0abc123def456789e',
    type: 't3.small',
    cpuUtilization: 3.2,
    memoryUtilization: 8,
    hourlyRate: 0.0208,
    region: 'us-east-1',
    state: 'running',
    launchTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    name: 'staging-app-01',
    tags: { Environment: 'staging', CostCenter: 'dev-ops' },
  },
]

/**
 * Get all mock instances
 */
export function getInstances(): AwsInstance[] {
  return [...mockInstances]
}

/**
 * Stop a running instance
 */
export function stopInstance(instanceId: string): AwsInstance | null {
  const instance = mockInstances.find((i) => i.instanceId === instanceId)
  if (instance && instance.state === 'running') {
    instance.state = 'stopped'
    return instance
  }
  return null
}

/**
 * Start a stopped instance
 */
export function startInstance(instanceId: string): AwsInstance | null {
  const instance = mockInstances.find((i) => i.instanceId === instanceId)
  if (instance && instance.state === 'stopped') {
    instance.state = 'running'
    return instance
  }
  return null
}

/**
 * Terminate an instance
 */
export function terminateInstance(instanceId: string): AwsInstance | null {
  const instance = mockInstances.find((i) => i.instanceId === instanceId)
  if (instance && instance.state !== 'terminated') {
    instance.state = 'terminated'
    return instance
  }
  return null
}

/**
 * Modify instance type (resize) - directly mutates the infrastructure state
 * This is one of the two primary optimization tools
 */
export function modifyInstanceType(
  instanceId: string,
  newType: 't3.micro' | 't3.small' | 't3.medium' | 'm5.large' | 'm5.xlarge',
): AwsInstance | null {
  const instance = mockInstances.find((i) => i.instanceId === instanceId)
  if (!instance) {
    return null
  }

  // Type-to-hourly-rate mapping
  const typeRates: Record<string, number> = {
    't3.micro': 0.0104,
    't3.small': 0.0208,
    't3.medium': 0.0416,
    'm5.large': 0.096,
    'm5.xlarge': 0.192,
  }

  const newRate = typeRates[newType]
  if (!newRate) {
    return null
  }

  // Update the instance type and hourly rate in the in-memory state
  instance.type = newType
  instance.hourlyRate = newRate

  return instance
}

/**
 * Reset the infrastructure state to defaults
 */
export function resetInfrastructure(): void {
  mockInstances = [
    {
      instanceId: 'i-0abc123def456789a',
      type: 't3.micro',
      cpuUtilization: 1.8,
      memoryUtilization: 12,
      hourlyRate: 0.0104,
      region: 'us-east-1',
      state: 'running',
      launchTime: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      name: 'dev-web-01',
    },
    {
      instanceId: 'i-0abc123def456789b',
      type: 't3.small',
      cpuUtilization: 45.2,
      memoryUtilization: 68,
      hourlyRate: 0.0208,
      region: 'us-east-1',
      state: 'running',
      launchTime: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      name: 'prod-api-01',
    },
    {
      instanceId: 'i-0abc123def456789c',
      type: 't3.medium',
      cpuUtilization: 78.5,
      memoryUtilization: 82,
      hourlyRate: 0.0416,
      region: 'eu-west-1',
      state: 'running',
      launchTime: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      name: 'prod-db-01',
    },
    {
      instanceId: 'i-0abc123def456789d',
      type: 'm5.large',
      cpuUtilization: 92.1,
      memoryUtilization: 88,
      hourlyRate: 0.096,
      region: 'us-west-2',
      state: 'running',
      launchTime: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      name: 'analytics-server',
    },
    {
      instanceId: 'i-0abc123def456789e',
      type: 't3.small',
      cpuUtilization: 3.2,
      memoryUtilization: 18,
      hourlyRate: 0.0208,
      region: 'us-east-1',
      state: 'running',
      launchTime: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
      name: 'staging-app-01',
    },
  ]
}

/**
 * Calculate total monthly spend based on running instances
 */
export function calculateTotalSpend(): number {
  const runningInstances = mockInstances.filter((i) => i.state === 'running')
  const hoursPerMonth = 730 // average hours per month
  return runningInstances.reduce((total, instance) => total + instance.hourlyRate * hoursPerMonth, 0)
}

/**
 * Calculate estimated waste from underutilized instances
 */
export function calculateEstimatedWaste(): number {
  // Instances with < 10% CPU utilization are considered underutilized
  const wasteThreshold = 10
  const underutilizedInstances = mockInstances.filter(
    (i) => i.state === 'running' && i.cpuUtilization < wasteThreshold,
  )

  const hoursPerMonth = 730
  // Estimate that 70% of underutilized instance cost is waste
  return underutilizedInstances.reduce((total, instance) => total + instance.hourlyRate * hoursPerMonth * 0.7, 0)
}

/**
 * Get instances with anomalies (high CPU or idle resources)
 */
export function getAnomalies(): AwsInstance[] {
  const anomalies: AwsInstance[] = []

  mockInstances.forEach((instance) => {
    if (instance.state === 'running') {
      // High CPU anomaly (> 85%)
      if (instance.cpuUtilization > 85) {
        anomalies.push(instance)
      }
      // Low utilization anomaly (< 5%)
      if (instance.cpuUtilization < 5) {
        anomalies.push(instance)
      }
    }
  })

  return anomalies
}

/**
 * Get instance details by ID
 */
export function getInstanceById(instanceId: string): AwsInstance | null {
  return mockInstances.find((i) => i.instanceId === instanceId) || null
}
