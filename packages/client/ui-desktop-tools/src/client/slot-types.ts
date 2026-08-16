/**
 * Desktop-tools locale namespace declaration. Kept in its own module so both
 * the plugin entry and the dock component (and their tests) see the merge.
 */
import type { DesktopToolsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Desktop-tools balance dock and notification copy. */
    'desktopTools': DesktopToolsKey
  }
}
