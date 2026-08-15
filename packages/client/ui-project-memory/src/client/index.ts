/**
 * Project-memory plugin, browser half: exposes the Memorix integration as a
 * General-settings toggle. The host half keeps the Memorix MCP row in the
 * harness user patch layer in sync with the switch.
 * @module @deepseek-ai/dsh-client-ui-project-memory/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls ctx.locale into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ProjectMemorySettings } from '../project-memory-settings.ts'
import { PROJECT_MEMORY_ENABLED_FIELD, PROJECT_MEMORY_SETTINGS_NAMESPACE } from '../project-memory-settings.ts'
import { ProjectMemoryToggleRow, type ProjectMemoryToggleRowInjected } from './ProjectMemoryToggleRow.tsx'
import { createProjectMemoryStore } from './project-memory-store.ts'
import { en, zh, type ProjectMemoryKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Project-memory toggle row copy. */
    'settings.projectMemory': ProjectMemoryKey
  }
}

/** Dictionary namespace owned by this plugin (the toggle row's copy). */
const NS = 'settings.projectMemory'

/**
 * Required services: the settings scope transport plus slots/locale for the
 * General-section row. `connection` and `remote` carry the settings
 * invalidation that `settingsScope.bind` subscribes to on this context.
 */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

/**
 * Client plugin body: bind the project-memory settings scope to the toggle
 * row and register it in the General section.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-project-memory: dictionaries')

  const host = ctx.settingsScope.bind<ProjectMemorySettings>({ namespace: PROJECT_MEMORY_SETTINGS_NAMESPACE })
  const store = createProjectMemoryStore()
  let bound: BoundActions<typeof store> | undefined
  const sync = (): void => {
    const snapshot = host.getSnapshot()
    if (snapshot.status !== 'ready' || snapshot.value === undefined) return
    const { enabled } = snapshot.value
    bound?.sync(enabled, snapshot.revision ?? -1)
  }
  ctx.effect(() => {
    const disposer = host.subscribe(sync)
    sync()
    return disposer
  }, 'ui-project-memory: settings mirror')

  const injected = (actions: BoundActions<typeof store>): ProjectMemoryToggleRowInjected => {
    bound = actions
    sync()
    return {
      setEnabled: (enabled) => { void host.set(PROJECT_MEMORY_ENABLED_FIELD, enabled) },
    }
  }
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'project-memory',
    order: 21,
    store,
    locale: NS,
    inject: injected,
  }, ProjectMemoryToggleRow))
}
