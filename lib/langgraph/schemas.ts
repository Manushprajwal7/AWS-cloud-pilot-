import { z } from 'zod'

export const graphRunRequestSchema = z.object({
  resourceId: z.string().trim().min(1, 'resourceId must not be empty'),
})

export type GraphRunRequest = z.infer<typeof graphRunRequestSchema>
