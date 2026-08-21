/**
 * The market's card on the plugin configuration page (dsh >= 0.1.0-rc.7).
 *
 * It manages the market ITSELF — version, update, remove. That is the whole
 * scope on purpose: this page is where a user goes to deal with a plugin,
 * and "which version am I on / update it / get rid of it" is the part of
 * that anybody can act on without knowing how DSH is put together.
 *
 * `allowRestart` deliberately does NOT appear here. It exists for hosts
 * where a supervisor (systemd, launchd, pm2, Docker `restart: always`, a
 * desktop wrapper) owns the process, and its audience is whoever wrote that
 * deployment — a person already editing config, not someone browsing
 * settings. As a switch it read as jargon to everyone else, which is worse
 * than absent: a control you cannot evaluate is a control you cannot safely
 * touch. It remains a config option.
 *
 * ## Why the chrome is hand-built (again), and why it now matches
 *
 * The host's own contract is that "a plugin that ships a browser half owns
 * its own card" — the plugins tab only lays out a flex column and dispatches
 * `settings.plugin.item`. So the container IS ours to draw, and a value
 * import from `dsh-client-ui-settings-plugins` would fail the client
 * bundle-purity gate anyway.
 *
 * What the first version got wrong was drawing something of its own
 * invention: a flat, always-expanded box next to rows that collapse and
 * carry a chevron. The fix is not a different component — `DisclosureRow` is
 * 24px chrome for compact flow rows, a different thing — but the same design
 * tokens, laid out the way the host lays out `PluginCard`. Classes below
 * mirror it one for one, so the market stops looking like it wandered in
 * from another product.
 */
import type { ReactElement } from 'react';
import type { Translate } from './market-data.ts';
export interface SettingsCardProps {
    t: Translate;
    /**
     * Retire the market's own entry in the left settings menu.
     *
     * Called once the package is gone. Leaving "插件市场" in the menu after
     * the user removed it is the card asserting something the profile no
     * longer agrees with — and the section behind it can no longer talk to a
     * server that has disposed its routes.
     */
    onRemoved?: () => void;
}
/**
 * Clear the market's browser-side leftovers.
 *
 * These are the only two things the market keeps in the browser, and the
 * server cannot reach either. Neither holds a credential — the WebDAV
 * password is never persisted and a Gist token is read from the environment,
 * never from disk — so this is tidiness, not a security step, and the copy
 * must not imply otherwise.
 */
export declare function clearBrowserState(storage: Pick<Storage, 'removeItem'>): void;
export declare function SettingsCard({ t, onRemoved }: SettingsCardProps): ReactElement | null;
//# sourceMappingURL=SettingsCard.d.ts.map