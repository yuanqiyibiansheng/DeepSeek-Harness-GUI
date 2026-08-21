/**
 * dsh-market client: registers a "Market" settings section rendering the
 * plugin market UI, plus the post-install toast in the shell overlay layer.
 * Built by tsdown into the __ModuleLoader__ factory bundle at
 * client/client.js; the only externals are the loader module table's react
 * entries.
 */
import { createElement as h } from 'react';
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives';
import { en, zh } from "./locales.js";
import { InstallToast } from "./InstallToast.js";
import { MarketSection } from "./MarketSection.js";
import { SettingsCard } from "./SettingsCard.js";
const NS = 'dsh-market';
/**
 * Primitives this bundle relies on that did not exist before rc.6. The
 * primitives module is host-injected (external at build time), so on an
 * older host the module resolves but these named exports are undefined —
 * rendering would throw and blank the whole settings dialog. Returning the
 * gaps lets apply() skip registration for a clean downgrade instead.
 */
export const REQUIRED_PRIMITIVES = ['Menu', 'DisclosureRow', 'Tooltip', 'Toast'];
export function missingPrimitives(mod, required = REQUIRED_PRIMITIVES) {
    return required.filter(name => mod[name] === undefined);
}
export const name = 'dsh-market';
// 'theme' is safe to require: ui-layout (mandatory in every web composition)
// already hard-depends on it. This cordis's object-form inject means
// intercept config, NOT {required,optional} — do not use it here.
export const inject = ['slots', 'locale', 'theme'];
export function apply(ctx) {
    // Older hosts resolve the primitives module but lack the rc.6 exports the
    // market renders with. Skip registration (market simply absent from the
    // settings list) rather than throwing mid-render and blanking the dialog.
    const gaps = missingPrimitives(primitives);
    if (gaps.length > 0) {
        console.warn('[dsh-market] host ui-primitives missing ' + gaps.join(', ') + ' — market section disabled (dsh web >= 0.1.0-rc.6 required)');
        return;
    }
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-market: dictionaries');
    const t = ctx.locale.bind(NS);
    // Kept so the removal flow can retire the market's own nav entry the
    // moment the package is gone: leaving "插件市场" in the left menu after
    // the user removed it is the card claiming something the profile no
    // longer agrees with. `register` hands back its own disposer; calling it
    // twice (here and again when the context unwinds) is harmless, but the
    // reference is dropped after use so the intent stays readable.
    let retireSection = null;
    ctx.slots.inject('settings.section', () => {
        const off = ctx.slots.register({
            name: 'settings.section',
            id: 'market',
            order: 40,
            label: () => t('nav'),
            locale: NS,
            inject: () => ({ t }),
        }, () => h(MarketSection, {
            t,
            locale: ctx.locale,
            theme: ctx.theme,
            themeStore: {
                subscribe: (cb) => ctx.on('theme/change', cb),
                getSnapshot: () => ctx.theme.getTheme(),
            },
        }));
        if (typeof off === 'function')
            retireSection = off;
        return off;
    });
    // The settings card (dsh >= 0.1.0-rc.7). Registered through a NESTED
    // inject on purpose: naming settingsScope in the module-level `inject`
    // would keep this whole plugin unmounted on any host without that
    // service — the market's own page would vanish on rc.6 to gain a card
    // rc.6 cannot render. Nested, the card simply never appears there.
    const settingsCtx = ctx;
    settingsCtx.inject(['settingsScope'], (scoped) => {
        scoped.slots.inject('settings.plugin.item', () => scoped.slots.register({
            name: 'settings.plugin.item',
            key: NS,
            locale: NS,
            inject: () => ({ t }),
        }, () => h(SettingsCard, { t, onRemoved: () => { const off = retireSection; retireSection = null; off?.(); } })));
    });
    const Toast = () => h(InstallToast, { t });
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'dsh-market-toast',
        label: () => 'dsh-market',
    }, Toast));
}
//# sourceMappingURL=index.js.map