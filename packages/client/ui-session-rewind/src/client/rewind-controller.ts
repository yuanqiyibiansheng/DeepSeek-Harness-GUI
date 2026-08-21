/**
 * Per-session object layer over the sessionRewind Remote: one controller
 * backs every turn card of a Session, so a single `listTurnCheckpoints` read
 * seeds the whole transcript and each card addresses its own turn.
 */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  RewindTargetSelector,
  SessionRewindExecuteResult,
  SessionRewindMode,
  SessionTurnCheckpointPreview,
} from '@deepseek-ai/dsh-session-rewind/types'

/** The two Remote calls this controller needs. */
export interface SessionRewindRemote {
  execute: (
    sessionId: string,
    selector: RewindTargetSelector,
    mode?: SessionRewindMode,
  ) => Promise<RemoteResult<SessionRewindExecuteResult>>
  listTurnCheckpoints: (sessionId: string) => Promise<RemoteResult<SessionTurnCheckpointPreview[]>>
}

/** Load state of the one checkpoint list read that seeds every turn card. */
export type RewindStatus = 'cold' | 'loading' | 'ready' | 'error'

/** Immutable view published to every turn card of one Session. */
export interface RewindView {
  status: RewindStatus
  /** Checkpoint per target user message id (`String(seq)`). */
  byTarget: ReadonlyMap<string, SessionTurnCheckpointPreview>
  /** Reason the last load failed, cleared by the next successful load. */
  error: string | null
}

const EMPTY_BY_TARGET: ReadonlyMap<string, SessionTurnCheckpointPreview> = new Map()

const INITIAL_VIEW: RewindView = Object.freeze({
  status: 'cold',
  byTarget: EMPTY_BY_TARGET,
  error: null,
})

/** Human-readable text for one business failure code. */
function describe(code: string): string {
  switch (code) {
    case 'session-not-found': return 'this session is no longer persisted'
    case 'target-not-found': return 'this message has no rewind checkpoint'
    default: return code
  }
}

/**
 * Per-session rewind controller. One instance backs every turn card in that
 * Session; the checkpoint list is read once and every mutation goes through
 * the same Remote namespace.
 */
export class RewindController implements HostObservable<RewindView> {
  private view = INITIAL_VIEW
  private readonly listeners = new Set<() => void>()
  private loadPromise: Promise<void> | null = null
  private disposed = false
  private lastLoadedCompletedTurnCount: number | null = null

  /**
   * @param remote - the sessionRewind Remote namespace.
   * @param sessionId - Session owning every addressed turn checkpoint.
   */
  constructor(
    private readonly remote: SessionRewindRemote,
    private readonly sessionId: SessionId,
  ) {}

  /**
   * Load the Session's checkpoint list, refetching whenever the completed-turn
   * count moves (a newly completed turn may have produced a checkpoint since
   * the last read).
   * @param completedTurnCount - turns with a turn/end currently published by
   * the snapshot; grows only when a turn completes.
   */
  ensure(completedTurnCount: number): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.view.status === 'loading') return this.loadPromise ?? Promise.resolve()
    if (this.lastLoadedCompletedTurnCount === completedTurnCount && this.view.status !== 'cold') {
      return Promise.resolve()
    }
    this.view = { ...this.view, status: 'loading', error: null }
    this.publish()
    this.loadPromise = this.remote.listTurnCheckpoints(String(this.sessionId)).then(result => {
      if (this.disposed) return
      if (result.ok) {
        this.lastLoadedCompletedTurnCount = completedTurnCount
        this.view = {
          status: 'ready',
          byTarget: new Map(result.value.map(checkpoint => [checkpoint.target.targetUserMessageId, checkpoint])),
          error: null,
        }
      } else {
        this.view = {
          status: 'error',
          byTarget: EMPTY_BY_TARGET,
          error: result.error.message || describe(result.error.code),
        }
      }
      this.publish()
    }).catch((reason: unknown) => {
      if (this.disposed) return
      this.view = {
        status: 'error',
        byTarget: EMPTY_BY_TARGET,
        error: reason instanceof Error ? reason.message : String(reason),
      }
      this.publish()
    })
    return this.loadPromise
  }

  /** Drop the cached list so the next {@link ensure} refetches. */
  reset(): void {
    this.lastLoadedCompletedTurnCount = null
    if (this.view.status !== 'ready') return
    this.view = INITIAL_VIEW
    this.publish()
  }

  /** Execute a rewind for one target message. */
  execute(
    selector: RewindTargetSelector,
    mode?: SessionRewindMode,
  ): Promise<RemoteResult<SessionRewindExecuteResult>> {
    return this.remote.execute(String(this.sessionId), selector, mode)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot(): RewindView {
    return this.view
  }

  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}
