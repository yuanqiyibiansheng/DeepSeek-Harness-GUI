/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-plugin-marketplace`.
 * @module @deepseek-ai/dsh-client-ui-plugin-marketplace/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-plugin-marketplace'

/** Cordis companion plugin name. */
export const name = 'client-ui-plugin-marketplace-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the marketplace is only meaningful inside a dsh web
 * process with a bundled npm and a web profile; its owned state (profile
 * dependencies + patch rows) is exercised by the host-half unit tests.
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
