/**
 * Persona settings section: a textarea over the user-global instructions
 * document with a save action. The section reads the snapshot from its
 * controller and writes through the host instructions wire.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { PersonaSettingsState, PersonaSettingsStore } from './store.ts'
import type { en } from './locales.ts'
import css from './PersonaSection.module.css'

/** Injected dependencies of {@link PersonaSection} (slot `inject`). */
export interface PersonaSectionInjected {
  /** The page store (loaded on mount). */
  controller: PersonaSettingsStore
  /** uSES subscription hook bound to the store. */
  useSnapshot: <T>(selector: (s: PersonaSettingsState) => T) => T
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/** Props delivered by the slot outlet. */
export type PersonaSectionProps = Partial<PersonaSectionInjected>

/** Render the Persona section content column. */
export function PersonaSection(props: PersonaSectionProps): ReactNode {
  const { controller, useSnapshot, t } = props
  if (controller === undefined || useSnapshot === undefined || t === undefined) return null
  return <Loaded controller={controller} useSnapshot={useSnapshot} t={t} />
}

function Loaded({ controller, useSnapshot, t }: Required<PersonaSectionInjected>): ReactNode {
  const state = useSnapshot(s => s)
  const [draft, setDraft] = useState<string>(state.content)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [state.status, controller])

  // Adopt a freshly loaded document into the draft (the first load, or a
  // reload after an external edit). A user mid-edit is never overwritten.
  useEffect(() => {
    if (state.status === 'ready') setDraft(state.content)
  }, [state.status, state.content])

  const save = async (): Promise<void> => {
    setBusy(true)
    setSaved(false)
    setFailure(null)
    const error = await controller.save(draft)
    setBusy(false)
    if (error !== undefined) {
      setFailure(error)
      return
    }
    setSaved(true)
  }

  if (state.status === 'error') {
    return (
      <div className={css.section}>
        <h2 className={css.title}>{t('title')}</h2>
        <p className={css.error}>{`${t('loadFailed')}: ${state.error ?? ''}`}</p>
        <button type="button" className={css.secondaryButton} onClick={() => { void controller.load() }}>
          {t('retry')}
        </button>
      </div>
    )
  }

  return (
    <div className={css.section}>
      <h2 className={css.title}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      <textarea
        className={css.textarea}
        value={draft}
        placeholder={t('placeholder')}
        aria-label={t('title')}
        disabled={busy || state.status !== 'ready'}
        onChange={(event) => {
          setDraft(event.target.value)
          setSaved(false)
        }}
      />
      {draft.trim() === '' ? <p className={css.empty}>{t('empty')}</p> : null}
      {failure !== null ? <p className={css.error}>{`${t('error')}: ${failure}`}</p> : null}
      {saved ? <p className={css.saved}>{t('saved')}</p> : null}
      <div className={css.actions}>
        <button
          type="button"
          className={css.primaryButton}
          disabled={busy || state.status !== 'ready'}
          onClick={() => { void save() }}
        >
          {busy ? t('saving') : t('save')}
        </button>
      </div>
    </div>
  )
}
