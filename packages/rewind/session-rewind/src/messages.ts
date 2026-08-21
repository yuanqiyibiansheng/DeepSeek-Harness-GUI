/**
 * Read model of the rewind domain: project the session event log into the
 * transcript-like message list the ported rewind algorithm operates on. The
 * session log is the single source of truth — a rewound log yields exactly
 * the remaining turns' messages.
 *
 * @module @deepseek-ai/dsh-session-rewind/messages
 */

import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { RewindMessage } from './types.ts'

/**
 * Build the transcript-like message list of one session from its event log.
 *
 * Only direct (user-submitted) `user/message` events become `user` entries —
 * injected context messages are not rewind targets. `tool/call`/`tool/result`
 * events pair by `callId` into `tool_use`/`tool_result` entries; a `turn/end`
 * with an error reason closes with an `error` entry. Every entry carries the
 * session cwd (dsh events do not record per-message cwds).
 * @param events - session events in contiguous seq order.
 * @param header - the session header (for the cwd).
 * @returns the derived message list in log order.
 */
export function deriveRewindMessages(
  events: readonly SessionEvent[],
  header: SessionHeader,
): RewindMessage[] {
  const cwd = header.cwd
  const messages: RewindMessage[] = []
  for (const event of events) {
    switch (event.type) {
      case 'user/message': {
        if ((event.data.source as { kind?: string }).kind !== 'user') continue
        messages.push({
          id: String(event.seq),
          type: 'user',
          content: event.data.content,
          ...cwd === undefined ? {} : { cwd },
        })
        break
      }
      case 'assistant/message': {
        messages.push({
          id: String(event.seq),
          type: 'assistant',
          content: event.data.message.content,
          ...cwd === undefined ? {} : { cwd },
        })
        break
      }
      case 'tool/call': {
        let input: unknown
        try {
          input = JSON.parse(event.data.arguments) as unknown
        } catch {
          input = {}
        }
        messages.push({
          id: String(event.seq),
          type: 'tool_use',
          content: [{
            type: 'tool_use',
            id: event.data.callId,
            name: event.data.name,
            input,
          }],
          ...cwd === undefined ? {} : { cwd },
        })
        break
      }
      case 'tool/result': {
        const block = event.data.message.content[0]
        const toolUseId = block?.toolCallId
        messages.push({
          id: String(event.seq),
          type: 'tool_result',
          content: [{
            type: 'tool_result',
            tool_use_id: toolUseId,
            is_error: event.data.error !== undefined,
            content: event.data.message.content,
          }],
          ...cwd === undefined ? {} : { cwd },
        })
        break
      }
      case 'turn/end': {
        if (event.data.reason.kind === 'error') {
          messages.push({
            id: String(event.seq),
            type: 'error',
            content: event.data.reason.error.message,
            ...cwd === undefined ? {} : { cwd },
          })
        }
        break
      }
      default:
        break
    }
  }
  return messages
}

/**
 * The seq of the `turn/start` event that opens the turn containing the user
 * message at `userMessageSeq` — the trim cutoff that leaves the log balanced
 * (ending on a completed turn) after removing the target turn onward.
 * @param events - session events in contiguous seq order.
 * @param userMessageSeq - the target `user/message` event seq.
 * @returns the turn-start seq, or undefined when none precedes the message.
 */
export function turnStartSeqBefore(
  events: readonly SessionEvent[],
  userMessageSeq: number,
): number | undefined {
  for (let index = userMessageSeq - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'turn/start') return event.seq
  }
  return undefined
}
