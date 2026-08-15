/** `settings.pet` namespace dictionaries (the pet toggle row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'pet.title': '桌宠',
  'pet.enabledHint': '在桌面独立窗口中显示 DeepSeek 大肥鱼，随代理状态变换动画；关闭后重启应用仍保持关闭。',
} satisfies Record<string, string>

/** The settings.pet namespace key union. */
export type PetKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'pet.title': 'Desktop pet',
  'pet.enabledHint': 'Show the DeepSeek fat-fish in a floating desktop window, animated by the agent state; the choice is remembered across restarts.',
} satisfies Record<PetKey, string>
