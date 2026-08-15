import { describe, expect, it } from 'vitest'
import type { Session } from '@deepseek-ai/dsh-session'
import { extractTurnMemory } from '../src/auto.ts'

/** Minimal fake session: extractTurnMemory only reads `events`. */
function fakeSession(events: unknown[]): Session {
  return { events } as unknown as Session
}

describe('automatic turn memory capture', () => {
  it('extracts user prompt, assistant reply, and tool names from one turn', () => {
    const session = fakeSession([
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      { type: 'user/message', seq: 1, time: 2, data: { content: '修复登录 bug', role: 'user' } },
      { type: 'tool/call', seq: 2, time: 3, data: { turn: 1, step: 1, callId: 'c1', name: 'edit', arguments: '{}' } },
      { type: 'assistant/message', seq: 3, time: 4, data: { turn: 1, step: 1, message: { content: '已修复', role: 'assistant' } } },
      { type: 'turn/end', seq: 4, time: 5, data: { turn: 1, reason: { kind: 'completed' } } },
    ])

    const memory = extractTurnMemory(session, 1)
    expect(memory.user).toContain('修复登录 bug')
    expect(memory.assistant).toContain('已修复')
    expect(memory.tools).toEqual(['edit'])
  })

  it('ignores events outside the requested turn', () => {
    const session = fakeSession([
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      { type: 'user/message', seq: 1, time: 2, data: { content: '第一回合', role: 'user' } },
      { type: 'turn/end', seq: 2, time: 3, data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'turn/start', seq: 3, time: 4, data: { turn: 2 } },
      { type: 'user/message', seq: 4, time: 5, data: { content: '第二回合', role: 'user' } },
      { type: 'turn/end', seq: 5, time: 6, data: { turn: 2, reason: { kind: 'completed' } } },
    ])

    const memory = extractTurnMemory(session, 1)
    expect(memory.user).toContain('第一回合')
    expect(memory.user).not.toContain('第二回合')
  })
})
