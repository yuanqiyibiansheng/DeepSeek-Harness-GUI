/**
 * Read-side fold of `file/history-snapshot` events: reconstruct the per-user-
 * message file snapshots from a session's event log. The log is the single
 * source of truth — the fold is a pure function of the event array, so a
 * rewound log (whose removed turns' events are gone) yields exactly the
 * snapshots of the remaining turns.
 *
 * @module @deepseek-ai/dsh-file-history/fold
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  FileHistoryBackup,
  FileHistorySnapshot,
  FileHistorySnapshotMap,
} from './types.ts'

/**
 * Whether an event is a `file/history-snapshot` recording.
 * @param event - session event to test.
 * @returns true for the file-history recording event.
 */
export function isFileHistorySnapshotEvent(
  event: SessionEvent,
): event is SessionEvent<'file/history-snapshot'> {
  return event.type === 'file/history-snapshot'
}

/**
 * Fold a session's events into per-user-message file snapshots.
 *
 * Semantics match the recording side: every event carries the complete
 * per-path map known when it was appended, and per path the LAST event wins
 * (a mid-turn update supersedes the turn-start snapshot's entry for that
 * path, mirroring the in-memory commit order of the reference
 * implementation). The returned map contains one entry per user message that
 * recorded at least one path.
 * @param events - session events in contiguous seq order.
 * @returns the merged snapshot per user-message seq.
 */
export function foldFileHistorySnapshots(
  events: readonly SessionEvent[],
): FileHistorySnapshotMap {
  const byMessage = new Map<number, FileHistorySnapshot>()
  for (const event of events) {
    if (!isFileHistorySnapshotEvent(event)) continue
    const { userMessageSeq, trackedFileBackups } = event.data
    const merged = byMessage.get(userMessageSeq) ?? {
      userMessageSeq,
      trackedFileBackups: {},
    }
    for (const [trackingPath, backup] of Object.entries(trackedFileBackups)) {
      merged.trackedFileBackups[trackingPath] = backup
    }
    byMessage.set(userMessageSeq, merged)
  }
  return byMessage
}

/**
 * Every path ever tracked across all snapshots of one session — the path set
 * a rewind must consider when restoring (a path tracked in any earlier turn
 * may have been changed by a later turn's tools).
 * @param snapshots - folded snapshots of one session.
 * @returns the union of all tracked paths.
 */
export function collectTrackedPaths(
  snapshots: FileHistorySnapshotMap,
): Set<string> {
  const paths = new Set<string>()
  for (const snapshot of snapshots.values()) {
    for (const trackingPath of Object.keys(snapshot.trackedFileBackups)) {
      paths.add(trackingPath)
    }
  }
  return paths
}

/**
 * The latest recorded backup for one tracking path across the session's
 * snapshots (newest user message first — later turns' entries supersede
 * earlier ones).
 * @param snapshots - folded snapshots of one session.
 * @param trackingPath - the tracked path to search for.
 * @returns the newest backup entry, or undefined when the path was never tracked.
 */
export function latestBackupForPath(
  snapshots: FileHistorySnapshotMap,
  trackingPath: string,
): FileHistoryBackup | undefined {
  for (const seq of [...snapshots.keys()].sort((a, b) => b - a)) {
    const backup = snapshots.get(seq)?.trackedFileBackups[trackingPath]
    if (backup !== undefined) return backup
  }
  return undefined
}
