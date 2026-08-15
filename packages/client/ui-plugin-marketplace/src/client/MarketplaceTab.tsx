/**
 * Marketplace tab registered into Settings → Plugins: a search box over npm's
 * dsh-plugin keyword index, result cards with install/uninstall, and the list
 * of plugins already installed into the web profile. All business calls go
 * through the injected face (the apply closure's remote mount); the component
 * only keeps transient UI state.
 */
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  MarketplaceActionResult, MarketplaceInstalledSnapshot, MarketplaceSearchHit, MarketplaceSearchResult,
} from '../types.ts'
import type { MarketplaceKey } from './locales.ts'
import css from './marketplace.module.css'

/** Registration-side business face: the remote-backed marketplace calls. */
export interface MarketplaceInjected {
  /** Search npm for dsh plugins. */
  search: (query: string) => Promise<MarketplaceSearchResult>
  /** List plugins installed into the web profile. */
  installed: () => Promise<MarketplaceInstalledSnapshot>
  /** Install one package into the web profile and activate it. */
  install: (name: string) => Promise<MarketplaceActionResult>
  /** Uninstall one package from the web profile. */
  uninstall: (name: string) => Promise<MarketplaceActionResult>
}

/** Props the renderer binds for the marketplace tab. */
export type MarketplaceTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginMarketplace'>
  & InjectFace<MarketplaceInjected>

/** Live snapshot of the profile's installed plugins. */
interface InstalledState {
  status: 'loading' | 'ready' | 'error'
  plugins: MarketplaceInstalledSnapshot['plugins']
}

/** One search-result card with its install/uninstall action. */
function ResultCard({
  t, item, busy, onInstall, onUninstall,
}: {
  t: (key: MarketplaceKey) => string
  item: MarketplaceSearchHit
  busy: string | undefined
  onInstall: () => void
  onUninstall: () => void
}) {
  const installedVersion = item.installed?.version ?? null
  return (
    <li className={css.card}>
      <div className={css.cardHead}>
        <div className={css.cardTitleWrap}>
          <strong className={css.cardName} title={item.name}>{item.name}</strong>
          <span className={css.cardVersion}>v{item.version}</span>
          {installedVersion !== null && (
            <span className={css.installedBadge}>{t('installedTag')} v{installedVersion}</span>
          )}
        </div>
        {busy === 'installing' ? (
          <button type="button" className={css.installBtn} disabled>{t('installing')}</button>
        ) : installedVersion !== null ? (
          <button
            type="button"
            className={css.dangerBtn}
            disabled={busy !== undefined}
            onClick={onUninstall}
          >
            {busy === 'uninstalling' ? t('uninstalling') : t('uninstall')}
          </button>
        ) : (
          <button type="button" className={css.installBtn} disabled={busy !== undefined} onClick={onInstall}>
            {t('install')}
          </button>
        )}
      </div>
      {item.description !== '' && <p className={css.cardDesc}>{item.description}</p>}
      <div className={css.cardMeta}>
        <span>{item.date ?? ''}</span>
        {item.license !== '' && <span>{item.license}</span>}
        {typeof item.links.repository === 'string' && <span>{item.links.repository}</span>}
      </div>
    </li>
  )
}

/**
 * Render the marketplace tab.
 * @param props - composed slot props.
 * @returns the tab element tree.
 */
export function MarketplaceTab({ t, search, installed, install, uninstall }: MarketplaceTabProps) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<MarketplaceSearchHit[]>([])
  const [searchError, setSearchError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [needsRestart, setNeedsRestart] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [installedState, setInstalledState] = useState<InstalledState>({ status: 'loading', plugins: [] })
  const [installedTick, setInstalledTick] = useState(0)
  const autoSearchRef = useRef(false)

  useEffect(() => {
    let alive = true
    installed().then((value) => {
      if (!alive) return
      setInstalledState({ status: 'ready', plugins: value.plugins ?? [] })
    }, () => {
      if (alive) setInstalledState({ status: 'error', plugins: [] })
    })
    return () => { alive = false }
  }, [installed, installedTick])

  const runSearch = (term: string): void => {
    if (searching) return
    setSearching(true)
    setSearchError(null)
    search(term).then((value) => {
      setResults(value.results)
    }, (error: unknown) => {
      setSearchError(String((error as Error)?.message ?? error))
      setResults([])
    }).finally(() => { setSearching(false) })
  }

  // Auto-load the default catalog (keywords:dsh-plugin) on first mount so the
  // tab is never empty before the user searches.
  useEffect(() => {
    if (autoSearchRef.current) return
    autoSearchRef.current = true
    runSearch('')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- first-mount only; search identity is stable per apply.
  }, [search])

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    runSearch(query)
  }

  /** Reflect one install/uninstall result into the search-result cards so the
   * button state is truthful without a re-search round trip. */
  const patchResult = (name: string, installed: MarketplaceSearchHit['installed']): void => {
    setResults(current => current.map(item => item.name === name ? { ...item, installed } : item))
  }

  /** Whether the page runs inside the desktop shell (Tauri webview). */
  const isTauriShell = (): boolean => (
    typeof window !== 'undefined'
    && (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined
  )

  /** Ask the desktop shell to restart the dsh service in place (activates new plugins). */
  const restartService = (): void => {
    if (restarting) return
    setRestarting(true)
    const internals = (window as unknown as {
      __TAURI_INTERNALS__?: { invoke(command: string, args?: unknown): Promise<unknown> }
    }).__TAURI_INTERNALS__
    if (internals === undefined) {
      setRestarting(false)
      return
    }
    try {
      void internals.invoke('restart_service')
    } catch {
      setRestarting(false)
    }
  }

  const doInstall = (name: string): void => {
    if (busy[name] !== undefined) return
    setBusy((current) => ({ ...current, [name]: 'installing' }))
    setNotice(null)
    setNeedsRestart(null)
    install(name).then((value) => {
      if (value.ok) {
        patchResult(name, { version: value.version ?? '', isBundle: value.isBundle ?? false, isClient: value.isClient ?? false })
        if (value.needsRestart === true) setNeedsRestart(name)
      }
      setNotice(value.ok
        ? { kind: 'success', text: `${t('installDone')}${name}${value.needsRestart === true ? ` · ${t('restartHint')}` : ''}` }
        : { kind: 'error', text: `${t('installFailed')}${name}: ${value.error ?? ''}` })
    }, (error: unknown) => {
      setNotice({ kind: 'error', text: `${t('installFailed')}${name}: ${String((error as Error)?.message ?? error)}` })
    }).finally(() => {
      setBusy((current) => {
        const next = { ...current }
        delete next[name]
        return next
      })
      setInstalledTick((value) => value + 1)
    })
  }

  const doUninstall = (name: string): void => {
    if (busy[name] !== undefined) return
    setBusy((current) => ({ ...current, [name]: 'uninstalling' }))
    setNotice(null)
    setNeedsRestart(null)
    uninstall(name).then((value) => {
      if (value.ok) {
        patchResult(name, null)
        if (value.needsRestart === true) setNeedsRestart(name)
      }
      setNotice(value.ok
        ? { kind: 'success', text: `${t('uninstallDone')}${name}${value.needsRestart === true ? ` · ${t('restartHint')}` : ''}` }
        : { kind: 'error', text: `${t('uninstallFailed')}${name}: ${value.error ?? ''}` })
    }, (error: unknown) => {
      setNotice({ kind: 'error', text: `${t('uninstallFailed')}${name}: ${String((error as Error)?.message ?? error)}` })
    }).finally(() => {
      setBusy((current) => {
        const next = { ...current }
        delete next[name]
        return next
      })
      setInstalledTick((value) => value + 1)
    })
  }

  return (
    <div className={css.section}>
      <form className={css.search} onSubmit={submit}>
        <input
          type="text"
          className={css.searchInput}
          value={query}
          placeholder={t('searchPlaceholder')}
          onChange={(event) => { setQuery(event.target.value) }}
        />
        <button type="submit" className={css.searchButton} disabled={searching}>
          {searching ? t('searching') : t('searchButton')}
        </button>
      </form>
      {searchError !== null && (
        <p className={css.notice} data-kind="error">
          {t('searchFailed')}{searchError}
        </p>
      )}
      {searching && <p className={css.status}>{t('searching')}</p>}
      {!searching && searchError === null && results.length > 0 && (
        <>
          <div className={css.catalogHeading}>
            <h3>{t('catalog')}</h3>
            <span>{results.length}</span>
          </div>
          <ul className={css.cards}>
            {results.map((item) => (
              <ResultCard
                key={item.name}
                t={t}
                item={item}
                busy={busy[item.name]}
                onInstall={() => { doInstall(item.name) }}
                onUninstall={() => { doUninstall(item.name) }}
              />
            ))}
          </ul>
        </>
      )}
      {!searching && searchError === null && results.length === 0 && (
        <p className={css.status}>{t('empty')}</p>
      )}
      {notice !== null && (
        <p className={css.notice} data-kind={notice.kind}>
          {notice.text}
          {notice.kind === 'success' && needsRestart !== null && isTauriShell() && (
            <button
              type="button"
              className={css.restartBtn}
              disabled={restarting}
              onClick={restartService}
            >
              {restarting ? '正在重启服务…' : '立即重启'}
            </button>
          )}
        </p>
      )}
      <div className={css.catalogHeading}>
        <h3>{t('installedTitle')}</h3>
        <span>{installedState.status === 'ready' ? installedState.plugins.length : '…'}</span>
      </div>
      {installedState.status === 'loading' && <p className={css.status}>{t('loadingInstalled')}</p>}
      {installedState.status === 'ready' && installedState.plugins.length === 0 && (
        <p className={css.status}>{t('installedEmpty')}</p>
      )}
      {installedState.status === 'ready' && installedState.plugins.length > 0 && (
        <ul className={css.installedList}>
          {installedState.plugins.map((plugin) => (
            <li key={plugin.name} className={css.installedRow}>
              <div className={css.installedInfo}>
                <span className={css.installedName}>{plugin.name}</span>
                <span className={css.installedMeta}>
                  v{plugin.version}
                  {plugin.isBundle ? ' · bundle' : ''}
                  {plugin.isClient ? ' · client' : ''}
                  {plugin.inBundles ? ` · ${t('active')}` : ''}
                </span>
              </div>
              <button
                type="button"
                className={css.dangerBtn}
                disabled={busy[plugin.name] !== undefined}
                onClick={() => { doUninstall(plugin.name) }}
              >
                {busy[plugin.name] === 'uninstalling' ? t('uninstalling') : t('uninstall')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
