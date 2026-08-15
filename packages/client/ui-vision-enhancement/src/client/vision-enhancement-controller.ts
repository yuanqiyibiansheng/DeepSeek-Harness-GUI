/** Shared browser state for the Desktop visual-enhancement controls. */

import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import {
  createSnapshotStore, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'

/** Host settings namespace used by visual enhancement. */
export const VISION_SETTINGS_NAMESPACE = 'vision-enhancement'

/** One image probe sent through the existing atomic enable operation. */
export interface VisionEnableProbe {
  /** Optional credential stored by the Host before verification. */
  apiKey?: string
  /** Validated image media type. */
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  /** Canonical Base64 image payload. */
  data: string
  /** Optional task-specific visual question. */
  question?: string
  /** Optional display name for validation diagnostics. */
  name?: string
}

/** Shared status rendered by the Settings row and composer shortcut. */
export interface VisionEnhancementState {
  /** Current read or mutation phase. */
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'error'
  /** Host-authoritative enabled value. */
  enabled: boolean
  /** Whether the Host has a stored Bailian credential. */
  configured: boolean
  /** Visual provider model reported by the Host. */
  model: string
  /** Latest status or mutation failure. */
  error: string | null
}

type VisionApi = Pick<ConnectionHandle['api'], 'settings' | 'vision'>

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Controller joining status reads, enable verification, disable writes, and pushed refreshes. */
export class VisionEnhancementController {
  /** Status source shared by every visual-enhancement entry. */
  readonly store: SnapshotStore<VisionEnhancementState> = createSnapshotStore({
    status: 'idle',
    enabled: false,
    configured: false,
    model: 'qwen3.8-max',
    error: null,
  })

  private generation = 0
  private loading: Promise<void> | undefined
  private refreshPending = false

  /** @param api - Host visual-enhancement and Settings wire faces. */
  constructor(private readonly api: VisionApi) {}

  /** Load once for the first mounted surface and share the result. */
  ensureLoaded(): Promise<void> {
    if (this.store.getSnapshot().status !== 'idle') return this.loading ?? Promise.resolve()
    return this.load()
  }

  /** Refresh status after a pushed settings, credential, or connection change. */
  refreshIfLoaded(): void {
    const status = this.store.getSnapshot().status
    if (status === 'idle') return
    if (status === 'saving') {
      this.refreshPending = true
      return
    }
    void this.load()
  }

  /** Read the authoritative Host status; the latest request wins. */
  load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => {
      state.status = 'loading'
      state.error = null
    })
    const pending = (async () => {
      try {
        const response = await this.api.vision.status({})
        if (!response.result.ok) throw new Error(response.result.error.message)
        if (generation !== this.generation) return
        const value = response.result.value
        this.store.update((state) => {
          state.status = 'ready'
          state.enabled = value.enabled
          state.configured = value.configured
          state.model = value.model
          state.error = null
        })
      } catch (error) {
        if (generation !== this.generation) return
        this.fail(error)
      }
    })()
    this.loading = pending
    void pending.then(() => {
      if (this.loading === pending) this.loading = undefined
    })
    return pending
  }

  /** Disable the shared capability through its existing Settings namespace. */
  async disable(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => {
      state.status = 'saving'
      state.error = null
    })
    try {
      const response = await this.api.settings.update({
        ns: VISION_SETTINGS_NAMESPACE,
        patch: { enabled: false },
      })
      if (!response.result.ok) throw new Error(response.result.error.message)
      if (generation !== this.generation) return
      this.store.update((state) => {
        state.status = 'ready'
        state.enabled = false
        state.error = null
      })
    } catch (error) {
      if (generation === this.generation) this.fail(error)
      throw error
    } finally {
      this.flushPendingRefresh()
    }
  }

  /**
   * Verify one real image and enable the capability atomically.
   * @param input - Credential and image probe submitted to the Host.
   * @param signal - Optional cancellation signal for the verification request.
   * @returns The verified visual description returned by the provider.
   */
  async enable(input: VisionEnableProbe, signal?: AbortSignal): Promise<string> {
    const generation = ++this.generation
    this.store.update((state) => {
      state.status = 'saving'
      state.error = null
    })
    try {
      const response = await this.api.vision.enable(input, signal)
      if (!response.result.ok) throw new Error(response.result.error.message)
      const value = response.result.value
      if (generation === this.generation) {
        this.store.update((state) => {
          state.status = 'ready'
          state.enabled = true
          state.configured = true
          state.model = value.model
          state.error = null
        })
      }
      return value.description
    } catch (error) {
      if (generation === this.generation) this.fail(error)
      throw error
    } finally {
      this.flushPendingRefresh()
    }
  }

  /** Ignore every response that settles after the owning plugin is disposed. */
  dispose(): void {
    this.generation += 1
    this.loading = undefined
    this.refreshPending = false
  }

  private flushPendingRefresh(): void {
    if (!this.refreshPending) return
    this.refreshPending = false
    void this.load()
  }

  private fail(error: unknown): void {
    this.store.update((state) => {
      state.status = 'error'
      state.error = messageOf(error)
    })
  }
}
