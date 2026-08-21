/** Package-owned durable file-history event invariants. @module @deepseek-ai/dsh-file-history/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-file-history'

/** Cordis companion plugin name. */
export const name = 'file-history-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

function isBackupRecord(value: unknown, fail: InvariantFailure): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('file/history-snapshot trackedFileBackups entries must be objects')
    return
  }
  const { backupFileName, version, backupTime } = value as Record<string, unknown>
  if (backupFileName !== null && typeof backupFileName !== 'string') {
    fail('file/history-snapshot backupFileName must be a string or null')
  }
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    fail('file/history-snapshot version must be a positive safe integer')
  }
  if (typeof backupTime !== 'string' || Number.isNaN(Date.parse(backupTime))) {
    fail('file/history-snapshot backupTime must be a parseable ISO instant')
  }
}

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Validate the package-owned event fields and ignore unrelated events. */
function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'file/history-snapshot') return
  const { userMessageSeq, trackedFileBackups, isSnapshotUpdate } = event.data
  if (typeof userMessageSeq !== 'number' || !Number.isSafeInteger(userMessageSeq) || userMessageSeq < 0) {
    fail('file/history-snapshot userMessageSeq must be a non-negative safe integer')
  }
  if (typeof trackedFileBackups !== 'object' || trackedFileBackups === null || Array.isArray(trackedFileBackups)) {
    fail('file/history-snapshot trackedFileBackups must be a plain record')
    return
  }
  for (const entry of Object.values(trackedFileBackups)) {
    isBackupRecord(entry, fail)
  }
  if (typeof isSnapshotUpdate !== 'boolean') {
    fail('file/history-snapshot isSnapshotUpdate must be a boolean')
  }
}

/** Install validation for loaded and newly appended file-history snapshots. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    for (const event of session.events) validateEvent(event, fail)
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const event = (args as [Session, SessionEvent])[1]
    validateEvent(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register the file-history invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
