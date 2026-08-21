/** Package-owned durable session-rewind invariants. @module @deepseek-ai/dsh-session-rewind/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-rewind'

/** Cordis companion plugin name. */
export const name = 'session-rewind-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the rewind package owns no session events of its own
 * — it reads the `file/history-snapshot` events whose shape the
 * `dsh-file-history` invariant validates, and it never appends to the log.
 */
const install: InvariantInstaller = () => {}

/**
 * Register the session-rewind invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
