/**
 * Project-memory toggle row registered into the General section item slot:
 * title + hint + a switch. Selection follows the persisted setting; the write
 * is routed through the injected face (the plugin's settings scope).
 */
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createProjectMemoryStore } from './project-memory-store.ts'
import css from './ProjectMemoryToggleRow.module.css'

/** Injected business face: the integration write (t rides the standard locale seat). */
export interface ProjectMemoryToggleRowInjected {
  /** Persist the project-memory switch. */
  setEnabled: (enabled: boolean) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type ProjectMemoryToggleRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createProjectMemoryStore>>
  & PropsLocale<'settings.projectMemory'> & ProjectMemoryToggleRowInjected

/**
 * Render the project-memory toggle row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function ProjectMemoryToggleRow({ t, useStore, setEnabled }: ProjectMemoryToggleRowComponentProps) {
  const enabled = useStore(s => s.enabled)
  return (
    <div className={css.group}>
      <div className={css.copy}>
        <div className={css.title}>{t('projectMemory.title')}</div>
        <div className={css.hint}>{t('projectMemory.enabledHint')}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={t('projectMemory.title')}
        className={enabled ? `${css.switch} ${css.on}` : css.switch}
        onClick={() => { setEnabled(!enabled) }}
      >
        <span className={css.knob} aria-hidden />
      </button>
    </div>
  )
}
