/**
 * Integrated terminal panel backend for the desktop Web UI. Spawns one
 * selectable shell (PowerShell, Command Prompt, Git Bash, WSL) through the
 * subprocess PTY primitive per panel session, and serves it over plain HTTP:
 * output streams as SSE, input and resize go through POST. Sessions are
 * keyed by a random id, live only in memory, and are terminated when their
 * SSE stream closes (the panel closed) or the plugin disposes.
 * @module @deepseek-ai/dsh-terminal-host
 */

import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import { resolveShell, SHELL_KINDS, type ShellKind } from './shells.ts'

export const name = 'terminal-host'
export const inject = ['subprocess', 'webServer', 'settings']

/** Deployment configuration: the default shell the panel spawns. */
export interface Config {
  defaultShell: string
}

export const Config: z<Config> = z.object({
  // The union of selectable shell ids; resolution probes and rejects unknown
  // values at spawn time.
  defaultShell: z.string().default('pwsh'),
})

/** The `terminal` settings namespace (the panel's shell preference). */
export const TERMINAL_SETTINGS_NAMESPACE = settingsNamespace('terminal')

/** One live panel terminal session. */
interface TerminalSession {
  id: string
  handle: SubprocessTerminalHandle
  shell: string
  cwd: string
}

/** Grace for the PTY session cleanup. */
const TERMINAL_GRACE_MS = 3000

/** Read a JSON request body up to a small cap; null when unparseable. */
async function readJsonBody(req: IncomingMessage, cap = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    chunks.push(buffer)
    total += buffer.length
    if (total > cap) return null
  }
  if (chunks.length === 0) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    return null
  }
}

/** Write one JSON envelope. */
function json(res: ServerResponse, envelope: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(envelope))
}

/** Build the shell argv for one spawn request. */
function shellFor(current: () => Config, requested: unknown): { argv: readonly string[]; name: string } | null {
  const kind: string | null = requested === undefined || requested === null
    ? current().defaultShell
    : SHELL_KINDS.includes(requested as ShellKind)
      ? requested as ShellKind
      : null
  if (kind === null) return null
  const resolved = resolveShell(kind as ShellKind)
  return resolved === null ? null : { argv: resolved.argv, name: resolved.name }
}

/**
 * Register the terminal panel routes and the `terminal` settings namespace.
 * @param ctx - registrant context (subprocess + webServer + settings).
 * @param config - deployment configuration.
 */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  installSettingsSection(ctx, TERMINAL_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => { current = source },
    onChange: () => {},
    validate: () => {},
  })

  const sessions = new Map<string, TerminalSession>()

  const closeSession = (id: string): void => {
    const session = sessions.get(id)
    if (session === undefined) return
    sessions.delete(id)
    void session.handle.terminate().catch((error: unknown) => {
      console.error(`terminal-host: cleanup failed for ${id}: ${String(error)}`)
    })
  }

  ctx.effect(() => () => {
    for (const id of [...sessions.keys()]) closeSession(id)
  }, 'terminal-host: terminate all panel terminals')

  ctx.webServer.register({
    kind: 'prefix',
    path: '/terminal',
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      const url = new URL(req.url ?? '/', 'http://x')
      // spawn is the id-less creation route; everything else carries a session id.
      const spawnMatch = /^\/terminal\/spawn$/.exec(url.pathname)
      const actionMatch = /^\/terminal\/([^/]+)\/(stream|write|resize|kill)$/.exec(url.pathname)
      if (spawnMatch === null && actionMatch === null) {
        json(res, { ok: false, error: 'not found' }, 404)
        return
      }

      if (spawnMatch !== null) {
        if (req.method !== 'POST') {
          json(res, { ok: false, error: 'only POST is allowed' }, 405)
          return
        }
        const body = await readJsonBody(req) as Record<string, unknown> | null
        const cols = typeof body?.cols === 'number' ? body.cols : 80
        const rows = typeof body?.rows === 'number' ? body.rows : 24
        const cwd = typeof body?.cwd === 'string' && body.cwd !== '' ? body.cwd : process.cwd()
        const resolved = shellFor(current, body?.shell)
        if (resolved === null) {
          json(res, { ok: false, error: 'terminal-host: shell is not installed or not selectable' })
          return
        }
        try {
          const handle = await ctx.subprocess.spawnTerminal({
            argv: resolved.argv,
            cwd,
            rows,
            cols,
            graceMs: TERMINAL_GRACE_MS,
          })
          const sessionId = randomUUID()
          sessions.set(sessionId, { id: sessionId, handle, shell: resolved.name, cwd })
          json(res, { ok: true, id: sessionId, shell: resolved.name })
        } catch (error) {
          json(res, { ok: false, error: `terminal-host: spawn failed: ${String(error)}` })
        }
        return
      }

      const id = actionMatch?.[1] ?? ''
      const action = actionMatch?.[2] ?? ''
      const session = sessions.get(id)
      if (session === undefined) {
        json(res, { ok: false, error: 'terminal-host: unknown terminal session' }, 404)
        return
      }

      if (action === 'stream') {
        if (req.method !== 'GET') {
          json(res, { ok: false, error: 'only GET is allowed' }, 405)
          return
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        const onData = (chunk: Buffer): void => {
          res.write(`data: ${JSON.stringify({ type: 'output', data: chunk.toString('utf8') })}\n\n`)
        }
        session.handle.output.on('data', onData)
        void session.handle.done.then((outcome) => {
          res.write(`data: ${JSON.stringify({ type: 'exit', code: outcome.exitCode, signal: outcome.signal })}\n\n`)
          res.end()
        }).catch(() => {
          res.write(`data: ${JSON.stringify({ type: 'exit', code: null, signal: null })}\n\n`)
          res.end()
        })
        res.on('close', () => {
          session.handle.output.off('data', onData)
          closeSession(id)
        })
        return
      }

      if (req.method !== 'POST') {
        json(res, { ok: false, error: 'only POST is allowed' }, 405)
        return
      }
      const body = await readJsonBody(req) as Record<string, unknown> | null
      try {
        if (action === 'write') {
          const data = body?.data
          if (typeof data !== 'string') {
            json(res, { ok: false, error: 'terminal-host: data must be a string' })
            return
          }
          await session.handle.write(data)
          json(res, { ok: true })
        } else if (action === 'resize') {
          const cols = body?.cols
          const rows = body?.rows
          if (typeof cols !== 'number' || typeof rows !== 'number') {
            json(res, { ok: false, error: 'terminal-host: cols and rows must be numbers' })
            return
          }
          await session.handle.resize(cols, rows)
          json(res, { ok: true })
        } else if (action === 'kill') {
          closeSession(id)
          json(res, { ok: true })
        } else {
          json(res, { ok: false, error: 'not found' }, 404)
        }
      } catch (error) {
        json(res, { ok: false, error: `terminal-host: ${String(error)}` })
      }
    },
  })
}
