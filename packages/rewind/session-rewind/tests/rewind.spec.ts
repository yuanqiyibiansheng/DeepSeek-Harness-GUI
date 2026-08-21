import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import { MessageId } from '@deepseek-ai/dsh-llm'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { foldFileHistorySnapshots, createBackup } from '@deepseek-ai/dsh-file-history'
import {
  deriveRewindMessages,
  previewSessionRewind,
  executeSessionRewind,
  listSessionTurnCheckpoints,
  recordedCommandIsReadOnly,
  turnStartSeqBefore,
  buildRewindSessionData,
} from '../src/index.ts'
import type { RewindSessionData } from '../src/rewind.ts'

function userMessage(text: string, id = `m-${Math.random().toString(36).slice(2, 8)}`) {
  return {
    id: MessageId(id),
    role: 'user' as const,
    content: [{ type: 'text' as const, text }],
    source: { kind: 'user' as const },
  }
}

function assistantMessage(text: string, id = `a-${Math.random().toString(36).slice(2, 8)}`) {
  return {
    id: MessageId(id),
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text }],
    source: { kind: 'model' as const, provider: 'test', model: 'test' },
  }
}

/**
 * A session with two complete turns.
 * Event seqs: 0 turn/start(1), 1 user(first), 2 assistant, 3 turn/end(1),
 * 4 turn/start(2), 5 user(second), 6 assistant, 7 turn/end(2).
 */
function twoTurnSession(cwd: string): Session {
  const session = Session.create(SessionId('rewind-session'), undefined, {
    version: 0,
    id: SessionId('rewind-session'),
    createdAt: 1_700_000_000_000,
    cwd,
  })
  session.append('turn/start', { turn: 1 })
  session.append('user/message', userMessage('first question'), { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn: 1, step: 1, message: assistantMessage('first answer'),
  }, { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  session.append('turn/start', { turn: 2 })
  session.append('user/message', userMessage('second question'), { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn: 2, step: 1, message: assistantMessage('second answer'),
  }, { surfaceOp: 'append' })
  session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
  return session
}

/** A session whose second turn snapshots one tracked file's pre-turn state. */
async function sessionWithSnapshot(
  dir: string,
  workdir: string,
): Promise<{ session: Session; target: string; data: RewindSessionData }> {
  const target = join(workdir, 'note.txt')
  await writeFile(target, 'before turn 2', 'utf-8')
  const session = twoTurnSession(workdir)
  const backup = await createBackup(dir, String(session.id), target, 1, workdir)
  session.append('file/history-snapshot', {
    userMessageSeq: 5,
    trackedFileBackups: { 'note.txt': backup },
    isSnapshotUpdate: false,
  })
  await writeFile(target, 'after turn 2', 'utf-8')
  const data = buildRewindSessionData(
    session.events,
    session.header,
    foldFileHistorySnapshots(session.events),
    fileName => readBackupFile(dir, String(session.id), fileName),
  )
  return { session, target, data }
}

async function withTempDir(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-rewind-'))
  try {
    await body(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('dsh-session-rewind read model', () => {
  it('derives transcript-like messages from the event log', () => {
    const session = twoTurnSession('/work')
    const messages = deriveRewindMessages(session.events, session.header)
    expect(messages.map(message => message.type)).toEqual([
      'user', 'assistant',
      'user', 'assistant',
    ])
    expect(messages[0]?.id).toBe('1')
    expect(extractText(messages[0]?.content)).toBe('first question')
  })

  it('finds the turn-start seq before a user message', () => {
    const session = twoTurnSession('/work')
    expect(turnStartSeqBefore(session.events, 1)).toBe(0)
    expect(turnStartSeqBefore(session.events, 5)).toBe(4)
  })
})

describe('dsh-session-rewind preview', () => {
  it('previews a conversation-only rewind to the first user message', async () => {
    await withTempDir(async dir => {
      const workdir = join(dir, 'work')
      await mkdir(workdir)
      const session = twoTurnSession(workdir)
      const data = buildRewindSessionData(
        session.events,
        session.header,
        foldFileHistorySnapshots(session.events),
        () => Promise.reject(new Error('no backups')),
      )
      const preview = await previewSessionRewind(data, { userMessageIndex: 0 })
      expect(preview.target.userMessageCount).toBe(2)
      expect(preview.conversation.messagesRemoved).toBe(4)
      expect(preview.code.available).toBe(false)
      expect(preview.restoreAvailable).toBe(true)
    })
  })

  it('reports the changed files of a rewind with a snapshot', async () => {
    await withTempDir(async dir => {
      const workdir = join(dir, 'work')
      await mkdir(workdir)
      const { data, target } = await sessionWithSnapshot(dir, workdir)
      const preview = await previewSessionRewind(data, { userMessageIndex: 1 })
      expect(preview.code.available).toBe(true)
      expect(preview.code.filesChanged).toContain(target)
      expect(preview.code.deletions).toBe(1)
      expect(preview.code.insertions).toBe(1)
      expect(preview.restoreAvailable).toBe(true)
    })
  })
})

describe('dsh-session-rewind execute', () => {
  it('forks the surviving prefix into a new session id and restores files in both mode', async () => {
    await withTempDir(async dir => {
      const workdir = join(dir, 'work')
      await mkdir(workdir)
      const { data, target } = await sessionWithSnapshot(dir, workdir)
      const forked: number[] = []
      const result = await executeSessionRewind(
        data,
        { userMessageIndex: 1 },
        'both',
        async userMessageSeq => {
          forked.push(userMessageSeq)
          return { childSessionId: `session-${String(userMessageSeq)}` }
        },
      )
      // The file was restored to its pre-turn-2 content.
      expect(await readFileText(target)).toBe('before turn 2')
      expect(forked).toEqual([5])
      expect(result.conversation.removedMessageIds).toEqual(['5'])
      expect(result.childSessionId).toBe('session-5')
      expect(result.mode).toBe('both')
    })
  })

  it('keeps the files untouched in conversation mode and still forks a new session', async () => {
    await withTempDir(async dir => {
      const workdir = join(dir, 'work')
      await mkdir(workdir)
      const { data, target } = await sessionWithSnapshot(dir, workdir)
      const result = await executeSessionRewind(
        data,
        { userMessageIndex: 1 },
        'conversation',
        async userMessageSeq => ({ childSessionId: `session-${String(userMessageSeq)}` }),
      )
      expect(await readFileText(target)).toBe('after turn 2')
      expect(result.childSessionId).toBe('session-5')
    })
  })
})

describe('dsh-session-rewind checkpoints', () => {
  it('lists every completed turn even without recorded file changes', async () => {
    await withTempDir(async dir => {
      const workdir = join(dir, 'work')
      await mkdir(workdir)
      const session = twoTurnSession(workdir)
      const data = buildRewindSessionData(
        session.events,
        session.header,
        foldFileHistorySnapshots(session.events),
        () => Promise.reject(new Error('no backups')),
      )
      const checkpoints = await listSessionTurnCheckpoints(data)
      expect(checkpoints.length).toBe(2)
      expect(checkpoints.every(checkpoint => checkpoint.code.filesChanged.length === 0)).toBe(true)
    })
  })

  it('lists the completed turn with a file checkpoint', async () => {
    await withTempDir(async dir => {
      const workdir = join(dir, 'work')
      await mkdir(workdir)
      const { data } = await sessionWithSnapshot(dir, workdir)
      const checkpoints = await listSessionTurnCheckpoints(data)
      expect(checkpoints.length).toBe(2)
      const snapshotCheckpoint = checkpoints.find(checkpoint => checkpoint.target.userMessageIndex === 1)
      expect(snapshotCheckpoint?.code.filesChanged.length).toBe(1)
    })
  })
})

describe('dsh-session-rewind read-only classification', () => {
  it('classifies safe and unsafe shell commands', () => {
    expect(recordedCommandIsReadOnly('ls -la')).toBe(true)
    expect(recordedCommandIsReadOnly('git status')).toBe(true)
    expect(recordedCommandIsReadOnly('git status && git diff')).toBe(true)
    expect(recordedCommandIsReadOnly('git checkout main')).toBe(false)
    expect(recordedCommandIsReadOnly('echo hi > file.txt')).toBe(false)
    expect(recordedCommandIsReadOnly('sed -i s/a/b/ file')).toBe(false)
    expect(recordedCommandIsReadOnly('rm file')).toBe(false)
  })
})

describe('dsh-session-rewind persistence trim', () => {
  it('trims the stored log at the target turn boundary', async () => {
    await withTempDir(async dir => {
      const workdir = join(dir, 'work')
      await mkdir(workdir)
      const ctx = new Context()
      const fibers: Array<{ dispose(): Promise<void> }> = []
      fibers.push(await ctx.plugin(SessionStore))
      fibers.push(await ctx.plugin(JsonlSessionPersistence, {
        root: join(dir, 'logs'),
        packChunks: false,
        compression: 'none',
      }))
      const session = ctx.sessions.create(SessionId('s1'), { meta: { cwd: workdir } })
      session.append('turn/start', { turn: 1 })
      session.append('user/message', userMessage('first'), { surfaceOp: 'append' })
      session.append('assistant/message', { turn: 1, step: 1, message: assistantMessage('answer 1') }, { surfaceOp: 'append' })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      session.append('turn/start', { turn: 2 })
      session.append('user/message', userMessage('second'), { surfaceOp: 'append' })
      session.append('assistant/message', { turn: 2, step: 1, message: assistantMessage('answer 2') }, { surfaceOp: 'append' })
      session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
      await ctx.sessions.flush(session)
      const before = await ctx.sessionPersistence.readFrom(SessionId('s1'), 0)
      expect(before.events.length).toBe(8)

      // Trim from turn 2's turn/start (seq 4). The live session stays in the
      // store here only because the test never appends again; the production
      // contract discards the in-memory session (service restart) after trim.
      const removed = await ctx.sessionPersistence.trim(SessionId('s1'), 4)
      expect(removed.removedCount).toBe(4)

      const after = await ctx.sessionPersistence.readFrom(SessionId('s1'), 0)
      expect(after.events.map(event => event.type)).toEqual([
        'turn/start', 'user/message', 'assistant/message', 'turn/end',
      ])
      expect(after.events.map(event => event.seq)).toEqual([0, 1, 2, 3])
      for (const fiber of fibers.reverse()) await fiber.dispose()
    })
  })
})

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => (block as { type?: string })?.type === 'text')
    .map(block => (block as { text?: string })?.text ?? '')
    .join('\n')
}

async function readBackupFile(
  dshHome: string,
  sessionId: string,
  fileName: string,
): Promise<{ content: Buffer; mode: number }> {
  const path = join(dshHome, 'file-history', sessionId, fileName)
  const [content, fileStats] = await Promise.all([readFile(path), stat(path)])
  return { content, mode: fileStats.mode }
}

async function readFileText(path: string): Promise<string> {
  return readFile(path, 'utf-8')
}
