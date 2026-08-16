/**
 * Host-side no-op for the desktop-tools plugin (the Tauri shell owns the
 * balance query, recharge link, and Windows notifications).
 */

/**
 * Host plugin body: this package is browser-only; the desktop shell exposes
 * the `balance_query`, `notify_task_done`, and `open_recharge` commands that
 * the client half calls through the Tauri bridge.
 */
export function apply(): void {}
