/**
 * Code review action in the Session Header utilities seat: opens a right-side
 * drawer showing the current workspace git status and diff. Ctrl+Alt+B and
 * the header button both toggle the drawer through a shared DOM event.
 */
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconPanelLeftOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { parseUntrackedFiles, parseWorkspaceDiff, untrackedRows } from './diff-model.ts'
import { DiffReviewSurface } from './DiffReviewSurface.tsx'
import css from './CodeReviewAction.module.css'

/** Injected business face: toggle the right-side review drawer. */
export interface CodeReviewInjected {
  /** Toggle the review drawer. */
  togglePanel: () => void
}

/** Full component props: runtime share + locale seat + injected face. */
export type CodeReviewActionProps =
  PropsRuntime<'conversation.session.header.utilities'> & PropsLocale<'code-review'> & CodeReviewInjected

/** Payload returned by the local desktop diff service. */
export interface DiffPayload {
  ok?: boolean
  root?: string
  cwd?: string
  files?: string
  numstat?: string
  stat?: string
  diff?: string
  newFiles?: string
  fingerprint?: string
  /** True for the session-baseline review served in non-git workspaces. */
  snapshot?: boolean
  error?: string
}

/** Payload returned by the long-poll change watcher. */
interface WatchPayload {
  ok?: boolean
  changed?: boolean
  fingerprint?: string
  error?: string
}

/** One changed file row shown in the review drawer. */
interface ReviewFileRow {
  path: string
  added: string
  deleted: string
  untracked: boolean
}

/**
 * Build the changed-file list from git numstat and porcelain status.
 * @param files - `git status --porcelain -uall` output.
 * @param numstat - `git diff --numstat` output.
 * @returns per-file rows with insertion/deletion counts.
 */
function parseRows(files: string, numstat: string): ReviewFileRow[] {
  const rows: ReviewFileRow[] = []
  const seen = new Set<string>()
  for (const line of numstat.split('\n')) {
    const parts = line.split('\t')
    const path = parts.slice(2).join('\t').trim()
    if (path === '') continue
    seen.add(path)
    rows.push({ path, added: parts[0] ?? '', deleted: parts[1] ?? '', untracked: false })
  }
  for (const line of files.split('\n')) {
    if (!line.startsWith('?? ')) continue
    const path = line.slice(3).trim()
    if (path === '' || seen.has(path)) continue
    seen.add(path)
    rows.push({ path, added: '', deleted: '', untracked: true })
  }
  return rows
}

/**
 * Render the code review action and drawer.
 * @param props - composed slot props.
 * @returns the header action plus the openable drawer.
 */
export function CodeReviewAction({ sessionId, useSessions, t, togglePanel }: CodeReviewActionProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [payload, setPayload] = useState<DiffPayload | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const cwd = useSessions(state => state.byId[sessionId]?.cwd ?? '')

  useEffect(() => {
    const onToggle = (): void => { setOpen(current => !current) }
    window.addEventListener('dsh:code-review-toggle', onToggle)
    return () => { window.removeEventListener('dsh:code-review-toggle', onToggle) }
  }, [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    let hadOk = false
    let fingerprint = ''
    let controller: AbortController | null = null
    let timer: number | undefined

    const load = (retry = 0): Promise<DiffPayload | null> => {
      if (cwd === '') {
        setPayload({ error: t('review.noWorkspace') })
        return Promise.resolve(null)
      }
      controller = new AbortController()
      return fetch(`http://127.0.0.1:3199/code-review?cwd=${encodeURIComponent(cwd)}&session=${encodeURIComponent(sessionId)}`, { signal: controller.signal })
        .then(response => response.json() as Promise<DiffPayload>)
        .then(json => {
          if (!cancelled) {
            setPayload(json)
            if (json.ok === true) {
              hadOk = true
              if (json.fingerprint) fingerprint = json.fingerprint
            }
          }
          return json
        })
        .catch((error: unknown) => {
          // The desktop diff server binds a moment after the app window
          // opens; a fetch in that window fails with "Failed to fetch".
          // Retry briefly instead of showing the raw error.
          if (!cancelled && retry < 5) {
            timer = window.setTimeout(() => { void load(retry + 1) }, 800)
            return null
          }
          if (!cancelled) {
            setPayload({ error: String(error) })
            setLoading(false)
          }
          return null
        })
    }

    const watch = (): void => {
      if (cancelled || cwd === '') return
      controller = new AbortController()
      fetch(`http://127.0.0.1:3199/code-review/watch?cwd=${encodeURIComponent(cwd)}&session=${encodeURIComponent(sessionId)}&since=${encodeURIComponent(fingerprint)}`, { signal: controller.signal })
        .then(response => response.json() as Promise<WatchPayload>)
        .then(async json => {
          if (cancelled) return
          if (json.changed) {
            if (json.fingerprint) fingerprint = json.fingerprint
            const next = await load()
            if (cancelled) return
            if (next?.ok === true) {
              watch()
            } else if (hadOk) {
              timer = window.setTimeout(watch, 500)
            }
          } else {
            watch()
          }
        })
        .catch(() => {
          if (!cancelled) timer = window.setTimeout(watch, 1000)
        })
    }

    setLoading(true)
    load().then(json => {
      if (cancelled) return
      // A null result means a retry is in flight; keep the loading state.
      if (json !== null) setLoading(false)
      // The snapshot-based review is computed per request; there is no
      // git-backed change watcher for it, so skip long-polling.
      if (json?.ok === true && !json.snapshot) watch()
    })

    return () => {
      cancelled = true
      controller?.abort()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [open, cwd, t])


  useEffect(() => {
    if (cwd === '' || sessionId === '') return
    let cancelled = false
    let fingerprint = ''
    const query = `cwd=${encodeURIComponent(cwd)}&session=${encodeURIComponent(sessionId)}`
    const record = (): void => {
      if (cancelled) return
      fetch(`http://127.0.0.1:3199/code-review/watch?${query}&since=${encodeURIComponent(fingerprint)}`)
        .then(response => response.json() as Promise<WatchPayload>)
        .then(json => {
          if (cancelled) return
          if (json.changed === true && json.fingerprint) fingerprint = json.fingerprint
          record()
        })
        .catch(() => {
          if (!cancelled) window.setTimeout(record, 1000)
        })
    }
    fetch(`http://127.0.0.1:3199/code-review/snapshot?${query}`)
      .then(response => response.json() as Promise<DiffPayload>)
      .then(json => {
        if (!cancelled && json.ok === true) {
          record()
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [cwd, sessionId])

  const rows = payload?.ok === true ? parseRows(payload.files ?? '', payload.numstat ?? '') : []
  const parsedFiles = useMemo(
    () => (payload?.ok === true ? parseWorkspaceDiff(payload.diff ?? '') : []),
    [payload],
  )
  const untrackedFiles = useMemo(
    () => (payload?.ok === true ? parseUntrackedFiles(payload.newFiles ?? '') : []),
    [payload],
  )
  const activeFile = selectedPath === null ? undefined : parsedFiles.find(file => file.path === selectedPath)
  const activeUntracked = selectedPath === null ? undefined : untrackedFiles.find(file => file.path === selectedPath)

  // Auto-select the first changed file once a fresh payload lands.
  useEffect(() => {
    if (selectedPath === null && rows.length > 0) {
      setSelectedPath(rows[0]?.path ?? null)
    }
  }, [rows, selectedPath])

  // A stale selection (the payload changed between opens) falls back to the
  // auto-select path instead of leaving the diff area empty.
  useEffect(() => {
    if (selectedPath !== null && !rows.some(row => row.path === selectedPath)) {
      setSelectedPath(null)
    }
  }, [rows, selectedPath])

  return (
    <>
      <button
        type="button"
        className={css.action}
        title={`${t('review.toggle')} (Ctrl+Alt+B)`}
        onClick={togglePanel}
      >
        <IconPanelLeftOutline16 size={14} />
        <span>{t('review.toggle')}</span>
      </button>
      {createPortal(
        <div
          className={open ? `${css.drawer} ${css.open}` : css.drawer}
          role="dialog"
          aria-label={t('review.title')}
          aria-hidden={!open}
        >
          <header className={css.header}>
            <span className={css.title}>{t('review.title')}</span>
            <button type="button" className={css.close} onClick={() => { setOpen(false) }}>
              {t('review.close')}
            </button>
          </header>
          <div className={css.cwd}>{cwd === '' ? t('review.noWorkspace') : cwd}</div>
          <div className={css.body}>
            {loading && payload === null && <div className={css.status}>{t('review.loading')}</div>}
            {!loading && payload?.ok !== true && (
              <div className={css.error}>
                {payload?.error === 'current directory is not inside a git repository'
                  ? t('review.notGitRepo')
                  : payload?.error ?? t('review.failed')}
              </div>
            )}
            {payload?.ok === true && (
              <>
                {/* Kept visible while a background refresh is in flight, so
                    reopening the drawer shows the previous review instantly
                    instead of waiting for the next full computation. */}
                <div className={css.files}>
                  {rows.length === 0 && <div className={css.empty}>{t('review.empty')}</div>}
                  {rows.map(row => (
                    <button
                      type="button"
                      key={row.path}
                      className={row.path === selectedPath ? `${css.fileRow} ${css.fileRowSelected}` : css.fileRow}
                      onClick={() => { setSelectedPath(row.path) }}
                    >
                      <span className={css.filePath}>{row.path}</span>
                      {row.untracked ? (
                        <span className={css.fileUntracked}>{t('review.untracked')}</span>
                      ) : (
                        <span className={css.fileCount}>
                          <span className={css.added}>+{row.added}</span>
                          <span className={css.deleted}>-{row.deleted}</span>
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                {activeFile !== undefined || activeUntracked !== undefined ? (
                  <DiffReviewSurface
                    path={activeFile?.path ?? activeUntracked?.path ?? ''}
                    rows={activeFile !== undefined ? activeFile.rows : untrackedRows(activeUntracked?.content ?? '')}
                    expandLabel={t('review.expandAll')}
                    collapseLabel={t('review.collapse')}
                  />
                ) : (
                  rows.length > 0 && <div className={css.empty}>{t('review.empty')}</div>
                )}
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
