/**
 * Desktop pet plugin, browser half: bridges the runtime's `session/activity`
 * phase to the standalone pet window — a separate transparent always-on-top
 * desktop window loading the same-origin `pet.html` — through a
 * BroadcastChannel, and owns the `ui-pet` settings namespace: the General
 * section's toggle row persists the pet visibility, and the plugin drives the
 * desktop shell's `pet_control` command so the window shows/hides with the
 * switch and the last choice survives restarts.
 * @module @deepseek-ai/dsh-client-ui-pet/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionActivityEvent } from '@deepseek-ai/dsh-client-runtime/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls ctx.locale into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { PetSettings } from '../pet-settings.ts'
import { PET_ENABLED_FIELD, PET_SETTINGS_NAMESPACE } from '../pet-settings.ts'
import { PetToggleRow, type PetToggleRowInjected } from './PetToggleRow.tsx'
import { createPetToggleStore } from './pet-toggle-store.ts'
import { en, zh, type PetKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Pet toggle row copy. */
    'settings.pet': PetKey
  }
}

/** Dictionary namespace owned by this plugin (the toggle row's copy). */
const NS = 'settings.pet'

/** Same-origin channel shared with the standalone pet window. */
const ACTIVITY_CHANNEL = 'dsh:pet-activity'

/**
 * Required services: the settings scope transport plus slots/locale for the
 * General-section row. `connection` and `remote` carry the settings
 * invalidation that `settingsScope.bind` subscribes to on this context.
 */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

type PetControlAction = 'show' | 'hide'

/** Whether the page runs inside the desktop shell (Tauri webview). */
function isTauriShell(): boolean {
  return typeof window !== 'undefined'
    && (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined
}

/**
 * Ask the desktop shell to show or hide the pet window. No-op in a plain
 * browser (the pet window only exists in the desktop app).
 * @param action - window visibility request.
 */
function controlPetWindow(action: PetControlAction): void {
  if (!isTauriShell()) return
  try {
    const internals = (window as unknown as {
      __TAURI_INTERNALS__: { invoke(command: string, args?: unknown): Promise<unknown> }
    }).__TAURI_INTERNALS__
    void internals.invoke('pet_control', { action })
  } catch {
    // The IPC bridge may be unavailable during early boot; the next settings
    // sync retries.
  }
}

/**
 * Client plugin body: forward activity to the pet window, bind the pet
 * settings scope to the window visibility, and register the toggle row.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-pet: dictionaries')

  // Activity bridge: every session/activity phase is forwarded to the pet
  // window over a same-origin BroadcastChannel (both windows load the same
  // backend origin, so no cross-window IPC is involved).
  ctx.effect(() => {
    const channel = new BroadcastChannel(ACTIVITY_CHANNEL)
    const onActivity = (event: SessionActivityEvent): void => {
      channel.postMessage({ phase: event.phase })
    }
    const disposer = ctx.on('session/activity', onActivity)
    return () => {
      disposer()
      channel.close()
    }
  }, 'ui-pet: activity bridge')

  // Window control rides the persisted settings: the first accepted snapshot
  // (and every later change) mirrors the switch onto the desktop window.
  const host = ctx.settingsScope.bind<PetSettings>({ namespace: PET_SETTINGS_NAMESPACE })
  const store = createPetToggleStore()
  let bound: BoundActions<typeof store> | undefined
  let lastEnabled: boolean | undefined
  const sync = (): void => {
    const snapshot = host.getSnapshot()
    if (snapshot.status !== 'ready' || snapshot.value === undefined) return
    const { enabled } = snapshot.value
    bound?.sync(enabled, snapshot.revision ?? -1)
    if (enabled !== lastEnabled) {
      lastEnabled = enabled
      controlPetWindow(enabled ? 'show' : 'hide')
    }
  }
  ctx.effect(() => {
    const disposer = host.subscribe(sync)
    sync()
    return disposer
  }, 'ui-pet: window control')

  const injected = (actions: BoundActions<typeof store>): PetToggleRowInjected => {
    bound = actions
    // Re-sync from the getter so no snapshot is lost between registration and
    // first render (the store's revision guard drops stale duplicates).
    sync()
    return {
      setEnabled: (enabled) => { void host.set(PET_ENABLED_FIELD, enabled) },
    }
  }
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'pet',
    order: 20,
    store,
    locale: NS,
    inject: injected,
  }, PetToggleRow))
}
