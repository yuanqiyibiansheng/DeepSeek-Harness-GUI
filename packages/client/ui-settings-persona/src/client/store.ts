/**
 * Persona settings page store: one snapshot of the user-global instructions
 * document plus save state. The host is the single fact source; every write
 * goes through the host instructions wire.
 */

import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Page snapshot. */
export interface PersonaSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-load failure text. */
  error: string | null
  /** The current instructions text; empty when the file does not exist. */
  content: string
}

/**
 * Human text for a rejected wire call.
 * @param error - the rejection value.
 * @returns the message to show.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The persona settings page controller (one per settings surface). */
export class PersonaSettingsStore {
  /** The snapshot the section renders from (uSES-safe store). */
  readonly store: SnapshotStore<PersonaSettingsState> = createSnapshotStore<PersonaSettingsState>({
    status: 'idle', error: null, content: '',
  })

  /** @param api - the wire face (host domain). */
  constructor(private readonly api: Pick<IApiClient, 'host'>) {}

  /** Load the current instructions text from the host. */
  async load(): Promise<void> {
    this.store.update((s) => { s.status = 'loading'; s.error = null })
    try {
      const response = await this.api.host.readInstructions({})
      if (!response.result.ok) throw new Error(response.result.error.message)
      const content = response.result.ok ? response.result.value.content : null
      this.store.update((s) => {
        s.status = 'ready'
        s.error = null
        s.content = content ?? ''
      })
    } catch (error) {
      this.store.update((s) => {
        s.status = 'error'
        s.error = messageOf(error)
      })
    }
  }

  /** Persist the instructions text. Returns the failure message, or undefined on success. */
  async save(content: string): Promise<string | undefined> {
    try {
      const response = await this.api.host.writeInstructions({ content })
      if (!response.result.ok) return response.result.error.message
    } catch (error) {
      return messageOf(error)
    }
    return undefined
  }
}
