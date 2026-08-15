/**
 * Integrated terminal client plugin: the Terminal shell preference row in the
 * General settings section (the same shape as the permission-preset row). The
 * `terminal` settings namespace is owned by the host terminal-host plugin;
 * this package binds it through the shared settings scope.
 * @module @deepseek-ai/dsh-client-ui-terminal/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { TerminalShellRow, type TerminalSettingsInjected } from './TerminalShellRow.tsx'
import { en, zh, type UiTerminalKey } from './locales.ts'

/** Namespace owning this feature's copy. */
export const NS = 'ui-terminal'

/** The `terminal` settings namespace name (owned by terminal-host). */
export const TERMINAL_SETTINGS_NAMESPACE = 'terminal'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The terminal shell setting copy. */
    'ui-terminal': UiTerminalKey
  }
}

export type { TerminalSettingsInjected } from './TerminalShellRow.tsx'
export type { UiTerminalKey } from './locales.ts'

/** Required services: the general item slot and the settings scope. */
export const inject = ['slots', 'locale', 'settingsScope']

/**
 * Client plugin body: register the shell preference row, bound to the
 * `terminal` settings namespace.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    'ui-terminal: shell setting dictionaries',
  )

  const scope = ctx.settingsScope.bind<{ shell?: string }>({ namespace: TERMINAL_SETTINGS_NAMESPACE })
  const injected = (): TerminalSettingsInjected => ({
    defaultShell: () => scope.getSnapshot().value?.shell ?? 'pwsh',
    setShell: (shell) => { void scope.set('shell', shell) },
  })

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'terminal-shell',
    order: 90,
    locale: NS,
    inject: injected,
  }, TerminalShellRow))
}
