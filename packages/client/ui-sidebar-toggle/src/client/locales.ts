/** `code-review` namespace dictionaries (the header action and drawer copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'review.title': '代码审阅',
  'review.toggle': '代码审阅',
  'review.close': '关闭',
  'review.loading': '正在读取改动...',
  'review.noWorkspace': '当前会话没有工作区目录',
  'review.failed': '读取失败',
  'review.empty': '暂无改动',
  'review.untracked': '新文件',
  'review.rollback': '回滚这条消息前的修改',
  'review.rollbackTitle': '回滚本次对话',
  'review.rollbackConfirm': '确定要回滚到这条消息发出前的状态吗？',
  'review.rollbackCancel': '取消',
  'review.rollbackAction': '回滚',
  'review.rollbackFailed': '回滚失败',
  'review.rollbackNoSnapshot': '尚未建立会话快照',
} satisfies Record<string, string>

/** The code-review namespace key union. */
export type CodeReviewKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'review.title': 'Code Review',
  'review.toggle': 'Code Review',
  'review.close': 'Close',
  'review.loading': 'Loading changes...',
  'review.noWorkspace': 'This session has no workspace directory',
  'review.failed': 'Failed to read changes',
  'review.empty': 'No changes',
  'review.untracked': 'New file',
  'review.rollback': 'Roll back changes before this message',
  'review.rollbackTitle': 'Rollback conversation',
  'review.rollbackConfirm': 'Roll back to the state before this message was sent?',
  'review.rollbackCancel': 'Cancel',
  'review.rollbackAction': 'Rollback',
  'review.rollbackFailed': 'Rollback failed',
  'review.rollbackNoSnapshot': 'No snapshot for this conversation yet',
} satisfies Record<CodeReviewKey, string>