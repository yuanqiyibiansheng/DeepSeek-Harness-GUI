import { defineConfig } from 'tsdown'

/**
 * Prebuilt bundle: `lib/` is shipped as-is (the plugin publishes a built
 * `lib/client.js`). tsdown must not try to rebuild it here — there is no
 * tsc-emitted `lib/types/*` entry — so return an empty `entry` to drop this
 * package from the workspace build.
 */
export default defineConfig({ entry: '' })
