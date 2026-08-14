/**
 * skills domain zod schemas (names derived from map keys: skillListRequestSchema /
 * skillListValueSchema).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'
import type { ManagedSkillEntry, SkillEntry } from './skills.ts'

/** SkillEntry row of skill.list. */
export const skillEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  whenToUse: z.string().optional(),
  modelInvocable: z.boolean(),
}) satisfies z.ZodType<Wire<SkillEntry>>

/** skill.list request payload. */
export const skillListRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'skill.list'>>>

/** skill.list response value. */
export const skillListValueSchema = z.object({
  skills: z.array(skillEntrySchema),
}) satisfies z.ZodType<Wire<ResponseValue<'skill.list'>>>

/** ManagedSkillEntry row of skill.listManaged. */
export const managedSkillEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  whenToUse: z.string().optional(),
  modelInvocable: z.boolean(),
  userInvocable: z.boolean(),
  path: z.string().min(1),
  loadable: z.boolean(),
}) satisfies z.ZodType<Wire<ManagedSkillEntry>>

/** skill.listManaged request payload. */
export const skillListManagedRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'skill.listManaged'>>>

/** skill.listManaged response value. */
export const skillListManagedValueSchema = z.object({
  skills: z.array(managedSkillEntrySchema),
}) satisfies z.ZodType<Wire<ResponseValue<'skill.listManaged'>>>

/** skill.updateManaged request payload. */
export const skillUpdateManagedRequestSchema = z.object({
  name: z.string().min(1),
  toggle: z.object({
    modelInvocable: z.boolean().optional(),
    userInvocable: z.boolean().optional(),
  }),
}) satisfies z.ZodType<Wire<RequestPayload<'skill.updateManaged'>>>

/** skill.updateManaged response value. */
export const skillUpdateManagedValueSchema = managedSkillEntrySchema satisfies z.ZodType<Wire<ResponseValue<'skill.updateManaged'>>>

/** skill.removeManaged request payload. */
export const skillRemoveManagedRequestSchema = z.object({
  name: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'skill.removeManaged'>>>

/** skill.removeManaged response value. */
export const skillRemoveManagedValueSchema = z.object({
  removed: z.literal(true),
}) satisfies z.ZodType<Wire<ResponseValue<'skill.removeManaged'>>>
