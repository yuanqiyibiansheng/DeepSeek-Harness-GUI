/**
 * Unified-diff parsing for the code-review drawer: `git diff` text becomes a
 * per-file row model the review surface renders with line numbers and +/-
 * prefixes. Pure functions — no DOM, no React, unit-testable in node.
 * @module @deepseek-ai/dsh-client-ui-sidebar-toggle/client/diff-model
 */

/** One rendered diff row kind. */
export type DiffRowKind = 'metadata' | 'hunk' | 'context' | 'deletion' | 'addition'

/** One parsed diff row: prefix and line numbers resolved from the hunk header. */
export interface DiffRow {
  kind: DiffRowKind
  /** Row content without its leading +/-/space prefix. */
  text: string
  /** The diff prefix (`+`, `-`, ` `, or empty for chrome rows). */
  prefix: string
  /** Old-side line number, or null for addition-only rows and chrome. */
  oldLine: number | null
  /** New-side line number, or null for deletion-only rows and chrome. */
  newLine: number | null
}

/** One parsed file section of a unified diff. */
export interface DiffFile {
  /** New-side path (the display path), falling back to the old side. */
  path: string
  oldPath: string | null
  newPath: string | null
  rows: DiffRow[]
}

/** One untracked file's content from the review payload's `newFiles` section. */
export interface UntrackedFile {
  path: string
  content: string
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

const FILE_HEADER = /^diff --git a\/(.+) b\/(.+)$/

/** New-file sections in the `newFiles` payload (`===== new file: <path> =====`). */
const NEW_FILE_MARKER = /===== new file: (.+?) =====\n?/g

/**
 * Parse `git diff --unified=N` output into per-file row models. Rows outside
 * any file section are ignored; `---`/`+++` path headers, `\ No newline`
 * markers, `Binary` lines, and pre-hunk extended headers (`index`, `new file
 * mode`, ...) become non-selectable metadata rows.
 * @param text - the raw diff text.
 * @returns the parsed files, in diff order.
 */
export function parseWorkspaceDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  let current: DiffFile | null = null
  let oldLine = 0
  let newLine = 0
  let inHunk = false
  for (const line of text.replace(/\n$/, '').split('\n')) {
    const fileHeader = FILE_HEADER.exec(line)
    if (fileHeader !== null) {
      const oldPath = fileHeader[1] ?? ''
      const newPath = fileHeader[2] ?? ''
      current = { path: newPath, oldPath, newPath, rows: [] }
      files.push(current)
      inHunk = false
      continue
    }
    if (current === null) continue
    const hunk = HUNK_HEADER.exec(line)
    if (hunk !== null) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      inHunk = true
      current.rows.push({ kind: 'hunk', text: line, prefix: '', oldLine: null, newLine: null })
      continue
    }
    if (line.startsWith('--- ') || line.startsWith('+++ ')
      || line === '\\ No newline at end of file' || line.startsWith('Binary ')) {
      current.rows.push({ kind: 'metadata', text: line, prefix: '', oldLine: null, newLine: null })
      continue
    }
    if (inHunk && line.startsWith('+')) {
      current.rows.push({ kind: 'addition', text: line.slice(1), prefix: '+', oldLine: null, newLine })
      newLine += 1
      continue
    }
    if (inHunk && line.startsWith('-')) {
      current.rows.push({ kind: 'deletion', text: line.slice(1), prefix: '-', oldLine, newLine: null })
      oldLine += 1
      continue
    }
    if (inHunk) {
      // Context rows carry a single-space prefix in the wire text; a blank
      // line inside a hunk arrives as a bare ` ` and slices to empty content.
      current.rows.push({ kind: 'context', text: line.startsWith(' ') ? line.slice(1) : line, prefix: ' ', oldLine, newLine })
      oldLine += 1
      newLine += 1
      continue
    }
    // Pre-hunk extended headers (`index 1111..2222 100644`, `new file mode`,
    // ...) carry no line numbers and render as chrome.
    current.rows.push({ kind: 'metadata', text: line, prefix: '', oldLine: null, newLine: null })
  }
  return files
}

/**
 * Parse the review payload's `newFiles` section — `===== new file: <path> =====`
 * delimited blocks, one per untracked text file — into path/content pairs.
 * @param text - the raw newFiles payload.
 * @returns the untracked files in payload order.
 */
export function parseUntrackedFiles(text: string): UntrackedFile[] {
  if (text === '') return []
  const files: UntrackedFile[] = []
  NEW_FILE_MARKER.lastIndex = 0
  let match = NEW_FILE_MARKER.exec(text)
  while (match !== null) {
    const path = match[1] ?? ''
    const start = match.index + match[0].length
    NEW_FILE_MARKER.lastIndex = start
    const next = NEW_FILE_MARKER.exec(text)
    const end = next === null ? text.length : next.index
    if (path !== '') files.push({ path, content: text.slice(start, end) })
    match = next
  }
  return files
}

/**
 * Turn one untracked file's content into all-addition rows (a new file has no
 * old side). The trailing terminator newline is dropped, matching the review
 * payload's own content lines.
 * @param content - the untracked file's text.
 * @returns one addition row per content line, numbered from 1.
 */
export function untrackedRows(content: string): DiffRow[] {
  const body = content.endsWith('\n') ? content.slice(0, -1) : content
  return body.split('\n').map((line, index) => ({
    kind: 'addition' as const,
    text: line,
    prefix: '+',
    oldLine: null,
    newLine: index + 1,
  }))
}

/** File extension to a shiki language id `highlightLines` accepts. */
const EXTENSION_LANGUAGES: Record<string, string> = {
  ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', json: 'json',
  md: 'md', mdx: 'mdx', html: 'html', htm: 'html',
  css: 'css', scss: 'scss', less: 'less',
  py: 'py', rb: 'rb', go: 'go', rs: 'rs', java: 'java',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cs: 'cs',
  kt: 'kotlin', swift: 'swift', php: 'php',
  yml: 'yml', yaml: 'yaml', toml: 'toml', ini: 'ini',
  sql: 'sql', xml: 'xml', lua: 'lua',
  sh: 'sh', bash: 'bash', zsh: 'zsh', shell: 'shell',
}

/**
 * The language hint for one file path, or undefined for unknown extensions
 * (the surface then renders plain text). Extension matching is
 * case-insensitive and covers the aliases the shared highlighter accepts.
 * @param path - the file path.
 * @returns the language id, or undefined.
 */
export function languageFromPath(path: string): string | undefined {
  const base = path.split('/').pop() ?? path
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return undefined
  return EXTENSION_LANGUAGES[base.slice(dot + 1).toLowerCase()]
}
