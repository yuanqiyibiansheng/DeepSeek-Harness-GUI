/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-terminal-host`.
 * @module @deepseek-ai/dsh-terminal-host/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-terminal-host'

/** Cordis companion plugin name. */
export const name = 'terminal-host-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: sessions are in-memory state owned by the plugin
 * lifecycle, and every external relationship (route registration, settings
 * namespace, PTY termination) is enforced by the respective service contract.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
