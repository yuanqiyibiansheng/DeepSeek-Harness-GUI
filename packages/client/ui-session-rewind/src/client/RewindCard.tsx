/**
 * Per-turn rewind card: the "N 个文件已更改" checkpoint card a completed turn
 * ends with, matching the reference desktop flow. The card lists the turn's
 * tracked files with +/- statistics, opens a file through the chat view's
 * opener, and offers undo (latest turn) or "回滚到这一轮之前" (historical
 * turns) through the reference confirm dialog.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ConversationSnapshot, UserMessageNode } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  RewindTargetSelector,
  SessionRewindExecuteResult,
  SessionRewindMode,
} from '@deepseek-ai/dsh-session-rewind/types'
import type { RewindView } from './rewind-controller.ts'
import type {} from './locales.ts'
import css from './RewindCard.module.css'

/** Files shown before the list collapses behind "show more". */
const COLLAPSED_FILE_COUNT = 5

/** Match the turn-tail chain entry claims for one completed turn. */
export interface RewindTurnMatch {
  readonly turn: number
  readonly seq: number
}

/** The rewind verbs and checkpoint view this entry injects, bound to the session. */
export interface RewindInjected {
  hooks: {
    /** The owning Session's checkpoint view, shared by every turn card. */
    rewind: HostObservable<RewindView>
  }
  /** Load the Session's checkpoint list, refetching when a turn completes. */
  ensure: (completedTurnCount: number) => Promise<void>
  /** Execute a rewind for one target message. */
  execute: (
    selector: RewindTargetSelector,
    mode?: SessionRewindMode,
  ) => Promise<RemoteResult<SessionRewindExecuteResult>>
}

/**
 * Claim the turn-tail chain for every closed turn; the card itself decides
 * whether the turn has a checkpoint once the shared list has loaded.
 * @param owner - Turn-tail owner currency for the closing assistant.
 * @returns the turn identity, or null while the turn is still open.
 */
export function selectRewindTurn(owner: TurnTailOwnerProps): RewindTurnMatch | null {
  if (owner.turn.status !== 'closed') return null
  return { turn: owner.turn.turn, seq: owner.seq }
}

/** Full props of one turn-tail rewind card. */
export type RewindCardProps =
  Pick<TurnTailOwnerProps, 'openFile'>
  & { matched: RewindTurnMatch }
  & PropsRuntime<'conversation.chat.turnTail'>
  & InjectFace<RewindInjected>
  & PropsLocale<'rewind'>

/**
 * Resolve the user message seq that opened one turn from the snapshot's
 * engine-owned location index.
 * @param snapshot - the standard conversation snapshot.
 * @param turn - the completed turn number.
 * @returns the turn-opening user message seq string, or undefined.
 */
function turnUserSeq(snapshot: ConversationSnapshot, turn: number): string | undefined {
  for (const key of snapshot.chat.locations.getTurn(turn)) {
    const node = snapshot.chat.nodes.get(key)
    if (node?.kind === 'user' && (node.data as UserMessageNode).kind === 'user') {
      return String((node.data as UserMessageNode).seq)
    }
  }
  return undefined
}

/** Relativize an absolute checkpoint path against the turn's workdir. */
function relativizeWorkspacePath(filePath: string, workDir: string | undefined): string {
  const normalizedPath = filePath.replace(/\\/g, '/')
  if (workDir === undefined) return normalizedPath
  const normalizedWorkDir = workDir.replace(/\\/g, '/').replace(/\/+$/, '')
  const comparablePath = normalizedPath.toLowerCase()
  const comparableWorkDir = normalizedWorkDir.toLowerCase()
  if (comparablePath.startsWith(`${comparableWorkDir}/`)) {
    return normalizedPath.slice(normalizedWorkDir.length + 1)
  }
  return normalizedPath
}

/** File-type presentation facts, mirroring the reference card's type row. */
function describeFileType(displayPath: string): { category: 'rewind.typeDocument' | 'rewind.typeText' | 'rewind.typeImage' | 'rewind.typeCode' | 'rewind.typeFile'; ext: string } {
  const ext = (displayPath.split('.').pop() ?? '').toUpperCase()
  if (['MD', 'MARKDOWN'].includes(ext)) return { category: 'rewind.typeDocument', ext }
  if (['PNG', 'JPG', 'JPEG', 'GIF', 'WEBP', 'SVG', 'ICO'].includes(ext)) return { category: 'rewind.typeImage', ext }
  if (['TS', 'TSX', 'JS', 'JSX', 'JSON', 'PY', 'RS', 'GO', 'JAVA', 'C', 'CPP', 'H', 'CSS', 'HTML', 'YAML', 'YML', 'TOML', 'SQL', 'SH', 'BAT', 'PS1'].includes(ext)) return { category: 'rewind.typeCode', ext }
  if (['TXT', 'LOG', 'CSV'].includes(ext)) return { category: 'rewind.typeText', ext }
  return { category: 'rewind.typeFile', ext }
}

/**
 * Render one turn's checkpoint card plus the rewind confirm dialog.
 * @param props - turn identity, opener, the injected rewind view/verbs, copy.
 * @returns the card, or null while the checkpoint list is still loading or
 * the turn has no checkpoint.
 */
export function RewindCard({
  matched, openFile, useSession, useRewind, ensure, execute, t,
}: RewindCardProps) {
  const status = useRewind(view => view.status)
  const byTarget = useRewind(view => view.byTarget)
  const userSeq = useSession(snapshot => turnUserSeq(snapshot, matched.turn))
  // turnEnds grows only on turn/end, so a newly completed turn changes this
  // count and forces the checkpoint refetch that makes the card appear live.
  const completedTurnCount = useSession(snapshot => snapshot.turnEnds.size)
  const isLatest = useSession(snapshot =>
    snapshot.chat.timeline.turnOrder.at(-1) === matched.turn)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAllFiles, setShowAllFiles] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // status is a dependency too: a connection reset clears the view to
    // 'cold', and the same completed-turn count must still trigger a refetch.
    void ensure(completedTurnCount)
  }, [ensure, completedTurnCount, status])

  const checkpoint = userSeq === undefined ? undefined : byTarget.get(userSeq)

  const closeDialog = useCallback((): void => {
    if (busy) return
    setOpen(false)
  }, [busy])

  useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDialog()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open, closeDialog])

  const performRollback = useCallback(async (mode: SessionRewindMode): Promise<void> => {
    if (busy || userSeq === undefined) return
    setBusy(true)
    setError(null)
    try {
      const result = await execute({ targetUserMessageId: userSeq }, mode)
      if (!result.ok) {
        setError(result.error.message || t('rewind.failed'))
        return
      }
      setBusy(false)
      setOpen(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setBusy(false)
    }
  }, [busy, execute, t, userSeq])

  if (status !== 'ready' || checkpoint === undefined) return null

  const restoreAvailable = checkpoint.restoreAvailable !== false
  const unverifiedChangeSources = checkpoint.unverifiedChangeSources ?? []
  const hasUnverifiedChanges = restoreAvailable && unverifiedChangeSources.length > 0
  const files = checkpoint.code.filesChanged.map(filePath => ({
    apiPath: filePath,
    displayPath: relativizeWorkspacePath(filePath, checkpoint.workDir),
  }))
  const visibleFiles = showAllFiles ? files : files.slice(0, COLLAPSED_FILE_COUNT)
  const subtitle = !restoreAvailable
    ? t('rewind.conversationOnlySubtitle')
    : hasUnverifiedChanges
      ? t('rewind.filesSubtitle', { sources: unverifiedChangeSources.join(', ') })
      : isLatest
        ? t('rewind.latestSubtitle')
        : t('rewind.historicalSubtitle')
  const undoLabel = isLatest ? t('rewind.latestUndo') : t('rewind.historicalUndo')
  const undoAria = isLatest ? t('rewind.latestUndoAria') : t('rewind.historicalUndoAria')
  const confirmTitle = isLatest ? t('rewind.latestConfirmTitle') : t('rewind.historicalConfirmTitle')
  const confirmBody = isLatest ? t('rewind.latestConfirmBody') : t('rewind.historicalConfirmBody')
  const confirmAction = isLatest ? t('rewind.latestConfirmUndo') : t('rewind.historicalConfirmUndo')
  const caution = !restoreAvailable
    ? t('rewind.conversationOnlyBody')
    : hasUnverifiedChanges
      ? t('rewind.partialBody', { sources: unverifiedChangeSources.join(', ') })
      : null

  return (
    <>
      <section className={css.card} aria-label={t('rewind.cardLabel')}>
        <div className={css.cardHeader}>
          <div className={css.headerText}>
            <div className={css.cardTitleRow}>
              <span className={css.cardTitle}>{t('rewind.filesTitle', { count: files.length })}</span>
              <span className={css.added}>+{checkpoint.code.insertions}</span>
              <span className={css.deleted}>-{checkpoint.code.deletions}</span>
            </div>
            <div className={hasUnverifiedChanges ? css.subtitleWarn : css.subtitle}>{subtitle}</div>
          </div>
          <button
            type="button"
            className={`${css.button} ${css.buttonSecondary} ${css.undoButton}`}
            aria-label={undoAria}
            disabled={busy}
            onClick={() => { setOpen(true) }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 10h7a5 5 0 0 1 0 10H7" />
              <polyline points="7 6 3 10 7 14" />
            </svg>
            {busy ? t('rewind.working') : undoLabel}
          </button>
        </div>
        {files.length > 0 && (
          <div className={css.fileList}>
            {visibleFiles.map(({ apiPath, displayPath }) => {
              const fileName = displayPath.split('/').pop() || displayPath
              const typeInfo = describeFileType(displayPath)
              return (
                <div key={apiPath} className={css.fileRow}>
                  <button
                    type="button"
                    className={css.fileMain}
                    aria-label={t('rewind.openWith')}
                    title={displayPath}
                    onClick={() => { openFile(apiPath) }}
                  >
                    <span className={css.fileIcon}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                        <polyline points="14 3 14 9 20 9" />
                      </svg>
                    </span>
                    <span className={css.fileText}>
                      <span className={css.fileName}>{fileName}</span>
                      <span className={css.fileMeta}>{`${t(typeInfo.category)} · ${typeInfo.ext}`}</span>
                    </span>
                    <svg className={css.fileChevron} xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <polyline points="9 6 15 12 9 18" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className={`${css.button} ${css.buttonSecondary} ${css.openWith}`}
                    onClick={() => { openFile(apiPath) }}
                  >
                    {t('rewind.openWith')}
                  </button>
                </div>
              )
            })}
            {files.length > COLLAPSED_FILE_COUNT && (
              <button
                type="button"
                className={css.toggleMore}
                onClick={() => setShowAllFiles(current => !current)}
              >
                {showAllFiles
                  ? t('rewind.showLess')
                  : t('rewind.showMore', { count: String(files.length - COLLAPSED_FILE_COUNT) })}
              </button>
            )}
          </div>
        )}
        {error !== null && (
          <div className={css.errorBanner}>{error}</div>
        )}
      </section>
      {open && createPortal((
        <div className={css.overlay} role="presentation">
          <div className={css.mask} aria-hidden="true" onClick={closeDialog} />
          <div
            ref={panelRef}
            className={css.panel}
            role="dialog"
            aria-modal="true"
            aria-label={confirmTitle}
            tabIndex={-1}
          >
            <div className={css.header}>
              <h2 className={css.title}>{confirmTitle}</h2>
              <button
                type="button"
                className={css.close}
                aria-label={t('rewind.cancel')}
                disabled={busy}
                onClick={closeDialog}
              >
                <span className={css.closeIcon} aria-hidden>×</span>
              </button>
            </div>
            <div className={css.body}>
              <p className={css.bodyText}>{confirmBody}</p>
              {caution !== null && <p className={css.caution}>{caution}</p>}
              <section className={css.card} aria-label={t('rewind.cardLabel')}>
                <div className={css.cardHeader}>
                  <div className={css.headerText}>
                    <div className={css.cardTitleRow}>
                      <span className={css.cardTitle}>{t('rewind.filesTitle', { count: files.length })}</span>
                      <span className={css.added}>+{checkpoint.code.insertions}</span>
                      <span className={css.deleted}>-{checkpoint.code.deletions}</span>
                    </div>
                    <div className={hasUnverifiedChanges ? css.subtitleWarn : css.subtitle}>{subtitle}</div>
                  </div>
                </div>
                {files.length > 0 && (
                  <div className={css.fileList}>
                    {visibleFiles.map(({ apiPath, displayPath }) => {
                      const fileName = displayPath.split('/').pop() || displayPath
                      const typeInfo = describeFileType(displayPath)
                      return (
                        <div key={apiPath} className={css.fileRow}>
                          <span className={css.fileMain}>
                            <span className={css.fileIcon}>
                              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                                <polyline points="14 3 14 9 20 9" />
                              </svg>
                            </span>
                            <span className={css.fileText}>
                              <span className={css.fileName}>{fileName}</span>
                              <span className={css.fileMeta}>{`${t(typeInfo.category)} · ${typeInfo.ext}`}</span>
                            </span>
                          </span>
                        </div>
                      )
                    })}
                    {files.length > COLLAPSED_FILE_COUNT && (
                      <button
                        type="button"
                        className={css.toggleMore}
                        onClick={() => setShowAllFiles(current => !current)}
                      >
                        {showAllFiles
                          ? t('rewind.showLess')
                          : t('rewind.showMore', { count: String(files.length - COLLAPSED_FILE_COUNT) })}
                      </button>
                    )}
                  </div>
                )}
              </section>
              {busy && <p className={css.status}>{t('rewind.working')}</p>}
              {error !== null && <p className={css.error}>{error}</p>}
            </div>
            <div className={css.footer}>
              <button
                type="button"
                className={`${css.button} ${css.buttonSecondary}`}
                disabled={busy}
                onClick={closeDialog}
              >
                {t('rewind.cancel')}
              </button>
              <button
                type="button"
                className={`${css.button} ${restoreAvailable ? css.buttonSecondary : css.buttonDanger}`}
                disabled={busy}
                onClick={() => { void performRollback('conversation') }}
              >
                {t('rewind.conversationOnly')}
              </button>
              {restoreAvailable && (
                <button
                  type="button"
                  className={`${css.button} ${css.buttonDanger}`}
                  disabled={busy}
                  onClick={() => { void performRollback('both') }}
                >
                  {confirmAction}
                </button>
              )}
            </div>
          </div>
        </div>
      ), document.body)}
    </>
  )
}
