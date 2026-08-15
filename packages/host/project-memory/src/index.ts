/** Host registration for the project-memory (Memorix) integration. */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the systemPrompt context merge and session/event firehose
// into this host program.
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-session'
import {
  PROJECT_MEMORY_SETTINGS_NAMESPACE, ProjectMemorySettingsSchema,
} from '@deepseek-ai/dsh-client-ui-project-memory'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { loadMemorySummary, storeTurnMemory } from './auto.ts'
import {
  bundledMemorixCommand, composeMemorixPatch, readUserPatch, stripMemorixPatch, userPatchPath, writeUserPatch,
} from './patch.ts'

export {
  bundledMemorixCommand, composeMemorixPatch, hasMemorixPatch, MEMORIX_MCP_PLUGIN, MEMORIX_ROW_ID,
  readUserPatch, stripMemorixPatch, userPatchPath, writeUserPatch,
} from './patch.ts'

/**
 * Host plugin body: register the project-memory settings namespace and keep
 * the Memorix MCP row in `$DSH_HOME/cordis.patch.yml` in sync with the
 * switch. A missing bundled Memorix runtime leaves the patch untouched so a
 * development checkout cannot start a broken MCP child.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings', 'systemPrompt'], (hostCtx) => {
    const scope = hostCtx.settings.register(
      settingsNamespace(PROJECT_MEMORY_SETTINGS_NAMESPACE),
      ProjectMemorySettingsSchema,
    )
    let enabled = scope.get().enabled
    let currentCwd = ''
    let memorySummary = ''
    let summaryPromise: Promise<void> | undefined

    const refreshSummary = (): void => {
      if (!enabled || !currentCwd || summaryPromise !== undefined) return
      summaryPromise = loadMemorySummary(currentCwd)
        .then((text) => { memorySummary = text })
        .catch(() => {})
        .finally(() => { summaryPromise = undefined })
    }

    const disposers: (() => void)[] = []
    // Dynamic section: the provider returns the cached recent-memory summary
    // at every prompt assembly, so new turns automatically see project memory.
    disposers.push(hostCtx.systemPrompt.section({
      name: 'project-memory',
      order: -98,
      text: () => memorySummary,
    }))
    // Session firehose: refresh the injected summary at each turn start and
    // store the completed turn into project memory at each turn end.
    disposers.push(hostCtx.on('session/event', (session, event) => {
      currentCwd = session.header.cwd ?? currentCwd
      if (event.type === 'turn/start') refreshSummary()
      else if (event.type === 'turn/end') void storeTurnMemory(session, event.data.turn)
    }))

    const sync = (): void => {
      const next = scope.get().enabled
      enabled = next
      const file = userPatchPath()
      const existing = readUserPatch(file)
      if (next) {
        const bundled = bundledMemorixCommand()
        if (bundled === undefined) return
        writeUserPatch(file, composeMemorixPatch(existing, bundled.command, bundled.args))
        refreshSummary()
      } else if (existing !== undefined) {
        memorySummary = ''
        writeUserPatch(file, stripMemorixPatch(existing))
      }
    }
    disposers.push(scope.watch(sync))
    hostCtx.effect(() => () => {
      for (const disposer of disposers) disposer()
    }, 'project-memory: lifecycle')
    sync()
  })
}
