/**
 * Memorix MCP row management for the harness user patch layer.
 *
 * Memorix integrates with DeepSeek Harness as a row of the
 * `@deepseek-ai/dsh-mcp-client` plugin inside `$DSH_HOME/cordis.patch.yml`.
 * The row id is `memory-memorix`, matching Memorix's own DSH adapter, so the
 * `memorix setup --agent dsh` command and this client agree on ownership.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

/** Row id Memorix owns inside the DSH user patch layer. */
export const MEMORIX_ROW_ID = 'memory-memorix'

/** The MCP client plugin row name Memorix registers through. */
export const MEMORIX_MCP_PLUGIN = '@deepseek-ai/dsh-mcp-client'

/** One loader patch operation (the DSH include dialect). */
export interface PatchOperation {
  id?: string
  insert?: PatchRow[]
  name?: string
  disabled?: boolean
  config?: Record<string, unknown>
  [key: string]: unknown
}

/** One inserted loader row. */
export interface PatchRow {
  id: string
  name: string
  disabled?: boolean
  config?: Record<string, unknown>
}

/** Resolve the harness home used for the user patch layer. */
export function resolveProjectMemoryDshHome(): string {
  const configured = process.env.DSH_HOME?.trim()
  return configured || join(homedir(), '.dsh')
}

/** Absolute user patch file path (`$DSH_HOME/cordis.patch.yml`). */
export function userPatchPath(home: string = resolveProjectMemoryDshHome()): string {
  return join(home, 'cordis.patch.yml')
}

/** Locate the bundled Memorix runtime next to the running harness bundle. */
export function bundledMemorixCommand(): { command: string; args: string[] } | undefined {
  const cwd = process.cwd()
  const nodeExe = resolve(cwd, '..', 'node', 'node.exe')
  const cli = resolve(cwd, '..', 'memorix', 'dist', 'cli', 'index.js')
  if (existsSync(nodeExe) && existsSync(cli)) return { command: nodeExe, args: [cli, 'serve'] }
  return undefined
}

/** Flatten one parsed patch document into its inserted/bare row list. */
function patchRows(document: unknown): PatchRow[] {
  if (!Array.isArray(document)) return []
  const rows: PatchRow[] = []
  for (const item of document) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as PatchOperation
    if (Array.isArray(record.insert)) {
      rows.push(...record.insert)
    } else if (typeof record.id === 'string' && typeof record.name === 'string') {
      rows.push(record as PatchRow)
    }
  }
  return rows
}

/**
 * Compose the user patch document with the Memorix row present.
 * @param existing - parsed patch operations, or undefined when absent.
 * @param command - executable to launch.
 * @param args - CLI arguments (the Memorix CLI plus `serve`).
 * @returns the new patch operations list.
 */
export function composeMemorixPatch(
  existing: PatchOperation[] | undefined,
  command: string,
  args: string[],
): PatchOperation[] {
  const document = structuredClone(existing ?? [])
  const insertOp = document.find((op) => Array.isArray(op.insert))
  const rows = insertOp?.insert ?? []
  const rowIndex = rows.findIndex((row) => row.id === MEMORIX_ROW_ID)
  const row: PatchRow = {
    id: MEMORIX_ROW_ID,
    name: MEMORIX_MCP_PLUGIN,
    config: {
      serverName: 'memorix',
      transport: 'stdio',
      command,
      args,
    },
  }
  if (rowIndex >= 0) rows[rowIndex] = row
  else rows.push(row)
  if (insertOp === undefined) document.push({ insert: rows })
  return document
}

/**
 * Compose the user patch document without the Memorix row.
 * @param existing - parsed patch operations, or undefined when absent.
 * @returns the new patch operations list.
 */
export function stripMemorixPatch(existing: PatchOperation[] | undefined): PatchOperation[] {
  const document = structuredClone(existing ?? [])
  for (const op of document) {
    if (!Array.isArray(op.insert)) continue
    op.insert = op.insert.filter((row) => row.id !== MEMORIX_ROW_ID)
  }
  return document.filter((op) => !Array.isArray(op.insert) || op.insert.length > 0)
}

/** Read the user patch file, tolerating a missing or malformed file. */
export function readUserPatch(file: string): PatchOperation[] | undefined {
  if (!existsSync(file)) return undefined
  try {
    const parsed = parseYaml(readFileSync(file, 'utf8'))
    return Array.isArray(parsed) ? parsed as PatchOperation[] : undefined
  } catch {
    return undefined
  }
}

/** Write a user patch file, preserving the top-level array dialect. */
export function writeUserPatch(file: string, operations: PatchOperation[]): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, stringifyYaml(operations, { lineWidth: 0 }) + '\n')
}

/** Whether the current patch document contains the Memorix row. */
export function hasMemorixPatch(operations: PatchOperation[] | undefined): boolean {
  return patchRows(operations).some((row) => row.id === MEMORIX_ROW_ID)
}
