/**
 * Vision capability enhancement, browser half: a General-settings row and a
 * composer shortcut that share one controller over the host's
 * `vision-enhancement` settings namespace and `api.vision` endpoints. While
 * enabled, the host turns image blocks into model-visible Bailian
 * observations, so text-only agents can read screenshots, photos, charts,
 * and image text.
 * @module @deepseek-ai/dsh-client-ui-vision-enhancement/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { VisionEnhancementRow } from './VisionEnhancementRow.tsx'
import { VisionEnhancementShortcut } from './VisionEnhancementShortcut.tsx'
import type { VisionEnhancementInjected } from './VisionEnhancementShortcut.tsx'
import {
  VISION_SETTINGS_NAMESPACE, VisionEnhancementController,
} from './vision-enhancement-controller.ts'

/**
 * Required services: slots for the two entries, the connection for the
 * api.vision wire face, and remote for the pushed status invalidations.
 */
export const inject = ['slots', 'locale', 'connection', 'remote']

/**
 * Client plugin body: share one controller between the settings row and the
 * composer shortcut, and keep its status fresh on settings, credential, and
 * connection changes.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const vision = new VisionEnhancementController(connection.api)
  const visionInjected = (): VisionEnhancementInjected => ({
    hooks: { visionEnhancement: vision.store },
    load: () => vision.ensureLoaded(),
    disable: () => vision.disable(),
    enable: (input, signal) => vision.enable(input, signal),
  })
  ctx.effect(() => {
    const disposers = [
      ctx.remote.$on('settings/document-updated', (ns) => {
        if (ns === VISION_SETTINGS_NAMESPACE) vision.refreshIfLoaded()
      }),
      ctx.remote.$on('credentials/updated', (ref) => {
        if (ref === 'DASHSCOPE_API_KEY') vision.refreshIfLoaded()
      }),
      ctx.on('connection/reset', () => { vision.refreshIfLoaded() }),
    ]
    return () => {
      vision.dispose()
      for (const dispose of disposers) dispose()
    }
  }, 'ui-vision-enhancement: status invalidations')

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'vision-enhancement',
    order: 35,
    inject: visionInjected,
  }, VisionEnhancementRow))
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'vision-enhancement',
    order: 20,
    inject: visionInjected,
  }, VisionEnhancementShortcut))
}
