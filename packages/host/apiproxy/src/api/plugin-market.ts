/**
 * plugin-market domain contract: installable-plugin marketplace over the dsh
 * profile. The host runs `dsh plugin` (a pnpm forwarder) in the active
 * profile; the browser only ever sends a market entry id or a package spec —
 * never a free-form command line.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** One market catalog row. */
export interface PluginMarketEntry {
  /** Stable market id (search key and install handle). */
  id: string
  /** Display name. */
  title: string
  /** Author / organization. */
  author?: string
  /** One-sentence description. */
  description: string
  /** The pnpm spec `dsh plugin add` installs (registry name or git URL). */
  source: string
  /** GitHub page for the "View source" link. */
  reference?: string
  /** Whether the plugin is an official DeepSeek Harness package. */
  official?: boolean
  /** Whether installing this activates a profile patch layer. */
  bundle?: boolean
}

/** One installed profile plugin. */
export interface PluginInstalledEntry {
  /** The package name as installed. */
  name: string
  /** Whether it is a profile patch-layer bundle. */
  bundle: boolean
}

/** plugin-market domain methods (the map keys pluginMarket.* of RpcMethodMap). */
export interface PluginMarketApi {
  /** The curated marketplace catalog plus the currently installed profile packages. */
  snapshot(request: RpcRequest<{}>): Promise<RpcResponse<{
    market: readonly PluginMarketEntry[]
    installed: readonly PluginInstalledEntry[]
  }>>

  /** Install one market entry by id into the profile. */
  install(request: RpcRequest<{ id: string }>): Promise<RpcResponse<{ installed: true }>>

  /** Uninstall one market entry by id from the profile. */
  uninstall(request: RpcRequest<{ id: string }>): Promise<RpcResponse<{ removed: true }>>

  /** Update every installed plugin in the profile. */
  update(request: RpcRequest<{}>): Promise<RpcResponse<{ updated: true }>>
}
