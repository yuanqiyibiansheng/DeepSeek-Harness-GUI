/** `ui-terminal` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'terminal.shellSetting': '集成终端 Shell',
  'terminal.shellSettingDesc': '选择用于执行命令的终端模式：PowerShell、命令提示符、Git Bash 或 WSL',
} satisfies Record<string, string>

/** The terminal namespace key union. */
export type UiTerminalKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'terminal.shellSetting': 'Integrated Terminal Shell',
  'terminal.shellSettingDesc': 'Select the terminal mode used to run commands: PowerShell, Command Prompt, Git Bash, or WSL',
} satisfies Record<UiTerminalKey, string>
