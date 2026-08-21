import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { CallId, MessageId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import FileHistory, {
  foldFileHistorySnapshots,
  collectTrackedPaths,
  readBackupFileSafely,
} from '../src/index.ts'

const testSignal = new AbortController().signal

/** A parent Agent backed by a real Session — the hooks read `agent.session`. */
function agentWithSession(session: Session): Agent & { session: Session } {
  return { id: session.id, session } as unknown as Agent & { session: Session }
}

/** One direct user message on the surface. */
function userMessage(text: string) {
  return {
    id: MessageId(`m-${text.length}-${Math.random().toString(36).slice(2)}`),
    role: 'user' as const,
    content: [{ type: 'text' as const, text }],
    source: { kind: 'user' as const },
  }
}

/** Mount the real services on a fresh context with a temp backup root. */
async function setup(root: string): Promise<{ ctx: Context; dispose: () => Promise<void> }> {
  const ctx = new Context()
  const fibers: Array<{ dispose(): Promise<void> }> = []
  for (const plugin of [
    [SystemPrompt, {}],
    [ToolRuntime, {}],
    [SessionStore, {}],
    [FileHistory, { backupRoot: root, enabled: true }],
  ] as const) {
    const [mount, config] = plugin
    fibers.push(await ctx.plugin(mount, config))
  }
  return {
    ctx,
    dispose: async () => {
      for (const fiber of fibers.reverse()) await fiber.dispose()
    },
  }
}

async function withTempDir(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-file-history-'))
  try {
    await body(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('dsh-file-history fold', () => {
  it('folds snapshot events per user message with last-wins per path', () => {
    const session = Session.create(SessionId('fold-1'))
    session.append('file/history-snapshot', {
      userMessageSeq: 1,
      trackedFileBackups: {
        'a.ts': { backupFileName: 'hash@v1', version: 1, backupTime: '2026-01-01T00:00:00.000Z' },
      },
      isSnapshotUpdate: false,
    })
    session.append('file/history-snapshot', {
      userMessageSeq: 1,
      trackedFileBackups: {
        'b.ts': { backupFileName: 'hashb@v1', version: 1, backupTime: '2026-01-01T00:00:00.000Z' },
      },
      isSnapshotUpdate: true,
    })
    session.append('file/history-snapshot', {
      userMessageSeq: 2,
      trackedFileBackups: {
        'a.ts': { backupFileName: 'hash@v2', version: 2, backupTime: '2026-01-01T00:00:00.000Z' },
      },
      isSnapshotUpdate: false,
    })

    const folded = foldFileHistorySnapshots(session.events)
    expect([...folded.keys()]).toEqual([1, 2])
    // Message 1 merged the update event's entry in.
    expect(folded.get(1)?.trackedFileBackups['a.ts']?.version).toBe(1)
    expect(folded.get(1)?.trackedFileBackups['b.ts']?.version).toBe(1)
    // Message 2 superseded path a.ts with its own version.
    expect(folded.get(2)?.trackedFileBackups['a.ts']?.version).toBe(2)
    expect(collectTrackedPaths(folded)).toEqual(new Set(['a.ts', 'b.ts']))
  })
})

describe('dsh-file-history recording', () => {
  it('records a turn-start snapshot on a direct user message', async () => {
    await withTempDir(async dir => {
      const workdir = join(dir, 'work')
      await mkdir(workdir)
      const { ctx, dispose } = await setup(dir)
      const session = ctx.sessions.create(SessionId('s1'), { meta: { cwd: workdir } })
      const seq = session.seq
      session.append('user/message', userMessage('hello'), { surfaceOp: 'append' })
      // The hook runs through the serialized chain; wait for the snapshot.
      await new Promise(resolve => setTimeout(resolve, 20))
      const folded = foldFileHistorySnapshots(session.events)
      const snapshot = folded.get(seq)
      expect(snapshot).toBeDefined()
      expect(snapshot?.trackedFileBackups).toEqual({})
      await dispose()
    })
  })

  it('ignores injected (non-user) user messages', async () => {
    await withTempDir(async dir => {
      const { ctx, dispose } = await setup(dir)
      const session = ctx.sessions.create(SessionId('s2'))
      session.append('user/message', {
        id: MessageId('m-injected'),
        role: 'user',
        content: [{ type: 'text', text: 'notice' }],
        source: { kind: 'plugin', plugin: 'test', form: 'notice', summary: 'notice' },
      }, { surfaceOp: 'append' })
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(foldFileHistorySnapshots(session.events).size).toBe(0)
      await dispose()
    })
  })

  it('records a first-edit backup before a file-mutating tool runs', async () => {
    await withTempDir(async dir => {
      const workdir = join(dir, 'work')
      await mkdir(workdir)
      const target = join(workdir, 'note.txt')
      await writeFile(target, 'before', 'utf-8')
      const { ctx, dispose } = await setup(dir)
      ctx.tools.register(defineTool({
        name: 'write',
        description: 'write a file',
        parameters: { file_path: { type: 'string', required: true }, content: { type: 'string', required: true } },
        output: {
          schema: { type: 'array', items: { type: 'json' } },
          render: (_args, value) => value as unknown as { type: 'text'; text: string }[],
        },
        execute: async (args: { file_path: string; content: string }) => {
          await writeFile(args.file_path, args.content, 'utf-8')
          return [{ type: 'text', text: 'ok' }]
        },
      }))
      const session = ctx.sessions.create(SessionId('s3'), { meta: { cwd: workdir } })
      const messageSeq = session.seq
      session.append('user/message', userMessage('edit'), { surfaceOp: 'append' })
      const agent = agentWithSession(session)
      const result = await ctx.tools.execute({
        signal: testSignal,
        callId: CallId('call-1'),
        name: 'write',
        arguments: { file_path: target, content: 'after' },
        agent,
      })
      expect(result.isError).toBe(false)

      // The pre-edit content was backed up into the current turn's snapshot.
      const folded = foldFileHistorySnapshots(session.events)
      const snapshot = folded.get(messageSeq)
      const backup = snapshot?.trackedFileBackups['note.txt']
      expect(backup).toBeDefined()
      expect(backup?.version).toBe(1)
      expect(backup?.backupFileName).not.toBeNull()
      const artifact = await readBackupFileSafely(
        dir,
        String(session.id),
        backup?.backupFileName as string,
      )
      expect(artifact.content.toString('utf-8')).toBe('before')
      await dispose()
    })
  })

  it('backs up a changed tracked file with a new version at the next turn', async () => {
    await withTempDir(async dir => {
      const workdir = join(dir, 'work')
      await mkdir(workdir)
      const target = join(workdir, 'note.txt')
      await writeFile(target, 'v1', 'utf-8')
      const { ctx, dispose } = await setup(dir)

      const session = ctx.sessions.create(SessionId('s4'), { meta: { cwd: workdir } })
      const firstSeq = session.seq
      session.append('user/message', userMessage('turn 1'), { surfaceOp: 'append' })
      // Turn 1 edits the file: the backup captures the pre-edit content.
      await ctx.fileHistory.trackEdit(agentWithSession(session), 'write', { file_path: target })
      await writeFile(target, 'v2', 'utf-8')
      expect(foldFileHistorySnapshots(session.events).get(firstSeq)?.trackedFileBackups['note.txt']?.version).toBe(1)

      // Turn 2 snapshots the changed file as v2.
      const secondSeq = session.seq
      session.append('user/message', userMessage('turn 2'), { surfaceOp: 'append' })
      await ctx.fileHistory.makeSnapshot(session, secondSeq)
      const snapshot = foldFileHistorySnapshots(session.events).get(secondSeq)
      const backup = snapshot?.trackedFileBackups['note.txt']
      expect(backup?.version).toBe(2)
      const artifact = await readBackupFileSafely(dir, String(session.id), backup?.backupFileName as string)
      expect(artifact.content.toString('utf-8')).toBe('v2')
      await dispose()
    })
  })

  it('reuses the latest backup when the tracked file is unchanged', async () => {
    await withTempDir(async dir => {
      const workdir = join(dir, 'work')
      await mkdir(workdir)
      const target = join(workdir, 'note.txt')
      await writeFile(target, 'stable', 'utf-8')
      const { ctx, dispose } = await setup(dir)
      const session = ctx.sessions.create(SessionId('s5'), { meta: { cwd: workdir } })
      session.append('user/message', userMessage('turn 1'), { surfaceOp: 'append' })
      await ctx.fileHistory.trackEdit(agentWithSession(session), 'write', { file_path: target })
      const secondSeq = session.seq
      session.append('user/message', userMessage('turn 2'), { surfaceOp: 'append' })
      await ctx.fileHistory.makeSnapshot(session, secondSeq)
      const backup = foldFileHistorySnapshots(session.events).get(secondSeq)?.trackedFileBackups['note.txt']
      expect(backup?.version).toBe(1) // unchanged -> reused, no new artifact
      await dispose()
    })
  })
})
