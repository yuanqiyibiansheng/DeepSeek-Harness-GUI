// @vitest-environment jsdom
/** PetToggleRow behavior: switch mirrors the persisted setting, clicks drive
 * the injected visibility write. */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore, type SessionListState, type WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { PetToggleRow, type PetToggleRowComponentProps } from '../src/client/PetToggleRow.tsx'
import { createPetToggleStore } from '../src/client/pet-toggle-store.ts'

const COPY: Record<string, string> = {
  'pet.title': '桌宠',
  'pet.enabledHint': '在桌面独立窗口中显示 DeepSeek 大肥鱼',
}

/** Empty global standard-kit hooks (the row reads neither). */
function emptySessions() {
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })
  return bindSnapshotSelector(store)
}
function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  })
  return bindSnapshotSelector(store)
}

function mount(enabled = true): { store: ReturnType<ReturnType<typeof createPetToggleStore>['create']>; setEnabled: ReturnType<typeof vi.fn>; cleanup: () => void } {
  // Real store instance — the sanctioned zero-machinery path for tests.
  const store = createPetToggleStore().create()
  store.actions.sync(enabled, 0)
  const setEnabled = vi.fn()
  const props: PetToggleRowComponentProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key] ?? key,
    setEnabled,
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(createElement(PetToggleRow, props)) })
  return {
    store,
    setEnabled,
    cleanup: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

const checked = (): string | null =>
  document.querySelector('[role="switch"]')?.getAttribute('aria-checked') ?? null

describe('PetToggleRow', () => {
  it('renders the title and mirrors the persisted setting', () => {
    const b = mount(true)
    expect(document.body.textContent).toContain('桌宠')
    expect(checked()).toBe('true')
    b.cleanup()
  })

  it('click drives setEnabled; the switch follows the store mirror, not the click echo', () => {
    const b = mount(true)
    act(() => {
      (document.querySelector('[role="switch"]') as HTMLButtonElement).click()
    })
    expect(b.setEnabled).toHaveBeenCalledWith(false)
    // No store write yet: the switch is unchanged.
    expect(checked()).toBe('true')
    act(() => { b.store.actions.sync(false, 1) })
    expect(checked()).toBe('false')
    b.cleanup()
  })
})
