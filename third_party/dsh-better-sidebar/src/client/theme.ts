/**
 * Live theme access for surfaces that cannot consume the token colors
 * directly — xterm's palette and CodeMirror's theme extensions need concrete
 * values, but the app's scheme flips at runtime (ui-layout's ThemePresenter
 * projects prefers-color-scheme and the user's choice onto
 * body[data-ds-dark-theme] and html { color-scheme }). This module reads the
 * resolved scheme and token values, and notifies subscribers on flips, so
 * the terminal and the editor re-theme in place instead of freezing in the
 * scheme they happened to be created under.
 */

/** Whether the app shell resolved to the dark scheme.
 *
 * The presenter sets `html { color-scheme }` together with the body palette
 * attribute, so a set color-scheme means the decision is authoritative (an
 * absent attribute is then LIGHT even when the OS prefers dark — the user
 * chose light). Before the presenter has run, fall back to the OS media
 * query as the best guess.
 */
export function isDarkScheme(): boolean {
  if (typeof document === 'undefined') return true
  const decided = document.documentElement.style.colorScheme !== ''
  if (decided) return document.body.hasAttribute('data-ds-dark-theme')
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
}

/** One token's computed value on <body> ('' while the theme has not applied). */
export function tokenValue(name: string): string {
  if (typeof document === 'undefined') return ''
  return getComputedStyle(document.body).getPropertyValue(name).trim()
}

/**
 * Subscribe to color-scheme flips (the presenter toggles the body
 * attribute). The callback fires after the attribute changed; re-read the
 * scheme inside it.
 * @returns the disposer.
 */
export function subscribeColorScheme(callback: () => void): () => void {
  if (typeof document === 'undefined') return () => {}
  const observer = new MutationObserver(() => { callback() })
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
  return () => { observer.disconnect() }
}
