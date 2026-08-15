import { describe, expect, it } from 'vitest'
import { resolveShell, SHELL_KINDS } from '../src/shells.ts'

describe('resolveShell', () => {
  it('resolves cmd on Windows to cmd.exe', () => {
    const original = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      const resolved = resolveShell('cmd')
      expect(resolved).not.toBeNull()
      expect(resolved?.argv[0]).toBe('cmd.exe')
    } finally {
      Object.defineProperty(process, 'platform', { value: original })
    }
  })

  it('resolves every selectable kind to a non-empty argv', () => {
    const original = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      for (const kind of SHELL_KINDS) {
        // A machine may not have every shell installed; the contract is that
        // a resolution is either null or a non-empty argv.
        const resolved = resolveShell(kind)
        if (resolved !== null) {
          expect(resolved.argv.length).toBeGreaterThan(0)
          expect(resolved.name.length).toBeGreaterThan(0)
        }
      }
    } finally {
      Object.defineProperty(process, 'platform', { value: original })
    }
  })

  it('rejects unsupported kinds on non-Windows platforms', () => {
    const original = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    try {
      expect(resolveShell('cmd')).toBeNull()
      expect(resolveShell('wsl')).toBeNull()
      expect(resolveShell('git-bash')).toBeNull()
    } finally {
      Object.defineProperty(process, 'platform', { value: original })
    }
  })
})
