/** `desktopTools` namespace dictionaries (balance dock and task notifications). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'balance.turn': '本轮 ¥{cost}',
  'balance.balance': '余额 ¥{balance}',
  'balance.title': '{currency} 余额 ¥{balance}（充值 ¥{toppedUp} · 赠送 ¥{granted}）；本轮费用按 token 用量估算，点击前往充值',
  'notify.title': 'DeepSeek Harness 任务完成',
  'notify.body': 'Agent 已完成本轮任务，点击回到窗口',
} satisfies Record<string, string>

/** The desktopTools namespace key union. */
export type DesktopToolsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'balance.turn': 'Turn ¥{cost}',
  'balance.balance': 'Balance ¥{balance}',
  'balance.title': '{currency} balance ¥{balance} (topped up ¥{toppedUp} · granted ¥{granted}); this-turn cost is estimated from token usage, click to top up',
  'notify.title': 'DeepSeek Harness task complete',
  'notify.body': 'The agent finished this turn. Click to return to the window.',
} satisfies Record<DesktopToolsKey, string>
