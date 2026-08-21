import { defineConfig } from 'tsdown'

/**
 * Prebuilt theme bundle: `lib/` is shipped as-is (the source theme repo builds
 * `lib/client.js` with its own `build.cjs`). tsdown must not try to rebuild it
 * here — there is no tsc-emitted `lib/types/*` entry — so return an empty
 * `entry` to drop this package from the workspace build.
 */
export default defineConfig({ entry: '' })
