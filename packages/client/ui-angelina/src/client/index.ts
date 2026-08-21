import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ThemeDefinition } from '@deepseek-ai/dsh-client-ui-theme/client'
import { ANGELINA_THEMES } from '../themes.ts'
import { AngelinaParallaxController } from './angelina-parallax.ts'
import { installAngelinaStyles } from './style.ts'

const THEME_ATTRIBUTE = 'data-ds-theme'

export const inject = ['theme']

declare module '@deepseek-ai/cordis' {
  interface Context {
    theme: import('@deepseek-ai/dsh-client-ui-theme/client').ThemeRuntime
  }
  interface Events {
    /**
     * Resolved theme snapshot changed.
     * @mode emit
     * @param snapshot - latest theme snapshot.
     */
    'theme/change'(snapshot: import('@deepseek-ai/dsh-client-ui-theme/client').ThemeSnapshot): void
  }
}

function registerAngelinaThemes(ctx: ClientContext): () => void {
  const disposers = ANGELINA_THEMES.map(theme => ctx.theme.register(theme satisfies ThemeDefinition))
  return () => { for (const dispose of disposers.reverse()) dispose() }
}

function installThemeAttributePresenter(ctx: ClientContext): () => void {
  const previous = document.body.getAttribute(THEME_ATTRIBUTE)
  let presented = previous
  const sync = (snapshot: import('@deepseek-ai/dsh-client-ui-theme/client').ThemeSnapshot): void => {
    presented = snapshot.active.id
    document.body.setAttribute(THEME_ATTRIBUTE, presented)
  }
  sync(ctx.theme.getTheme())
  const offChange = ctx.on('theme/change', payload => { sync(payload as import('@deepseek-ai/dsh-client-ui-theme/client').ThemeSnapshot) })
  return () => {
    offChange()
    if (document.body.getAttribute(THEME_ATTRIBUTE) !== presented) return
    if (previous === null) document.body.removeAttribute(THEME_ATTRIBUTE)
    else document.body.setAttribute(THEME_ATTRIBUTE, previous)
  }
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => registerAngelinaThemes(ctx), 'ui-angelina: themes')
  ctx.effect(() => installThemeAttributePresenter(ctx), 'ui-angelina: active theme attribute')
  ctx.effect(() => installAngelinaStyles(), 'ui-angelina: styles')
  ctx.effect(() => {
    const parallax = new AngelinaParallaxController()
    parallax.sync(ctx.theme.getTheme().active.id)
    const offChange = ctx.on('theme/change', payload => {
      parallax.sync((payload as import('@deepseek-ai/dsh-client-ui-theme/client').ThemeSnapshot).active.id)
    })
    return () => { offChange(); parallax.dispose() }
  }, 'ui-angelina: parallax')
}
