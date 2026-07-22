/**
 * Request-body validation for /api/monitoring/{test,connect} — a Zod
 * discriminated union on `provider`, following the same convention as
 * app/api/simulation/scenario/route.ts's scenarioRequestSchema.
 */

import { z } from 'zod'

const awsSchema = z.object({
  provider: z.literal('AWS'),
  credentials: z.object({
    accessKeyId: z.string().min(1),
    secretAccessKey: z.string().min(1),
    region: z.string().min(1),
    endpoint: z.string().url().optional(),
  }),
})

const gcpSchema = z.object({
  provider: z.literal('GCP'),
  credentials: z
    .object({
      serviceAccountJson: z.string().min(1).optional(),
      clientEmail: z.string().min(1).optional(),
      privateKey: z.string().min(1).optional(),
      projectId: z.string().min(1),
      endpoint: z.string().url().optional(),
    })
    .refine((c) => Boolean(c.serviceAccountJson) || Boolean(c.clientEmail && c.privateKey), {
      message: 'Provide either serviceAccountJson or both clientEmail and privateKey',
    }),
})

const prometheusSchema = z.object({
  provider: z.literal('PROMETHEUS'),
  credentials: z.object({
    serverUrl: z.string().url(),
    username: z.string().optional(),
    password: z.string().optional(),
    bearerToken: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
})

export const monitoringCredentialsSchema = z.discriminatedUnion('provider', [awsSchema, gcpSchema, prometheusSchema])

export type MonitoringCredentialsInput = z.infer<typeof monitoringCredentialsSchema>
