/**
 * Conversation rollback action in the user message actions strip: an undo
 * button that asks for confirmation, then rolls back code and conversation
 * together for this message. The original message returns to the input for
 * re-editing (dsh-TUI rewind semantics).
 */
import { useEffect, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationSnapshot, UserMessageNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DiffPayload } from './diff-payload.ts'
import css from './ConversationRollbackAction.module.css'

/** Full props: standard user-action runtime share plus the code-review locale. */
export type ConversationRollbackActionProps =
  PropsRuntime<'conversation.chat.user-actions'> & PropsLocale<'code-review'>

/** Pending rollback draft key: the message text is restored after reload. */
const PENDING_DRAFT_PREFIX = 'dsh-rollback-draft:'

/**
 * Extract the plain text of one user message from the conversation snapshot.
 * @param snapshot - the standard conversation snapshot.
 * @param messageId - the user message seq string passed to the action.
 * @returns the message's text blocks joined by newlines.
 */
function userMessageText(snapshot: ConversationSnapshot, messageId: string): string {
  const node = snapshot.chat.legacy.nodes.find((item): item is UserMessageNode =>
    item.kind === 'user' && String(item.seq) === messageId)
  return (node?.content ?? [])
    .filter(block => block.type === 'text')
    .map(block => block.text ?? '')
    .join('\n')
}

/**
 * Render the per-message rollback icon with a confirmation-only dialog.
 * @param props - session identity and locale.
 * @returns the small undo button and the rollback dialog.
 */
export function ConversationRollbackAction({ sessionId, messageId, useSession, useSessions, t }: ConversationRollbackActionProps) {
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const cwd = useSessions(state => state.byId[sessionId]?.cwd ?? '')
  const selectedText = useSession(snapshot => userMessageText(snapshot, messageId))

  useEffect(() => {
    if (cwd === '') return
    let cancelled = false
    fetch(`http://127.0.0.1:3199/code-review/snapshot?cwd=${encodeURIComponent(cwd)}&session=${encodeURIComponent(sessionId)}&message=${encodeURIComponent(messageId)}`)
      .then(response => response.json() as Promise<DiffPayload>)
      .then(json => {
        if (!cancelled && json.ok === true) setReady(true)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [cwd, sessionId, messageId])

  const rollback = (): void => {
    if (!ready || busy) return
    setConfirmOpen(true)
  }

  const performRollback = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const response = await fetch(`http://127.0.0.1:3199/code-review/rollback?cwd=${encodeURIComponent(cwd)}&session=${encodeURIComponent(sessionId)}&message=${encodeURIComponent(messageId)}&scope=both`)
      const json = await response.json() as DiffPayload
      if (json.ok === true) {
        if (selectedText !== '') {
          sessionStorage.setItem(`${PENDING_DRAFT_PREFIX}${sessionId}`, selectedText)
          const setter = (window as unknown as {
            __dshSetRollbackDraft?: (sessionId: string, text: string) => void
          }).__dshSetRollbackDraft
          setter?.(String(sessionId), selectedText)
        }
        const internals = (window as unknown as {
          __TAURI_INTERNALS__?: { invoke(command: string, args?: unknown): Promise<unknown> }
        }).__TAURI_INTERNALS__
        if (internals !== undefined) {
          try {
            await internals.invoke('restart_service')
            return
          } catch {
            // Desktop shell restart unavailable: fall back to a full reload.
          }
        }
        window.location.reload()
        return
      }
      window.alert(json.error ?? t('review.rollbackFailed'))
    } catch (error) {
      window.alert(String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className={css.undo}
        title={t('review.rollback')}
        aria-label={t('review.rollback')}
        disabled={!ready || busy}
        onClick={rollback}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 10h7a5 5 0 0 1 0 10H7" />
          <polyline points="7 6 3 10 7 14" />
        </svg>
      </button>
      <Modal
        open={confirmOpen}
        onClose={() => { setConfirmOpen(false) }}
        title={t('review.rollbackTitle')}
        className={css.dialog as string}
        headless
      >
        <div className={css.dialogBody}>
          <h2 className={css.dialogTitle}>{t('review.rollbackTitle')}</h2>
          {busy && <p className={css.dialogText}>{t('review.rollbackWorking')}</p>}
          <div className={css.dialogActions}>
            <Button
              variant="outline"
              className={css.cancelButton}
              disabled={busy}
              onClick={() => { setConfirmOpen(false) }}
            >
              {t('review.rollbackCancel')}
            </Button>
            <Button
              variant="primary"
              className={css.confirmButton}
              disabled={busy}
              onClick={() => { void performRollback() }}
            >
              {t('review.rollbackAction')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
