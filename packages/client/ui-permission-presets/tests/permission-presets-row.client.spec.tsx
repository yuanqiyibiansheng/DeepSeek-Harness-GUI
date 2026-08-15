// @vitest-environment jsdom
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { PermissionRow, type PermissionRowProps } from '../src/client/PermissionRow.tsx'
import { en } from '../src/client/locales.ts'
import { PermissionPresetSettingsController } from '../src/client/settings-store.ts'

/** Wait until `find` matches or the timeout elapses. */
function waitFor<T>(find: () => T | null | undefined, timeout = 1500): Promise<T> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      let value: T | null | undefined
      try { value = find() } catch { value = null }
      if (value !== null && value !== undefined) { resolve(value); return }
      if (Date.now() - start > timeout) { reject(new Error('waitFor timeout')); return }
      setTimeout(tick, 10)
    }
    tick()
  })
}

/** Query helpers over document.body. Native buttons carry no role attribute. */
function byRole(role: string, name?: string): HTMLElement | null {
  const selector = role === 'button' ? 'button' : `[role="${role}"]`
  const nodes = [...document.querySelectorAll<HTMLElement>(selector)]
  const match = nodes.find(node =>
    name === undefined || node.textContent?.trim() === name || node.getAttribute('aria-label') === name)
  return match ?? null
}

const SCHEMA = {
  uid: 5,
  refs: {
    1: { type: 'const', value: 'read-only' },
    2: { type: 'const', value: 'workspace-write' },
    3: { type: 'const', value: 'danger-full-access' },
    4: { type: 'union', list: [1, 2, 3] },
    5: { type: 'object', dict: { defaultPreset: 4 } },
  },
}

function view(defaultPreset: string, revision = 0): SettingsNamespaceView {
  return {
    ns: 'permission',
    schema: SCHEMA,
    value: { defaultPreset },
    base: { defaultPreset: 'read-only' },
    applies: 'live',
    secrets: [],
    revision,
  }
}

function ok<T>(value: T) {
  return { rpcId: 'test', result: { ok: true as const, value } }
}

const dictionary: Record<string, string> = en
const t: PermissionRowProps['t'] = key => dictionary[key] ?? key
const runtime = {
  useSessions: (() => { throw new Error('unused') }) as never,
  useWorkspaces: (() => { throw new Error('unused') }) as never,
}

function mount(controller: PermissionPresetSettingsController): () => void {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(createElement(PermissionRow as never, {
      ...runtime,
      load: () => controller.load(),
      select: (preset: string) => controller.select(preset),
      usePermission: bindSnapshotSelector(controller.store),
      t,
    }))
  })
  return () => {
    act(() => { root.unmount() })
    container.remove()
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('PermissionRow', () => {
  it('loads the descriptor, opens the menu, and selects a new default', async () => {
    const mutate = vi.fn(() => Promise.resolve(ok(view('workspace-write', 1))))
    const controller = new PermissionPresetSettingsController({
      settings: {
        describe: () => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] })),
        mutate,
      } as never,
    })
    const cleanup = mount(controller)
    const button = await waitFor(() => byRole('button', '只读')) as HTMLButtonElement
    expect(button.getAttribute('aria-expanded')).toBe('false')
    act(() => { button.click() })
    expect(button.getAttribute('aria-expanded')).toBe('true')
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    await waitFor(() => button.getAttribute('aria-expanded') === 'false' ? button : null)
    act(() => { button.click() })
    act(() => { button.click() })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    act(() => { button.click() })
    act(() => { byRole('menuitem', '只读')?.click() })
    expect(mutate).not.toHaveBeenCalled()
    act(() => { button.click() })
    act(() => { byRole('menuitem', '工作区写入')?.click() })
    await waitFor(() => byRole('button', '工作区写入'))
    expect(mutate).toHaveBeenCalledOnce()
    cleanup()
  })

  it('requires explicit acknowledgement before saving Full access', async () => {
    const mutate = vi.fn(() => Promise.resolve(ok(view('danger-full-access', 1))))
    const controller = new PermissionPresetSettingsController({
      settings: {
        describe: () => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] })),
        mutate,
      } as never,
    })
    const cleanup = mount(controller)
    const trigger = await waitFor(() => byRole('button', '只读')) as HTMLButtonElement
    act(() => { trigger.click() })
    act(() => { byRole('menuitem', '完全访问')?.click() })
    expect(mutate).not.toHaveBeenCalled()
    act(() => { byRole('button', 'Cancel')?.click() })
    expect(byRole('dialog')).toBeNull()
    act(() => { trigger.click() })
    act(() => { byRole('menuitem', '完全访问')?.click() })
    const dialog = await waitFor(() => byRole('dialog'))
    const enable = byRole('button', 'Enable Full access')
    expect((enable as HTMLButtonElement | null)?.disabled).toBe(true)
    act(() => { document.querySelector('input[type="checkbox"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    act(() => { enable?.click() })
    await waitFor(() => (mutate.mock.calls.length > 0 ? dialog : null))
    expect(dialog.isConnected).toBe(false)
    cleanup()
  })

  it('hides an unavailable namespace and disables a read-only provider', async () => {
    const absent = new PermissionPresetSettingsController({
      settings: {
        describe: () => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [] })),
        mutate: vi.fn(),
      } as never,
    })
    const cleanup = mount(absent)
    await waitFor(() => (document.body.textContent === '' ? document.body : null))
    cleanup()

    const readonly = new PermissionPresetSettingsController({
      settings: {
        describe: () => Promise.resolve(ok({ writable: false, hasDocument: false, namespaces: [view('read-only')] })),
        mutate: vi.fn(),
      } as never,
    })
    const cleanup2 = mount(readonly)
    const button = await waitFor(() => byRole('button', '只读')) as HTMLButtonElement
    expect(button.hasAttribute('disabled')).toBe(true)
    cleanup2()
  })

  it('shows loading and a contained write error', async () => {
    const describe = Promise.withResolvers<ReturnType<typeof ok<{
      writable: boolean
      namespaces: SettingsNamespaceView[]
    }>>>()
    const controller = new PermissionPresetSettingsController({
      settings: {
        describe: () => describe.promise,
        mutate: () => Promise.resolve({
          rpcId: 'test',
          result: {
            ok: false as const,
            error: { code: 'settings-conflict', message: 'changed elsewhere', details: {} },
          },
        }),
      } as never,
    })
    const cleanup = mount(controller)
    const loading = await waitFor(() => byRole('button', 'Loading')) as HTMLButtonElement
    expect(loading.hasAttribute('disabled')).toBe(true)
    describe.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] }))
    const button = await waitFor(() => byRole('button', '只读')) as HTMLButtonElement
    act(() => { button.click() })
    act(() => { byRole('menuitem', '工作区写入')?.click() })
    const alert = await waitFor(() => byRole('alert'))
    expect(alert.textContent).toBe('changed elsewhere')
    cleanup()
  })
})
