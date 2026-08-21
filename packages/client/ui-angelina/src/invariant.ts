/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-angelina`.
 * @module @deepseek-ai/dsh-client-ui-angelina/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-angelina'

export const name = 'client-ui-angelina-invariant'
export const inject = ['invariants']

/** No runtime invariant: the Angelina theme is a pure UI contribution. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
