import { describe, expect, it } from 'vitest'
import {
  composeMemorixPatch, hasMemorixPatch, MEMORIX_MCP_PLUGIN, MEMORIX_ROW_ID, stripMemorixPatch,
  type PatchOperation,
} from '../src/patch.ts'

const COMMAND = 'node.exe'
const ARGS = ['memorix.js', 'serve']

describe('Memorix user patch management', () => {
  it('adds the MCP row when no patch layer exists', () => {
    const result = composeMemorixPatch(undefined, COMMAND, ARGS)
    expect(result).toHaveLength(1)
    expect(result[0]?.insert?.[0]).toMatchObject({
      id: MEMORIX_ROW_ID,
      name: MEMORIX_MCP_PLUGIN,
      config: {
        serverName: 'memorix',
        transport: 'stdio',
        command: COMMAND,
        args: ARGS,
      },
    })
    expect(hasMemorixPatch(result)).toBe(true)
  })

  it('replaces an existing row and keeps unrelated patch operations', () => {
    const existing: PatchOperation[] = [
      { insert: [{ id: 'other', name: 'pkg-a' }] },
      { id: 'config-row', config: { value: 1 } },
    ]
    const result = composeMemorixPatch(existing, COMMAND, ARGS)
    expect(result).toHaveLength(2)
    const insert = result.find(op => Array.isArray(op.insert))
    expect(insert?.insert).toHaveLength(2)
    expect(insert?.insert?.[0]).toMatchObject({ id: 'other' })
    expect(insert?.insert?.[1]).toMatchObject({ id: MEMORIX_ROW_ID, name: MEMORIX_MCP_PLUGIN })
    expect(result[1]).toMatchObject({ id: 'config-row' })
  })

  it('removes the MCP row and drops an empty insert operation', () => {
    const existing: PatchOperation[] = [
      { insert: [{ id: MEMORIX_ROW_ID, name: MEMORIX_MCP_PLUGIN, config: {} }] },
      { id: 'config-row', config: { value: 1 } },
    ]
    const result = stripMemorixPatch(existing)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 'config-row' })
    expect(hasMemorixPatch(result)).toBe(false)
  })
})
