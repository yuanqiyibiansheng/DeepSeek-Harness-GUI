/**
 * Conversation rollback action in the user message actions strip: a small
 * undo button that restores files and the conversation log to the snapshot
 * taken before the clicked user message.
 */
import { useEffect, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DiffPayload } from './CodeReviewAction.tsx'
import css from './ConversationRollbackAction.module.css'

/** Full props: standard user-action runtime share plus the code-review locale. */
export type ConversationRollbackActionProps =
  PropsRuntime<'conversation.chat.user-actions'> & PropsLocale<'code-review'>

/**
 * Render the per-message rollback icon.
 * @param props - session identity and locale.
 * @returns the small undo button and confirmation dialog.
 */
export function ConversationRollbackAction({ sessionId, messageId, useSessions, t }: ConversationRollbackActionProps) {
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const cwd = useSessions(state => state.byId[sessionId]?.cwd ?? '')

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
    setConfirmOpen(false)
    setBusy(true)
    try {
      const response = await fetch(`http://127.0.0.1:3199/code-review/rollback?cwd=${encodeURIComponent(cwd)}&session=${encodeURIComponent(sessionId)}&message=${encodeURIComponent(messageId)}`)
      const json = await response.json() as DiffPayload
      if (json.ok === true) {
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
          <p className={css.dialogText}>{t('review.rollbackConfirm')}</p>
          <div className={css.dialogActions}>
            <Button
              variant="outline"
              className={css.cancelButton}
              onClick={() => { setConfirmOpen(false) }}
            >
              {t('review.rollbackCancel')}
            </Button>
            <Button
              variant="primary"
              className={css.confirmButton}
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
