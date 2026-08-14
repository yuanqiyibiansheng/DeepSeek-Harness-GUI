/**
 * Host registration for the sidebar toggle surface. The client bundle owns
 * the session-header action and the Ctrl+Alt+B shortcut.
 * @module @deepseek-ai/dsh-client-ui-sidebar-toggle
 */

import type { Context } from '@deepseek-ai/cordis'

/** Stable Cordis plugin name. */
export const name = 'client-ui-sidebar-toggle'

/**
 * No Host-side behavior is required.
 * @param _ctx - host context (unused).
 */
export function apply(_ctx: Context): void {}