/**
 * Session rewind client plugin: the per-turn "N 个文件已更改" checkpoint card
 * in the chat view's turn-tail chain, matching the reference desktop flow.
 * Every call goes through the sessionRewind Host Remote.
 * @module @deepseek-ai/dsh-client-ui-session-rewind/client
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the generated Remote API and ctx.remote merge through the
// Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-conversation SlotMap merge and ctx.conversationInput Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { RewindCard, selectRewindTurn, type RewindInjected } from './RewindCard.tsx'
import { RewindController } from './rewind-controller.ts'
import { en, zh, type RewindKey } from './locales.ts'

export type { RewindCardProps, RewindInjected, RewindTurnMatch } from './RewindCard.tsx'
export { selectRewindTurn } from './RewindCard.tsx'
export type { RewindKey } from './locales.ts'
export type { RewindView } from './rewind-controller.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'rewind'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The per-message rewind action's copy. */
    rewind: RewindKey
  }
}

/** Required services: the slot registry, the Remote namespace, the copy, the
 * sessions runtime, and the connection owner for a fresh subscribed generation. */
export const inject = ['slots', 'remote', 'remote.sessionRewind', 'locale', 'sessions', 'connection', 'conversationInput']

/**
 * Client plugin body: register the per-message rewind action.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'rewind: dictionaries')

  const controllers = new Map<SessionId, RewindController>()
  const resetControllers = (): void => {
    for (const controller of controllers.values()) controller.reset()
  }
  const controllerFor = (sessionId: SessionId): RewindController => {
    let controller = controllers.get(sessionId)
    if (controller === undefined) {
      controller = new RewindController(ctx.remote.sessionRewind, sessionId)
      controllers.set(sessionId, controller)
    }
    return controller
  }

  // A reconnect re-baselines every session from the host; drop the cached
  // checkpoint lists so the next turn-count read refetches the trimmed truth.
  ctx.on('connection/reset', resetControllers)

  ctx.slots.inject('conversation.chat.turnTail', () => {
    const dispose = ctx.slots.register({
      name: 'conversation.chat.turnTail',
      select: selectRewindTurn,
      locale: NS,
      inject: (sessionId): RewindInjected => {
        const controller = controllerFor(sessionId)
        return {
          hooks: { rewind: controller },
          ensure: completedTurnCount => controller.ensure(completedTurnCount),
          execute: async (selector, mode) => {
            const result = await controller.execute(selector, mode)
            if (result.ok && result.value.childSessionId !== undefined) {
              controller.reset()
              await ctx.sessions.open(result.value.childSessionId as SessionId)
            }
            return result
          },
        }
      },
    }, RewindCard)
    return () => {
      dispose()
      for (const controller of controllers.values()) controller.dispose()
      controllers.clear()
    }
  })
}
