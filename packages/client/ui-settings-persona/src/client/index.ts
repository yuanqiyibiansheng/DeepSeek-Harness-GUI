/**
 * Persona settings section plugin, browser half. Registers the Persona page
 * over the host instructions wire (readInstructions / writeInstructions).
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.remote merge and forwarded-event key faces.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { PersonaSection } from './PersonaSection.tsx'
import type { PersonaSectionInjected } from './PersonaSection.tsx'
import { PersonaSettingsStore } from './store.ts'
import { en, zh, type PersonaKey } from './locales.ts'

export type { PersonaSectionInjected, PersonaSectionProps } from './PersonaSection.tsx'
export type { PersonaKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Persona page copy. */
    'settings.persona': PersonaKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.persona'
export type { PersonaSettingsState } from './store.ts'

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on each slot through `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'connection', 'remote']

/**
 * Register the Persona section once the `settings.section` declaration is on
 * the ledger, wired to the host instructions wire.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-persona: copy dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new PersonaSettingsStore(connection.api)
  const useSnapshot = bindSnapshotSelector(controller.store)
  const t = ctx.locale.bind(NS) as PersonaSectionInjected['t']
  const injected = (): PersonaSectionInjected => ({ controller, useSnapshot, t })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'persona',
    order: 2,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, PersonaSection))

  // The page reads the document on mount, so external edits to AGENTS.md are
  // picked up on open.
}
