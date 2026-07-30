import { z } from 'zod'

/** Lifecycle status of a durable Run. */
export const runStatusSchema = z.enum([
  'planning',
  'awaiting_approval',
  'running',
  'paused',
  'done',
  'failed',
])
export type RunStatus = z.infer<typeof runStatusSchema>

/** One step of a proposed Plan. */
export const planStepSchema = z.object({
  index: z.number().int().nonnegative(),
  description: z.string(),
})
export type PlanStep = z.infer<typeof planStepSchema>

/** The agent's proposed, user-approvable plan for a Run. */
export const planSchema = z.object({
  id: z.string(),
  steps: z.array(planStepSchema),
  approvedAt: z.string().nullable().optional(),
})
export type Plan = z.infer<typeof planSchema>

/** A persisted unit of a Run's execution — the resume log. */
export const runStepSchema = z.object({
  id: z.string(),
  seq: z.number().int(),
  kind: z.string(),
  data: z.unknown(),
  createdAt: z.string(),
})
export type RunStep = z.infer<typeof runStepSchema>

/** A durable, resumable execution of an agent toward a Goal. */
export const runSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  goal: z.string(),
  status: runStatusSchema,
  result: z.unknown().nullable().optional(),
  error: z.string().nullable().optional(),
  plan: planSchema.nullable().optional(),
  steps: z.array(runStepSchema).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Run = z.infer<typeof runSchema>

/** Payload to launch a Run. `conversationId` is optional — omit to start fresh. */
export const createRunInputSchema = z.object({
  goal: z.string().min(1).max(8000),
  conversationId: z.string().optional(),
})
export type CreateRunInput = z.infer<typeof createRunInputSchema>

/** Payload to approve (and optionally edit) a proposed plan, starting execution. */
export const approvePlanInputSchema = z.object({
  steps: z.array(planStepSchema).optional(),
})
export type ApprovePlanInput = z.infer<typeof approvePlanInputSchema>
