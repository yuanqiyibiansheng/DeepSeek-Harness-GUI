/**
 * Automatic Memorix memory capture for DeepSeek Harness sessions.
 *
 * The host half listens to the session event firehose, writes one project
 * memory observation per completed turn, and caches a short recent-memory
 * summary that the system-prompt section provider injects into new turns.
 */

import { execFile, type ExecFileException } from 'node:child_process'
import type { Session } from '@deepseek-ai/dsh-session'
import { bundledMemorixCommand } from './patch.ts'

/** Run one Memorix CLI command in the given project directory. */
function runMemorix(cwd: string, args: string[]): Promise<string> {
  const bundled = bundledMemorixCommand()
  if (bundled === undefined) return Promise.resolve('')
  const cli = bundled.args[0]
  if (cli === undefined) return Promise.resolve('')
  return new Promise((resolve) => {
    execFile(
      bundled.command,
      [cli, ...args],
      { cwd, timeout: 20_000, maxBuffer: 8 * 1024 * 1024 },
      (error: ExecFileException | null, stdout: string) => {
        if (error) {
          process.stderr.write(`project-memory: memorix ${args.join(' ')} failed: ${String(error)}\n`)
          resolve('')
          return
        }
        resolve(stdout)
      },
    )
  })
}

/** Extract readable text from a user/assistant message content value. */
function textOf(value: unknown, limit: number): string {
  if (typeof value === 'string') return value.slice(0, limit)
  if (!Array.isArray(value)) return ''
  const parts: string[] = []
  for (const block of value) {
    const record = block as { type?: string; text?: string; content?: unknown }
    if (typeof record.text === 'string') parts.push(record.text)
    else if (typeof record.content === 'string') parts.push(record.content)
  }
  return parts.join(' ').slice(0, limit)
}

/** One turn's captured memory content. */
export interface TurnMemory {
  user: string
  assistant: string
  tools: string[]
}

/**
 * Extract the user prompt, assistant output, and tool names from one turn.
 * @param session - the live session log.
 * @param turn - the turn number to capture.
 * @returns the captured turn text.
 */
export function extractTurnMemory(session: Session, turn: number): TurnMemory {
  const user: string[] = []
  const assistant: string[] = []
  const tools = new Set<string>()
  let inTurn = false
  for (const event of session.events) {
    if (event.type === 'turn/start' && event.data.turn === turn) inTurn = true
    else if (event.type === 'turn/end' && event.data.turn === turn) break
    if (!inTurn) continue
    if (event.type === 'user/message') {
      const text = textOf((event.data as { content?: unknown }).content, 600)
      if (text) user.push(text)
    } else if (event.type === 'assistant/message') {
      const message = (event.data as { message?: { content?: unknown } }).message
      const text = textOf(message?.content, 1200)
      if (text) assistant.push(text)
    } else if (event.type === 'tool/call') {
      tools.add((event.data as { name: string }).name)
    }
  }
  return {
    user: user.join('\n').slice(0, 600),
    assistant: assistant.join('\n').slice(0, 1200),
    tools: [...tools],
  }
}

/**
 * Write one completed turn into the project memory store.
 * @param session - the live session whose turn ended.
 * @param turn - the completed turn number.
 */
export async function storeTurnMemory(session: Session, turn: number): Promise<void> {
  const cwd = session.header.cwd
  if (!cwd) return
  const memory = extractTurnMemory(session, turn)
  if (!memory.user && !memory.assistant) return
  const title = `会话 ${session.id} 第 ${turn} 回合`
  const text = [
    `会话 ${session.id} 第 ${turn} 回合`,
    `时间：${new Date().toISOString()}`,
    `用户：${memory.user || '(无文本)'}`,
    `助手：${memory.assistant || '(无文本)'}`,
    memory.tools.length > 0 ? `使用工具：${memory.tools.join(', ')}` : '',
  ].filter(Boolean).join('\n')
  await runMemorix(cwd, ['memory', 'store', '--visibility', 'project', '--title', title, '--text', text])
}

/**
 * Load a compact recent-memory summary for system-prompt injection.
 * @param cwd - the project directory Memorix should resolve.
 * @returns the summary text, or an empty string when unavailable.
 */
export async function loadMemorySummary(cwd: string): Promise<string> {
  if (!cwd) return ''
  const output = await runMemorix(cwd, ['memory', 'recent', '--limit', '5', '--json'])
  if (!output) return ''
  try {
    const parsed = JSON.parse(output) as { observations?: { title?: string; narrative?: string }[] }
    const lines: string[] = []
    for (const item of parsed.observations ?? []) {
      const title = item.title?.trim()
      const narrative = item.narrative?.trim()
      if (title) lines.push(`- ${title}${narrative ? `：${narrative.slice(0, 400)}` : ''}`)
    }
    return lines.length > 0 ? lines.join('\n') : ''
  } catch {
    return ''
  }
}
