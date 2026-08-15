/** Machine value of the preset that requires an explicit GUI risk gate. */
export const FULL_ACCESS_PRESET = 'danger-full-access'

/** Chinese product labels for the shipped sandbox presets. */
const PRESET_LABELS_ZH: Readonly<Record<string, string>> = {
  'read-only': '只读',
  'workspace-write': '工作区写入',
  'danger-full-access': '完全访问',
}

/**
 * Convert conventional kebab-case preset names into user-facing title case.
 * @param name - host-supplied preset label or key.
 * @returns the title-cased conventional key, or a non-kebab label unchanged.
 */
export function displayPresetName(name: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name
  return name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

/**
 * Render a permission preset under its product label.
 * @param value - preset machine value.
 * @param name - host-supplied preset name.
 * @returns the Chinese product label, the Full access product label, or the conventional display name.
 */
export function displayPermissionPreset(value: string, name: string): string {
  const zh = PRESET_LABELS_ZH[value]
  if (zh !== undefined) return zh
  return value === FULL_ACCESS_PRESET ? '完全访问' : displayPresetName(name)
}
