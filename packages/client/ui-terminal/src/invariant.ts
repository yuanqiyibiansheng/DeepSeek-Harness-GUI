/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-terminal`.
 * @module @deepseek-ai/dsh-client-ui-terminal/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-terminal'

/** Cordis companion plugin name. */
export const name = 'client-ui-terminal-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a presentation shell projecting the terminal shell
 * settings section; all owned state is the host terminal-host plugin's, which
 * carries its own lifecycle.
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
