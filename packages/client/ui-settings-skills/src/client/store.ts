/**
 * Skills settings page store: one snapshot of the user-owned skill directory
 * (`skill.listManaged`) plus per-row mutation state. The host is the single
 * fact source; every write goes through the wire and the page reloads from the
 * next listManaged.
 */

import type { IApiClient, ManagedSkillEntry } from '@deepseek-ai/dsh-client-connection/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Page snapshot. */
export interface SkillsSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-load failure text; row-level write failures stay in the row. */
  error: string | null
  /** Every user-owned skill, sorted by name. */
  skills: readonly ManagedSkillEntry[]
}

/**
 * Human text for a rejected wire call.
 * @param error - the rejection value.
 * @returns the message to show.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The skills settings page controller (one per settings surface). */
export class SkillsSettingsStore {
  /** The snapshot the section renders from (uSES-safe store). */
  readonly store: SnapshotStore<SkillsSettingsState> = createSnapshotStore<SkillsSettingsState>({
    status: 'idle', error: null, skills: [],
  })

  /** Latest load wins; an older response never overwrites a newer one. */
  private generation = 0

  /** @param api - the wire face (skills domain). */
  constructor(private readonly api: Pick<IApiClient, 'skills'>) {}

  /** Refresh the whole page snapshot from the host. */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading'; s.error = null })
    try {
      const response = await this.api.skills.listManaged({})
      if (!response.result.ok) throw new Error(response.result.error.message)
      const skills = response.result.ok ? response.result.value.skills : []
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'ready'
        s.error = null
        s.skills = [...skills]
      })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'error'
        s.error = messageOf(error)
      })
    }
  }

  /** Toggle one skill's model or user invocation, then reload. */
  async toggle(name: string, toggle: { modelInvocable?: boolean; userInvocable?: boolean }): Promise<string | undefined> {
    try {
      const response = await this.api.skills.updateManaged({ name, toggle })
      if (!response.result.ok) return response.result.error.message
    } catch (error) {
      return messageOf(error)
    }
    await this.load()
    return undefined
  }

  /** Remove one user skill, then reload. */
  async remove(name: string): Promise<string | undefined> {
    try {
      const response = await this.api.skills.removeManaged({ name })
      if (!response.result.ok) return response.result.error.message
    } catch (error) {
      return messageOf(error)
    }
    await this.load()
    return undefined
  }
}
