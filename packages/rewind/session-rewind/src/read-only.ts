/**
 * Read-only bash command classification for rewind evidence. The reference
 * implementation (cc-haha `src/tools/BashTool/readOnlyValidation.ts`, a
 * 2000-line tree-sitter-based permission stack) is replaced here by a
 * conservative self-contained allowlist with the same contract: a command
 * classified read-only cannot have changed workspace files, so its presence
 * in a turn says nothing about restore coverage. Misclassification is safe
 * in one direction only — a command judged NOT read-only merely downgrades
 * coverage to partial, never overstates it — so the conservative allowlist
 * keeps the reference semantics without the parser stack.
 *
 * @module @deepseek-ai/dsh-session-rewind/read-only
 */

/** Commands that never mutate files, regardless of arguments. */
const READONLY_COMMANDS = new Set([
  'cat',
  'cd',
  'du',
  'echo',
  'env',
  'file',
  'grep',
  'head',
  'ls',
  'pwd',
  'stat',
  'tail',
  'test',
  'wc',
  'which',
  'whoami',
])

/** `git` subcommands that never mutate the worktree or repository. */
const READONLY_GIT_SUBCOMMANDS = new Set([
  'blame',
  'cat-file',
  'config',
  'diff',
  'log',
  'ls-files',
  'ls-tree',
  'rev-parse',
  'show',
  'status',
])

/**
 * Whether a shell command is provably read-only. The command must parse as a
 * chain of simple commands (split on `&&`, `||`, `;`, `|`, newlines) whose
 * every segment is a read-only command; `git` segments additionally require a
 * read-only subcommand. Any token containing a `>` redirection (including fd
 * forms such as `2>file` or `1>file`) rejects the segment, because it writes
 * to a named path.
 * @param command - the recorded shell command.
 * @returns true when every segment is a known read-only command.
 */
export function recordedCommandIsReadOnly(command: string): boolean {
  if (typeof command !== 'string' || command.trim() === '') return false
  const segments = splitShellSegments(command)
  if (segments.length === 0) return false
  for (const segment of segments) {
    const tokens = segment.trim().split(/\s+/)
    if (tokens.length === 0) return false
    for (const token of tokens) {
      if (token.includes('>')) return false
    }
    const name = tokens[0]?.replace(/^["']|["']$/g, '') ?? ''
    if (name === '') return false
    if (name === 'git') {
      const subcommand = tokens.slice(1).find(token => !token.startsWith('-'))
      if (subcommand === undefined || !READONLY_GIT_SUBCOMMANDS.has(subcommand)) {
        return false
      }
      continue
    }
    if (!READONLY_COMMANDS.has(name)) return false
  }
  return true
}

/**
 * Split a shell command on the compound-command separators (`&&`, `||`, `;`,
 * `|`, newlines), honoring simple quote pairs so a quoted separator does not
 * split a token.
 * @param command - the shell command to split.
 * @returns the non-empty segments.
 */
export function splitShellSegments(command: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    if (quote !== undefined) {
      current += char
      if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (char === '\n' || char === ';' || char === '|') {
      if (current.trim() !== '') segments.push(current)
      current = ''
      continue
    }
    if (char === '&' && command[index + 1] === '&') {
      if (current.trim() !== '') segments.push(current)
      current = ''
      index += 1
      continue
    }
    current += char
  }
  if (current.trim() !== '') segments.push(current)
  return segments
}
