/**
 * The rewind core: target resolution, code-preview building, turn-checkpoint
 * state, and the preview/execute/checkpoints/diff operations. Ported 1:1 in
 * behavior from the reference implementation (cc-haha
 * `src/server/services/sessionRewindService.ts`), adapted to the event-sourced
 * session log: the transcript is derived from session events, snapshots come
 * from the `file/history-snapshot` fold, and the transcript is always complete
 * (dsh subagent work lives in its own session, not in sidecar transcripts).
 *
 * @module @deepseek-ai/dsh-session-rewind/rewind
 */

import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { diffLines, createTwoFilesPatch } from 'diff'
import type {
  FileHistorySnapshot,
  FileHistorySnapshotMap,
} from '@deepseek-ai/dsh-file-history'
import { collectTrackedPaths } from '@deepseek-ai/dsh-file-history'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { deriveRewindMessages } from './messages.ts'
import { collectErroredToolUseIds, collectSuccessfulToolUseIds } from './evidence.ts'
import { recordedCommandIsReadOnly } from './read-only.ts'
import {
  applyRestorePlan,
  buildRestorePlan,
  expandTrackingPath,
  isSafeTrackedPath,
  RewindError,
  rollbackRestorePlan,
  type RestorePlanEntry,
} from './restore.ts'
import type {
  RewindCodePreview,
  RewindMessage,
  RewindTargetSelector,
  SessionRewindExecuteResult,
  SessionRewindMode,
  SessionRewindPreview,
  SessionTurnCheckpointDiffResult,
  SessionTurnCheckpointPreview,
} from './types.ts'

export type { RewindMessage }
export type { FileHistorySnapshot, FileHistorySnapshotMap } from '@deepseek-ai/dsh-file-history'

interface RewindTarget {
  targetUserMessageSeq: number
  userMessageIndex: number
  userMessageCount: number
  messagesRemoved: number
}

interface FileChangeStats {
  insertions: number
  deletions: number
}

const fileChangeStats = Symbol('fileChangeStats')

type RewindCodePreviewWithStats = RewindCodePreview & {
  [fileChangeStats]?: Map<string, FileChangeStats>
}

interface TranscriptFileChange {
  path: string
  absolutePath: string
  identityPath: string
  additions: number
  deletions: number
  diff?: string
}

interface TranscriptTurnFileEvidence {
  confirmedChanges: TranscriptFileChange[]
  uncertainChanges: TranscriptFileChange[]
  /**
   * Tools in this turn whose file effects the transcript cannot describe — a
   * writing shell command, a tool we have no extractor for, a call whose input
   * did not survive. Their changes are only undoable where the file-history
   * snapshot happens to cover them, so this downgrades restore coverage to
   * partial instead of blocking the undo.
   */
  unverifiedChangeSources: string[]
}

interface SnapshotTurnCodePreview {
  preview: RewindCodePreview
  coveredPathIdentities: Set<string>
  restorablePathIdentities: Set<string>
  restoreAvailable: boolean
}

interface MergedTurnCodePreview {
  preview: RewindCodePreview
  restoreAvailable: boolean
  unverifiedChangeSources: string[]
}

/** Everything the rewind algorithm reads from one session. */
export interface RewindSessionData {
  messages: RewindMessage[]
  /** The session workdir (the checkpoint base dir for tracking paths). */
  cwd: string
  /** Folded per-user-message file snapshots (keyed by user-message seq). */
  snapshots: FileHistorySnapshotMap
  /** Reads one backup artifact of the session. */
  readBackup(backupFileName: string): Promise<{ content: Buffer; mode: number }>
}

// --- target resolution ---

function normalizePromptText(text: string): string {
  return text.replace(/\r\n/g, '\n').trim()
}

function extractUserPromptText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .flatMap((block) => {
      if (!block || typeof block !== 'object') return []
      const record = block as Record<string, unknown>
      return record.type === 'text' && typeof record.text === 'string'
        ? [record.text]
        : []
    })
    .join('\n')
}

function assertExpectedPromptMatches(
  targetMessage: RewindMessage,
  expectedContent: string | undefined,
): void {
  if (expectedContent === undefined) return

  const actual = normalizePromptText(extractUserPromptText(targetMessage.content))
  const expected = normalizePromptText(expectedContent)
  if (actual !== expected) {
    throw new RewindError(
      'The resolved rewind target does not match the selected prompt. Refresh the session and try again.',
    )
  }
}

function resolveRewindTarget(
  messages: RewindMessage[],
  selector: RewindTargetSelector,
): RewindTarget {
  const userMessages = messages.filter(message => message.type === 'user')

  if (userMessages.length === 0) {
    throw new RewindError('This session has no user messages to rewind.')
  }

  let targetUserMessage: RewindMessage | null = null
  let userMessageIndex = -1

  if (selector.targetUserMessageId !== undefined) {
    const activeMessage = messages.find(message => message.id === selector.targetUserMessageId)
    if (activeMessage !== undefined) {
      if (activeMessage.type !== 'user') {
        throw new RewindError('The selected rewind target is not a user message.')
      }
      targetUserMessage = activeMessage
      userMessageIndex = userMessages.findIndex(message => message.id === activeMessage.id)
    }
  }

  if (targetUserMessage === null && Number.isInteger(selector.userMessageIndex)) {
    userMessageIndex = selector.userMessageIndex!
    if (userMessageIndex >= 0 && userMessageIndex < userMessages.length) {
      targetUserMessage = userMessages[userMessageIndex]!
    }
  }

  if (
    targetUserMessage === null ||
    userMessageIndex < 0 ||
    userMessageIndex >= userMessages.length
  ) {
    throw new RewindError(
      `Invalid rewind target. Expected targetUserMessageId or userMessageIndex 0-${userMessages.length - 1}.`,
    )
  }

  assertExpectedPromptMatches(targetUserMessage, selector.expectedContent)

  const activeMessageIndex = messages.findIndex(
    message => message.id === targetUserMessage.id,
  )
  if (activeMessageIndex < 0) {
    throw new RewindError('The selected user message is not in the active chain.')
  }

  return {
    targetUserMessageSeq: Number(targetUserMessage.id),
    userMessageIndex,
    userMessageCount: userMessages.length,
    messagesRemoved: messages.length - activeMessageIndex,
  }
}

// --- snapshot-based code preview ---

function normalizeDiffStats(diffStats: {
  filesChanged?: string[]
  insertions?: number
  deletions?: number
  fileStats?: Map<string, FileChangeStats>
} | undefined): RewindCodePreviewWithStats {
  const preview: RewindCodePreviewWithStats = {
    available: true,
    filesChanged: diffStats?.filesChanged ?? [],
    insertions: diffStats?.insertions ?? 0,
    deletions: diffStats?.deletions ?? 0,
  }
  if (diffStats?.fileStats) preview[fileChangeStats] = diffStats.fileStats
  return preview
}

function findTargetSnapshot(
  snapshots: FileHistorySnapshotMap,
  targetUserMessageSeq: number,
): FileHistorySnapshot | null {
  return snapshots.get(targetUserMessageSeq) ?? null
}

function getEarliestBackupFileName(
  trackingPath: string,
  snapshots: FileHistorySnapshotMap,
): string | null | undefined {
  for (const seq of [...snapshots.keys()].sort((a, b) => a - b)) {
    const backup = snapshots.get(seq)?.trackedFileBackups[trackingPath]
    if (backup?.version === 1) {
      return backup.backupFileName
    }
  }
  return undefined
}

function getBackupFileNameForTarget(
  trackingPath: string,
  snapshots: FileHistorySnapshotMap,
  targetSnapshot: FileHistorySnapshot,
): string | null | undefined {
  const targetBackup = targetSnapshot.trackedFileBackups[trackingPath]
  if (targetBackup && 'backupFileName' in targetBackup) {
    return targetBackup.backupFileName
  }
  return getEarliestBackupFileName(trackingPath, snapshots)
}

async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}

function countInsertedLines(content: string): number {
  return diffLines('', content).reduce((total, change) => (
    change.added ? total + (change.count || 0) : total
  ), 0)
}

async function readBackupContent(
  readBackup: (backupFileName: string) => Promise<{ content: Buffer; mode: number }>,
  backupFileName: string | null | undefined,
): Promise<string | null | undefined> {
  if (backupFileName === undefined) return undefined
  if (backupFileName === null) return null
  try {
    return (await readBackup(backupFileName)).content.toString('utf-8')
  } catch {
    return undefined
  }
}

function buildCheckpointDiff(
  displayPath: string,
  oldContent: string,
  newContent: string,
  oldExists: boolean,
  newExists: boolean,
): string {
  const oldFileName = oldExists ? `a/${displayPath}` : '/dev/null'
  const newFileName = newExists ? `b/${displayPath}` : '/dev/null'

  return createTwoFilesPatch(
    oldFileName,
    newFileName,
    oldContent,
    newContent,
    '',
    '',
    { context: 3 },
  )
}

/**
 * Build the snapshot-based code preview for one target message: for every
 * tracked path, compare the current file with the backup the target snapshot
 * records and count the differences. `restoreAvailable` is false when any
 * tracked path cannot be safely restored.
 */
async function buildCodePreview(
  data: RewindSessionData,
  targetUserMessageSeq: number,
): Promise<{
  snapshots: FileHistorySnapshotMap
  preview: RewindCodePreview
  restoreAvailable: boolean
}> {
  const { snapshots, cwd } = data
  if (snapshots.size === 0) {
    return {
      snapshots,
      preview: {
        available: false,
        reason: 'No file checkpoints were recorded for this session.',
        filesChanged: [],
        insertions: 0,
        deletions: 0,
      },
      restoreAvailable: true,
    }
  }

  const targetSnapshot = findTargetSnapshot(snapshots, targetUserMessageSeq)
  if (targetSnapshot === null) {
    return {
      snapshots,
      preview: {
        available: false,
        reason: 'No file checkpoint is available for the selected message.',
        filesChanged: [],
        insertions: 0,
        deletions: 0,
      },
      restoreAvailable: true,
    }
  }

  const trackedPaths = collectTrackedPaths(snapshots)
  const filesChanged: string[] = []
  const backupByIdentity = new Map<string, string | null>()
  const statsByIdentity = new Map<string, FileChangeStats>()
  let insertions = 0
  let deletions = 0
  let restoreAvailable = true

  for (const trackingPath of trackedPaths) {
    const backupFileName = getBackupFileNameForTarget(
      trackingPath,
      snapshots,
      targetSnapshot,
    )

    if (backupFileName === undefined) continue

    const absolutePath = expandTrackingPath(trackingPath, cwd)
    const identityPath = absolutePath
    if (backupByIdentity.has(identityPath)) {
      if (backupByIdentity.get(identityPath) !== backupFileName) {
        restoreAvailable = false
      }
      continue
    }
    backupByIdentity.set(identityPath, backupFileName)

    if (!(await isSafeTrackedPath(cwd, trackingPath))) {
      restoreAvailable = false
      continue
    }

    if (backupFileName === null) {
      const currentContent = await readFileOrNull(absolutePath)
      if (currentContent !== null) {
        filesChanged.push(absolutePath)
        const fileInsertions = countInsertedLines(currentContent)
        insertions += fileInsertions
        statsByIdentity.set(identityPath, { insertions: fileInsertions, deletions: 0 })
      }
      continue
    }

    const [currentContent, backupContent] = await Promise.all([
      readFileOrNull(absolutePath),
      readBackupContent(data.readBackup, backupFileName),
    ])
    if (backupContent === null || backupContent === undefined) {
      restoreAvailable = false
      continue
    }
    if (currentContent === backupContent) continue

    filesChanged.push(absolutePath)
    const fileStats = { insertions: 0, deletions: 0 }
    for (const change of diffLines(currentContent ?? '', backupContent ?? '')) {
      if (change.added) {
        insertions += change.count || 0
        fileStats.insertions += change.count || 0
      }
      if (change.removed) {
        deletions += change.count || 0
        fileStats.deletions += change.count || 0
      }
    }
    statsByIdentity.set(identityPath, fileStats)
  }

  return {
    snapshots,
    preview: normalizeDiffStats({
      filesChanged,
      insertions,
      deletions,
      fileStats: statsByIdentity,
    }),
    restoreAvailable,
  }
}

// --- transcript evidence ---

function normalizeComparablePath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

function isWithinBaseDir(absolutePath: string, baseDir: string): boolean {
  const relativePath = relative(baseDir, absolutePath)
  return relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

function normalizeTranscriptRelativePath(filePath: string): string {
  return normalizeComparablePath(filePath).replace(/^\/+/, '')
}

function resolveTranscriptToolPath(
  filePath: unknown,
  baseDir: string,
): { path: string; absolutePath: string; identityPath: string } | null {
  if (typeof filePath !== 'string' || !filePath.trim()) return null
  const normalizedBaseDir = resolve(baseDir)
  const absolutePath = isAbsolute(filePath)
    ? resolve(filePath)
    : resolve(normalizedBaseDir, filePath)
  const pathWithinBaseDir = isWithinBaseDir(absolutePath, normalizedBaseDir)

  return {
    path: pathWithinBaseDir
      ? normalizeTranscriptRelativePath(relative(normalizedBaseDir, absolutePath))
      : normalizeComparablePath(absolutePath),
    absolutePath,
    identityPath: absolutePath,
  }
}

function countTranscriptLines(content: string): number {
  if (!content) return 0
  const lines = content.split(/\r\n|\r|\n/)
  if (lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines.length
}

function buildTranscriptDiff(
  oldPath: string,
  newPath: string,
  oldContent: string,
  newContent: string,
): string {
  const oldLines = oldContent ? oldContent.split('\n') : []
  const newLines = newContent ? newContent.split('\n') : []
  if (oldLines.at(-1) === '') oldLines.pop()
  if (newLines.at(-1) === '') newLines.pop()

  return [
    `diff --session a/${oldPath} b/${newPath}`,
    `--- ${oldPath === '/dev/null' ? '/dev/null' : `a/${oldPath}`}`,
    `+++ b/${newPath}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
  ].join('\n')
}

function buildTranscriptEditChange(
  filePath: { path: string; absolutePath: string; identityPath: string },
  input: Record<string, unknown>,
): TranscriptFileChange {
  const oldString = typeof input.old_string === 'string' ? input.old_string : ''
  const newString = typeof input.new_string === 'string' ? input.new_string : ''
  return {
    path: filePath.path,
    absolutePath: filePath.absolutePath,
    identityPath: filePath.identityPath,
    additions: countTranscriptLines(newString),
    deletions: countTranscriptLines(oldString),
    diff: buildTranscriptDiff(filePath.path, filePath.path, oldString, newString),
  }
}

function extractApplyPatchTranscriptChanges(
  patch: unknown,
  baseDir: string,
): TranscriptFileChange[] {
  if (typeof patch !== 'string') return []
  const changes: TranscriptFileChange[] = []

  for (const line of patch.split('\n')) {
    const match = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/) ??
      line.match(/^\*\*\* Move to: (.+)$/)
    if (!match?.[1]) continue
    const filePath = resolveTranscriptToolPath(match[1], baseDir)
    if (!filePath) continue
    changes.push({
      path: filePath.path,
      absolutePath: filePath.absolutePath,
      identityPath: filePath.identityPath,
      additions: 0,
      deletions: 0,
    })
  }

  return changes
}

function extractTranscriptChangesFromTool(
  toolName: string,
  input: Record<string, unknown>,
  baseDir: string,
): TranscriptFileChange[] {
  const normalizedToolName = toolName.toLowerCase()
  if (normalizedToolName === 'write') {
    const filePath = resolveTranscriptToolPath(input.file_path ?? input.path, baseDir)
    if (!filePath) return []
    const content = typeof input.content === 'string' ? input.content : ''
    return [{
      path: filePath.path,
      absolutePath: filePath.absolutePath,
      identityPath: filePath.identityPath,
      additions: countTranscriptLines(content),
      deletions: 0,
      diff: buildTranscriptDiff('/dev/null', filePath.path, '', content),
    }]
  }

  if (normalizedToolName === 'edit') {
    const filePath = resolveTranscriptToolPath(input.file_path ?? input.path, baseDir)
    if (!filePath) return []
    return [buildTranscriptEditChange(filePath, input)]
  }

  if (normalizedToolName === 'multiedit') {
    const filePath = resolveTranscriptToolPath(input.file_path ?? input.path, baseDir)
    if (!filePath || !Array.isArray(input.edits)) return []
    return input.edits
      .filter((edit): edit is Record<string, unknown> => !!edit && typeof edit === 'object')
      .map((edit) => buildTranscriptEditChange(filePath, edit))
  }

  if (normalizedToolName === 'notebookedit') {
    const filePath = resolveTranscriptToolPath(
      input.notebook_path ?? input.file_path ?? input.path,
      baseDir,
    )
    if (!filePath) return []
    const oldString = typeof input.old_source === 'string' ? input.old_source : ''
    const newString = typeof input.new_source === 'string' ? input.new_source : ''
    return [{
      path: filePath.path,
      absolutePath: filePath.absolutePath,
      identityPath: filePath.identityPath,
      additions: countTranscriptLines(newString),
      deletions: countTranscriptLines(oldString),
      diff: buildTranscriptDiff(filePath.path, filePath.path, oldString, newString),
    }]
  }

  if (normalizedToolName === 'apply_patch') {
    return extractApplyPatchTranscriptChanges(input.patch, baseDir)
  }

  return []
}

function isKnownFileMutationTool(toolName: string): boolean {
  return ['write', 'edit', 'multiedit', 'notebookedit', 'apply_patch']
    .includes(toolName.toLowerCase())
}

/**
 * Tools that cannot change workspace files, so their presence in a turn says
 * nothing about restore coverage. Deliberately absent: TaskCreate/TaskStop
 * spawn background work that writes files outside this transcript, so they
 * keep counting as unverified sources.
 */
function isKnownNonFileTool(toolName: string): boolean {
  return [
    'agent',
    'askuserquestion',
    'enterplanmode',
    'exitplanmode',
    'glob',
    'grep',
    'read',
    'skill',
    'sleep',
    'task',
    'taskget',
    'tasklist',
    'taskupdate',
    'todowrite',
    'toolsearch',
    'webfetch',
    'websearch',
  ].includes(toolName.toLowerCase())
}

function isReadOnlyShellCall(toolName: string, input: unknown): boolean {
  if (toolName.toLowerCase() !== 'bash') return false
  const command = (input as { command?: unknown } | null | undefined)?.command
  return typeof command === 'string' && recordedCommandIsReadOnly(command)
}

function isNonMutatingToolCall(toolName: string, input: unknown): boolean {
  return isKnownNonFileTool(toolName) || isReadOnlyShellCall(toolName, input)
}

function getTurnMessageRange(
  messages: RewindMessage[],
  targetUserMessageId: string,
): { start: number; end: number } | null {
  const start = messages.findIndex(message => message.id === targetUserMessageId)
  if (start < 0) return null
  const nextUserIndex = messages.findIndex(
    (message, index) => index > start && message.type === 'user',
  )
  return { start, end: nextUserIndex >= 0 ? nextUserIndex : messages.length }
}

/**
 * The turn's messages: everything after the target user message up to the
 * next user message. dsh subagent work lives in its own session, so there are
 * no parentToolUseId child chains to splice in — the reference's subagent
 * traversal is structurally absent here.
 */
function getTranscriptTurnMessages(
  messages: RewindMessage[],
  targetUserMessageId: string,
): RewindMessage[] {
  const range = getTurnMessageRange(messages, targetUserMessageId)
  if (!range) return []
  return messages.slice(range.start + 1, range.end)
}

const MAX_UNVERIFIED_CHANGE_SOURCES = 8

function normalizeUnverifiedChangeSources(sources: Iterable<string>): string[] {
  return [...new Set(sources)].sort().slice(0, MAX_UNVERIFIED_CHANGE_SOURCES)
}

function collectTranscriptTurnFileChanges(
  messages: RewindMessage[],
  targetUserMessageId: string,
  baseDir: string,
): TranscriptTurnFileEvidence {
  const turnMessages = getTranscriptTurnMessages(messages, targetUserMessageId)
  if (turnMessages.length === 0) {
    return { confirmedChanges: [], uncertainChanges: [], unverifiedChangeSources: [] }
  }

  const confirmedChanges = new Map<string, TranscriptFileChange>()
  const uncertainChanges = new Map<string, TranscriptFileChange>()
  const successfulToolUseIds = collectSuccessfulToolUseIds(turnMessages)
  const erroredToolUseIds = collectErroredToolUseIds(turnMessages)
  const seenToolUseIds = new Set<string>()
  const unverifiedChangeSources = new Set<string>()
  for (const message of turnMessages) {
    if (message.type !== 'tool_use' || !Array.isArray(message.content)) continue

    for (const block of message.content) {
      if (!block || typeof block !== 'object') continue
      const record = block as Record<string, unknown>
      if (record.type !== 'tool_use' || typeof record.name !== 'string') continue
      if (typeof record.id !== 'string' || seenToolUseIds.has(record.id)) {
        continue
      }
      seenToolUseIds.add(record.id)
      const input = record.input
      // A failed call can still have written before it failed, and a call whose
      // input did not survive tells us nothing about what it touched.
      if (erroredToolUseIds.has(record.id) || !input || typeof input !== 'object') {
        if (!isNonMutatingToolCall(record.name, input)) {
          unverifiedChangeSources.add(record.name)
        }
        continue
      }
      if (isNonMutatingToolCall(record.name, input)) continue
      if (!isKnownFileMutationTool(record.name)) {
        unverifiedChangeSources.add(record.name)
        continue
      }

      const changes = successfulToolUseIds.has(record.id)
        ? confirmedChanges
        : uncertainChanges
      const extractedChanges = extractTranscriptChangesFromTool(
        record.name,
        input as Record<string, unknown>,
        message.cwd ?? baseDir,
      )
      if (extractedChanges.length === 0) unverifiedChangeSources.add(record.name)

      for (const change of extractedChanges) {
        const existing = changes.get(change.identityPath)
        if (!existing) {
          changes.set(change.identityPath, change)
          continue
        }

        changes.set(change.identityPath, {
          ...existing,
          additions: existing.additions + change.additions,
          deletions: existing.deletions + change.deletions,
          diff: [existing.diff, change.diff].filter(Boolean).join('\n'),
        })
      }
    }
  }

  const sortChanges = (changes: Map<string, TranscriptFileChange>) =>
    [...changes.values()].sort((a, b) => a.path.localeCompare(b.path))
  return {
    confirmedChanges: sortChanges(confirmedChanges),
    uncertainChanges: sortChanges(uncertainChanges),
    unverifiedChangeSources: normalizeUnverifiedChangeSources(unverifiedChangeSources),
  }
}

function buildTranscriptTurnCodePreview(
  changes: TranscriptFileChange[],
): RewindCodePreview {
  if (changes.length === 0) {
    return {
      available: false,
      reason: 'No transcript file changes were recorded for this turn.',
      filesChanged: [],
      insertions: 0,
      deletions: 0,
    }
  }

  const fileStats = new Map<string, FileChangeStats>()
  for (const change of changes) {
    fileStats.set(change.identityPath, {
      insertions: change.additions,
      deletions: change.deletions,
    })
  }
  return normalizeDiffStats({
    filesChanged: changes.map(change => change.absolutePath),
    insertions: changes.reduce((total, change) => total + change.additions, 0),
    deletions: changes.reduce((total, change) => total + change.deletions, 0),
    fileStats,
  })
}

/**
 * Combine what the file-history snapshot captured with what the transcript
 * says the turn did. `restoreAvailable` answers whether the files this
 * checkpoint reports can be put back — snapshots only cover the structured
 * file tools, so a shell command that writes off-checkpoint is invisible to
 * them; such turns restore what IS covered and report the tools whose effects
 * were not. The transcript is always complete in dsh (no sidecar logs), so
 * the reference's `transcriptIntact` gate is structurally absent.
 */
function mergeTurnCodePreviews(
  snapshotPreview: SnapshotTurnCodePreview | null,
  transcriptEvidence: TranscriptTurnFileEvidence,
): MergedTurnCodePreview {
  const transcriptChanges = transcriptEvidence.confirmedChanges
  const transcriptPreview = buildTranscriptTurnCodePreview(transcriptChanges)
  const checkpointPreview = snapshotPreview?.preview ?? null
  const hasUncoveredUncertainChange = transcriptEvidence.uncertainChanges.some(change =>
    !snapshotPreview?.coveredPathIdentities.has(change.identityPath)
  )
  const unverifiedChangeSources = transcriptEvidence.unverifiedChangeSources
  if (!checkpointPreview?.available) {
    return {
      preview: transcriptPreview,
      unverifiedChangeSources,
      restoreAvailable: !transcriptPreview.available &&
        !hasUncoveredUncertainChange,
    }
  }
  if (!transcriptPreview.available) {
    return {
      preview: checkpointPreview,
      unverifiedChangeSources,
      restoreAvailable: (snapshotPreview?.restoreAvailable ?? false) &&
        !hasUncoveredUncertainChange,
    }
  }

  const missingTranscriptChanges = transcriptChanges.filter(change =>
    !snapshotPreview?.coveredPathIdentities.has(change.identityPath)
  )
  if (missingTranscriptChanges.length === 0) {
    return {
      preview: checkpointPreview,
      unverifiedChangeSources,
      restoreAvailable: (snapshotPreview?.restoreAvailable ?? false) &&
        !hasUncoveredUncertainChange,
    }
  }

  const checkpointFileStats: Map<string, FileChangeStats> =
    (checkpointPreview as RewindCodePreviewWithStats)[fileChangeStats] ?? new Map()
  const transcriptFileStats: Map<string, FileChangeStats> =
    (transcriptPreview as RewindCodePreviewWithStats)[fileChangeStats] ?? new Map()
  const mergedFileStats = new Map(checkpointFileStats)
  for (const change of missingTranscriptChanges) {
    const stats = transcriptFileStats.get(change.identityPath)
    if (stats) mergedFileStats.set(change.identityPath, stats)
  }

  return {
    preview: normalizeDiffStats({
      filesChanged: [
        ...checkpointPreview.filesChanged,
        ...missingTranscriptChanges.map(change => change.absolutePath),
      ],
      insertions: checkpointPreview.insertions + missingTranscriptChanges.reduce(
        (total, change) => total + change.additions,
        0,
      ),
      deletions: checkpointPreview.deletions + missingTranscriptChanges.reduce(
        (total, change) => total + change.deletions,
        0,
      ),
      fileStats: mergedFileStats,
    }),
    unverifiedChangeSources,
    restoreAvailable: (snapshotPreview?.restoreAvailable ?? false) &&
      missingTranscriptChanges.every(change =>
        snapshotPreview?.restorablePathIdentities.has(change.identityPath)
      ) &&
      !hasUncoveredUncertainChange,
  }
}

// --- turn checkpoint state ---

function buildTurnPreview(
  target: RewindTarget,
  preview: RewindCodePreview,
  workDir: string,
  restoreAvailable = true,
  unverifiedChangeSources: string[] = [],
): SessionTurnCheckpointPreview {
  return {
    target: {
      targetUserMessageId: String(target.targetUserMessageSeq),
      userMessageIndex: target.userMessageIndex,
      userMessageCount: target.userMessageCount,
    },
    conversation: {
      messagesRemoved: target.messagesRemoved,
    },
    code: preview,
    workDir,
    restoreAvailable,
    unverifiedChangeSources,
  }
}

function hasCompletedTurn(
  messages: RewindMessage[],
  targetUserMessageId: string,
): boolean {
  const range = getTurnMessageRange(messages, targetUserMessageId)
  if (!range) return false
  return messages.slice(range.start + 1, range.end).some(message =>
    message.type === 'assistant' ||
    message.type === 'tool_use' ||
    message.type === 'tool_result' ||
    message.type === 'error',
  )
}

function getNextUserMessageId(
  userMessages: RewindMessage[],
  userMessageIndex: number,
): string | null {
  return userMessages[userMessageIndex + 1]?.id ?? null
}

async function buildTurnCodePreview(
  data: RewindSessionData,
  targetUserMessageSeq: number,
  nextSnapshot: FileHistorySnapshot | null,
): Promise<SnapshotTurnCodePreview> {
  const { snapshots, cwd } = data
  const targetSnapshot = findTargetSnapshot(snapshots, targetUserMessageSeq)
  if (targetSnapshot === null) {
    return {
      preview: {
        available: false,
        reason: 'No file checkpoint is available for the selected message.',
        filesChanged: [],
        insertions: 0,
        deletions: 0,
      },
      coveredPathIdentities: new Set(),
      restorablePathIdentities: new Set(),
      restoreAvailable: true,
    }
  }

  const trackedPaths = Object.keys(targetSnapshot.trackedFileBackups)
  const coveredPathIdentities = new Set<string>()
  const restorablePathIdentities = new Set<string>()
  const processedPathIdentities = new Set<string>()
  const backupByIdentity = new Map<string, string | null>()
  const statsByIdentity = new Map<string, FileChangeStats>()
  const filesChanged: string[] = []
  let insertions = 0
  let deletions = 0
  let restoreAvailable = true

  for (const trackingPath of trackedPaths) {
    const identityPath = expandTrackingPath(trackingPath, cwd)
    const targetBackupFileName = targetSnapshot.trackedFileBackups[trackingPath]
      ?.backupFileName
    if (targetBackupFileName === undefined) {
      restoreAvailable = false
      continue
    }
    if (backupByIdentity.has(identityPath)) {
      if (backupByIdentity.get(identityPath) !== targetBackupFileName) {
        restoreAvailable = false
      }
      continue
    }
    backupByIdentity.set(identityPath, targetBackupFileName)
    if (processedPathIdentities.has(identityPath)) continue
    processedPathIdentities.add(identityPath)

    const absolutePath = expandTrackingPath(trackingPath, cwd)
    const beforeContent = await readBackupContent(data.readBackup, targetBackupFileName)
    const restorePointAvailable = targetBackupFileName === null ||
      (typeof targetBackupFileName === 'string' && beforeContent !== null)

    // The turn boundary: the next snapshot's backup (or the live file) holds
    // the state AFTER this turn, i.e. the state the rewind reverts.
    let afterContent: string | null
    let afterBoundaryAvailable: boolean
    if (nextSnapshot === null) {
      afterContent = await readFileOrNull(absolutePath)
      afterBoundaryAvailable = true
    } else {
      const identityPathMatch = Object.entries(nextSnapshot.trackedFileBackups)
        .filter(([nextTrackingPath]) =>
          expandTrackingPath(nextTrackingPath, cwd) === identityPath
        )
        .map(([, backup]) => backup.backupFileName)
      const distinctNextBackups = new Set(identityPathMatch)
      const nextBackupFileName = distinctNextBackups.size === 1
        ? identityPathMatch[0]
        : undefined
      const nextContent = await readBackupContent(data.readBackup, nextBackupFileName)
      afterBoundaryAvailable = distinctNextBackups.size === 1 && nextContent !== undefined
      afterContent = afterBoundaryAvailable ? nextContent ?? null : beforeContent ?? null
    }
    const safeTrackedPath = await isSafeTrackedPath(cwd, trackingPath)
    if (restorePointAvailable && safeTrackedPath) {
      restorablePathIdentities.add(identityPath)
    }
    if (afterBoundaryAvailable) coveredPathIdentities.add(identityPath)
    if (beforeContent === afterContent) continue

    filesChanged.push(absolutePath)
    if (!restorePointAvailable || !safeTrackedPath) {
      restoreAvailable = false
    }
    const stats = countTurnDiffStats(beforeContent ?? null, afterContent ?? null)
    statsByIdentity.set(identityPath, stats)
    insertions += stats.insertions
    deletions += stats.deletions
  }

  return {
    preview: normalizeDiffStats({
      filesChanged,
      insertions,
      deletions,
      fileStats: statsByIdentity,
    }),
    coveredPathIdentities,
    restorablePathIdentities,
    restoreAvailable,
  }
}

function countTurnDiffStats(
  beforeContent: string | null,
  afterContent: string | null,
): { insertions: number; deletions: number } {
  let insertions = 0
  let deletions = 0
  for (const change of diffLines(beforeContent ?? '', afterContent ?? '')) {
    if (change.added) insertions += change.count || 0
    if (change.removed) deletions += change.count || 0
  }
  return { insertions, deletions }
}

function mergeRewindCodePreview(
  rewindPreview: RewindCodePreview,
  turnPreview: RewindCodePreview,
): RewindCodePreview {
  if (!rewindPreview.available) return turnPreview
  if (!turnPreview.available) return rewindPreview

  const knownPathIdentities = new Set(rewindPreview.filesChanged)
  const missingPaths = turnPreview.filesChanged.filter(filePath =>
    !knownPathIdentities.has(filePath)
  )
  if (missingPaths.length === 0) return rewindPreview

  const turnFileStats: Map<string, FileChangeStats> =
    (turnPreview as RewindCodePreviewWithStats)[fileChangeStats] ?? new Map()
  let missingInsertions = 0
  let missingDeletions = 0
  for (const filePath of missingPaths) {
    const stats = turnFileStats.get(filePath)
    missingInsertions += stats?.insertions ?? 0
    missingDeletions += stats?.deletions ?? 0
  }

  return normalizeDiffStats({
    filesChanged: [...rewindPreview.filesChanged, ...missingPaths],
    insertions: rewindPreview.insertions + missingInsertions,
    deletions: rewindPreview.deletions + missingDeletions,
  })
}

async function buildTurnCheckpointState(
  data: RewindSessionData,
  target: RewindTarget,
): Promise<SessionTurnCheckpointPreview> {
  const userMessages = data.messages.filter(message => message.type === 'user')
  const targetSnapshot = findTargetSnapshot(data.snapshots, target.targetUserMessageSeq)
  const nextUserMessageId = getNextUserMessageId(userMessages, target.userMessageIndex)
  const nextSnapshot = nextUserMessageId !== null
    ? findTargetSnapshot(data.snapshots, Number(nextUserMessageId))
    : null
  const snapshotPreview = targetSnapshot
    ? await buildTurnCodePreview(data, target.targetUserMessageSeq, nextSnapshot)
    : null
  const transcriptEvidence = collectTranscriptTurnFileChanges(
    data.messages,
    String(target.targetUserMessageSeq),
    data.cwd,
  )
  const { preview, restoreAvailable, unverifiedChangeSources } = mergeTurnCodePreviews(
    snapshotPreview,
    transcriptEvidence,
  )

  return buildTurnPreview(
    target,
    preview,
    data.cwd,
    restoreAvailable,
    unverifiedChangeSources,
  )
}

async function buildRewindTurnCheckpointState(
  data: RewindSessionData,
  target: RewindTarget,
): Promise<SessionTurnCheckpointPreview> {
  const userMessages = data.messages.filter(message => message.type === 'user')
  const checkpoints: SessionTurnCheckpointPreview[] = []

  for (let userMessageIndex = target.userMessageIndex;
    userMessageIndex < userMessages.length;
    userMessageIndex += 1) {
    const userMessage = userMessages[userMessageIndex]
    if (!userMessage) continue
    checkpoints.push(await buildTurnCheckpointState(
      data,
      {
        targetUserMessageSeq: Number(userMessage.id),
        userMessageIndex,
        userMessageCount: userMessages.length,
        messagesRemoved: target.messagesRemoved,
      },
    ))
  }

  const [firstCheckpoint, ...laterCheckpoints] = checkpoints
  if (!firstCheckpoint) {
    return await buildTurnCheckpointState(data, target)
  }
  return {
    ...firstCheckpoint,
    code: laterCheckpoints.reduce(
      (preview, checkpoint) => mergeRewindCodePreview(preview, checkpoint.code),
      firstCheckpoint.code,
    ),
    restoreAvailable: checkpoints.every(checkpoint => checkpoint.restoreAvailable),
    unverifiedChangeSources: normalizeUnverifiedChangeSources(
      checkpoints.flatMap(checkpoint => checkpoint.unverifiedChangeSources),
    ),
  }
}

// --- public operations ---

function buildPreview(
  target: RewindTarget,
  codePreview: RewindCodePreview,
  turnCheckpoint: SessionTurnCheckpointPreview,
): SessionRewindPreview {
  return {
    target: {
      targetUserMessageId: String(target.targetUserMessageSeq),
      userMessageIndex: target.userMessageIndex,
      userMessageCount: target.userMessageCount,
    },
    conversation: {
      messagesRemoved: target.messagesRemoved,
    },
    code: mergeRewindCodePreview(codePreview, turnCheckpoint.code),
    restoreAvailable: turnCheckpoint.restoreAvailable,
    unverifiedChangeSources: turnCheckpoint.unverifiedChangeSources,
  }
}

/** Preview a rewind without changing anything. */
export async function previewSessionRewind(
  data: RewindSessionData,
  selector: RewindTargetSelector,
): Promise<SessionRewindPreview> {
  const target = resolveRewindTarget(data.messages, selector)
  const codePreview = await buildCodePreview(data, target.targetUserMessageSeq)
  const turnCheckpoint = await buildRewindTurnCheckpointState(data, target)

  return {
    ...buildPreview(target, codePreview.preview, turnCheckpoint),
    restoreAvailable: codePreview.restoreAvailable && turnCheckpoint.restoreAvailable,
  }
}

/** List the per-turn checkpoints with completed work. */
export async function listSessionTurnCheckpoints(
  data: RewindSessionData,
): Promise<SessionTurnCheckpointPreview[]> {
  const userMessages = data.messages.filter(message => message.type === 'user')
  if (userMessages.length === 0) {
    return []
  }

  const checkpoints: SessionTurnCheckpointPreview[] = []
  for (const [userMessageIndex, userMessage] of userMessages.entries()) {
    const activeMessageIndex = data.messages.findIndex(message => message.id === userMessage.id)
    if (activeMessageIndex < 0) continue
    if (!hasCompletedTurn(data.messages, userMessage.id)) continue

    const target: RewindTarget = {
      targetUserMessageSeq: Number(userMessage.id),
      userMessageIndex,
      userMessageCount: userMessages.length,
      messagesRemoved: data.messages.length - activeMessageIndex,
    }
    const checkpoint = await buildTurnCheckpointState(data, target)
    checkpoints.push(checkpoint)
  }

  return checkpoints
}

/** The per-file diff of one turn checkpoint. */
export async function getSessionTurnCheckpointDiff(
  data: RewindSessionData,
  selector: RewindTargetSelector,
  requestedPath: string,
): Promise<SessionTurnCheckpointDiffResult> {
  const target = resolveRewindTarget(data.messages, selector)
  const missingResult: SessionTurnCheckpointDiffResult = {
    target: buildTurnPreview(
      target,
      {
        available: false,
        filesChanged: [],
        insertions: 0,
        deletions: 0,
      },
      data.cwd,
    ).target,
    workDir: data.cwd,
    path: normalizeComparablePath(requestedPath),
    state: 'missing',
  }

  const userMessages = data.messages.filter(message => message.type === 'user')
  const targetSnapshot = findTargetSnapshot(data.snapshots, target.targetUserMessageSeq)
  const nextUserMessageId = getNextUserMessageId(userMessages, target.userMessageIndex)
  const nextSnapshot = nextUserMessageId !== null
    ? findTargetSnapshot(data.snapshots, Number(nextUserMessageId))
    : null

  if (targetSnapshot !== null) {
    const inspectedPathIdentities = new Set<string>()
    for (const trackingPath of Object.keys(targetSnapshot.trackedFileBackups)) {
      const identityPath = expandTrackingPath(trackingPath, data.cwd)
      if (inspectedPathIdentities.has(identityPath)) continue
      inspectedPathIdentities.add(identityPath)
      if (!matchesCheckpointPath(requestedPath, trackingPath, data.cwd)) {
        continue
      }

      const displayPath = toCheckpointResponsePath(trackingPath, data.cwd)

      try {
        const beforeContent = await readBackupContent(
          data.readBackup,
          targetSnapshot.trackedFileBackups[trackingPath]?.backupFileName,
        )
        let afterContent: string | null
        let afterBoundaryAvailable: boolean
        if (nextSnapshot === null) {
          afterContent = await readFileOrNull(identityPath)
          afterBoundaryAvailable = true
        } else {
          const matchingNextBackups = Object.entries(nextSnapshot.trackedFileBackups)
            .filter(([nextTrackingPath]) =>
              expandTrackingPath(nextTrackingPath, data.cwd) === identityPath
            )
            .map(([, backup]) => backup.backupFileName)
          const distinctNextBackups = new Set(matchingNextBackups)
          const nextBackupFileName = distinctNextBackups.size === 1
            ? matchingNextBackups[0]
            : undefined
          const nextContent = await readBackupContent(data.readBackup, nextBackupFileName)
          afterBoundaryAvailable = distinctNextBackups.size === 1 && nextContent !== undefined
          afterContent = afterBoundaryAvailable ? nextContent ?? null : beforeContent ?? null
        }

        if (!afterBoundaryAvailable) {
          return {
            ...missingResult,
            path: displayPath,
          }
        }
        if (beforeContent === afterContent) {
          return {
            ...missingResult,
            path: displayPath,
          }
        }

        return {
          target: missingResult.target,
          workDir: data.cwd,
          path: displayPath,
          state: 'ok',
          diff: buildCheckpointDiff(
            displayPath,
            beforeContent ?? '',
            afterContent ?? '',
            beforeContent !== null,
            afterContent !== null,
          ),
        }
      } catch (error) {
        return {
          target: missingResult.target,
          workDir: data.cwd,
          path: displayPath,
          state: 'error',
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }
  }

  return missingResult
}

function toCheckpointResponsePath(
  trackingPath: string,
  checkpointBaseDir: string,
): string {
  if (isAbsolute(trackingPath)) {
    return trackingPath
  }

  const absolutePath = expandTrackingPath(trackingPath, checkpointBaseDir)
  const relativePath = normalizeComparablePath(relative(checkpointBaseDir, absolutePath))
  return relativePath && !relativePath.startsWith('../')
    ? relativePath
    : normalizeComparablePath(trackingPath)
}

function matchesCheckpointPath(
  requestedPath: string,
  trackingPath: string,
  checkpointBaseDir: string,
): boolean {
  const normalizedRequestedPath = normalizeComparablePath(requestedPath)
  const absolutePath = normalizeComparablePath(
    expandTrackingPath(trackingPath, checkpointBaseDir),
  )
  const responsePath = normalizeComparablePath(
    toCheckpointResponsePath(trackingPath, checkpointBaseDir),
  )

  return normalizedRequestedPath === absolutePath ||
    normalizedRequestedPath === normalizeComparablePath(trackingPath) ||
    normalizedRequestedPath === responsePath
}

/**
 * Execute a rewind: stop the owning agent (the caller supplies the drain),
 * restore files to the target snapshot when `mode === 'both'`, and trim the
 * session log from the target turn onward. The caller performs the durable
 * trim via the persistence service and reports the removed message ids.
 */
export async function executeSessionRewind(
  data: RewindSessionData,
  selector: RewindTargetSelector,
  mode: SessionRewindMode,
  /**
   * Fork the session at the target user message's turn boundary.
   * The implementation resolves the target turn's `turn/start` seq and forks
   * there so the surviving log becomes a new session with a fresh id.
   * @param userMessageSeq - the target `user/message` event seq.
   */
  fork: (userMessageSeq: number) => Promise<{ childSessionId: string }>,
): Promise<SessionRewindExecuteResult> {
  const restoreFiles = mode === 'both'
  const selectedTarget = resolveRewindTarget(data.messages, selector)

  // Re-resolve with the expected content after the runtime drained: a late
  // tool result or snapshot cannot shift the target.
  const target = resolveRewindTarget(data.messages, {
    targetUserMessageId: String(selectedTarget.targetUserMessageSeq),
    ...(selector.expectedContent === undefined
      ? {}
      : { expectedContent: selector.expectedContent }),
  })

  const turnCheckpoint = await buildRewindTurnCheckpointState(data, target)
  if (restoreFiles && !turnCheckpoint.restoreAvailable) {
    throw new RewindError(
      'This turn includes file changes without a complete restorable checkpoint. No messages or files were changed.',
    )
  }
  const codePreview = await buildCodePreview(data, target.targetUserMessageSeq)
  if (restoreFiles && !codePreview.restoreAvailable) {
    throw new RewindError(
      'One or more tracked files cannot be safely restored from this checkpoint. No messages or files were changed.',
    )
  }
  const preview = mergeRewindCodePreview(codePreview.preview, turnCheckpoint.code)

  let appliedRestorePlan: RestorePlanEntry[] = []
  if (restoreFiles && preview.available && data.snapshots.size > 0) {
    const targetSnapshot = findTargetSnapshot(data.snapshots, target.targetUserMessageSeq)
    if (targetSnapshot === null) {
      throw new RewindError('No file checkpoint is available for the selected message.')
    }
    try {
      const trackedPaths = [...collectTrackedPaths(data.snapshots)]
      const targetBackups = new Map<string, string | null>()
      for (const trackingPath of trackedPaths) {
        const backupFileName = getBackupFileNameForTarget(
          trackingPath,
          data.snapshots,
          targetSnapshot,
        )
        if (backupFileName !== undefined) targetBackups.set(trackingPath, backupFileName)
      }
      appliedRestorePlan = await buildRestorePlan(
        data.cwd,
        trackedPaths,
        targetBackups,
        data.readBackup,
      )
    } catch (error) {
      if (error instanceof RewindError) throw error
      throw new RewindError(
        'The checkpoint could not be prepared safely. No messages or files were changed.',
      )
    }
    await applyRestorePlan(data.cwd, appliedRestorePlan)
  }

  let childSessionId: string
  let removedMessageIds: string[]
  try {
    ({ childSessionId } = await fork(target.targetUserMessageSeq))
    // The removed transcript messages are everything from the target message
    // onward; report the direct user messages among them.
    const activeMessageIndex = data.messages.findIndex(
      message => Number(message.id) === target.targetUserMessageSeq,
    )
    const removedMessages = activeMessageIndex >= 0
      ? data.messages.slice(activeMessageIndex)
      : []
    removedMessageIds = removedMessages
      .filter(message => message.type === 'user')
      .map(message => message.id)
  } catch (error) {
    const rollbackErrors = await rollbackRestorePlan(data.cwd, appliedRestorePlan)
    if (rollbackErrors.length > 0) {
      throw new Error(
        `Transcript fork failed and file rollback was incomplete: ${rollbackErrors.join('; ')}`,
        { cause: error },
      )
    }
    throw error
  }

  return {
    ...buildPreview(target, codePreview.preview, turnCheckpoint),
    conversation: {
      messagesRemoved: target.messagesRemoved,
      removedMessageIds,
    },
    childSessionId,
    restoreAvailable: turnCheckpoint.restoreAvailable && codePreview.restoreAvailable,
    mode,
  }
}

/** Load a session's rewind data from its event log and header. */
export function buildRewindSessionData(
  events: readonly SessionEvent[],
  header: SessionHeader,
  snapshots: FileHistorySnapshotMap,
  readBackup: (backupFileName: string) => Promise<{ content: Buffer; mode: number }>,
): RewindSessionData {
  return {
    messages: deriveRewindMessages(events, header),
    cwd: header.cwd ?? process.cwd(),
    snapshots,
    readBackup,
  }
}
