/**
 * Code review client plugin: one Session Header utility action plus the
 * global Ctrl+Alt+B shortcut. Both paths toggle the right-side drawer that
 * reads the current workspace git diff from the local desktop service.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { CodeReviewAction, type CodeReviewInjected } from './CodeReviewAction.tsx'
import { ConversationRollbackAction } from './ConversationRollbackAction.tsx'
import { en, zh, type CodeReviewKey } from './locales.ts'

/** Namespace owning this feature's header-action copy. */
export const NS = 'code-review'

/** DOM event name shared by the button and the global shortcut. */
export const TOGGLE_EVENT = 'dsh:code-review-toggle'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Code review action's copy. */
    'code-review': CodeReviewKey
  }
}

export type { CodeReviewInjected, CodeReviewActionProps, DiffPayload } from './CodeReviewAction.tsx'
export type { CodeReviewKey } from './locales.ts'

/** Required services: the header utilities slot and the locale seat. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the header action and the global shortcut.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    'code-review: header action dictionaries',
  )

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'code-review',
    order: 1,
    locale: NS,
    inject: (): CodeReviewInjected => ({
      togglePanel: () => { window.dispatchEvent(new CustomEvent(TOGGLE_EVENT)) },
    }),
  }, CodeReviewAction))

  ctx.slots.inject('conversation.chat.user-actions', () => ctx.slots.register({
    name: 'conversation.chat.user-actions',
    id: 'rollback',
    order: 0,
    locale: NS,
  }, ConversationRollbackAction))

  ctx.effect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.altKey && (event.key === 'b' || event.key === 'B')) {
        event.preventDefault()
        window.dispatchEvent(new CustomEvent(TOGGLE_EVENT))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, 'code-review: Ctrl+Alt+B shortcut')
}