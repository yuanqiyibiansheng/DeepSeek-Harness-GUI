/**
 * Skills settings section: a table of user-owned skills with model/user
 * invocation toggles and a delete action. The section reads the joined
 * snapshot from its controller and writes through the skills wire; a row-level
 * failure stays in the row, never in the section banner.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ManagedSkillEntry } from '@deepseek-ai/dsh-client-connection/client'
import type { SkillsSettingsState, SkillsSettingsStore } from './store.ts'
import type { en } from './locales.ts'
import css from './SkillsSection.module.css'

/** Injected dependencies of {@link SkillsSection} (slot `inject`). */
export interface SkillsSectionInjected {
  /** The page store (loaded on mount, refreshed on pushed invalidations). */
  controller: SkillsSettingsStore
  /** uSES subscription hook bound to the store. */
  useSnapshot: <T>(selector: (s: SkillsSettingsState) => T) => T
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/** Props delivered by the slot outlet. */
export type SkillsSectionProps = Partial<SkillsSectionInjected>

/** One row's mutation status: which toggle is in flight, and its failure text. */
interface RowState {
  toggling: 'model' | 'user' | undefined
  failure: string | null
}
/** Render the Skills section content column. */
export function SkillsSection(props: SkillsSectionProps): ReactNode {
  const { controller, useSnapshot, t } = props
  if (controller === undefined || useSnapshot === undefined || t === undefined) return null
  return <Loaded controller={controller} useSnapshot={useSnapshot} t={t} />
}

function Loaded({ controller, useSnapshot, t }: Required<SkillsSectionInjected>): ReactNode {
  const state = useSnapshot(s => s)
  const [rowStates, setRowStates] = useState<ReadonlyMap<string, RowState>>(new Map())
  const [deleteTarget, setDeleteTarget] = useState<ManagedSkillEntry | undefined>(undefined)
  const [deleting, setDeleting] = useState(false)
  const [deleteFailure, setDeleteFailure] = useState<string | null>(null)

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [state.status, controller])

  const markToggling = (name: string, which: 'model' | 'user'): void => {
    setRowStates(current => new Map(current).set(name, { toggling: which, failure: null }))
  }

  const clearToggling = (name: string, failure: string | null | undefined): void => {
    setRowStates(current => new Map(current).set(name, { toggling: undefined, failure: failure ?? null }))
  }

  const toggleModel = async (skill: ManagedSkillEntry): Promise<void> => {
    markToggling(skill.name, 'model')
    const failure = await controller.toggle(skill.name, { modelInvocable: !skill.modelInvocable })
    clearToggling(skill.name, failure)
  }

  const toggleUser = async (skill: ManagedSkillEntry): Promise<void> => {
    markToggling(skill.name, 'user')
    const failure = await controller.toggle(skill.name, { userInvocable: !skill.userInvocable })
    clearToggling(skill.name, failure)
  }

  const confirmDelete = (): void => {
    if (deleteTarget === undefined || deleting) return
    setDeleting(true)
    setDeleteFailure(null)
    void controller.remove(deleteTarget.name)
      .then((failure) => {
        if (failure !== undefined && failure !== null) {
          setDeleteFailure(failure)
          return
        }
        setDeleteTarget(undefined)
      })
      .finally(() => { setDeleting(false) })
  }

  if (state.status === 'error') {
    return (
      <div className={css.section}>
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
      {state.skills.length === 0
        ? <p className={css.empty}>{t('empty')}</p>
        : (
          <ul className={css.rows}>
            {state.skills.map(skill => {
              const row = rowStates.get(skill.name)
              const toggling = row?.toggling
              return (
                <li key={skill.name} className={css.rowCard}>
                  <div className={css.rowHead}>
                    <span className={css.rowName}>{skill.name}</span>
                    {!skill.loadable
                      ? <span className={css.rowTag}>{t('unloadable')}</span>
                      : null}
                  </div>
                  <p className={css.rowDescription}>
                    {skill.description === '' ? t('notLoadableHint') : skill.description}
                  </p>
                  <p className={css.rowPath}>{skill.path}</p>
                  {row?.failure !== null && row?.failure !== undefined
                    ? <p className={css.error}>{`${t('failed')}: ${row.failure}`}</p>
                    : null}                  <div className={css.rowActions}>
                    <button
                      type="button"
                      className={css.toggleButton}
                      aria-pressed={skill.modelInvocable}
                      disabled={toggling !== undefined || !skill.loadable}
                      onClick={() => { void toggleModel(skill) }}
                    >
                      <span className={css.toggleTrack} data-on={skill.modelInvocable || undefined} />
                      <span className={css.toggleLabel}>
                        {toggling === 'model' ? t('toggling') : skill.modelInvocable ? t('modelOn') : t('modelOff')}
                      </span>
                    </button>
                    <button
                      type="button"
                      className={css.toggleButton}
                      aria-pressed={skill.userInvocable}
                      disabled={toggling !== undefined || !skill.loadable}
                      onClick={() => { void toggleUser(skill) }}
                    >
                      <span className={css.toggleTrack} data-on={skill.userInvocable || undefined} />
                      <span className={css.toggleLabel}>
                        {toggling === 'user' ? t('toggling') : skill.userInvocable ? t('userOn') : t('userOff')}
                      </span>
                    </button>
                    <button
                      type="button"
                      className={css.dangerButton}
                      disabled={toggling !== undefined}
                      onClick={() => {
                        setDeleteTarget(skill)
                        setDeleteFailure(null)
                      }}
                    >
                      {t('remove')}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      <Modal
        open={deleteTarget !== undefined}
        onClose={() => { if (!deleting) setDeleteTarget(undefined) }}
        title={deleteTarget === undefined ? '' : t('removeSkill').replace('{name}', deleteTarget.name)}
        closeLabel={t('close')}
        description={t('removeDescription')}
        footer={(
          <>
            <Button variant="outline" autoFocus disabled={deleting} onClick={() => { setDeleteTarget(undefined) }}>
              {t('cancel')}
            </Button>
            <Button
              variant="outline"
              className={css.deleteConfirm}
              disabled={deleting}
              onClick={confirmDelete}
            >
              {deleteTarget === undefined ? '' : t('removeConfirm').replace('{name}', deleteTarget.name)}
            </Button>
          </>
        )}
      >
        {deleteFailure === null ? null : <p className={css.error}>{deleteFailure}</p>}
      </Modal>
    </div>
  )
}
