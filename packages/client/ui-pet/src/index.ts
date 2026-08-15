/** Host registration for the durable pet visibility preference. */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { PET_SETTINGS_NAMESPACE, PetSettingsSchema } from './pet-settings.ts'

export {
  DEFAULT_PET_ENABLED, PET_ENABLED_FIELD, PET_SETTINGS_NAMESPACE,
  type PetSettings, PetSettingsSchema,
} from './pet-settings.ts'

/**
 * Host plugin body: register the pet settings namespace when the settings
 * service is composed.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(settingsNamespace(PET_SETTINGS_NAMESPACE), PetSettingsSchema)
  })
}
