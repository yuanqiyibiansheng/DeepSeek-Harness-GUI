/**
 * Durable pet settings shared by the Host schema registration and the browser
 * settings-scope binding.
 */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the pet plugin. */
export const PET_SETTINGS_NAMESPACE = 'ui-pet'

/** Field carrying the pet window visibility switch. */
export const PET_ENABLED_FIELD = 'enabled'

/** Default visibility when the user-settings document has no override. */
export const DEFAULT_PET_ENABLED = true

/** Durable pet section shared by the Host schema and the browser scope. */
export interface PetSettings {
  /** Whether the desktop pet window is shown. */
  enabled: boolean
}

/** Durable pet schema; also the wire envelope the browser scope validates against. */
export const PetSettingsSchema: z<PetSettings> = z.object({
  [PET_ENABLED_FIELD]: z.boolean().default(DEFAULT_PET_ENABLED),
})
