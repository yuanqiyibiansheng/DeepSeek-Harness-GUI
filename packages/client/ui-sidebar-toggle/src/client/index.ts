/**
 * Conversation rollback client plugin: one undo action per user message that
 * restores code and conversation together through the local desktop service.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ConversationRollbackAction } from './ConversationRollbackAction.tsx'
import { en, zh, type CodeReviewKey } from './locales.ts'

/** Namespace owning the rollback action copy. */
export const NS = 'code-review'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The rollback action's copy. */
    'code-review': CodeReviewKey
  }
}

export type { CodeReviewKey } from './locales.ts'
export type { DiffPayload } from './diff-payload.ts'

/** Required services: the user-actions slot and the locale seat. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the per-message rollback action.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    'code-review: rollback dictionaries',
  )

  ctx.slots.inject('conversation.chat.user-actions', () => ctx.slots.register({
    name: 'conversation.chat.user-actions',
    id: 'rollback',
    order: 0,
    locale: NS,
  }, ConversationRollbackAction))
}
