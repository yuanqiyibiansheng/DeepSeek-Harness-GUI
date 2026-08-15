/**
 * Plugin marketplace, browser half: mounts the `pluginMarketplace` Typert
 * Remote face and registers the Settings → Plugins "Marketplace" tab that
 * searches npm and installs/uninstalls dsh plugins into the web profile.
 * @module @deepseek-ai/dsh-client-ui-plugin-marketplace/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { MarketplaceTab, type MarketplaceInjected } from './MarketplaceTab.tsx'
import { en, zh, type MarketplaceKey } from './locales.ts'
import type {
  MarketplaceActionResult, MarketplaceInstalledSnapshot, MarketplaceSearchResult,
} from '../types.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Marketplace tab copy. */
    'settings.pluginMarketplace': MarketplaceKey
  }
}

/** Dictionary namespace owned by this plugin (the marketplace tab's copy). */
const NS = 'settings.pluginMarketplace'

/** Typert Remote identity shared with the host half. */
const REMOTE_PACKAGE = '@deepseek-ai/dsh-client-ui-plugin-marketplace'

/** Strict codec for the JSON wire envelope (matches the host half). */
const looseCodec = () => ({
  mode: 'strict' as const,
  typeSymbol: `${REMOTE_PACKAGE}/types#Json`,
  schema: { parse: (value: unknown) => value },
})

const descriptor = (method: string, parameters: string[]) => ({
  id: `${REMOTE_PACKAGE}#pluginMarketplace/${method}`,
  service: 'pluginMarketplace',
  namespace: 'pluginMarketplace',
  method,
  invocation: { kind: 'direct' as const },
  parameters: parameters.map((name) => ({
    name,
    wire: name,
    source: 'json' as const,
    codec: looseCodec(),
  })),
  result: looseCodec(),
})

const REMOTE = {
  package: REMOTE_PACKAGE,
  descriptors: [
    descriptor('search', ['query']),
    descriptor('installed', []),
    descriptor('installPlugin', ['packageName']),
    descriptor('uninstallPlugin', ['packageName']),
  ],
}

/** The mounted namespace service's method envelope. */
interface RemoteEnvelope<T> {
  ok: boolean
  value?: T
  error?: { message?: string }
}

/** The mounted pluginMarketplace namespace service. */
interface MarketplaceRemote {
  search(query: string): Promise<RemoteEnvelope<MarketplaceSearchResult>>
  installed(): Promise<RemoteEnvelope<MarketplaceInstalledSnapshot>>
  installPlugin(packageName: string): Promise<RemoteEnvelope<MarketplaceActionResult>>
  uninstallPlugin(packageName: string): Promise<RemoteEnvelope<MarketplaceActionResult>>
}

/**
 * Required services: slots for the tab, locale for the dictionaries, and the
 * remote gateway that mounts the pluginMarketplace face.
 */
export const inject = ['slots', 'locale', 'remote']

/**
 * Client plugin body: mount the remote face in the background and register
 * the marketplace tab. A mount problem shows up as an error banner inside
 * the tab instead of the tab silently disappearing.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-plugin-marketplace: dictionaries')
  const t = ctx.locale.bind(NS)

  let mountFailure: string | null = null
  const mountPromise = ctx.remote.$mount(REMOTE).then((dispose) => {
    ctx.effect(() => dispose, 'ui-plugin-marketplace: remote face')
    return true
  }, (error: unknown) => {
    mountFailure = String((error as Error)?.message ?? error)
    console.error('ui-plugin-marketplace: remote face mount failed', error)
    return false
  })

  /** Resolve the mounted namespace service, waiting for the mount. */
  const remote = async (): Promise<MarketplaceRemote> => {
    await mountPromise
    if (mountFailure !== null) throw new Error(`pluginMarketplace 远程接口未就绪: ${mountFailure}`)
    const service = ctx.get('remote.pluginMarketplace') as MarketplaceRemote | undefined
    if (service === undefined || service === null || typeof service !== 'object') {
      await new Promise((resolve) => setTimeout(resolve, 50))
      const retry = ctx.get('remote.pluginMarketplace') as MarketplaceRemote | undefined
      if (retry === undefined || retry === null || typeof retry !== 'object') {
        throw new Error('pluginMarketplace 远程接口未注册')
      }
      return retry
    }
    return service
  }

  const unwrap = <T,>(result: RemoteEnvelope<T>): T => {
    if (!result.ok) throw new Error(result.error?.message ?? 'remote failed')
    return result.value as T
  }

  const injected = (): MarketplaceInjected => ({
    search: async (query) => unwrap(await (await remote()).search(query)),
    installed: async () => unwrap(await (await remote()).installed()),
    install: async (name) => unwrap(await (await remote()).installPlugin(name)),
    uninstall: async (name) => unwrap(await (await remote()).uninstallPlugin(name)),
  })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'marketplace',
    order: 20,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, MarketplaceTab))
}
