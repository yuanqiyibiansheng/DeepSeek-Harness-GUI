/**
 * Plugin Market sidebar footer action: a button that opens the plugin market
 * as a full-viewport overlay, reusing the same PluginMarketTab content the
 * Settings Plugins tab shows. This gives ComfyUI-Manager-style access from the
 * main shell without threading through the settings modal.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  IconCloseOutline16, IconPersonalizationOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginMarketTabInjected } from './PluginMarketTab.tsx'
import { PluginMarketTab } from './PluginMarketTab.tsx'
import css from './PluginMarketAction.module.css'

/** Full component props assembled by the slot renderer. */
export type PluginMarketActionProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<PluginMarketTabInjected>

/** Sidebar footer action that opens the plugin market overlay. */
export function PluginMarketAction({ wide, api, t }: PluginMarketActionProps): ReactNode {
  const [open, setOpen] = useState(false)

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open])

  return (
    <>
      <button
        type="button"
        className={css.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen(true) }}
      >
        <IconPersonalizationOutline16 size={wide ? 16 : 18} />
        {wide && <span className={css.triggerLabel}>{t('marketNav')}</span>}
      </button>
      {open && (
        <div className={css.overlay} role="presentation">
          <div className={css.mask} aria-hidden="true" onClick={() => { setOpen(false) }} />
          <div className={css.panel} role="dialog" aria-modal="true" aria-label={t('marketNav')}>
            <div className={css.header}>
              <strong className={css.title}>{t('marketNav')}</strong>
              <button type="button" className={css.close} onClick={() => { setOpen(false) }} aria-label={t('close')}>
                <IconCloseOutline16 size={14} />
              </button>
            </div>
            <div className={css.body}>
              <PluginMarketTab api={api} t={t} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
