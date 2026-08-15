/**
 * Shell resolution for the integrated terminal panel: one selectable shell
 * kind maps to a concrete executable argv on the current platform. Pure
 * functions — the probes use the ambient PATH and well-known install
 * locations, and a kind that cannot be resolved reports null so the caller
 * can fail loud instead of spawning garbage.
 * @module @deepseek-ai/dsh-terminal-host/shells
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

/** The shells the terminal panel offers. */
export type ShellKind = 'pwsh' | 'powershell' | 'cmd' | 'git-bash' | 'wsl'

/** Every selectable shell id, in settings order. */
export const SHELL_KINDS: readonly ShellKind[] = ['pwsh', 'powershell', 'cmd', 'git-bash', 'wsl']

/** A resolved shell: the exact argv to spawn and its display name. */
export interface ResolvedShell {
  argv: readonly string[]
  name: string
}

/** One candidate executable probe: the command to run and its display name. */
interface ShellCandidate {
  name: string
  argv: readonly string[]
  /** Whether the program is reachable through PATH or an absolute path. */
  available: boolean
}

/** Resolve one program against PATH (Windows: where.exe; elsewhere: which). */
function onPath(program: string): boolean {
  const probe = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [program], { stdio: 'ignore' })
  return probe.status === 0
}

/** Well-known Git for Windows bash locations. */
function gitBashCandidates(): string[] {
  const envRoot = process.env.PROGRAMFILES ?? 'C:\\Program Files'
  const envRootX86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)'
  const localApp = process.env.LOCALAPPDATA ?? ''
  return [
    join(envRoot, 'Git', 'bin', 'bash.exe'),
    join(envRootX86, 'Git', 'bin', 'bash.exe'),
    ...localApp === '' ? [] : [join(localApp, 'Programs', 'Git', 'bin', 'bash.exe')],
  ]
}

/** Probe one shell kind into its candidate list, or null when nothing resolves. */
export function resolveShell(kind: ShellKind): ResolvedShell | null {
  if (process.platform !== 'win32') {
    // Non-Windows: only bash-style shells make sense here; pwsh may exist.
    switch (kind) {
      case 'pwsh': return { argv: ['pwsh', '-NoLogo'], name: 'pwsh' }
      case 'cmd':
      case 'powershell':
      case 'git-bash':
      case 'wsl':
        return null
    }
  }
  const candidates: ShellCandidate[] = []
  switch (kind) {
    case 'pwsh': {
      candidates.push({ name: 'PowerShell 7', argv: ['pwsh.exe', '-NoLogo'], available: onPath('pwsh.exe') })
      candidates.push({ name: 'Windows PowerShell', argv: ['powershell.exe', '-NoLogo'], available: onPath('powershell.exe') })
      break
    }
    case 'powershell': {
      candidates.push({ name: 'Windows PowerShell', argv: ['powershell.exe', '-NoLogo'], available: onPath('powershell.exe') })
      break
    }
    case 'cmd': {
      candidates.push({ name: 'Command Prompt', argv: ['cmd.exe'], available: onPath('cmd.exe') })
      break
    }
    case 'git-bash': {
      if (onPath('bash.exe')) {
        candidates.push({ name: 'Git Bash', argv: ['bash.exe', '--login', '-i'], available: true })
      }
      for (const bash of gitBashCandidates()) {
        candidates.push({ name: 'Git Bash', argv: [bash, '--login', '-i'], available: existsSync(bash) })
      }
      break
    }
    case 'wsl': {
      candidates.push({ name: 'WSL', argv: ['wsl.exe'], available: onPath('wsl.exe') })
      break
    }
  }
  const resolved = candidates.find(candidate => candidate.available)
  return resolved === undefined ? null : { argv: resolved.argv, name: resolved.name }
}
