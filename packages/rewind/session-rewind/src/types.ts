/**
 * Pure payload types of the session-rewind domain: the wire contracts for
 * preview/execute/checkpoints, free of this package's host-side value imports.
 *
 * @module @deepseek-ai/dsh-session-rewind/types
 */

/**
 * What a rewind is allowed to touch.
 *
 * `both` needs a restorable checkpoint and fails loudly without one.
 * `conversation` only trims the transcript, so it stays available for a turn
 * whose files cannot be restored — losing the ability to undo the code should
 * not also cost the user the ability to back out of the prompt.
 */
export type SessionRewindMode = 'both' | 'conversation'

/** Select one user message as the rewind target. */
export interface RewindTargetSelector {
  /** The target user message's seq, as a decimal string (`String(seq)`). */
  targetUserMessageId?: string
  /** The target's index among the session's direct user messages. */
  userMessageIndex?: number
  /** When set, the resolved target's text must equal this (anti-stale guard). */
  expectedContent?: string
}

/** Diff statistics for the file effects a rewind would revert. */
export interface RewindCodePreview {
  available: boolean
  reason?: string
  filesChanged: string[]
  insertions: number
  deletions: number
}

/** What a rewind preview reports before any change is made. */
export interface SessionRewindPreview {
  target: {
    targetUserMessageId: string
    userMessageIndex: number
    userMessageCount: number
  }
  conversation: {
    messagesRemoved: number
  }
  code: RewindCodePreview
  restoreAvailable: boolean
  /**
   * Tool names that may have changed files this checkpoint cannot restore.
   * Empty means the listed files are the whole story; non-empty means undo
   * still works but only covers the files it reports.
   */
  unverifiedChangeSources: string[]
}

/** The result of an executed rewind. */
export interface SessionRewindExecuteResult extends SessionRewindPreview {
  conversation: SessionRewindPreview['conversation'] & {
    removedMessageIds: string[]
  }
  /** New session created from the surviving prefix after the rewind. */
  childSessionId?: string
  /** What this rewind actually touched, so the client never overstates it. */
  mode: SessionRewindMode
}

/** One per-turn checkpoint offered by the checkpoint list. */
export interface SessionTurnCheckpointPreview extends SessionRewindPreview {
  workDir: string
  restoreAvailable: boolean
}

/** The per-file diff of one turn checkpoint. */
export interface SessionTurnCheckpointDiffResult {
  target: SessionRewindPreview['target']
  workDir: string
  path: string
  state: 'ok' | 'missing' | 'error'
  diff?: string
  error?: string
}

/** The transcript-like read model built from the session event log. */
export interface RewindMessage {
  id: string
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'error'
  content: unknown
  parentToolUseId?: string
  cwd?: string
}
