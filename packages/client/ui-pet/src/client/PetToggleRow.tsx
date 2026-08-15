/**
 * Pet visibility toggle row registered into the General section item slot:
 * title + hint + a switch. Selection follows the persisted setting; the write
 * is routed through the injected face (the plugin's settings scope).
 */
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createPetToggleStore } from './pet-toggle-store.ts'
import css from './PetToggleRow.module.css'

/** Injected business face: the visibility write (t rides the standard locale seat). */
export interface PetToggleRowInjected {
  /** Persist the pet visibility switch. */
  setEnabled: (enabled: boolean) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type PetToggleRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createPetToggleStore>>
  & PropsLocale<'settings.pet'> & PetToggleRowInjected

/**
 * Render the pet toggle row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function PetToggleRow({ t, useStore, setEnabled }: PetToggleRowComponentProps) {
  const enabled = useStore(s => s.enabled)
  return (
    <div className={css.group}>
      <div className={css.copy}>
        <div className={css.title}>{t('pet.title')}</div>
        <div className={css.hint}>{t('pet.enabledHint')}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={t('pet.title')}
        className={enabled ? `${css.switch} ${css.on}` : css.switch}
        onClick={() => { setEnabled(!enabled) }}
      >
        <span className={css.knob} aria-hidden />
      </button>
    </div>
  )
}
