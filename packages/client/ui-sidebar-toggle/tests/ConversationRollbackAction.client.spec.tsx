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
    // The action consumes only the members below; the rest of the runtime
    // share is stubbed away through the createElement cast.
    root.render(createElement(ConversationRollbackAction as never, {
      sessionId: 's1',
      messageId: 'm1',
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

const PREVIEW = {
  ok: true,
  files: [
    { path: 'src/a.ts', state: 'modified', additions: 2, deletions: 1, diff: 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,3 @@\n-old\n+new\n+more\n' },
    { path: 'src/b.ts', state: 'deleted', additions: 0, deletions: 3, diff: 'diff --git a/src/b.ts b/src/b.ts\n--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1,3 +1,0 @@\n-gone\n-away\n-now\n' },
  ],
  skipped: ['assets/logo.bin: binary'],
  totalAdditions: 2,
  totalDeletions: 4,
  restoreAvailable: true,
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('ConversationRollbackAction', () => {
  it('loads the preview and lists the files to restore before confirming', async () => {
    const calls: string[] = []
    const cleanup = mount(async (url) => {
      calls.push(url)
      if (url.includes('/rollback/preview')) return PREVIEW
      return { ok: true }
    })
    // Let the readiness snapshot request settle, then click the undo button.
    await act(async () => { await Promise.resolve() })
    act(() => {
      document.querySelector('button')?.click()
    })
    await act(async () => { await Promise.resolve() })
    expect(calls.some(url => url.includes('/rollback/preview'))).toBe(true)
    const text = document.body.textContent ?? ''
    expect(text).toContain('src/a.ts')
    expect(text).toContain('src/b.ts')
    expect(text).toContain('review.rollbackFiles')
    expect(text).toContain('assets/logo.bin')
    cleanup()
  })

  it('shows the selected file diff and disables confirm on error', async () => {
    let previewCalls = 0
    const cleanup = mount(async (url) => {
      if (url.includes('/rollback/preview')) {
        previewCalls += 1
        return previewCalls === 1 ? PREVIEW : { ok: false, error: 'boom' }
      }
      return { ok: true }
    })
    await act(async () => { await Promise.resolve() })
    act(() => {
      document.querySelector('button')?.click()
    })
    await act(async () => { await Promise.resolve() })
    // The first file's diff rows render inside the preview surface.
    expect(document.body.textContent).toContain('new')
    cleanup()
  })

  it('keeps the confirm button disabled while the preview failed', async () => {
    const cleanup = mount(async (url) => {
      if (url.includes('/rollback/preview')) return { ok: false, error: 'boom' }
      return { ok: true }
    })
    await act(async () => { await Promise.resolve() })
    act(() => {
      document.querySelector('button')?.click()
    })
    await act(async () => { await Promise.resolve() })
    expect(queryByText(document.body, 'boom')).toBeTruthy()
    cleanup()
  })
})
