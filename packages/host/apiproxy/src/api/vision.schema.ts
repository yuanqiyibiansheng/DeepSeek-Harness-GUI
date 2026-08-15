/** Zod schemas for the Bailian vision-enhancement API. */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'

const imageMediaTypeSchema = z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export const visionStatusRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'vision.status'>>>
export const visionStatusValueSchema = z.object({
  enabled: z.boolean(),
  configured: z.boolean(),
  model: z.literal('qwen3.8-max'),
  apiKeyUrl: z.url(),
}) satisfies z.ZodType<Wire<ResponseValue<'vision.status'>>>

export const visionTestRequestSchema = z.object({
  mediaType: imageMediaTypeSchema,
  data: z.string().min(1).max(14_000_000),
  question: z.string().max(2_000).optional(),
  name: z.string().max(255).optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'vision.test'>>>

export const visionEnableRequestSchema = visionTestRequestSchema.extend({
  apiKey: z.string().min(1).max(16_384).optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'vision.enable'>>>

export const visionTestValueSchema = z.object({
  model: z.literal('qwen3.8-max'),
  description: z.string().min(1),
}) satisfies z.ZodType<Wire<ResponseValue<'vision.test'>>>

export const visionEnableValueSchema = visionTestValueSchema satisfies z.ZodType<Wire<ResponseValue<'vision.enable'>>>
