/** `settings.projectMemory` namespace dictionaries (the toggle row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'projectMemory.title': '项目记忆',
  'projectMemory.enabledHint': '让新对话自动读取项目历史、进度与决策（Memorix）；关闭后需重启客户端生效。',
} satisfies Record<string, string>

/** The settings.projectMemory namespace key union. */
export type ProjectMemoryKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'projectMemory.title': 'Project memory',
  'projectMemory.enabledHint': 'Let new conversations read project history, progress, and decisions (Memorix); restart the client after changing it.',
} satisfies Record<ProjectMemoryKey, string>
