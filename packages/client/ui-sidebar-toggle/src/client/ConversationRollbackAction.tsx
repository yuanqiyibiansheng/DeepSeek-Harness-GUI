/**
 * Conversation rollback action in the user message actions strip: an undo
 * button that first loads a rollback PREVIEW (the files the snapshot will
 * restore, with per-file diffs and +/- counts) and only then asks for
 * confirmation — the cc-haha rewind contract: see before you roll back, and
 * report what cannot be restored.
 */
import { useEffect, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DiffPayload } from './CodeReviewAction.tsx'
import { parseWorkspaceDiff } from './diff-model.ts'
import { DiffReviewSurface } from './DiffReviewSurface.tsx'
import type { CodeReviewKey } from './locales.ts'
import css from './ConversationRollbackAction.module.css'

/** One file's rollback preview row. */
export interface RollbackPreviewFile {
  path: string
  state: 'modified' | 'created' | 'deleted'
  additions: number
  deletions: number
  diff?: string
  note?: string
}

/** The /code-review/rollback/preview payload. */
export interface RollbackPreview {
  ok?: boolean
  files?: RollbackPreviewFile[]
  skipped?: string[]
  totalAdditions?: number
  totalDeletions?: number
  restoreAvailable?: boolean
  error?: string
}

/** Full props: standard user-action runtime share plus the code-review locale. */
export type ConversationRollbackActionProps =
  PropsRuntime<'conversation.chat.user-actions'> & PropsLocale<'code-review'>

/** The state label for one preview row. */
function stateLabel(t: (key: CodeReviewKey, params?: Record<string, unknown>) => string, state: RollbackPreviewFile['state']): string {
  switch (state) {
    case 'modified': return t('review.rollbackStateModified')
    case 'created': return t('review.rollbackStateCreated')
    case 'deleted': return t('review.rollbackStateDeleted')
  }
}

/**
 * Render the per-message rollback icon with a preview-then-confirm dialog.
 * @param props - session identity and locale.
 * @returns the small undo button and the preview dialog.
 */
export function ConversationRollbackAction({ sessionId, messageId, useSessions, t }: ConversationRollbackActionProps) {
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [preview, setPreview] = useState<RollbackPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
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
    setPreview(null)
    setSelectedPath(null)
    setPreviewLoading(true)
    fetch(`http://127.0.0.1:3199/code-review/rollback/preview?cwd=${encodeURIComponent(cwd)}&session=${encodeURIComponent(sessionId)}&message=${encodeURIComponent(messageId)}`)
      .then(response => response.json() as Promise<RollbackPreview>)
      .then(json => {
        setPreview(json)
        if (json.ok === true && (json.files?.length ?? 0) > 0) {
          setSelectedPath(json.files?.[0]?.path ?? null)
        }
      })
      .catch(() => { setPreview({ ok: false, error: t('review.rollbackFailed') }) })
      .finally(() => { setPreviewLoading(false) })
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

  const files = preview?.ok === true ? preview.files ?? [] : []
  const selected = files.find(file => file.path === selectedPath)
  const selectedRows = selected !== undefined && (selected.diff ?? '') !== ''
    ? (parseWorkspaceDiff(selected.diff ?? '')[0]?.rows ?? [])
    : []

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
          <h2 className={css.dialogTitle}>{t('review.rollbackPreview')}</h2>
          {previewLoading && <p className={css.dialogText}>{t('review.rollbackLoading')}</p>}
          {!previewLoading && preview?.ok !== true && (
            <p className={css.dialogError}>{preview?.error ?? t('review.rollbackFailed')}</p>
          )}
          {!previewLoading && preview?.ok === true && (
            <>
              <p className={css.dialogText}>
                {t('review.rollbackFiles', { count: files.length })}
                {files.length > 0 && `（+${preview.totalAdditions ?? 0} -${preview.totalDeletions ?? 0}）`}
              </p>
              {(preview.skipped?.length ?? 0) > 0 && (
                <p className={css.dialogWarn}>
                  {t('review.rollbackSkipped', { count: preview.skipped?.length ?? 0 })}
                  {preview.skipped?.slice(0, 5).map(item => (
                    <span key={item} className={css.previewSkippedItem}>{item}</span>
                  ))}
                  {(preview.skipped?.length ?? 0) > 5 && <span className={css.previewSkippedItem}>…</span>}
                </p>
              )}
              <div className={css.previewBody}>
                <div className={css.previewFiles}>
                  {files.length === 0 && <div className={css.previewEmpty}>{t('review.empty')}</div>}
                  {files.map(file => (
                    <button
                      type="button"
                      key={file.path}
                      className={file.path === selectedPath ? `${css.previewFile} ${css.previewFileSelected}` : css.previewFile}
                      onClick={() => { setSelectedPath(file.path) }}
                    >
                      <span className={css.previewFilePath}>{file.path}</span>
                      <span className={css.previewFileState}>{stateLabel(t, file.state)}</span>
                      {file.additions > 0 && <span className={css.previewAdded}>+{file.additions}</span>}
                      {file.deletions > 0 && <span className={css.previewDeleted}>-{file.deletions}</span>}
                    </button>
                  ))}
                </div>
                {selected !== undefined && (
                  <div className={css.previewDiff}>
                    {selectedRows.length > 0 ? (
                      <DiffReviewSurface
                        path={selected.path}
                        rows={selectedRows}
                        expandLabel={t('review.expandAll')}
                        collapseLabel={t('review.collapse')}
                      />
                    ) : (
                      <p className={css.previewNote}>
                        {selected.note !== undefined
                          ? selected.note
                          : selected.state === 'created'
                            ? t('review.rollbackStateCreated')
                            : t('review.rollbackNoDiff')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
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
              disabled={previewLoading || preview?.ok !== true}
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
