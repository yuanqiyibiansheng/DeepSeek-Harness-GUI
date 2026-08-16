// @vitest-environment jsdom
/**
 * BalanceDock render/cost behavior plus the pure money and session-cost
 * helpers. The desktop shell bridge is stubbed where balance data is needed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { BalanceDock, type BalanceDockProps } from '../src/client/BalanceDock.tsx'
import { money, sessionCost } from '../src/client/desktop-bridge.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
})

const t: BalanceDockProps['t'] = makeTranslate(zh, commonZh)

function setup(usage: unknown, invoke = vi.fn()) {
  if (invoke !== undefined) {
    ;(window as unknown as {
      __TAURI_INTERNALS__: { invoke(command: string, args?: unknown): Promise<unknown> }
    }).__TAURI_INTERNALS__ = { invoke }
  }
  const store = createSnapshotStore<{ value: unknown }>({ value: usage })
  const useProjection = (_key: string, selector?: (v: unknown) => unknown) =>
    bindSnapshotSelector(store)(s => (selector ?? (v => v))(s.value))
  return render(<BalanceDock useProjection={useProjection} t={t} />)
}

describe('desktop-tools balance helpers', () => {
  it('estimates session cost from token usage', () => {
    expect(sessionCost({
      uncachedInputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 500_000,
    }, undefined)).toBe(6)
  })

  it('formats money with adaptive precision', () => {
    expect(money(12.345)).toBe('12.35')
    expect(money(0.1234)).toBe('0.123')
    expect(money(0.01234)).toBe('0.0123')
  })
})

describe('BalanceDock', () => {
  it('renders nothing without billable usage or a shell balance', () => {
    const view = setup(undefined, undefined)
    expect(view.container.innerHTML).toBe('')
  })

  it('renders this-turn cost only in a plain browser', () => {
    setup({
      uncachedInputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 500_000,
    }, undefined)
    expect(screen.getByRole('link').textContent).toContain('本轮 ¥6.000')
  })

  it('renders cost and balance from the shell and opens the top-up page', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'balance_query') {
        return {
          ok: true,
          is_available: true,
          balances: [{ currency: 'CNY', total: 100, granted: 5, toppedUp: 95 }],
          prices: { cacheMiss: 2, cacheHit: 0.5, output: 8 },
        }
      }
      if (command === 'open_recharge') return null
      return undefined
    })
    setup({
      uncachedInputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 500_000,
    }, invoke)
    const link = await screen.findByRole('link')
    await waitFor(() => expect(link.textContent).toContain('余额 ¥100.00'))
    fireEvent.click(link)
    expect(invoke).toHaveBeenCalledWith('open_recharge', { url: 'https://platform.deepseek.com/top_up' })
  })
})
