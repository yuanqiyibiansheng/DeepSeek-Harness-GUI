/** Host registration for the project-memory (Memorix) integration. */

import type { Context } from '@deepseek-ai/cordis'
import {
  PROJECT_MEMORY_SETTINGS_NAMESPACE, ProjectMemorySettingsSchema,
} from '@deepseek-ai/dsh-client-ui-project-memory'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
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
  ctx.inject(['settings'], (settingsCtx) => {
    const scope = settingsCtx.settings.register(
      settingsNamespace(PROJECT_MEMORY_SETTINGS_NAMESPACE),
      ProjectMemorySettingsSchema,
    )
    const sync = (): void => {
      const file = userPatchPath()
      const enabled = scope.get().enabled
      const existing = readUserPatch(file)
      if (enabled) {
        const bundled = bundledMemorixCommand()
        if (bundled === undefined) return
        writeUserPatch(file, composeMemorixPatch(existing, bundled.command, bundled.args))
      } else if (existing !== undefined) {
        writeUserPatch(file, stripMemorixPatch(existing))
      }
    }
    const disposer = scope.watch(sync)
    ctx.effect(() => disposer, 'project-memory: settings watch')
    sync()
  })
}
