/**
 * Pure types of the file-history domain: the ONE home of the
 * `file/history-snapshot` event-key declaration plus its payload types, free
 * of this package's host-side value imports (node:fs, dsh-tools, Cordis).
 *
 * @module @deepseek-ai/dsh-file-history/types
 */

/**
 * One tracked file's backup identity within a snapshot.
 *
 * `backupFileName` is the backup artifact's base filename on disk (see
 * `resolveBackupPath` in the package root); `null` records that the file did
 * not exist in this version (a deletion marker).
 */
export interface FileHistoryBackup {
  /** Base filename of the backup artifact, or `null` for "absent in this version". */
  backupFileName: string | null
  /** Monotonic version of this path across the session's snapshots. */
  version: number
  /** ISO-8601 instant when the backup was created (JSON-safe timestamp). */
  backupTime: string
}
export interface FileHistorySnapshot {
  /** Seq of the `user/message` event this snapshot belongs to. */
  userMessageSeq: number
  /** Per tracking path (shortened relative to the session cwd) backup identity. */
  trackedFileBackups: Record<string, FileHistoryBackup>
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** File-history recording for one user message or mid-turn edit update. */
    'file/history-snapshot': {
      userMessageSeq: number
      trackedFileBackups: Record<string, FileHistoryBackup>
      isSnapshotUpdate: boolean
    }
  }
}

/** Snapshot fold result: per user-message seq, the merged snapshot. */
export type FileHistorySnapshotMap = ReadonlyMap<number, FileHistorySnapshot>
