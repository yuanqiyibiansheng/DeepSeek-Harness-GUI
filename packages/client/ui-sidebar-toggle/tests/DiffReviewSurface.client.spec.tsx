// @vitest-environment jsdom
import { getAllByText, getByText, queryByText } from '@testing-library/dom'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { DiffReviewSurface, DEFAULT_DIFF_REVIEW_MAX_LINES } from '../src/client/DiffReviewSurface.tsx'
import type { DiffRow } from '../src/client/diff-model.ts'

/** A small three-hunk sample with both sides and chrome rows. */
const ROWS: DiffRow[] = [
  { kind: 'hunk', text: '@@ -1,3 +1,3 @@', prefix: '', oldLine: null, newLine: null },
  { kind: 'context', text: 'const a = 1', prefix: ' ', oldLine: 1, newLine: 1 },
  { kind: 'deletion', text: 'const old = 2', prefix: '-', oldLine: 2, newLine: null },
  { kind: 'addition', text: 'const b = 2', prefix: '+', oldLine: null, newLine: 2 },
  { kind: 'context', text: 'const tail = 3', prefix: ' ', oldLine: 3, newLine: 3 },
]

/** Mount the surface with react-dom 18 directly; returns cleanup. */
function mount(rows: DiffRow[], path: string): () => void {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<DiffReviewSurface path={path} rows={rows} expandLabel="显示全部" collapseLabel="收起" />)
  })
  return () => {
    act(() => { root.unmount() })
    container.remove()
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('DiffReviewSurface', () => {
  it('renders the file header, gutters, prefixes, and row text', () => {
    const cleanup = mount(ROWS, 'src/a.ts')
    expect(getByText(document.body, 'src/a.ts')).toBeTruthy()
    // Old and new gutter numbers render as separate cells.
    expect(getAllByText(document.body, '1').length).toBeGreaterThanOrEqual(2)
    // Highlighted rows split into token spans, so assert on the body text.
    const text = document.body.textContent ?? ''
    expect(text).toContain('const b = 2')
    expect(text).toContain('const old = 2')
    expect(text).toContain('@@ -1,3 +1,3 @@')
    cleanup()
  })

  it('renders plain text for an unknown language instead of crashing', () => {
    const cleanup = mount(ROWS, 'Makefile')
    expect(document.body.textContent).toContain('const b = 2')
    cleanup()
  })

  it('collapses a long diff and expands on demand', () => {
    const many: DiffRow[] = Array.from({ length: DEFAULT_DIFF_REVIEW_MAX_LINES + 100 }, (_, index) => ({
      kind: 'context' as const,
      text: `line ${index}`,
      prefix: ' ',
      oldLine: index + 1,
      newLine: index + 1,
    }))
    const cleanup = mount(many, 'big.txt')
    expect(getByText(document.body, '显示全部')).toBeTruthy()
    // `line 300` sits in the collapsed middle (head 0..249, tail 350..599).
    expect(queryByText(document.body, 'line 300')).toBeNull()
    act(() => {
      getByText(document.body, '显示全部').click()
    })
    expect(getByText(document.body, 'line 300')).toBeTruthy()
    expect(getByText(document.body, '收起')).toBeTruthy()
    cleanup()
  })
})
