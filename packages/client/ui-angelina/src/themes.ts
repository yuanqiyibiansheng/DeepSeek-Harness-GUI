import { ANGELINA_THEMES } from './themes.generated.ts'

export { ANGELINA_THEMES }
export type ThemeDefinition = (typeof ANGELINA_THEMES)[number]

export const ANGELINA_IDS = new Set<string>(ANGELINA_THEMES.map(theme => theme.id))
