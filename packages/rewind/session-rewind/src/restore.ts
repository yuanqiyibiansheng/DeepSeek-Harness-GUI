/**
 * File-restore planning and execution for a rewind: read the target
 * checkpoint's backup artifacts and rewrite the tracked files to their
 * pre-turn state, with preflight writability checks, per-file safety
 * re-verification, and plan rollback on partial failure. Ported 1:1 in
 * behavior from the reference implementation (cc-haha
 * `src/server/services/sessionRewindService.ts` restore section).
 *
 * @module @deepseek-ai/dsh-session-rewind/restore
 */

import { constants as fsConstants } from 'node:fs'
import {
  type FileHandle,
  access,
  lstat,
  mkdir,
  open,
  realpath,
  unlink,
} from 'node:fs/promises'
import { dirname, isAbsolute, parse, relative, resolve } from 'node:path'

const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0

/** The on-disk state of one tracked file at a plan boundary. */
export type RestorableFileState =
  | { exists: false }
  | { exists: true; content: Buffer; mode: number }

/** One planned file rewrite of the restore. */
export interface RestorePlanEntry {
  trackingPath: string
  absolutePath: string
  originalState: RestorableFileState
  targetState: RestorableFileState
}

/** The rewind error contract: a loud, corrective diagnostic. */
export class RewindError extends Error {
  /** Machine-readable failure category. */
  readonly code = 'REWIND_BAD_REQUEST'

  /**
   * @param message - correction-oriented diagnostic.
   * @param options - optional cause.
   */
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options)
    this.name = 'RewindError'
  }
}

function isWithinBaseDir(absolutePath: string, baseDir: string): boolean {
  const relativePath = relative(baseDir, absolutePath)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

function pathsMatch(firstPath: string, secondPath: string): boolean {
  const first = resolve(firstPath)
  const second = resolve(secondPath)
  return process.platform === 'win32'
    ? first.toLowerCase() === second.toLowerCase()
    : first === second
}

async function toFileIdentityPath(filePath: string): Promise<string> {
  const canonical = (await resolveThroughExistingAncestor(filePath)) ?? resolve(filePath)
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical
}

function basenameOf(filePath: string): string {
  return filePath.slice(Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1)
}

function findTrackedPathRoot(firstPath: string, secondPath: string): string {
  let rootPath = resolve(firstPath)
  while (!isWithinBaseDir(secondPath, rootPath)) {
    const parentPath = dirname(rootPath)
    if (parentPath === rootPath) return parse(secondPath).root
    rootPath = parentPath
  }
  return rootPath
}

async function resolveThroughExistingAncestor(filePath: string): Promise<string | null> {
  let existingPath = resolve(filePath)
  const missingSegments: string[] = []

  while (true) {
    try {
      return resolve(await realpath(existingPath), ...missingSegments)
    } catch (error) {
      const maybeErr = error as NodeJS.ErrnoException
      if (maybeErr.code !== 'ENOENT') return null

      const parentPath = dirname(existingPath)
      if (parentPath === existingPath) return null
      missingSegments.unshift(basenameOf(existingPath))
      existingPath = parentPath
    }
  }
}

/** Whether a tracked path is safe to restore: a regular non-linked file. */
export async function isSafeTrackedPath(
  checkpointBaseDir: string,
  trackingPath: string,
): Promise<boolean> {
  const baseDir = resolve(checkpointBaseDir)
  const absolutePath = resolve(expandTrackingPath(trackingPath, baseDir))

  if (!isAbsolute(trackingPath) && !isWithinBaseDir(absolutePath, baseDir)) {
    return false
  }

  const pathRoot = findTrackedPathRoot(baseDir, absolutePath)

  const [canonicalPathRoot, canonicalPath] = await Promise.all([
    resolveThroughExistingAncestor(pathRoot),
    resolveThroughExistingAncestor(absolutePath),
  ])
  if (!canonicalPathRoot || !canonicalPath) return false

  // Resolve the shared root once so system-level aliases above the workspace
  // (for example /var -> /private/var on macOS) remain valid while links in a
  // tracked path are rejected.
  const expectedPath = resolve(canonicalPathRoot, relative(pathRoot, absolutePath))
  if (!pathsMatch(canonicalPath, expectedPath)) return false

  try {
    const stats = await lstat(absolutePath)
    return stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1
  } catch (error) {
    const maybeErr = error as NodeJS.ErrnoException
    return maybeErr.code === 'ENOENT'
  }
}

/** Expand a tracking key to an absolute path under the checkpoint base dir. */
export function expandTrackingPath(trackingPath: string, checkpointBaseDir: string): string {
  return isAbsolute(trackingPath)
    ? trackingPath
    : resolve(checkpointBaseDir, trackingPath)
}

function restorableFileStatesMatch(
  first: RestorableFileState,
  second: RestorableFileState,
): boolean {
  if (!first.exists || !second.exists) return first.exists === second.exists
  return first.content.equals(second.content)
}

async function readRestorableFileState(
  filePath: string,
): Promise<RestorableFileState> {
  let fileHandle: FileHandle
  try {
    fileHandle = await open(filePath, fsConstants.O_RDONLY | O_NOFOLLOW)
  } catch (error) {
    const maybeErr = error as NodeJS.ErrnoException
    if (maybeErr.code === 'ENOENT') return { exists: false }
    throw error
  }

  try {
    const stats = await fileHandle.stat()
    if (!stats.isFile() || stats.nlink !== 1) {
      throw new RewindError(`File cannot be restored safely: ${filePath}`)
    }
    return {
      exists: true,
      content: await fileHandle.readFile(),
      mode: stats.mode,
    }
  } finally {
    await fileHandle.close()
  }
}

async function writeRestorableFileState(
  filePath: string,
  state: RestorableFileState,
): Promise<void> {
  if (!state.exists) {
    try {
      const currentState = await readRestorableFileState(filePath)
      if (currentState.exists) await unlink(filePath)
    } catch (error) {
      const maybeErr = error as NodeJS.ErrnoException
      if (maybeErr.code !== 'ENOENT') throw error
    }
    return
  }

  let targetFile: FileHandle
  try {
    targetFile = await open(filePath, fsConstants.O_WRONLY | O_NOFOLLOW)
  } catch (error) {
    const maybeErr = error as NodeJS.ErrnoException
    if (maybeErr.code !== 'ENOENT') throw error
    await mkdir(dirname(filePath), { recursive: true })
    targetFile = await open(
      filePath,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        O_NOFOLLOW,
      state.mode,
    )
  }

  try {
    const targetStats = await targetFile.stat()
    if (!targetStats.isFile() || targetStats.nlink !== 1) {
      throw new RewindError(`File cannot be restored safely: ${filePath}`)
    }
    await targetFile.truncate(0)
    await targetFile.writeFile(state.content)
    await targetFile.chmod(state.mode)
  } finally {
    await targetFile.close()
  }
}

async function assertRestoreTargetWritable(
  filePath: string,
  originalState: RestorableFileState,
  targetState: RestorableFileState,
): Promise<void> {
  if (originalState.exists && targetState.exists) {
    const fileHandle = await open(filePath, fsConstants.O_WRONLY | O_NOFOLLOW)
    try {
      const stats = await fileHandle.stat()
      if (!stats.isFile() || stats.nlink !== 1) {
        throw new RewindError(`File cannot be restored safely: ${filePath}`)
      }
    } finally {
      await fileHandle.close()
    }
    return
  }

  let existingParent = dirname(filePath)
  while (true) {
    try {
      await access(existingParent, fsConstants.W_OK)
      return
    } catch (error) {
      const maybeErr = error as NodeJS.ErrnoException
      if (maybeErr.code !== 'ENOENT') throw error
      const parent = dirname(existingParent)
      if (parent === existingParent) throw error
      existingParent = parent
    }
  }
}

/**
 * Build the ordered restore plan for one target snapshot: every path tracked
 * across the session, resolved to the backup the target message's snapshot
 * (or the earliest version) records, excluding paths whose current state
 * already equals the target. The plan verifies path safety and writability
 * up front so execution can fail before touching any file.
 * @param checkpointBaseDir - the session workdir.
 * @param trackedPaths - every path tracked across the session's snapshots.
 * @param targetBackups - per tracking path, the target message's recorded
 *   backup identity (`backupFileName` or `null` for absent) — already
 *   resolved by the caller from the snapshot fold.
 * @param readBackup - reads one backup artifact (`{content, mode}`).
 * @returns the ordered plan entries.
 */
export async function buildRestorePlan(
  checkpointBaseDir: string,
  trackedPaths: readonly string[],
  targetBackups: ReadonlyMap<string, string | null>,
  readBackup: (backupFileName: string) => Promise<{ content: Buffer; mode: number }>,
): Promise<RestorePlanEntry[]> {
  const plan: RestorePlanEntry[] = []
  const backupByIdentity = new Map<string, string | null>()

  for (const trackingPath of trackedPaths) {
    const backupFileName = targetBackups.get(trackingPath)
    if (backupFileName === undefined) continue

    const absolutePath = expandTrackingPath(trackingPath, checkpointBaseDir)
    const identityPath = await toFileIdentityPath(absolutePath)
    if (backupByIdentity.has(identityPath)) {
      if (backupByIdentity.get(identityPath) !== backupFileName) {
        throw new RewindError(`Conflicting checkpoints for tracked path: ${trackingPath}`)
      }
      continue
    }
    backupByIdentity.set(identityPath, backupFileName)

    if (!(await isSafeTrackedPath(checkpointBaseDir, trackingPath))) {
      throw new RewindError(`Tracked path became unsafe before restore: ${trackingPath}`)
    }

    const originalState = await readRestorableFileState(absolutePath)
    const targetState: RestorableFileState = backupFileName === null
      ? { exists: false }
      : { exists: true, ...await readBackup(backupFileName) }
    if (!targetState.exists && backupFileName !== null) {
      throw new RewindError(`Checkpoint backup is missing: ${backupFileName}`)
    }
    if (restorableFileStatesMatch(originalState, targetState)) continue
    await assertRestoreTargetWritable(absolutePath, originalState, targetState)
    plan.push({ trackingPath, absolutePath, originalState, targetState })
  }

  return plan
}

/**
 * Execute an ordered restore plan, rolling back the already-applied entries
 * on any failure so a partial restore never lands.
 * @param checkpointBaseDir - the session workdir.
 * @param plan - the ordered plan from {@link buildRestorePlan}.
 */
export async function applyRestorePlan(
  checkpointBaseDir: string,
  plan: RestorePlanEntry[],
): Promise<void> {
  const attempted: RestorePlanEntry[] = []
  try {
    for (const entry of plan) {
      if (!(await isSafeTrackedPath(checkpointBaseDir, entry.trackingPath))) {
        throw new RewindError(
          `Tracked path became unsafe before restore: ${entry.trackingPath}`,
        )
      }
      attempted.push(entry)
      await writeRestorableFileState(entry.absolutePath, entry.targetState)
    }
  } catch (error) {
    const rollbackErrors = await rollbackRestorePlan(checkpointBaseDir, attempted)
    if (rollbackErrors.length > 0) {
      throw new Error(
        `Restore failed and rollback was incomplete: ${rollbackErrors.join('; ')}`,
        { cause: error },
      )
    }
    throw new RewindError(
      'The checkpoint could not be restored safely. No messages or files were changed.',
    )
  }
}

/** Revert an applied restore plan in reverse order, reporting failures. */
export async function rollbackRestorePlan(
  checkpointBaseDir: string,
  plan: RestorePlanEntry[],
): Promise<string[]> {
  const rollbackErrors: string[] = []
  for (const entry of [...plan].reverse()) {
    try {
      if (!(await isSafeTrackedPath(checkpointBaseDir, entry.trackingPath))) {
        rollbackErrors.push(`Tracked path became unsafe: ${entry.trackingPath}`)
        continue
      }
      await writeRestorableFileState(entry.absolutePath, entry.originalState)
    } catch (rollbackError) {
      rollbackErrors.push(
        rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
      )
    }
  }
  return rollbackErrors
}
