import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const baseConfigPath = join(repoRoot, 'packages/bundle/base/cordis.patch.yml')
const webConfigPath = join(repoRoot, 'packages/bundle/web-app/cordis.patch.yml')

interface PatchEntry {
  id?: string
  disabled?: unknown
  config?: { auto?: unknown }
  insert?: PatchEntry[]
}

const jsExprType = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  construct: value => String(value),
})
const configSchema = yaml.JSON_SCHEMA.extend(jsExprType)

describe('web compaction default', () => {
  it('keeps compaction-basic enabled with auto compaction on', async () => {
    const baseRows = (yaml.load(await readFile(baseConfigPath, 'utf8'), { schema: configSchema }) as PatchEntry[])
      .flatMap(entry => entry.insert ?? [entry])
    const webRows = (yaml.load(await readFile(webConfigPath, 'utf8'), { schema: configSchema }) as PatchEntry[])
      .flatMap(entry => entry.insert ?? [entry])
    const baseCompaction = baseRows.find(row => row.id === 'compaction-basic')
    const webCompaction = webRows.find(row => row.id === 'compaction-basic')

    expect(baseCompaction?.disabled).toBeUndefined()
    expect(webCompaction?.disabled).toBeUndefined()
    expect(webCompaction?.config?.auto).toBe(true)
  })
})
