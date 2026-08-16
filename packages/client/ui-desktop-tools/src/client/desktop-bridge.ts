/**
 * Tauri bridge helpers for the desktop-tools plugin: invoke shell commands,
 * the DeepSeek balance payload shape, and the per-turn cost estimate used by
 * the conversation stats widget.
 */

/** One DeepSeek account balance bucket. */
export interface BalanceInfo {
  currency: string
  total: number
  granted: number
  toppedUp: number
}

/** Result of the shell's `balance_query` command. */
export interface BalanceQueryResult {
  ok: boolean
  is_available?: boolean
  balances: BalanceInfo[]
  prices?: {
    cacheMiss: number
    cacheHit: number
    output: number
  }
  error?: string
}

/** Token-usage projection consumed by the cost estimate. */
export interface TokenUsageLike {
  uncachedInputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  outputTokens?: number
}

/** Whether the page runs inside the Tauri desktop shell. */
export function isTauriShell(): boolean {
  return typeof window !== 'undefined'
    && (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined
}

/** Invoke a desktop shell command through the Tauri bridge when available. */
export function invokeShell(command: string, args?: Record<string, unknown>): Promise<unknown> {
  const internals = (window as unknown as {
    __TAURI_INTERNALS__?: { invoke(command: string, args?: unknown): Promise<unknown> }
  }).__TAURI_INTERNALS__
  if (internals === undefined) return Promise.resolve(undefined)
  return internals.invoke(command, args)
}

/** Open the DeepSeek top-up page in the default browser. */
export function openRecharge(): void {
  const url = 'https://platform.deepseek.com/top_up'
  if (isTauriShell()) {
    void invokeShell('open_recharge', { url })
    return
  }
  window.open(url, '_blank', 'noopener')
}

/** Official price table (CNY per million tokens; fallback mirrors DeepSeek). */
export const FALLBACK_PRICES = { cacheMiss: 2, cacheHit: 0.5, output: 8 }

/**
 * Estimate the session cost from token usage. Cache writes are billed at the
 * cache-miss price (matching the official API); cache reads at the hit price.
 * @param usage - the durable `tokenUsage` projection.
 * @param prices - shell-provided prices for the active model.
 * @returns estimated cost in CNY.
 */
export function sessionCost(usage: TokenUsageLike | undefined, prices?: BalanceQueryResult['prices']): number {
  if (usage === undefined) return 0
  const p = { ...FALLBACK_PRICES, ...(prices ?? {}) }
  const perM = (n: number | undefined): number => (Number(n) || 0) / 1_000_000
  return (
    perM(usage.uncachedInputTokens) * p.cacheMiss
    + perM(usage.cacheReadTokens) * p.cacheHit
    + perM(usage.cacheWriteTokens) * p.cacheMiss
    + perM(usage.outputTokens) * p.output
  )
}

/** Whether the session carries any billable token activity. */
export function hasUsage(usage: TokenUsageLike | undefined): boolean {
  return usage !== undefined && (
    (usage.outputTokens ?? 0) > 0
    || (usage.uncachedInputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0) > 0
  )
}

/**
 * Compact money display: two decimals above ¥10, three between ¥0.1 and ¥10,
 * four below ¥0.1.
 * @param value - CNY amount.
 * @returns display string.
 */
export function money(value: number): string {
  const v = Number(value) || 0
  if (v >= 10) return v.toFixed(2)
  if (v >= 0.1) return v.toFixed(3)
  return v.toFixed(4)
}
