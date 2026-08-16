/**
 * Desktop-tools plugin, browser half: adds the inline balance/cost dock to
 * the conversation stats bar and raises a Windows task-completion
 * notification when an agent turn ends. The desktop shell owns the balance
 * query, the top-up link, and the toast.
 * @module @deepseek-ai/dsh-client-ui-desktop-tools/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionTurnEndEvent } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the composer.dock entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import './slot-types.ts'
import { BalanceDock } from './BalanceDock.tsx'
import { invokeShell, isTauriShell } from './desktop-bridge.ts'
import { en, zh } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'desktopTools'

/** Minimum interval between notifications for the same session (ms). */
const NOTIFY_COOLDOWN_MS = 30_000

/** Required services: slot registry and locale dictionary registry. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the balance dock and the turn-end
 * notification listener.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-desktop-tools: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'desktop-tools-balance',
    order: 100,
    locale: NS,
  }, BalanceDock)

  const lastNotifyAt = new Map<string, number>()
  ctx.effect(() => {
    const onTurnEnd = (event: SessionTurnEndEvent): void => {
      if (!isTauriShell()) return
      const now = Date.now()
      const last = lastNotifyAt.get(event.sessionId) ?? 0
      if (now - last < NOTIFY_COOLDOWN_MS) return
      lastNotifyAt.set(event.sessionId, now)
      void invokeShell('notify_task_done', {
        title: t('notify.title'),
        body: t('notify.body'),
      })
    }
    const disposer = ctx.on('session/turn-end', onTurnEnd)
    return () => {
      disposer()
      lastNotifyAt.clear()
    }
  }, 'ui-desktop-tools: task notifications')
}
