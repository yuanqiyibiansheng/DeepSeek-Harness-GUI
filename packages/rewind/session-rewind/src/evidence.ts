/**
 * Tool-result evidence collection: which tool calls of a turn settled as
 * errors vs successes, read from `tool_result` content blocks. Ported 1:1
 * from the reference implementation (cc-haha
 * `src/server/services/transcriptToolResults.ts`).
 *
 * @module @deepseek-ai/dsh-session-rewind/evidence
 */

import type { RewindMessage } from './types.ts'

/**
 * Collect the tool-use ids whose `tool_result` entry marked `is_error`.
 * @param messages - transcript-like messages of one turn.
 * @returns the errored tool-use ids.
 */
export function collectErroredToolUseIds(messages: RewindMessage[]): Set<string> {
  const erroredToolUseIds = new Set<string>()

  for (const message of messages) {
    if (message.type !== 'tool_result' || !Array.isArray(message.content)) continue

    for (const block of message.content) {
      if (!block || typeof block !== 'object') continue
      const record = block as Record<string, unknown>
      if (
        record.type === 'tool_result' &&
        record.is_error === true &&
        typeof record.tool_use_id === 'string'
      ) {
        erroredToolUseIds.add(record.tool_use_id)
      }
    }
  }

  return erroredToolUseIds
}

/**
 * Collect the tool-use ids whose `tool_result` entry settled without
 * `is_error` (and whose id is not also present in an errored result).
 * @param messages - transcript-like messages of one turn.
 * @returns the successful tool-use ids.
 */
export function collectSuccessfulToolUseIds(messages: RewindMessage[]): Set<string> {
  const successfulToolUseIds = new Set<string>()
  const erroredToolUseIds = collectErroredToolUseIds(messages)

  for (const message of messages) {
    if (message.type !== 'tool_result' || !Array.isArray(message.content)) continue

    for (const block of message.content) {
      if (!block || typeof block !== 'object') continue
      const record = block as Record<string, unknown>
      if (
        record.type === 'tool_result' &&
        record.is_error !== true &&
        typeof record.tool_use_id === 'string'
      ) {
        successfulToolUseIds.add(record.tool_use_id)
      }
    }
  }

  for (const toolUseId of erroredToolUseIds) {
    successfulToolUseIds.delete(toolUseId)
  }
  return successfulToolUseIds
}
