// @vitest-environment jsdom
import { queryByText } from '@testing-library/dom'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
// Loads the package's LocaleNamespaceMap declaration so PropsLocale resolves.
import type {} from '../src/client/index.ts'
import { ConversationRollbackAction } from '../src/client/ConversationRollbackAction.tsx'

/** Mount the action with a stubbed fetch and sessions store. */
function mount(fetchImpl: (url: string) => Promise<unknown>): () => void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const body = await fetchImpl(url)
    return {
      ok: true,
      json: async () => body,
    } as Response
  }))
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const useSessions = (() => ({ byId: { 's1': { cwd: 'H:\\ws' } } })) as never
  act(() => {
    root.render(createElement(ConversationRollbackAction as never, {
      sessionId: 's1',
      messageId: 'm1',
      useSession: (() => 'original prompt') as never,
      useSessions,
      t: (key: string) => key,
    }))
  })
  return () => {
    act(() => { root.unmount() })
    container.remove()
    vi.unstubAllGlobals()
  }
}

afterEach(() => {
  document.body.innerHTML = ''
  sessionStorage.clear()
})

describe('ConversationRollbackAction', () => {
  it('opens the confirmation window without loading a rollback preview', async () => {
    const calls: string[] = []
    const cleanup = mount(async (url) => {
      calls.push(url)
      return { ok: true }
    })
    await act(async () => { await Promise.resolve() })
    act(() => {
      document.querySelector('button')?.click()
    })
    await act(async () => { await Promise.resolve() })
    expect(calls.some(url => url.includes('/rollback/preview'))).toBe(false)
    expect(document.body.textContent).toContain('review.rollbackTitle')
    expect(document.body.textContent).toContain('review.rollbackCancel')
    expect(document.body.textContent).toContain('review.rollbackAction')
    expect(document.body.textContent).not.toContain('review.rollbackBoth')
    cleanup()
  })

  it('rolls back code and conversation immediately and restores the original message draft', async () => {
    const calls: string[] = []
    const cleanup = mount(async (url) => {
      calls.push(url)
      return { ok: true }
    })
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    await act(async () => { await Promise.resolve() })
    act(() => {
      document.querySelector('button')?.click()
    })
    await act(async () => { await Promise.resolve() })
    act(() => {
      queryByText(document.body, 'review.rollbackAction')?.click()
    })
    await act(async () => { await Promise.resolve() })
    expect(calls.some(url => url.includes('/code-review/rollback?') && url.includes('scope=both'))).toBe(true)
    expect(calls.some(url => url.includes('/rollback/preview'))).toBe(false)
    expect(sessionStorage.getItem('dsh-rollback-draft:s1')).toBe('original prompt')
    expect(reload).toHaveBeenCalledTimes(1)
    cleanup()
  })
})
