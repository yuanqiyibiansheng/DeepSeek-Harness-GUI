/**
 * Pet toggle row slot store: a mirror of the pet settings snapshot. The
 * plugin's apply-world sync listener is the only writer; the row component
 * reads via props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** Store state mirrored from the pet settings snapshot. */
export interface PetToggleState {
  /** Persisted visibility switch. */
  enabled: boolean
  /** Settings revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type PetToggleActions = {
  sync: (draft: PetToggleState, enabled: boolean, revision: number) => void
}

/**
 * Declares the pet toggle state and write surface.
 * @returns the store handle.
 */
export function createPetToggleStore(): EngineStoreHandle<PetToggleState, PetToggleActions> {
  return defineStore({
    init: (): PetToggleState => ({ enabled: true, revision: -1 }),
    actions: {
      sync: (d, enabled, revision) => {
        if (revision <= d.revision) return
        d.enabled = enabled
        d.revision = revision
      },
    },
  })
}
