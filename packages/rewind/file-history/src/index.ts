/**
 * File-history recording service: per-user-message file backups captured from
 * tool execution and the session log. A turn-start snapshot records each
 * tracked file's state before the turn runs; per-edit updates add first-edit
 * backups for files the turn's tools touch. Both are appended to the session
 * log as `file/history-snapshot` events, so a rewind of the log rewinds the
 * recording metadata together with the conversation, and the backup
 * artifacts live under `{dshHome}/file-history/{sessionId}/`.
 *
 * Ported in behavior from the reference implementation (cc-haha
 * `src/utils/fileHistory.ts`), adapted to the event-sourced session log: the
 * in-memory per-session state of the reference is the session log itself
 * (the fold of `file/history-snapshot` events), and the two recording calls
 * of the reference — per user message (`fileHistoryMakeSnapshot`) and per
 * file edit (`fileHistoryTrackEdit`) — are wired to the `user/message`
 * session event and the `tools/pre-execute` waterfall.
 *
 * @module @deepseek-ai/dsh-file-history
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import {
  checkOriginFileChanged,
  createBackup,
  expandTrackingPath,
  readBackupFileSafely,
  resolveBackupPath,
  shortenTrackingPath,
} from './backup.ts'
import {
  collectTrackedPaths,
  foldFileHistorySnapshots,
  latestBackupForPath,
} from './fold.ts'
import type { FileHistoryBackup } from './types.ts'

export type { FileHistoryBackup, FileHistorySnapshot, FileHistorySnapshotMap } from './types.ts'
export {
  assertTrackedPathStaysWithinWorkdir,
  backupDirectory,
  backupFileNameFor,
  checkOriginFileChanged,
  createBackup,
  expandTrackingPath,
  readBackupFileSafely,
  resolveBackupPath,
  shortenTrackingPath,
} from './backup.ts'
export { collectTrackedPaths, foldFileHistorySnapshots, latestBackupForPath } from './fold.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    fileHistory: FileHistory
  }
}

/** File-history recording configuration. */
export interface Config {
  /** Master switch; false records nothing (a rewind then restores no files). */
  enabled?: boolean
  /** Resolved data-root override; defaults to the Harness home (`$DSH_HOME`). */
  backupRoot?: string
}

/** Schemastery configuration for the file-history service consumer. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  backupRoot: z.string(),
})

/** Model-facing tools whose effects the recording knows how to attribute to files. */
export const FILE_MUTATION_TOOLS = new Set([
  'write',
  'edit',
  'multiedit',
  'notebookedit',
  'apply_patch',
])

function isAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/')
}

/**
 * Extract the absolute target paths of one tool call from its parsed
 * arguments, following the same field names the transcript extractor reads.
 * @param name - the tool name (one of {@link FILE_MUTATION_TOOLS}).
 * @param args - the tool's parsed arguments.
 * @param workDir - the session workdir for relative paths.
 * @returns the absolute paths the call may write.
 */
function mutationTargetPaths(name: string, args: unknown, workDir: string): string[] {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return []
  const record = args as Record<string, unknown>
  const resolvePath = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0
      ? isAbsolutePath(value) ? value : join(workDir, value)
      : undefined
  switch (name) {
    case 'write':
    case 'edit':
    case 'multiedit': {
      const path = resolvePath(record.file_path ?? record.path)
      return path === undefined ? [] : [path]
    }
    case 'notebookedit': {
      const path = resolvePath(record.notebook_path ?? record.file_path ?? record.path)
      return path === undefined ? [] : [path]
    }
    case 'apply_patch': {
      const patch = typeof record.patch === 'string' ? record.patch : ''
      const paths: string[] = []
      for (const line of patch.split('\n')) {
        const match = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/) ??
          line.match(/^\*\*\* Move to: (.+)$/)
        if (!match?.[1]) continue
        paths.push(isAbsolutePath(match[1]) ? match[1] : join(workDir, match[1]))
      }
      return paths
    }
    default:
      return []
  }
}

/** The direct (user-submitted) user-message seq of the current turn, if any. */
function currentUserMessageSeq(session: Session): number | undefined {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event?.type !== 'user/message') continue
    return (event.data.source as { kind?: string }).kind === 'user'
      ? event.seq
      : undefined
  }
  return undefined
}

/** Whether a path exists on disk. */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT' ? false : true
  }
}

/**
 * The file-history recording service. Registers the two recording hooks in
 * its constructor: the turn-start snapshot on direct `user/message` events,
 * and first-edit backups before every file-mutating tool dispatch.
 */
export class FileHistory extends Service {
  static inject = ['tools']

  /** The resolved backup root (the Harness home by default). */
  readonly backupRoot: string
  private readonly enabled: boolean
  /** Per-session serialization chain: recording IO commits in event order. */
  private readonly chains = new Map<SessionId, Promise<void>>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'fileHistory')
    this.enabled = config.enabled ?? true
    this.backupRoot = resolveDshHome(config.backupRoot)

    ctx.on('session/event', (session, event) => {
      if (!this.enabled) return
      if (event.type !== 'user/message') return
      if ((event.data.source as { kind?: string }).kind !== 'user') return
      const seq = event.seq
      // Appending inside the event dispatch is forbidden (reentrancy guard in
      // Session.append); the serialized chain defers the append past it.
      this.chain(session, () => this.makeSnapshot(session, seq))
    })

    ctx.on('tools/pre-execute', async (exec: ToolExecution, next: () => Promise<PreToolDecision>) => {
      if (this.enabled && exec.agent !== undefined && FILE_MUTATION_TOOLS.has(exec.name)) {
        try {
          await this.trackEdit(exec.agent, exec.name, exec.arguments)
        } catch (error) {
          this.ctx.logger.warn(`file-history: trackEdit failed: ${String(error)}`)
        }
      }
      return next()
    })
  }

  /** Queue one recording operation per session, preserving event order. */
  private chain(session: Session, operation: () => Promise<void>): void {
    const previous = this.chains.get(session.id) ?? Promise.resolve()
    const next = previous.then(() => operation()).catch((error: unknown) => {
      this.ctx.logger.warn(`file-history: recording failed for session ${session.id}: ${String(error)}`)
    })
    this.chains.set(session.id, next)
    void next.finally(() => {
      if (this.chains.get(session.id) === next) this.chains.delete(session.id)
    })
  }

  /** The session's absolute working directory, falling back to the process cwd. */
  private workDirOf(session: Session): string {
    return session.header.cwd ?? process.cwd()
  }

  /**
   * Record first-edit backups of every target of a file-mutating tool call
   * into the current turn's snapshot. Called before the tool edits, so each
   * backup captures the file's pre-edit (pre-turn) content. A path already
   * recorded for the current user message is left untouched — the recorded
   * value is already the pre-turn state.
   * @param agent - the agent whose session owns the tool call.
   * @param name - the tool name (one of the mutation tools).
   * @param args - the tool's parsed arguments.
   */
  async trackEdit(agent: Agent, name: string, args: unknown): Promise<void> {
    const session = agent.session
    const workDir = this.workDirOf(session)
    const userMessageSeq = currentUserMessageSeq(session)
    if (userMessageSeq === undefined) return
    for (const filePath of mutationTargetPaths(name, args, workDir)) {
      await this.trackPath(session, filePath, userMessageSeq, workDir)
    }
  }

  private async trackPath(
    session: Session,
    filePath: string,
    userMessageSeq: number,
    workDir: string,
  ): Promise<void> {
    const trackingPath = shortenTrackingPath(filePath, workDir)
    const snapshot = foldFileHistorySnapshots(session.events).get(userMessageSeq)
    if (snapshot?.trackedFileBackups[trackingPath] !== undefined) return
    const backup = await createBackup(
      this.backupRoot,
      String(session.id),
      filePath,
      1,
      workDir,
    )
    session.append('file/history-snapshot', {
      userMessageSeq,
      trackedFileBackups: { [trackingPath]: backup },
      isSnapshotUpdate: true,
    })
  }

  /**
   * Record the turn-start snapshot for one user message: back up every path
   * tracked in earlier turns whose content changed since its latest backup,
   * and append the snapshot event keyed to `userMessageSeq`.
   * @param session - the session owning the message.
   * @param userMessageSeq - the `user/message` event seq this turn started from.
   */
  async makeSnapshot(session: Session, userMessageSeq: number): Promise<void> {
    const workDir = this.workDirOf(session)
    const snapshots = foldFileHistorySnapshots(session.events)
    const trackedFileBackups: Record<string, FileHistoryBackup> = {}
    await Promise.all(
      Array.from(collectTrackedPaths(snapshots), async trackingPath => {
        try {
          const filePath = expandTrackingPath(trackingPath, workDir)
          const latestBackup = latestBackupForPath(snapshots, trackingPath)
          const nextVersion = latestBackup ? latestBackup.version + 1 : 1

          if (latestBackup?.backupFileName === null) {
            // Absent at the latest version: record a fresh marker, or back the
            // file up when it appeared since (a new file).
            trackedFileBackups[trackingPath] = await fileExists(filePath)
              ? await createBackup(this.backupRoot, String(session.id), filePath, nextVersion, workDir)
              : {
                  backupFileName: null,
                  version: nextVersion,
                  backupTime: new Date().toISOString(),
                }
            return
          }

          if (latestBackup === undefined) return
          if (
            latestBackup.backupFileName !== null &&
            !(await checkOriginFileChanged(
              filePath,
              this.backupRoot,
              String(session.id),
              latestBackup.backupFileName,
            ))
          ) {
            // Unchanged since the latest backup: reuse it for this snapshot.
            trackedFileBackups[trackingPath] = latestBackup
            return
          }

          trackedFileBackups[trackingPath] = await createBackup(
            this.backupRoot,
            String(session.id),
            filePath,
            nextVersion,
            workDir,
          )
        } catch (error) {
          this.ctx.logger.warn(`file-history: snapshot failed for ${trackingPath}: ${String(error)}`)
        }
      }),
    )
    session.append('file/history-snapshot', {
      userMessageSeq,
      trackedFileBackups,
      isSnapshotUpdate: false,
    })
  }

  /**
   * Read one backup artifact safely.
   * @param sessionId - the session owning the backups.
   * @param backupFileName - the artifact base name.
   * @returns the artifact content and mode.
   */
  readBackup(
    sessionId: SessionId,
    backupFileName: string,
  ): Promise<{ content: Buffer; mode: number }> {
    return readBackupFileSafely(this.backupRoot, String(sessionId), backupFileName)
  }

  /** Resolve one backup artifact's absolute path under this service's root. */
  backupPath(sessionId: SessionId, backupFileName: string): string {
    return resolveBackupPath(this.backupRoot, String(sessionId), backupFileName)
  }
}

export default FileHistory
