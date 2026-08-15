/**
 * Terminal preference row in the General settings section: the startup shell
 * for the integrated terminal panel, persisted through the `terminal`
 * settings namespace — the same shape as the permission-preset row.
 * @module @deepseek-ai/dsh-client-ui-terminal/client/TerminalShellRow
 */

import { useState } from 'react'
import { Menu, IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import clsx from 'clsx'
import { SHELL_OPTIONS } from './terminal-model.ts'
import css from './TerminalShellRow.module.css'

/** Injected face: read and write the persisted shell preference. */
export interface TerminalSettingsInjected {
  /** Read the settings-chosen default shell id. */
  defaultShell: () => string
  /** Persist the chosen shell id. */
  setShell: (shell: string) => void
}

/** Full props: general item runtime share plus locale and injected face. */
export type TerminalShellRowProps =
  PropsRuntime<'settings.general.item'> & PropsLocale<'ui-terminal'> & TerminalSettingsInjected

/**
 * Render the terminal startup-shell selector.
 * @param props - the general item share plus locale and injected face.
 * @returns the selector row.
 */
export function TerminalShellRow({ defaultShell, setShell, t }: TerminalShellRowProps) {
  const [value, setValue] = useState(defaultShell)
  const [open, setOpen] = useState(false)
  const selected = SHELL_OPTIONS.find(option => option.id === value)
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('terminal.shellSetting')}</div>
        <div className={css.desc}>{t('terminal.shellSettingDesc')}</div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        anchor={(
          <button
            type="button"
            className={clsx(css.select, open && css.selectOpen)}
            aria-expanded={open}
            onClick={() => { setOpen(value => !value) }}
          >
            <span>{selected?.label ?? value}</span>
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        )}
        items={SHELL_OPTIONS.map(option => ({ id: option.id, label: option.label }))}
        selectedId={value}
        onSelect={(id) => {
          setOpen(false)
          if (id === value) return
          setValue(id)
          setShell(id)
        }}
        align="end"
        portal
      />
    </div>
  )
}
