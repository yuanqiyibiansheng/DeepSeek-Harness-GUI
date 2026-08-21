// @vitest-environment jsdom
import { queryByText } from '@testing-library/dom'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  SessionRewindExecuteResult,
  SessionTurnCheckpointPreview,
} from '@deepseek-ai/dsh-session-rewind/types'
import type { RewindView } from '../src/client/rewind-controller.ts'
// Loads the package's LocaleNamespaceMap declaration so PropsLocale resolves.
import type {} from '../src/client/index.ts'
import { RewindCard, type RewindInjected } from '../src/client/RewindCard.tsx'

const SNAPSHOT = {
  turnEnds: new Map([[1, 3], [2, 7]]),
  chat: {
    locations: {
      getTurn: () => ['u1'],
    },
    nodes: {
      get: (key: string) => key === 'u1'
        ? { kind: 'user', data: { kind: 'user', seq: 1, content: [{ type: 'text', text: 'original prompt' }] } }
        : undefined,
    },
    timeline: {
      turnOrder: [1, 2],
    },
    legacy: {
      nodes: [{
        kind: 'user',
        seq: 1,
        content: [{ type: 'text', text: 'original prompt' }],
      }],
    },
  },
} as unknown as ConversationSnapshot

const CHECKPOINT: SessionTurnCheckpointPreview = {
  workDir: 'H:\\ws',
  target: { targetUserMessageId: '1', userMessageIndex: 0, userMessageCount: 2 },
  conversation: { messagesRemoved: 2 },
  code: {
    available: true,
    filesChanged: ['H:\\ws\\a.ts', 'H:\\ws\\b.ts'],
    insertions: 3,
    deletions: 1,
  },
  restoreAvailable: true,
  unverifiedChangeSources: ['Bash'],
}

const EXECUTE_RESULT: SessionRewindExecuteResult = {
  ...CHECKPOINT,
  conversation: { messagesRemoved: 2, removedMessageIds: ['assistant-2'] },
  mode: 'both',
}

const VIEW: RewindView = {
  status: 'ready',
  byTarget: new Map([['1', CHECKPOINT]]),
  error: null,
}

/** Mount the turn-tail card with stubbed rewind verbs and session snapshot. */
function mount(injected: Partial<RewindInjected> & { openFile?: (path: string) => void }): () => void {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const ensure = injected.ensure ?? vi.fn(async () => {})
  const execute = injected.execute ?? vi.fn(async () => ({ ok: true as const, value: EXECUTE_RESULT }))
  act(() => {
    root.render(createElement(RewindCard as never, {
      matched: { turn: 1, seq: 2 },
      openFile: injected.openFile ?? (() => {}),
      sessionId: 's1',
      useSession: (selector: (snapshot: ConversationSnapshot) => unknown) => selector(SNAPSHOT),
      useRewind: (selector: (view: RewindView) => unknown) => selector(VIEW),
      ensure,
      execute,
      t: (key: string) => key,
    }))
  })
  return () => {
    act(() => { root.unmount() })
    container.remove()
  }
}

afterEach(() => {
  document.body.innerHTML = ''
  sessionStorage.clear()
  vi.unstubAllGlobals()
})

describe('RewindCard', () => {
  it('clears the working state after a successful rollback', async () => {
    const execute = vi.fn(async () => ({ ok: true as const, value: EXECUTE_RESULT }))
    const cleanup = mount({ execute })

    act(() => {
      queryByText(document.body, 'rewind.historicalUndo')?.click()
    })
    await act(async () => { await Promise.resolve() })
    act(() => {
      queryByText(document.body, 'rewind.historicalConfirmUndo')?.click()
    })
    await act(async () => { await Promise.resolve() })

    expect(execute).toHaveBeenCalledWith({ targetUserMessageId: '1' }, 'both')
    expect(queryByText(document.body, 'rewind.working')).toBeNull()
    cleanup()
  })
  it('renders the checkpoint card and rolls back code and conversation together', async () => {
    const execute = vi.fn(async () => ({ ok: true as const, value: EXECUTE_RESULT }))
    const cleanup = mount({ execute })

    expect(queryByText(document.body, 'rewind.filesTitle')).not.toBeNull()
    expect(queryByText(document.body, 'a.ts')).not.toBeNull()
    expect(queryByText(document.body, 'rewind.historicalUndo')).not.toBeNull()

    act(() => {
      queryByText(document.body, 'rewind.historicalUndo')?.click()
    })
    await act(async () => { await Promise.resolve() })

    expect(queryByText(document.body, 'rewind.historicalConfirmTitle')).not.toBeNull()
    expect(queryByText(document.body, 'rewind.historicalConfirmBody')).not.toBeNull()

    act(() => {
      queryByText(document.body, 'rewind.historicalConfirmUndo')?.click()
    })
    await act(async () => { await Promise.resolve() })

    expect(execute).toHaveBeenCalledWith({ targetUserMessageId: '1' }, 'both')
    cleanup()
  })

  it('opens files through the chat opener from the row and the 打开方式 button', () => {
    const openFile = vi.fn()
    const cleanup = mount({ openFile })

    act(() => {
      document.querySelector<HTMLElement>('[title="a.ts"]')?.click()
    })
    expect(openFile).toHaveBeenCalledWith('H:\\ws\\a.ts')

    act(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      const openWith = buttons.find(button => button.textContent === 'rewind.openWith')
      openWith?.click()
    })
    expect(openFile).toHaveBeenCalledWith('H:\\ws\\a.ts')
    cleanup()
  })

  it('offers conversation-only rollback when the file checkpoint is incomplete', async () => {
    const execute = vi.fn(async () => ({ ok: true as const, value: EXECUTE_RESULT }))
    const view: RewindView = {
      status: 'ready',
      byTarget: new Map([['1', { ...CHECKPOINT, restoreAvailable: false, unverifiedChangeSources: [] }]]),
      error: null,
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(createElement(RewindCard as never, {
        matched: { turn: 1, seq: 2 },
        openFile: () => {},
        sessionId: 's1',
        useSession: (selector: (snapshot: ConversationSnapshot) => unknown) => selector(SNAPSHOT),
        useRewind: (selector: (value: RewindView) => unknown) => selector(view),
        ensure: vi.fn(async () => {}),
        execute,
        t: (key: string) => key,
      }))
    })

    expect(queryByText(document.body, 'rewind.conversationOnlySubtitle')).not.toBeNull()
    act(() => {
      queryByText(document.body, 'rewind.historicalUndo')?.click()
    })
    await act(async () => { await Promise.resolve() })

    expect(queryByText(document.body, 'rewind.conversationOnly')).not.toBeNull()
    expect(queryByText(document.body, 'rewind.historicalConfirmUndo')).toBeNull()
    act(() => {
      queryByText(document.body, 'rewind.conversationOnly')?.click()
    })
    await act(async () => { await Promise.resolve() })

    expect(execute).toHaveBeenCalledWith({ targetUserMessageId: '1' }, 'conversation')
    act(() => { root.unmount() })
    container.remove()
  })

  it('does not reload the page after a successful rollback', async () => {
    const execute = vi.fn(async () => ({ ok: true as const, value: EXECUTE_RESULT }))
    const cleanup = mount({ execute })
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })

    act(() => {
      queryByText(document.body, 'rewind.historicalUndo')?.click()
    })
    await act(async () => { await Promise.resolve() })
    act(() => {
      queryByText(document.body, 'rewind.historicalConfirmUndo')?.click()
    })
    await act(async () => { await Promise.resolve() })

    expect(execute).toHaveBeenCalledWith({ targetUserMessageId: '1' }, 'both')
    expect(reload).not.toHaveBeenCalled()
    cleanup()
  })
})
