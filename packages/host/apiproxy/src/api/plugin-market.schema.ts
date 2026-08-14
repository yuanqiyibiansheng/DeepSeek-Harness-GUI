/**
 * plugin-market domain zod schemas (names derived from map keys).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { PluginInstalledEntry, PluginMarketEntry } from './plugin-market.ts'

/** One market catalog row. */
export const pluginMarketEntrySchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  author: z.string().optional(),
  description: z.string(),
  source: z.string().min(1),
  reference: z.string().optional(),
  official: z.boolean().optional(),
  bundle: z.boolean().optional(),
}) satisfies z.ZodType<Wire<PluginMarketEntry>>

/** One installed profile plugin. */
export const pluginInstalledEntrySchema = z.object({
  name: z.string(),
  bundle: z.boolean(),
}) satisfies z.ZodType<Wire<PluginInstalledEntry>>

/** pluginMarket.snapshot request payload (empty object literal). */
export const pluginMarketSnapshotRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'pluginMarket.snapshot'>>>

/** pluginMarket.snapshot response value. */
export const pluginMarketSnapshotValueSchema = z.object({
  market: z.array(pluginMarketEntrySchema),
  installed: z.array(pluginInstalledEntrySchema),
}) satisfies z.ZodType<Wire<ResponseValue<'pluginMarket.snapshot'>>>

/** pluginMarket.install request payload. */
export const pluginMarketInstallRequestSchema = z.object({
  id: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'pluginMarket.install'>>>

/** pluginMarket.install response value. */
export const pluginMarketInstallValueSchema = z.object({
  installed: z.literal(true),
}) satisfies z.ZodType<Wire<ResponseValue<'pluginMarket.install'>>>

/** pluginMarket.uninstall request payload. */
export const pluginMarketUninstallRequestSchema = z.object({
  id: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'pluginMarket.uninstall'>>>

/** pluginMarket.uninstall response value. */
export const pluginMarketUninstallValueSchema = z.object({
  removed: z.literal(true),
}) satisfies z.ZodType<Wire<ResponseValue<'pluginMarket.uninstall'>>>

/** pluginMarket.update request payload (empty object literal). */
export const pluginMarketUpdateRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'pluginMarket.update'>>>

/** pluginMarket.update response value. */
export const pluginMarketUpdateValueSchema = z.object({
  updated: z.literal(true),
}) satisfies z.ZodType<Wire<ResponseValue<'pluginMarket.update'>>>
