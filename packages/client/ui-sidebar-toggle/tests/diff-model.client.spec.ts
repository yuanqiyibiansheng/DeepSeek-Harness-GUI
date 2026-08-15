import { describe, expect, it } from 'vitest'
import {
  languageFromPath,
  parseUntrackedFiles,
  parseWorkspaceDiff,
  untrackedRows,
} from '../src/client/diff-model.ts'

const SAMPLE_DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const a = 1
-const old = 2
+const b = 2
+const c = 3
 const tail = 4
\\ No newline at end of file
diff --git a/new.md b/new.md
new file mode 100644
--- /dev/null
+++ b/new.md
@@ -0,0 +1,2 @@
+# Title
+body
`

describe('parseWorkspaceDiff', () => {
  it('parses multiple file sections with path, rows, and line numbers', () => {
    const files = parseWorkspaceDiff(SAMPLE_DIFF)
    expect(files).toHaveLength(2)
    expect(files[0]?.path).toBe('src/a.ts')
    expect(files[1]?.path).toBe('new.md')
    const rows = files[0]?.rows ?? []
    const context = rows.find(row => row.text === 'const a = 1')
    expect(context?.kind).toBe('context')
    expect(context?.oldLine).toBe(1)
    expect(context?.newLine).toBe(1)
    const deletion = rows.find(row => row.text === 'const old = 2')
    expect(deletion?.kind).toBe('deletion')
    expect(deletion?.oldLine).toBe(2)
    expect(deletion?.newLine).toBeNull()
    const additions = rows.filter(row => row.kind === 'addition')
    expect(additions.map(row => [row.text, row.newLine])).toEqual([
      ['const b = 2', 2],
      ['const c = 3', 3],
    ])
    expect(additions[0]?.oldLine).toBeNull()
  })

  it('tracks the hunk starting line numbers from the header', () => {
    const files = parseWorkspaceDiff(SAMPLE_DIFF)
    const rows = files[1]?.rows ?? []
    const hunk = rows.find(row => row.kind === 'hunk')
    expect(hunk?.text).toContain('@@ -0,0 +1,2 @@')
    const first = rows.find(row => row.kind === 'addition')
    expect(first?.newLine).toBe(1)
  })

  it('marks chrome lines as metadata and keeps no-newline markers', () => {
    const files = parseWorkspaceDiff(SAMPLE_DIFF)
    const rows = files[0]?.rows ?? []
    expect(rows.filter(row => row.kind === 'metadata').map(row => row.text)).toContain('\\ No newline at end of file')
    expect(rows.filter(row => row.kind === 'metadata').some(row => row.text === '--- a/src/a.ts')).toBe(true)
  })

  it('returns an empty list for empty or headerless text', () => {
    expect(parseWorkspaceDiff('')).toEqual([])
    expect(parseWorkspaceDiff('just a line\nwithout headers')).toEqual([])
  })
})

describe('parseUntrackedFiles', () => {
  it('parses one or more new-file blocks with content', () => {
    const text = '\n===== new file: one.ts =====\nline1\nline2\n===== new file: two.md =====\n# doc\n'
    const files = parseUntrackedFiles(text)
    expect(files).toEqual([
      { path: 'one.ts', content: 'line1\nline2\n' },
      { path: 'two.md', content: '# doc\n' },
    ])
  })

  it('returns an empty list for empty text', () => {
    expect(parseUntrackedFiles('')).toEqual([])
  })
})

describe('untrackedRows', () => {
  it('builds all-addition rows numbered from 1 and drops the terminator newline', () => {
    const rows = untrackedRows('a\nb\n')
    expect(rows).toEqual([
      { kind: 'addition', text: 'a', prefix: '+', oldLine: null, newLine: 1 },
      { kind: 'addition', text: 'b', prefix: '+', oldLine: null, newLine: 2 },
    ])
  })
})

describe('languageFromPath', () => {
  it('maps known extensions case-insensitively', () => {
    expect(languageFromPath('src/a.ts')).toBe('ts')
    expect(languageFromPath('src/A.TS')).toBe('ts')
    expect(languageFromPath('README.md')).toBe('md')
    expect(languageFromPath('x.py')).toBe('py')
  })

  it('returns undefined for unknown, extensionless, and dotfile paths', () => {
    expect(languageFromPath('src/unknown.xyz')).toBeUndefined()
    expect(languageFromPath('Makefile')).toBeUndefined()
    expect(languageFromPath('.gitignore')).toBeUndefined()
  })
})
