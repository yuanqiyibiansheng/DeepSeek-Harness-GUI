/** Copy dictionaries for the Persona settings section. */

/** English strings (the key-set source of truth for this pair). */
export const en = {
  nav: 'Persona',
  title: 'Persona',
  intro: 'Your user-global instructions (~/.dsh/AGENTS.md) are injected into every session, alongside project AGENTS.md files. Use this space for standing preferences, working style, and identity.',
  empty: 'No instructions yet. Write your persona and save.',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved.',
  loadFailed: 'Loading your instructions failed',
  retry: 'Retry',
  placeholder: 'I am a coding agent who…\n\n- prefers concise answers\n- always writes tests\n- uses TypeScript by default',
  error: 'Operation failed',
}

/** The settings.persona namespace key union. */
export type PersonaKey = keyof typeof en

/** Chinese strings (same keys as {@link en}). */
export const zh: { [Key in keyof typeof en]: string } = {
  nav: '人格设定',
  title: '人格设定',
  intro: '你的用户级指令（~/.dsh/AGENTS.md）会注入每个会话，与项目 AGENTS.md 一起生效。可在这里写常驻偏好、工作风格与身份设定。',
  empty: '还没有指令。写下你的人格设定并保存。',
  save: '保存',
  saving: '保存中…',
  saved: '已保存。',
  loadFailed: '加载你的指令失败',
  retry: '重试',
  placeholder: '我是一个编程助手……\n\n- 喜欢简洁的回答\n- 总是写测试\n- 默认使用 TypeScript',
  error: '操作失败',
}
