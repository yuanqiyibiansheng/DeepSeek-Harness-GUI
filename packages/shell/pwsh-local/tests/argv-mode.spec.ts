/**
 * Unit tests for the executor's terminal-mode argv switch: the
 * `terminal.shell` preference selects cmd / Git Bash / WSL / PowerShell per
 * call. No process is spawned — only the argv construction is exercised.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { PwshLocalExecutor } from '@deepseek-ai/dsh-pwsh-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'

/** Boot the executor with a stubbed `terminal.shell` setting. */
async function executorWithShell(shell: string | undefined) {
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  ctx.provide('settings', {
    describe: () => (shell === undefined ? [] : [{ ns: 'terminal', value: { shell } }]),
  } as never)
  await ctx.plugin(PwshLocalExecutor, { graceMs: 200 })
  const exposed = ctx.shell as unknown as { argv: (spec: unknown) => string[] }
  return (command: string): string[] =>
    exposed.argv({ command, workdir: process.cwd(), timeoutMs: 1000, stdoutMaxBytes: 1000 })
}

describe('PwshLocalExecutor argv mode switch', () => {
  it('runs cmd through cmd.exe /d /s /c', async () => {
    const argv = await executorWithShell('cmd')
    const argvList = argv('echo hi')
    expect(argvList[0]?.toLowerCase()).toBe('cmd.exe')
    expect(argvList).toContain('/c')
    expect(argvList[argvList.length - 1]).toBe('echo hi')
  })

  it('runs wsl through wsl.exe bash -c', async () => {
    const argv = await executorWithShell('wsl')
    const argvList = argv('echo hi')
    expect(argvList[0]?.toLowerCase()).toBe('wsl.exe')
    expect(argvList).toContain('bash')
    expect(argvList).toContain('-c')
  })

  it('runs git-bash through a bash.exe -c', async () => {
    const argv = await executorWithShell('git-bash')
    const argvList = argv('echo hi')
    expect(argvList[0]?.toLowerCase()).toContain('bash.exe')
    expect(argvList).toContain('-c')
  })

  it('keeps the PowerShell dialect when the preference is unset or pwsh', async () => {
    for (const shell of [undefined, 'pwsh', 'powershell']) {
      const argv = await executorWithShell(shell)
      const argvList = argv('echo hi')
      expect(argvList).toContain('-Command')
      expect(argvList[argvList.length - 1]).toContain('echo hi')
    }
  })
})
