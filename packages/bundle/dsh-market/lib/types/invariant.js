/**
 * Package-owned invariant companion for `dshmarket`.
 * @module dshmarket/invariant
 */
const PACKAGE_NAME = 'dshmarket';
/** Cordis companion plugin name. */
export const name = 'dshmarket-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * No runtime invariant: the market is only meaningful inside a live `dsh web`
 * process with the profile/loader and HTTP services composed; its owned state
 * (profile plugin list, patch rows, the `dsh-market` settings namespace, and
 * the runtime state file) is exercised by the host-half unit tests rather than
 * a single event/data relationship.
 */
const install = () => { };
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
/* jscpd:ignore-end */
//# sourceMappingURL=invariant.js.map