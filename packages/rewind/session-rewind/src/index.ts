/**
 * Session rewind service: preview and execute conversation+file rollback to
 * any direct user message of a session, over the event-sourced session log
 * and the file-history snapshot fold. The service exposes the four rewind
 * operations as Typert Remotes so the desktop/web client can drive them over
 * the API gateway.
 *
 * Ported in behavior from the reference implementation (cc-haha
 * `src/server/services/sessionRewindService.ts`); the execute flow replaces
 * the reference's transcript-file rewrite with a durable session-log trim.
 *
 * @module @deepseek-ai/dsh-session-rewind
 */

import { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { foldFileHistorySnapshots } from '@deepseek-ai/dsh-file-history'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
// Type-only: resolves ctx.sessionPersistence (declared by dsh-session-persistence).
import type {} from '@deepseek-ai/dsh-session-persistence'
import {
  buildRewindSessionData,
  executeSessionRewind,
  getSessionTurnCheckpointDiff,
  listSessionTurnCheckpoints,
  previewSessionRewind,
  type RewindSessionData,
} from './rewind.ts'
import { turnStartSeqBefore } from './messages.ts'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import type {
  RewindTargetSelector,
  SessionRewindExecuteResult,
  SessionRewindMode,
  SessionRewindPreview,
  SessionTurnCheckpointDiffResult,
  SessionTurnCheckpointPreview,
} from './types.ts'

export type {
  RewindCodePreview,
  RewindMessage,
  RewindTargetSelector,
  SessionRewindExecuteResult,
  SessionRewindMode,
  SessionRewindPreview,
  SessionTurnCheckpointDiffResult,
  SessionTurnCheckpointPreview,
} from './types.ts'
export {
  buildRewindSessionData,
  executeSessionRewind,
  getSessionTurnCheckpointDiff,
  listSessionTurnCheckpoints,
  previewSessionRewind,
} from './rewind.ts'
export { RewindError } from './restore.ts'
export { deriveRewindMessages, turnStartSeqBefore } from './messages.ts'
export { recordedCommandIsReadOnly } from './read-only.ts'
export { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionRewind: SessionRewindService
  }
}

/**
 * Validate a wire rewind mode. Absent means `both` (the reference default);
 * anything else must be one of the two modes.
 * @param value - the wire value.
 * @returns the parsed mode.
 * @throws when the value is neither a mode nor absent.
 */
export function parseSessionRewindMode(value: unknown): SessionRewindMode {
  if (value === undefined || value === null) return 'both'
  if (value === 'both' || value === 'conversation') return value
  throw new Error(`Invalid rewind mode: expected 'both' or 'conversation'.`)
}

/** One loaded session's events and header, plus the context that owns the roster read. */
interface LoadedSession {
  meta: SessionHeader
  events: readonly SessionEvent[]
  ctx: Context
}

interface SessionForker {
  forkFromPrefix(
    source: LoadedSession,
    cut: number,
  ): Promise<{ childSessionId: string }>
}

/**
 * The agent composition a rewind fork inherits.
 *
 * Resolved from the source session's LOG, not its header: a session that
 * switched preset while blank runs later turns under the newer composition,
 * and `resolveSessionPreset` (newest `agent-preset/selected` wins) is exactly
 * the answer every resume/fork path uses. `setup` mounts the preset under the
 * child's scope when a roster is composed; without one it is the identity (the
 * model-facing rows then live in the host composition, so the child sees them
 * through the global layer).
 */
async function composeAgentFromSource(
  source: LoadedSession,
): Promise<{
  agentPreset?: string
  setup: (agentCtx: Context) => Promise<void>
}> {
  const presets = source.ctx.get('agentPresets')
  if (presets === undefined) {
    return { setup: () => Promise.resolve() }
  }
  const presetId = resolveSessionPreset({ header: source.meta, events: source.events })
  return {
    ...presetId === undefined ? {} : { agentPreset: presetId },
    setup: async (agentCtx: Context) => { await presets.mount(agentCtx, presetId) },
  }
}

/**
 * Session rewind service (`ctx.sessionRewind`). All four operations are
 * exposed as Typert Remotes (`sessionRewind/preview`,
 * `sessionRewind/execute`, `sessionRewind/listTurnCheckpoints`,
 * `sessionRewind/getTurnCheckpointDiff`).
 */
export class SessionRewindService extends TypertRemoteService {
  static inject = ['sessions', 'agents', 'sessionPersistence', 'fileHistory']

  private readonly sessionForker: SessionForker = {
    forkFromPrefix: async (source, cut) => {
      const childSessionId = SessionId(`session-${randomUUID()}`)
      // The rewind fork inherits the parent's composition for the same reason
      // the gateway's own `session.fork` does: the seeded history was produced
      // under those tools, and composing anything else would strand every tool
      // call it already carries — leaving the child with no model-facing tools
      // at all once nothing sits in the host plane.
      const composition = await composeAgentFromSource(source)
      await this.ctx.agents.create({
        sessionId: childSessionId,
        seed: source.events.slice(0, cut),
        meta: {
          ...source.meta.cwd === undefined ? {} : { cwd: source.meta.cwd },
          parentSession: source.meta.parentSession ?? source.meta.id,
          seedLength: cut,
          ...composition.agentPreset === undefined
            ? {}
            : { agentPreset: composition.agentPreset },
        },
        setup: composition.setup,
      })
      return { childSessionId }
    },
  }

  constructor(ctx: Context) {
    super(ctx, 'sessionRewind')
  }

  /** Host-provided session-runtime stop verb (structural, no package edge). */
  private get sessionRuntimeStop(): { stopSessionAndWait(sessionId: SessionId): Promise<void> } | undefined {
    // Cordis property access on a Service context requires the name in
    // `static inject`, which would make the host-only service mandatory in
    // headless runs; `ctx.get` is the optional-access seam (undefined when the
    // host gateway did not mount it).
    const ctx = this.ctx as unknown as {
      get(name: 'sessionRuntime'): { stopSessionAndWait(sessionId: SessionId): Promise<void> } | undefined
    }
    return ctx.get('sessionRuntime')
  }

  /** Load one session's rewind data, live-first then persisted. */
  private async loadData(sessionId: SessionId): Promise<{ loaded: LoadedSession; data: RewindSessionData }> {
    const loaded: LoadedSession = await (async () => {
      const live = this.ctx.sessions.get(sessionId)
      if (live !== undefined) return { meta: live.header, events: live.events, ctx: this.ctx }
      const inspection = await this.ctx.sessionPersistence.inspect(sessionId)
      return { meta: inspection.meta, events: inspection.events, ctx: this.ctx }
    })()
    const data = buildRewindSessionData(
      loaded.events,
      loaded.meta,
      foldFileHistorySnapshots(loaded.events),
      backupFileName => this.ctx.fileHistory.readBackup(sessionId, backupFileName),
    )
    return { loaded, data }
  }

  /**
   * Preview a rewind to one user message without changing anything.
   * @param sessionId - the session to rewind.
   * @param selector - the rewind target.
   * @returns what the rewind would remove and restore.
   */
  @Remote('preview')
  async preview(sessionId: string, selector: RewindTargetSelector): Promise<SessionRewindPreview> {
    const { data } = await this.loadData(SessionId(sessionId))
    return previewSessionRewind(data, selector)
  }

  /**
   * List the per-turn checkpoints of a session (turns with completed work and
   * recorded file changes).
   * @param sessionId - the session to list.
   * @returns one checkpoint preview per rewindable turn.
   */
  @Remote('listTurnCheckpoints')
  async listTurnCheckpoints(sessionId: string): Promise<SessionTurnCheckpointPreview[]> {
    const { data } = await this.loadData(SessionId(sessionId))
    return listSessionTurnCheckpoints(data)
  }

  /**
   * The per-file diff of one turn checkpoint.
   * @param sessionId - the session to inspect.
   * @param selector - the rewind target.
   * @param path - the requested file path.
   * @returns the checkpoint diff or a missing/error state.
   */
  @Remote('getTurnCheckpointDiff')
  async getTurnCheckpointDiff(
    sessionId: string,
    selector: RewindTargetSelector,
    path: string,
  ): Promise<SessionTurnCheckpointDiffResult> {
    const { data } = await this.loadData(SessionId(sessionId))
    return getSessionTurnCheckpointDiff(data, selector, path)
  }

  /**
   * Execute a rewind: stop the owning runtime first, restore the target
   * snapshot's files (`both`), and durably trim the session log from the
   * target turn onward. This follows the reference behavior more closely than
   * the previous cancel-in-place path: queued work dies with the session
   * runtime instead of surviving into the next prompt after reopen.
   * @param sessionId - the session to rewind.
   * @param selector - the rewind target.
   * @param mode - `'both'` (default) or `'conversation'`.
   * @returns what the rewind removed and restored.
   */
  @Remote('execute')
  async execute(
    sessionId: string,
    selector: RewindTargetSelector,
    mode?: SessionRewindMode,
  ): Promise<SessionRewindExecuteResult> {
    const parsedMode = parseSessionRewindMode(mode)
    const id = SessionId(sessionId)

    // Reference parity: stop the live runtime before the final completeness
    // check. Rewind correctness depends more on killing queued follow-up work
    // and tearing down the old session world than on keeping the UI live while
    // the trim happens.
    const stop = this.sessionRuntimeStop
    if (stop !== undefined) {
      await stop.stopSessionAndWait(id)
    } else {
      const agent = this.ctx.agents.get(id)
      if (agent !== undefined) {
        agent.inbox.clear()
        agent.cancel({ kind: 'user' })
        await agent.whenIdle()
      }
    }
    const live = this.ctx.sessions.get(id)
    if (live !== undefined) {
      await this.ctx.sessions.flush(live)
    }

    const { loaded, data } = await this.loadData(id)
    const result = await executeSessionRewind(data, selector, parsedMode, async userMessageSeq => {
      const cutoffSeq = turnStartSeqBefore(loaded.events, userMessageSeq) ?? userMessageSeq
      return this.sessionForker.forkFromPrefix(loaded, cutoffSeq)
    })
    return result
  }
}

export default SessionRewindService
