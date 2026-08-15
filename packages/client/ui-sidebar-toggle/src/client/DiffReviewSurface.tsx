/**
 * The code-review diff surface: one file's parsed rows rendered with a
 * two-column line-number gutter, +/- prefixes, hunk/metadata chrome, and
 * per-line syntax highlighting through the shared shiki highlighter. Pure
 * presentation — rows and copy arrive through props; the highlighter's
 * `undefined` fallback renders plain text for unknown or not-yet-loaded
 * languages.
 * @module @deepseek-ai/dsh-client-ui-sidebar-toggle/client/DiffReviewSurface
 */

import { useMemo, useState } from 'react'
import { highlightLines, type HighlightSpan } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DiffRow } from './diff-model.ts'
import { languageFromPath } from './diff-model.ts'
import css from './CodeReviewAction.module.css'

/** Line count after which the middle of a long diff collapses. */
export const DEFAULT_DIFF_REVIEW_MAX_LINES = 500

/** The head and tail slice sizes when a diff is collapsed. */
const COLLAPSE_SLICE = 250

export interface DiffReviewSurfaceProps {
  /** The file path shown in the header; also drives the language hint. */
  path: string
  /** The parsed rows to render. */
  rows: DiffRow[]
  /** Copy for the expand control. */
  expandLabel: string
  /** Copy for the collapse control. */
  collapseLabel: string
  /** Collapse threshold in rendered rows (default {@link DEFAULT_DIFF_REVIEW_MAX_LINES}). */
  maxLines?: number
}

/** Render the hunk/metadata chrome rows and the code rows with gutter + prefix. */
function renderRow(row: DiffRow, spans: readonly HighlightSpan[] | undefined, index: number) {
  if (row.kind === 'hunk' || row.kind === 'metadata') {
    return (
      <div key={index} className={row.kind === 'hunk' ? css.diffHunk : css.diffMeta}>
        {row.text}
      </div>
    )
  }
  const highlighted = spans !== undefined && row.text !== ''
    ? spans.map((span, spanIndex) => (
      <span key={spanIndex} style={span.style}>{span.text}</span>
    ))
    : row.text
  const rowClass = row.kind === 'addition'
    ? css.diffRowAdd
    : row.kind === 'deletion'
      ? css.diffRowDel
      : css.diffRowContext
  return (
    <div key={index} className={rowClass}>
      <span className={css.gutter}>
        <span className={css.gutterOld}>{row.oldLine ?? ''}</span>
        <span className={css.gutterNew}>{row.newLine ?? ''}</span>
      </span>
      <span className={css.prefix}>{row.prefix || ' '}</span>
      <span className={css.diffContent}>{highlighted}</span>
    </div>
  )
}

/**
 * Render one file's diff rows.
 * @param props - see {@link DiffReviewSurfaceProps}.
 * @returns the diff surface element.
 */
export function DiffReviewSurface({ path, rows, expandLabel, collapseLabel, maxLines = DEFAULT_DIFF_REVIEW_MAX_LINES }: DiffReviewSurfaceProps) {
  const [expanded, setExpanded] = useState(false)
  const language = languageFromPath(path)
  const code = useMemo(() => rows.map(row => row.text).join('\n'), [rows])
  const highlighted = useMemo(() => highlightLines(code, language), [code, language])
  const collapsed = rows.length > maxLines && !expanded
  const visible: DiffRow[] = collapsed
    ? [...rows.slice(0, COLLAPSE_SLICE), ...rows.slice(rows.length - COLLAPSE_SLICE)]
    : rows
  return (
    <div className={css.diffArea} data-diff-review="">
      <div className={css.diffFileHeader}>
        <span className={css.diffFilePath}>{path}</span>
      </div>
      <div className={css.diffRows}>
        {visible.map((row, index) => renderRow(row, highlighted?.[index], index))}
      </div>
      {collapsed && (
        <div className={css.diffCollapseBar}>
          <span className={css.diffCollapseHint}>{rows.length - maxLines} 行已折叠</span>
          <button type="button" className={css.diffExpand} onClick={() => { setExpanded(true) }}>
            {expandLabel}
          </button>
        </div>
      )}
      {expanded && rows.length > maxLines && (
        <div className={css.diffCollapseBar}>
          <button type="button" className={css.diffExpand} onClick={() => { setExpanded(false) }}>
            {collapseLabel}
          </button>
        </div>
      )}
    </div>
  )
}
