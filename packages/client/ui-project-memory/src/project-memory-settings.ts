/**
 * Durable project-memory settings shared by the Host schema registration and
 * the browser settings-scope binding.
 */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the project-memory plugin. */
export const PROJECT_MEMORY_SETTINGS_NAMESPACE = 'project-memory'

/** Field carrying the Memorix integration switch. */
export const PROJECT_MEMORY_ENABLED_FIELD = 'enabled'

/** Default integration state: on. */
export const DEFAULT_PROJECT_MEMORY_ENABLED = true

/** Durable project-memory section shared by the Host schema and the browser scope. */
export interface ProjectMemorySettings {
  /** Whether the Memorix project-memory MCP server is composed. */
  enabled: boolean
}

/** Durable project-memory schema; also the wire envelope the browser scope validates against. */
export const ProjectMemorySettingsSchema: z<ProjectMemorySettings> = z.object({
  [PROJECT_MEMORY_ENABLED_FIELD]: z.boolean().default(DEFAULT_PROJECT_MEMORY_ENABLED),
})
