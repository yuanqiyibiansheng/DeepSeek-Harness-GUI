/**
 * Plugin Market tab: a curated marketplace of installable plugins over the
 * plugin-market wire. Each row shows the catalog entry with its installed
 * state, and offers install / uninstall / update actions.
 */

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient, PluginInstalledEntry, PluginMarketEntry } from '@deepseek-ai/dsh-client-connection/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './PluginMarketTab.module.css'

/** Registration-side face used by the tab. */
export interface PluginMarketTabInjected {
  /** The wire face for plugin-market RPCs. */
  api: Pick<IApiClient, 'pluginMarket'>
}

/** Full component props assembled by the Settings slot renderer. */
export type PluginMarketTabProps =
  InjectFace<PluginMarketTabInjected>
  & PropsLocale<'settings.pluginInventory'>

type ViewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; market: readonly PluginMarketEntry[]; installed: readonly PluginInstalledEntry[] }

/** Whether a market entry is installed, by package name match. */
function installedOf(
  entry: PluginMarketEntry,
  installed: readonly PluginInstalledEntry[],
): PluginInstalledEntry | undefined {
  const source = entry.source.startsWith('@') ? entry.source : entry.source.split('@')[0]
  return installed.find(row => row.name === source || row.name === entry.source)
}

/** Render the Plugin Market tab. */
export function PluginMarketTab({ api, t }: PluginMarketTabProps): ReactNode {
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [busyId, setBusyId] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const load = async (): Promise<void> => {
    setState({ status: 'loading' })
    try {
      const response = await api.pluginMarket.snapshot({})
      if (!response.result.ok) throw new Error(response.result.error.message)
      setState({
        status: 'ready',
        market: response.result.value.market,
        installed: response.result.value.installed,
      })
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  useEffect(() => { void load() }, [])

  const run = async (id: string, action: 'install' | 'uninstall' | 'update'): Promise<void> => {
    setBusyId(id)
    setFailure(null)
    try {
      if (action === 'install') {
        const response = await api.pluginMarket.install({ id })
        if (response.result.ok) await load()
        else setFailure(response.result.error.message)
      } else if (action === 'uninstall') {
        const response = await api.pluginMarket.uninstall({ id })
        if (response.result.ok) await load()
        else setFailure(response.result.error.message)
      } else {
        const response = await api.pluginMarket.update({})
        if (response.result.ok) await load()
        else setFailure(response.result.error.message)
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setBusyId(null)
    }
  }

  const needle = query.trim().toLocaleLowerCase()
  const filtered = useMemo(
    () => state.status === 'ready'
      ? state.market.filter(entry =>
        needle.length === 0
        || entry.title.toLocaleLowerCase().includes(needle)
        || entry.source.toLocaleLowerCase().includes(needle))
      : [],
    [needle, state],
  )

  const anyInstalled = state.status === 'ready' && state.installed.length > 0

  return (
    <div className={css.section}>
      <div className={css.toolbar}>
        <input
          type="search"
          className={css.search}
          value={query}
          placeholder={t('marketSearch')}
          aria-label={t('marketSearch')}
          onChange={(event) => { setQuery(event.currentTarget.value) }}
        />
        <button type="button" className={css.secondaryButton} onClick={() => { void load() }}>
          {t('retry')}
        </button>
        <button
          type="button"
          className={css.primaryButton}
          disabled={!anyInstalled || busyId !== null}
          onClick={() => { void run('__all__', 'update') }}
        >
          {t('marketUpdateAll')}
        </button>
      </div>

      {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div className={css.failure}>
          <p role="alert">{`${t('marketError')}: ${state.message}`}</p>
          <button type="button" onClick={() => { void load() }}>{t('retry')}</button>
        </div>
      ) : null}
      {failure !== null ? <p className={css.failure} role="alert">{`${t('marketError')}: ${failure}`}</p> : null}

      {state.status === 'ready' ? (
        filtered.length === 0
          ? <p className={css.status}>{t('marketEmpty')}</p>
          : (
            <ul className={css.cards}>
              {filtered.map(entry => {
                const installed = installedOf(entry, state.installed)
                return (
                  <li key={entry.id} className={css.card} data-market-entry={entry.id}>
                    <div className={css.info}>
                      <div className={css.titleRow}>
                        <strong className={css.title}>{entry.title}</strong>
                        {entry.official === true ? <span className={css.officialTag}>{t('marketOfficial')}</span> : null}
                        {entry.author !== undefined ? <span className={css.author}>{entry.author}</span> : null}
                      </div>
                      <p className={css.description}>{entry.description}</p>
                      <code className={css.source}>{entry.source}</code>
                      <div className={css.statusRow}>
                        {installed !== undefined
                          ? <span className={css.installed}>{t('marketInstalled')}</span>
                          : <span className={css.notInstalled}>{t('marketNotInstalled')}</span>}
                      </div>
                    </div>
                    <div className={css.actions}>
                      {installed === undefined ? (
                        <button
                          type="button"
                          className={css.primaryButton}
                          disabled={busyId !== null}
                          onClick={() => { void run(entry.id, 'install') }}
                        >
                          {busyId === entry.id ? t('marketInstalling') : t('marketInstall')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={css.dangerButton}
                          disabled={busyId !== null}
                          onClick={() => { void run(entry.id, 'uninstall') }}
                        >
                          {busyId === entry.id ? t('marketRemoving') : t('marketUninstall')}
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )
      ) : null}
    </div>
  )
}
