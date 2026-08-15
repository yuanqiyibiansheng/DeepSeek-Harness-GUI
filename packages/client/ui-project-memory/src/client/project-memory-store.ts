/**
 * Project-memory toggle row slot store: a mirror of the project-memory
 * settings snapshot. The plugin's apply-world sync listener is the only
 * writer; the row component reads via props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** Store state mirrored from the project-memory settings snapshot. */
export interface ProjectMemoryToggleState {
  /** Persisted integration switch. */
  enabled: boolean
  /** Settings revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type ProjectMemoryToggleActions = {
  sync: (draft: ProjectMemoryToggleState, enabled: boolean, revision: number) => void
}

/**
 * Declares the project-memory toggle state and write surface.
 * @returns the store handle.
 */
export function createProjectMemoryStore(): EngineStoreHandle<ProjectMemoryToggleState, ProjectMemoryToggleActions> {
  return defineStore({
    init: (): ProjectMemoryToggleState => ({ enabled: true, revision: -1 }),
    actions: {
      sync: (d, enabled, revision) => {
        if (revision <= d.revision) return
        d.enabled = enabled
        d.revision = revision
      },
    },
  })
}
