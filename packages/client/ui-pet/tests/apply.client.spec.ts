// @vitest-environment jsdom
/** ui-pet apply wiring: activity bridging to the pet window's
 * BroadcastChannel, settings-driven pet_control window commands, the
 * declaration-aware General-section toggle row, and teardown. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { SettingsScopeBinder } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-pet/client'
import { PET_ENABLED_FIELD, PET_SETTINGS_NAMESPACE, PetSettingsSchema } from '../src/pet-settings.ts'
import { PetToggleRow } from '../src/client/PetToggleRow.tsx'

usePinnedBrowserLanguages('zh-CN')

const SLOT = 'settings.general.item'

/** Minimal BroadcastChannel stand-in (jsdom provides none). */
class MockBroadcastChannel {
  static posted: { channel: string; message: unknown }[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  constructor(readonly name: string) {}
  postMessage(message: unknown): void {
    MockBroadcastChannel.posted.push({ channel: this.name, message })
  }
  close(): void {}
}

/** Desktop-shell stand-in: records pet_control invocations. */
function stubTauri(internals: { invoke: ReturnType<typeof vi.fn> }): void {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: internals,
  })
}

function clearTauri(): void {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: undefined,
  })
}

async function bench(isLoopback = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  let enabled = true
  const namespace = () => ({
    ns: PET_SETTINGS_NAMESPACE,
    schema: PetSettingsSchema.toJSON(),
    value: { enabled },
    applies: 'live' as const,
    secrets: [],
    revision: 0,
  })
  const describe = vi.fn(() => Promise.resolve({
    rpcId: 'pet-describe' as never,
    result: {
      ok: true as const,
      value: { writable: true, hasDocument: true, namespaces: [namespace()] },
    },
  }))
  const mutate = vi.fn((request: { ops: { field?: string; value?: unknown }[] }) => {
    const op = request.ops[0]!
    if (op.field === PET_ENABLED_FIELD) enabled = op.value as boolean
    return Promise.resolve({
      rpcId: 'pet-mutate' as never,
      result: { ok: true as const, value: namespace() },
    })
  })
  ctx.provide('connection', { api: { settings: { describe, mutate } }, isLoopback } as never)
  new TestRemote(ctx)
  await ctx.plugin(SettingsScopeBinder).await()
  return {
    ctx, slots: ctx.get('slots') as SlotRegistry, locale, describe, mutate,
    setHostEnabled: (next: boolean) => { enabled = next },
  }
}

/** Stand in for the settings shell: declare the General item slot from root. */
function declareItems(slots: SlotRegistry): () => void {
  return slots.register(
    { name: 'root', children: { [SLOT]: { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )
}

describe('ui-pet apply', () => {
  it('declares the slot, locale, and settings services', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'settingsScope'])
  })

  it('forwards session/activity phases to the pet BroadcastChannel', async () => {
    MockBroadcastChannel.posted = []
    Object.defineProperty(window, 'BroadcastChannel', { configurable: true, value: MockBroadcastChannel })
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    b.ctx.emit('session/activity', { sessionId: 's1' as SessionId, phase: 'working' })
    expect(MockBroadcastChannel.posted).toEqual([
      { channel: 'dsh:pet-activity', message: { phase: 'working' } },
    ])
    b.ctx.emit('session/activity', { sessionId: 's1' as SessionId, phase: 'idle' })
    expect(MockBroadcastChannel.posted.at(-1)).toEqual({
      channel: 'dsh:pet-activity', message: { phase: 'idle' },
    })
    await fiber.dispose()
  })

  it('shows the pet window when the persisted setting is enabled and hides it when disabled', async () => {
    const invoke = vi.fn(() => Promise.resolve(null))
    stubTauri({ invoke })
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('pet_control', { action: 'show' })
    })
    b.setHostEnabled(false)
    b.ctx.remote.$dispatch('settings/document-updated', [PET_SETTINGS_NAMESPACE, 1])
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('pet_control', { action: 'hide' })
    })
    await fiber.dispose()
    clearTauri()
  })

  it('never invokes the shell outside the desktop app', async () => {
    clearTauri()
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await vi.waitFor(() => { expect(b.describe).toHaveBeenCalled() })
    expect(b.mutate).not.toHaveBeenCalled()
    await fiber.dispose()
  })

  it('registers the toggle row and routes face writes back to settings', async () => {
    MockBroadcastChannel.posted = []
    Object.defineProperty(window, 'BroadcastChannel', { configurable: true, value: MockBroadcastChannel })
    const b = await bench()
    declareItems(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries(SLOT).find(e => e.component === PetToggleRow)!
    expect(entry.options).toMatchObject({ id: 'pet', order: 20 })
    expect(b.locale.bind('settings.pet')('pet.title')).toBe('桌宠')

    const face = (entry.inject as unknown as (a: unknown) => { setEnabled: (v: boolean) => void })(
      { sync: () => {}, },
    )
    face.setEnabled(false)
    await vi.waitFor(() => {
      expect(b.mutate).toHaveBeenCalledWith(expect.objectContaining({
        ops: [{ op: 'set', path: ['enabled'], value: false }],
      }))
    })
    await fiber.dispose()
  })

  it('teardown removes the row and the dictionaries', async () => {
    const b = await bench()
    declareItems(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries(SLOT)).toHaveLength(1)
    await fiber.dispose()
    expect(b.slots.entries(SLOT)).toHaveLength(0)
    expect(b.locale.bind('settings.pet')('pet.title')).toBe('pet.title')
  })
})
