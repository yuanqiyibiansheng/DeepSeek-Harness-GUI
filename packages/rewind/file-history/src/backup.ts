/**
 * Backup artifact storage for the file-history domain: deterministic per-path
 * versioned artifacts under `{dshHome}/file-history/{sessionId}/`, written
 * with symlink/hard-link refusal, directory-identity checks, and atomic
 * temp-then-rename publication. Ported 1:1 in behavior from the reference
 * implementation (cc-haha `src/utils/fileHistory.ts`), minus its analytics,
 * VSCode notifications, and global-session state — the session id and data
 * root are explicit parameters here.
 *
 * @module @deepseek-ai/dsh-file-history/backup
 */

import { constants as fsConstants, type Stats } from 'node:fs'
import {
  type FileHandle,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
} from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { FileHistoryBackup } from './types.ts'

const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0
const COPY_BUFFER_SIZE = 1024 * 1024

/** A safe directory entry captured before an operation and re-verified after. */
interface SafeDirectoryEntry {
  path: string
  stats: Stats
}

function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

function assertSafePathSegment(segment: string, label: string): void {
  if (
    !segment ||
    segment === '.' ||
    segment === '..' ||
    segment.includes('/') ||
    segment.includes('\\')
  ) {
    throw new Error(`FileHistory: Refusing unsafe ${label}: ${segment}`)
  }
}

function assertSafeDirectory(stats: Stats, path: string): void {
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`FileHistory: Refusing unsafe directory: ${path}`)
  }
}

function assertSafeRegularFile(
  stats: Stats,
  path: string,
  operation: 'snapshot' | 'restore' | 'delete',
): void {
  if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink > 1) {
    throw new Error(
      `FileHistory: Refusing to ${operation} unsafe linked file: ${path}`,
    )
  }
}

function sameFileIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

async function copyBetweenFileHandles(
  source: FileHandle,
  destination: FileHandle,
): Promise<void> {
  const buffer = Buffer.allocUnsafe(COPY_BUFFER_SIZE)
  let position = 0
  while (true) {
    const { bytesRead } = await source.read(
      buffer,
      0,
      buffer.length,
      position,
    )
    if (bytesRead === 0) return

    let written = 0
    while (written < bytesRead) {
      const { bytesWritten } = await destination.write(
        buffer,
        written,
        bytesRead - written,
        position + written,
      )
      written += bytesWritten
    }
    position += bytesRead
  }
}

/**
 * The backup directory for one session: `{dshHome}/file-history/{sessionId}`.
 * @param dshHome - the resolved Harness data root.
 * @param sessionId - the session owning the backups.
 * @returns the absolute backup directory.
 */
export function backupDirectory(dshHome: string, sessionId: string): string {
  assertSafePathSegment(sessionId, 'session ID')
  return join(dshHome, 'file-history', sessionId)
}

/**
 * Resolve one backup artifact's absolute path. The artifact lives directly in
 * the session's backup directory; the base name is a deterministic
 * `{sha256(path).slice(0,16)}@v{version}` — no traversal is possible.
 * @param dshHome - the resolved Harness data root.
 * @param sessionId - the session owning the backups.
 * @param backupFileName - the artifact base name (or `null`, which rejects).
 * @returns the absolute artifact path.
 */
export function resolveBackupPath(
  dshHome: string,
  sessionId: string,
  backupFileName: string,
): string {
  assertSafePathSegment(backupFileName, 'backup file name')
  return join(backupDirectory(dshHome, sessionId), backupFileName)
}

/** The deterministic base name of a path's `version`-th backup artifact. */
export function backupFileNameFor(filePath: string, version: number): string {
  const fileNameHash = createHash('sha256')
    .update(filePath)
    .digest('hex')
    .slice(0, 16)
  return `${fileNameHash}@v${version}`
}

async function ensureSafeBackupDirectory(
  dshHome: string,
  sessionId: string,
): Promise<SafeDirectoryEntry[]> {
  const backupDirectoryPath = backupDirectory(dshHome, sessionId)
  const relativeBackupDirectory = relative(dshHome, backupDirectoryPath)
  const entries: SafeDirectoryEntry[] = []
  let currentPath = dshHome
  await mkdir(dshHome, { recursive: true })
  for (const segment of relativeBackupDirectory.split(/[\\/]/)) {
    assertSafePathSegment(segment, 'backup directory segment')
    currentPath = join(currentPath, segment)
    try {
      await mkdir(currentPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code !== 'EEXIST') throw error
    }
    const stats = await lstat(currentPath)
    assertSafeDirectory(stats, currentPath)
    entries.push({ path: currentPath, stats })
  }
  return entries
}

async function inspectSafeBackupDirectory(
  dshHome: string,
  sessionId: string,
): Promise<SafeDirectoryEntry[]> {
  const backupDirectoryPath = backupDirectory(dshHome, sessionId)
  const relativeBackupDirectory = relative(dshHome, backupDirectoryPath)
  const entries: SafeDirectoryEntry[] = []
  let currentPath = dshHome
  for (const segment of relativeBackupDirectory.split(/[\\/]/)) {
    assertSafePathSegment(segment, 'backup directory segment')
    currentPath = join(currentPath, segment)
    const stats = await lstat(currentPath)
    assertSafeDirectory(stats, currentPath)
    entries.push({ path: currentPath, stats })
  }
  return entries
}

async function assertSafeDirectoryEntriesUnchanged(
  entries: SafeDirectoryEntry[],
): Promise<void> {
  for (const entry of entries) {
    const currentStats = await lstat(entry.path)
    assertSafeDirectory(currentStats, entry.path)
    if (!sameFileIdentity(entry.stats, currentStats)) {
      throw new Error(
        `FileHistory: Refusing a backup directory that changed: ${entry.path}`,
      )
    }
  }
}

async function areSafeDirectoryEntriesUnchanged(
  entries: SafeDirectoryEntry[],
): Promise<boolean> {
  try {
    await assertSafeDirectoryEntriesUnchanged(entries)
    return true
  } catch {
    return false
  }
}

/**
 * Refuse a tracked path whose existing parent escapes the session workdir
 * through a symbolic link: an in-workdir path resolving outside it via
 * symlink would let a rewind touch files the workdir did not own.
 * @param filePath - the absolute tracked path.
 * @param workDir - the session's absolute working directory.
 * @throws when the parent chain escapes the workdir through a link.
 */
export async function assertTrackedPathStaysWithinWorkdir(
  filePath: string,
  workDir: string,
): Promise<void> {
  const projectPath = resolve(workDir)
  const resolvedFilePath = resolve(filePath)
  const lexicalRelative = relative(projectPath, resolvedFilePath)
  if (lexicalRelative.startsWith('..') || isAbsolute(lexicalRelative)) {
    return
  }

  const realProjectPath = await realpath(projectPath)
  let existingParentPath = dirname(resolvedFilePath)
  let realParentPath: string
  while (true) {
    try {
      realParentPath = await realpath(existingParentPath)
      break
    } catch (error) {
      if (!isENOENT(error)) throw error
      const nextParent = dirname(existingParentPath)
      if (nextParent === existingParentPath) throw error
      existingParentPath = nextParent
    }
  }
  const realRelative = relative(realProjectPath, realParentPath)
  if (realRelative.startsWith('..') || isAbsolute(realRelative)) {
    throw new Error(
      `FileHistory: Refusing path whose parent escapes the workdir through a symbolic link: ${filePath}`,
    )
  }
}

/**
 * Create a backup of `filePath` as its `version`-th artifact. A missing file
 * records the null marker (deleted-in-this-version). The artifact is written
 * to a unique temp file, synced, and atomically renamed into place, with the
 * source verified to be a regular non-linked file both before and during the
 * copy.
 * @param dshHome - the resolved Harness data root.
 * @param sessionId - the session owning the backups.
 * @param filePath - the absolute file to back up, or null for a pure marker.
 * @param version - the backup version to record.
 * @param workDir - the session workdir for the project-boundary check.
 * @returns the recorded backup identity.
 */
export async function createBackup(
  dshHome: string,
  sessionId: string,
  filePath: string | null,
  version: number,
  workDir: string,
): Promise<FileHistoryBackup> {
  if (filePath === null) {
    return { backupFileName: null, version, backupTime: new Date().toISOString() }
  }

  const backupFileName = backupFileNameFor(filePath, version)
  const backupPath = resolveBackupPath(dshHome, sessionId, backupFileName)

  let pathStats: Stats
  try {
    pathStats = await lstat(filePath)
  } catch (error) {
    if (isENOENT(error)) {
      return { backupFileName: null, version, backupTime: new Date().toISOString() }
    }
    throw error
  }
  assertSafeRegularFile(pathStats, filePath, 'snapshot')

  let source: FileHandle
  try {
    source = await open(
      filePath,
      process.platform === 'win32'
        ? fsConstants.O_RDONLY
        : fsConstants.O_RDONLY | O_NOFOLLOW,
    )
  } catch (error) {
    if (isENOENT(error)) {
      return { backupFileName: null, version, backupTime: new Date().toISOString() }
    }
    throw error
  }

  let temporaryPath: string | undefined
  let backupDirectoryEntries: SafeDirectoryEntry[] | undefined
  try {
    await assertTrackedPathStaysWithinWorkdir(filePath, workDir)
    const srcStats = await source.stat()
    assertSafeRegularFile(srcStats, filePath, 'snapshot')
    if (!sameFileIdentity(pathStats, srcStats)) {
      throw new Error(
        `FileHistory: Refusing to snapshot a file that changed while opening: ${filePath}`,
      )
    }

    backupDirectoryEntries = await ensureSafeBackupDirectory(dshHome, sessionId)
    temporaryPath = `${backupPath}.${randomUUID()}.tmp`
    const destination = await open(
      temporaryPath,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        (process.platform === 'win32' ? 0 : O_NOFOLLOW),
      srcStats.mode,
    )
    try {
      await copyBetweenFileHandles(source, destination)
      await destination.chmod(srcStats.mode)
      await destination.sync()
    } finally {
      await destination.close()
    }
    await assertSafeDirectoryEntriesUnchanged(backupDirectoryEntries)
    const temporaryStats = await lstat(temporaryPath)
    assertSafeRegularFile(temporaryStats, temporaryPath, 'snapshot')
    await rename(temporaryPath, backupPath)
    temporaryPath = undefined
  } finally {
    await source.close()
    if (
      temporaryPath &&
      backupDirectoryEntries &&
      (await areSafeDirectoryEntriesUnchanged(backupDirectoryEntries))
    ) {
      await unlink(temporaryPath).catch(() => {})
    }
  }

  return { backupFileName, version, backupTime: new Date().toISOString() }
}

/**
 * Whether the original file's content differs from one of its backup
 * artifacts, using the same stat/content comparison as the restore path.
 * @param originalFile - the absolute file to compare.
 * @param dshHome - the resolved Harness data root.
 * @param sessionId - the session owning the backups.
 * @param backupFileName - the artifact base name to compare against.
 * @returns true when the file changed relative to the backup.
 */
export async function checkOriginFileChanged(
  originalFile: string,
  dshHome: string,
  sessionId: string,
  backupFileName: string,
): Promise<boolean> {
  const backupPath = resolveBackupPath(dshHome, sessionId, backupFileName)

  let originalStats: Stats | null = null
  try {
    originalStats = await lstat(originalFile)
  } catch (error) {
    if (!isENOENT(error)) return true
  }
  if (
    originalStats &&
    (originalStats.isSymbolicLink() ||
      !originalStats.isFile() ||
      originalStats.nlink > 1)
  ) {
    return true
  }
  let backupStats: Stats | null = null
  try {
    backupStats = await stat(backupPath)
  } catch (error) {
    if (!isENOENT(error)) return true
  }

  // One exists, one missing -> changed; both missing -> no change.
  if ((originalStats === null) !== (backupStats === null)) return true
  if (originalStats === null || backupStats === null) return false

  // Stat-level short-circuit: permissions, size, or mtime ordering.
  if (
    originalStats.mode !== backupStats.mode ||
    originalStats.size !== backupStats.size
  ) {
    return true
  }
  if (originalStats.mtimeMs < backupStats.mtimeMs) return false

  try {
    const [originalContent, backupContent] = await Promise.all([
      readFile(originalFile, 'utf-8'),
      readFile(backupPath, 'utf-8'),
    ])
    return originalContent !== backupContent
  } catch {
    // File deleted between stat and read -> treat as changed.
    return true
  }
}

/**
 * Read one backup artifact safely: the artifact must remain a regular
 * non-linked file and its directory chain unchanged between verification and
 * read.
 * @param dshHome - the resolved Harness data root.
 * @param sessionId - the session owning the backups.
 * @param backupFileName - the artifact base name.
 * @returns the artifact content and the file mode recorded at read time.
 */
export async function readBackupFileSafely(
  dshHome: string,
  sessionId: string,
  backupFileName: string,
): Promise<{ content: Buffer; mode: number }> {
  const directoryEntries = await inspectSafeBackupDirectory(dshHome, sessionId)
  const backupPath = resolveBackupPath(dshHome, sessionId, backupFileName)
  const pathStats = await lstat(backupPath)
  assertSafeRegularFile(pathStats, backupPath, 'restore')
  const fileHandle = await open(
    backupPath,
    process.platform === 'win32'
      ? fsConstants.O_RDONLY
      : fsConstants.O_RDONLY | O_NOFOLLOW,
  )
  try {
    const stats = await fileHandle.stat()
    assertSafeRegularFile(stats, backupPath, 'restore')
    if (!sameFileIdentity(pathStats, stats)) {
      throw new Error(
        `FileHistory: Refusing a backup that changed while opening: ${backupPath}`,
      )
    }
    await assertSafeDirectoryEntriesUnchanged(directoryEntries)
    return {
      content: await fileHandle.readFile(),
      mode: stats.mode,
    }
  } finally {
    await fileHandle.close()
  }
}

/**
 * Shorten an absolute file path to its workdir-relative form when it lives
 * inside the workdir; absolute paths outside it stay absolute (they are
 * still tracked, but restore treats them as outside the boundary).
 * @param filePath - the path to track.
 * @param workDir - the session's absolute working directory.
 * @returns the tracking key for the path.
 */
export function shortenTrackingPath(filePath: string, workDir: string): string {
  if (!isAbsolute(filePath)) return filePath
  const relativePath = relative(workDir, filePath)
  if (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  ) {
    return relativePath
  }
  return filePath
}

/**
 * Expand a tracking key back to an absolute path.
 * @param trackingPath - the tracked path (relative to the workdir, or absolute).
 * @param workDir - the session's absolute working directory.
 * @returns the absolute path.
 */
export function expandTrackingPath(trackingPath: string, workDir: string): string {
  if (isAbsolute(trackingPath)) return trackingPath
  return join(workDir, trackingPath)
}
