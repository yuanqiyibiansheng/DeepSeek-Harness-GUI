/**
 * Built-in pet catalog. The spritesheet lives in the web frontend's
 * `public/pets/` directory (served verbatim by the frontend-static fallback),
 * so it is referenced by URL rather than bundled imports (tsdown cannot
 * resolve image assets).
 */
import type { PetDescriptor } from './petTypes'

/** Public URL prefix for the builtin spritesheets. */
const PET_ASSET_URL = '/pets'

export const BUILTIN_PETS: readonly PetDescriptor[] = [
  {
    source: 'builtin',
    id: 'deepseek-fat-fish',
    displayName: 'DeepSeek 大肥鱼',
    description: 'DeepSeek 蓝色大肥鱼女仆主题动画桌宠。',
    imageUrl: `${PET_ASSET_URL}/deepseek-fat-fish.webp`,
    spriteVersionNumber: 2,
    spritesheetUrl: `${PET_ASSET_URL}/deepseek-fat-fish.webp`,
    accent: '#3b82f6',
  },
]

export function findBuiltinPet(id: string): PetDescriptor {
  return BUILTIN_PETS.find((pet) => pet.id === id) ?? BUILTIN_PETS[0]!
}
