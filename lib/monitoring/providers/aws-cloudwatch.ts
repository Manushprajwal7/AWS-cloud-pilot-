/**
 * AWS adapter: EC2 DescribeInstances for resource discovery, CloudWatch
 * GetMetricData for metrics. testConnection uses STS GetCallerIdentity — it
 * works with any valid AWS credentials regardless of EC2/CloudWatch IAM
 * scope, so a bad access key fails fast with a clear message instead of a
 * confusing permissions error from a heavier call.
 *
 * CloudWatch's default (no CloudWatch agent) EC2 metrics only cover
 * CPUUtilization/NetworkIn/NetworkOut — memoryPercent, latencyMs,
 * errorRatePercent, and requestsPerMinute have no default EC2 metric, so
 * they're reported as 0 rather than guessed.
 */

import { EC2Client, DescribeInstancesCommand, type Instance } from '@aws-sdk/client-ec2'
import { CloudWatchClient, GetMetricDataCommand, type MetricDataResult } from '@aws-sdk/client-cloudwatch'
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts'
import type { SimulatedCloudResource, ResourceMetrics, ResourceCost, CloudEnvironment } from '@/lib/simulation/types'
import type { AwsCredentials, ConnectionTestResult, MonitoringAdapter } from '../types'
import { createPollStore } from './poll-store'

const POLL_INTERVAL_MS = 60_000
const METRIC_LOOKBACK_MS = 10 * 60_000

function clientConfig(credentials: AwsCredentials) {
  return {
    region: credentials.region,
    endpoint: credentials.endpoint,
    credentials: { accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey },
  }
}

function environmentFromTags(instance: Instance): CloudEnvironment {
  const tag = instance.Tags?.find((t) => t.Key?.toLowerCase() === 'environment')?.Value?.toLowerCase()
  if (tag === 'development' || tag === 'staging' || tag === 'production') return tag
  return 'production'
}

function nameFromTags(instance: Instance): string {
  return instance.Tags?.find((t) => t.Key === 'Name')?.Value ?? instance.InstanceId ?? 'unknown-instance'
}

function latestValue(result: MetricDataResult | undefined): number {
  const value = result?.Values?.[0]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function createAwsCloudWatchAdapter(credentials: AwsCredentials): MonitoringAdapter {
  const store = createPollStore()
  const ec2 = new EC2Client(clientConfig(credentials))
  const cloudwatch = new CloudWatchClient(clientConfig(credentials))
  const sts = new STSClient(clientConfig(credentials))
  let timer: ReturnType<typeof setInterval> | null = null

  async function testConnection(): Promise<ConnectionTestResult> {
    try {
      const identity = await sts.send(new GetCallerIdentityCommand({}))
      return { ok: true, message: `Connected to AWS as ${identity.Arn ?? identity.Account ?? 'unknown identity'}.` }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Unable to authenticate with AWS' }
    }
  }

  async function discoverInstances(): Promise<Instance[]> {
    const response = await ec2.send(
      new DescribeInstancesCommand({ Filters: [{ Name: 'instance-state-name', Values: ['running'] }] }),
    )
    return (response.Reservations ?? []).flatMap((r) => r.Instances ?? []).filter((i): i is Instance => Boolean(i.InstanceId))
  }

  async function fetchMetrics(instanceIds: string[]): Promise<Map<string, ResourceMetrics>> {
    if (instanceIds.length === 0) return new Map()

    const now = new Date()
    const start = new Date(now.getTime() - METRIC_LOOKBACK_MS)

    const metricNames = ['CPUUtilization', 'NetworkIn', 'NetworkOut'] as const
    const queries = instanceIds.flatMap((id, idx) =>
      metricNames.map((metric) => ({
        Id: `m${idx}_${metric.toLowerCase()}`,
        MetricStat: {
          Metric: { Namespace: 'AWS/EC2', MetricName: metric, Dimensions: [{ Name: 'InstanceId', Value: id }] },
          Period: 300,
          Stat: metric === 'CPUUtilization' ? 'Average' : 'Sum',
        },
        ReturnData: true,
      })),
    )

    const results = new Map<string, ResourceMetrics>()
    // GetMetricData caps at 500 queries per call; instanceIds.length * 3 stays well under that for a dashboard-sized fleet.
    const response = await cloudwatch.send(
      new GetMetricDataCommand({ StartTime: start, EndTime: now, MetricDataQueries: queries }),
    )
    const byId = new Map((response.MetricDataResults ?? []).map((r) => [r.Id, r]))

    instanceIds.forEach((id, idx) => {
      const networkInBytes = latestValue(byId.get(`m${idx}_networkin`))
      const networkOutBytes = latestValue(byId.get(`m${idx}_networkout`))
      results.set(id, {
        cpuPercent: latestValue(byId.get(`m${idx}_cpuutilization`)),
        memoryPercent: 0,
        networkInMb: networkInBytes / (1024 * 1024),
        networkOutMb: networkOutBytes / (1024 * 1024),
        requestsPerMinute: 0,
        latencyMs: 0,
        errorRatePercent: 0,
        idleHours: 0,
      })
    })

    return results
  }

  async function pollOnce(): Promise<void> {
    const instances = await discoverInstances()
    const ids = instances.map((i) => i.InstanceId!).filter(Boolean)
    const metricsById = await fetchMetrics(ids)

    const resources: SimulatedCloudResource[] = instances.map((instance) => {
      const cost: ResourceCost = { hourlyUsd: 0, dailyUsd: 0, projectedMonthlyUsd: 0 }
      return {
        id: instance.InstanceId!,
        name: nameFromTags(instance),
        service: 'EC2',
        environment: environmentFromTags(instance),
        region: credentials.region,
        status: 'running',
        configuration: { instanceType: instance.InstanceType },
        metrics: metricsById.get(instance.InstanceId!) ?? {
          cpuPercent: 0, memoryPercent: 0, networkInMb: 0, networkOutMb: 0, requestsPerMinute: 0, latencyMs: 0, errorRatePercent: 0, idleHours: 0,
        },
        cost,
        activeScenario: 'NORMAL',
        updatedAt: new Date().toISOString(),
      }
    })

    store.applySnapshot(resources)
  }

  function start(): void {
    if (timer) return
    void pollOnce().catch(() => {})
    timer = setInterval(() => void pollOnce().catch(() => {}), POLL_INTERVAL_MS)
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  return { provider: 'AWS', testConnection, start, stop, store }
}
