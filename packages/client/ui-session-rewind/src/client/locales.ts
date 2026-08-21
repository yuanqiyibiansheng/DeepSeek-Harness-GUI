/** `rewind` namespace dictionaries (the per-message rewind action copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'rewind.cardLabel': '轮次已更改文件',
  'rewind.latestUndo': '撤销当前轮次',
  'rewind.latestUndoAria': '撤销当前轮次变更',
  'rewind.historicalUndo': '回滚到这一轮之前',
  'rewind.historicalUndoAria': '回滚到这一轮之前',
  'rewind.latestConfirmTitle': '撤销当前轮次？',
  'rewind.historicalConfirmTitle': '回滚到这一轮之前？',
  'rewind.latestConfirmBody': '这会回滚最近一次助手回复，并恢复这一轮中被跟踪的文件变更。',
  'rewind.historicalConfirmBody': '这会把会话回滚到这一轮之前，并恢复该检查点对应的文件变更。',
  'rewind.conversationOnlyBody': '这一轮的文件检查点不完整，无法安全还原文件。只回滚对话会把会话退回这一轮之前，磁盘上的文件保持现状。',
  'rewind.partialBody': '注意：{sources} 造成的文件改动没有被检查点记录，撤销不会还原它们。',
  'rewind.conversationOnly': '只回滚对话',
  'rewind.latestConfirmUndo': '撤销当前轮次',
  'rewind.historicalConfirmUndo': '回滚到这一轮之前',
  'rewind.cancel': '取消',
  'rewind.loading': '正在读取预览...',
  'rewind.working': '正在撤销...',
  'rewind.failed': '回滚失败',
  'rewind.filesTitle': '{count} 个文件已更改',
  'rewind.filesSubtitle': '撤销可还原上面这些文件；{sources} 的改动未被检查点记录，不会被撤销',
  'rewind.conversationOnlySubtitle': '文件检查点不完整，撤销只能回滚对话，不还原文件',
  'rewind.latestSubtitle': '当前轮次检查点',
  'rewind.historicalSubtitle': '历史轮次检查点',
  'rewind.openWith': '打开方式',
  'rewind.typeDocument': '文档',
  'rewind.typeText': '文本',
  'rewind.typeImage': '图片',
  'rewind.typeCode': '代码',
  'rewind.typeFile': '文件',
  'rewind.showMore': '再显示 {count} 个文件',
  'rewind.showLess': '收起',
  'rewind.noCheckpoint': '这一轮还没有可用的检查点',
} satisfies Record<string, string>

/** The rewind namespace key union. */
export type RewindKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The per-message rewind action's copy. */
    rewind: RewindKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'rewind.cardLabel': 'Turn changed files',
  'rewind.latestUndo': 'Undo current turn',
  'rewind.latestUndoAria': 'Undo current turn changes',
  'rewind.historicalUndo': 'Rewind to before this turn',
  'rewind.historicalUndoAria': 'Rewind to before this turn',
  'rewind.latestConfirmTitle': 'Undo current turn?',
  'rewind.historicalConfirmTitle': 'Rewind to before this turn?',
  'rewind.latestConfirmBody': 'This will rewind the latest assistant response and restore tracked files for this turn.',
  'rewind.historicalConfirmBody': 'This will rewind the conversation to before this turn and restore tracked files for that checkpoint.',
  'rewind.conversationOnlyBody': 'This turn has an incomplete file checkpoint, so the files cannot be restored safely. Rolling back the conversation only rewinds the session to before this turn and leaves the files on disk as they are.',
  'rewind.partialBody': 'Note: file changes made by {sources} were not checkpointed, so undo will not revert them.',
  'rewind.conversationOnly': 'Roll back conversation only',
  'rewind.latestConfirmUndo': 'Undo current turn',
  'rewind.historicalConfirmUndo': 'Rewind to before this turn',
  'rewind.cancel': 'Cancel',
  'rewind.loading': 'Loading preview...',
  'rewind.working': 'Undoing...',
  'rewind.failed': 'Rewind failed',
  'rewind.filesTitle': '{count} files changed',
  'rewind.filesSubtitle': 'Undo restores the files above; changes from {sources} were not checkpointed and will remain',
  'rewind.conversationOnlySubtitle': 'Incomplete file checkpoint; undo can roll back the conversation but not the files',
  'rewind.latestSubtitle': 'Current turn checkpoint',
  'rewind.historicalSubtitle': 'Saved turn checkpoint',
  'rewind.openWith': 'Open with',
  'rewind.typeDocument': 'Document',
  'rewind.typeText': 'Text',
  'rewind.typeImage': 'Image',
  'rewind.typeCode': 'Code',
  'rewind.typeFile': 'File',
  'rewind.showMore': 'Show {count} more files',
  'rewind.showLess': 'Show less',
  'rewind.noCheckpoint': 'No checkpoint is available for this turn yet',
} satisfies Record<RewindKey, string>
