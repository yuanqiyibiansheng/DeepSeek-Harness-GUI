/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-vision-enhancement`.
 * @module @deepseek-ai/dsh-client-ui-vision-enhancement/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-vision-enhancement'

/** Cordis companion plugin name. */
export const name = 'client-ui-vision-enhancement-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the vision-enhancement surface is a pure presentation
 * layer over the host's vision-enhancement runtime (status reads and enable
 * writes); the host half owns the durable settings/credential state and the
 * llm/stream bridge exercised by the host-side tests.
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
