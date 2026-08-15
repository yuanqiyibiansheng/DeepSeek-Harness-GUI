/**
 * Pure helpers for the terminal shell setting: the shell options offered in
 * the General settings row. Unit-testable in node — no DOM.
 * @module @deepseek-ai/dsh-client-ui-terminal/client/terminal-model
 */

/** The shell options the setting offers, in display order. */
export const SHELL_OPTIONS: readonly { id: string; label: string }[] = [
  { id: 'pwsh', label: 'PowerShell' },
  { id: 'powershell', label: 'Windows PowerShell' },
  { id: 'cmd', label: 'Command Prompt' },
  { id: 'git-bash', label: 'Git Bash' },
  { id: 'wsl', label: 'WSL' },
]
