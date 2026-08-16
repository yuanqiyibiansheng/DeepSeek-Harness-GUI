/**
 * Inline DeepSeek balance + this-turn cost widget for the conversation stats
 * bar (`conversation.composer.dock`). The desktop shell answers balance
 * queries and opens the top-up page; a plain browser shows cost only.
 */
import { useEffect, useState } from 'react'
import type { UseProjection } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: merges the tokenUsage key into SessionProjectionMap.
import type {} from '@deepseek-ai/dsh-token-meter/client'
import './slot-types.ts'
import {
  type BalanceQueryResult, hasUsage, invokeShell, money, openRecharge, sessionCost,
  type TokenUsageLike,
} from './desktop-bridge.ts'
import css from './BalanceDock.module.css'

/** Auto-refresh cadence for the shell balance query (15 minutes). */
const BALANCE_REFRESH_MS = 15 * 60 * 1000

/** Component props: the slot standard kit's projection seat and namespace translate. */
export interface BalanceDockProps {
  useProjection: UseProjection
  t: TranslateNS<'desktopTools'>
}

/**
 * Subscribe to the desktop shell's balance snapshot. The first fetch happens
 * on mount; later fetches follow the 15-minute cadence.
 * @returns the latest balance query result, or null before the first answer.
 */
function useBalance(): BalanceQueryResult | null {
  const [data, setData] = useState<BalanceQueryResult | null>(null)
  useEffect(() => {
    let alive = true
    const refresh = async (): Promise<void> => {
      try {
        const next = await invokeShell('balance_query') as BalanceQueryResult | undefined
        if (alive && next !== undefined) setData(next)
      } catch {
        // The shell may be absent (plain browser); the widget stays cost-only.
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), BALANCE_REFRESH_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])
  return data
}

/**
 * Render the balance dock entry.
 * @param props - projection seat and locale translate.
 * @returns the inline dock anchor, or null when neither cost nor balance is known.
 */
export function BalanceDock({ useProjection, t }: BalanceDockProps) {
  const usage = useProjection('tokenUsage') as TokenUsageLike | undefined
  const data = useBalance()
  const balances = data?.ok === true && Array.isArray(data.balances) ? data.balances : []
  const primary = balances.find(b => b.currency === 'CNY') ?? balances[0]
  const hasBalance = primary !== undefined
  const usageKnown = hasUsage(usage)
  if (!hasBalance && !usageKnown) return null
  const parts: string[] = []
  if (usageKnown) {
    parts.push(t('balance.turn', { cost: money(sessionCost(usage, data?.prices)) }))
  }
  if (hasBalance) {
    parts.push(t('balance.balance', { balance: money(primary.total) }))
  }
  const title = hasBalance
    ? t('balance.title', {
        currency: primary.currency,
        balance: money(primary.total),
        toppedUp: money(primary.toppedUp),
        granted: money(primary.granted),
      })
    : undefined
  return (
    <a
      className={css.dock}
      href="https://platform.deepseek.com/top_up"
      title={title}
      onClick={(event) => {
        event.preventDefault()
        openRecharge()
      }}
    >
      {parts.join(' · ')}
    </a>
  )
}
