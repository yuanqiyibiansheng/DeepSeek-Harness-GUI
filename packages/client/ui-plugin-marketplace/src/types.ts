/** Wire types shared by the marketplace host half and its browser tab. */

/** One profile plugin snapshot row. */
export interface MarketplacePluginEntry {
  name: string
  version: string
  isBundle: boolean
  isClient: boolean
  inBundles: boolean
}

/** Snapshot of the web profile's installed user plugins. */
export interface MarketplaceInstalledSnapshot {
  profileDir: string
  bundles: string[]
  plugins: MarketplacePluginEntry[]
}

/** One npm search hit merged with the local install state. */
export interface MarketplaceSearchHit {
  name: string
  version: string
  description: string
  date: string | null
  license: string
  links: Record<string, string>
  installed: { version: string; isBundle: boolean; isClient: boolean } | null
}

/** Search result envelope. */
export interface MarketplaceSearchResult {
  query: string
  results: MarketplaceSearchHit[]
}

/** Result of a marketplace mutation (install/uninstall). */
export interface MarketplaceActionResult {
  ok: boolean
  name: string
  version?: string
  isBundle?: boolean
  isClient?: boolean
  rowsAdded?: boolean
  needsRestart?: boolean
  error?: string
}
