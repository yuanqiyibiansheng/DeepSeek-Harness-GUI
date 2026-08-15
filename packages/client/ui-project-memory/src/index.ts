/** Shared constants for the project-memory (Memorix) integration. */

export {
  DEFAULT_PROJECT_MEMORY_ENABLED, PROJECT_MEMORY_ENABLED_FIELD, PROJECT_MEMORY_SETTINGS_NAMESPACE,
  type ProjectMemorySettings, ProjectMemorySettingsSchema,
} from './project-memory-settings.ts'

/**
 * Host plugin body: the browser-side plugin owns the toggle UI while the
 * `@deepseek-ai/dsh-project-memory` host package owns the Memorix MCP row.
 * This node half is a no-op so the loader row stays valid on the host.
 */
export function apply(): void {}
