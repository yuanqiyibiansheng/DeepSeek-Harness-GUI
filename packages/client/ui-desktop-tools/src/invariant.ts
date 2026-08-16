/**
 * Package-owned invariant companion for
 * `@deepseek-ai/dsh-client-ui-desktop-tools`.
 * @module @deepseek-ai/dsh-client-ui-desktop-tools/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-desktop-tools'

/** Cordis companion plugin name. */
export const name = 'client-ui-desktop-tools-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the balance widget and notifications mirror desktop
 * shell commands; the shell owns the network and Windows toast lifecycle.
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
