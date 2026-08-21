import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * The Market settings section: Discover / Themes / Installed tabs over the
 * /dsh-market/* host routes, with install/update/uninstall flows and the
 * pending-restart bookkeeping in sessionStorage.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Button, DisclosureRow, IconChevronDownOutline14, IconChevronLeftOutline14, IconChevronRightOutline14, IconChevronUpOutline14, IconCheckOutline16, IconCodeOutline16, IconCordisPluginOutline14, IconDownloadOutline16, IconFolderOpen16, IconLinkOutline14, IconLoadingOutline16, IconQuestionOutline14, IconRefreshOutline14, IconSearchOutline16, IconSparkle16, IconWarningOutline16, Input, Menu, Modal, Pill, StateDot, Toast, Tooltip, } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './Market.module.css';
import { OperationsPanel } from "./OperationsPanel.js";
import { clearSettled, drop, enqueue, patch as patchRecord, recordForUrl } from "./operations.js";
import { Diagnostics } from "./Diagnostics.js";
import { avatarColor, entryForDep, groupSwitchState, humanOutput, isInstalled, looksTerminal, matchInstalledName, orderedCategories, formatCount, pageItems, pluginName, pluginScreenshots, readSession, safeScreenshots, themePlugins as themePluginsOf, themeSwatch, TIME_RANGE_DAYS, visiblePlugins, } from "./market-data.js";
function isHostDependencyFinding(value) {
    if (value === null || typeof value !== 'object')
        return false;
    const finding = value;
    return finding.code === 'shared-host-package-dependency'
        && finding.severity === 'warning'
        && finding.subject?.kind === 'package'
        && typeof finding.subject.name === 'string'
        && finding.evidence?.basis === 'manifest-declaration'
        && typeof finding.evidence?.dependency === 'string'
        && typeof finding.evidence.declaredRange === 'string'
        && finding.evidence.declaredIn === 'dependencies';
}
const HOST_DEPENDENCY_PREVIEW_LIMIT = 5;
function HostDependencyDiagnostics({ findings, t, }) {
    if (findings.length === 0)
        return null;
    const preview = findings.slice(0, HOST_DEPENDENCY_PREVIEW_LIMIT);
    const remaining = findings.length - preview.length;
    return (_jsxs("div", { className: css.banner, children: [_jsx(IconWarningOutline16, { size: 14, className: css.bannerIcon }), _jsxs("span", { className: css.grow, children: [_jsx("div", { children: t('hostDependencyWarning') }), preview.map(finding => (_jsxs("div", { className: css.spec, children: [finding.subject.name, " \u2192 ", finding.evidence.dependency, "@", finding.evidence.declaredRange] }, `${finding.subject.name}:${finding.evidence.dependency}`))), remaining > 0 && (_jsx("div", { className: css.spec, children: t('hostDependencyMore').replace('{0}', String(remaining)) }))] })] }));
}
/** The state label + dot for one activation result (P0-2). */
function activationMeta(state, t) {
    if (state === 'live')
        return { label: t('stateLive'), dot: 'done' };
    if (state === 'restart')
        return { label: t('stateRestart'), dot: 'warning' };
    if (state === 'inert')
        return { label: t('stateInert'), dot: 'warning' };
    if (state === 'broken')
        return { label: t('stateBroken'), dot: 'error' };
    if (state === 'disabled')
        return { label: t('stateDisabled'), dot: 'warning' };
    return { label: '—', dot: 'warning' };
}
function phaseLabel(phase, t) {
    if (phase === 'resolving')
        return t('phaseResolving');
    if (phase === 'downloading')
        return t('phaseDownloading');
    if (phase === 'linking')
        return t('phaseLinking');
    return t('phaseBuilding');
}
/**
 * Page/page-size state shared by every paged list in this file (Discover,
 * Themes) — each caller owns its OWN instance (their filters are
 * independent, a search in one tab has no business resetting the other's
 * page), but the mechanics (clamp against a shrinking list, reset to page 1
 * when the filters that produced `count` change, scroll back to the top of
 * the shared body on any page move) are one implementation, not two.
 */
function usePagination(count, resetDeps, scrollToTop) {
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resetDeps IS the intended dependency list, supplied by the caller.
    useEffect(() => { setPage(1); }, resetDeps);
    const totalPages = Math.max(1, Math.ceil(count / pageSize));
    // Clamp in case the list shrank while the user was on a later page.
    const currentPage = Math.min(page, totalPages);
    const goToPage = (next) => {
        setPage(Math.max(1, Math.min(next, totalPages)));
        scrollToTop();
    };
    const changePageSize = (size) => {
        setPageSize(size);
        setPage(1);
        scrollToTop();
    };
    return { currentPage, totalPages, pageSize, goToPage, changePageSize };
}
/**
 * The sort/time-range dropdown (primitives Menu): three independent option
 * groups, ids namespaced so one onSelect routes by prefix. Owns its own
 * open state — a caller wires only the sort VALUES, not the dropdown's UI
 * state, so Discover and Themes can each mount one without threading an
 * extra `filterOpen`/`setFilterOpen` pair through their own state.
 */
function FilterMenu({ sortField, sortDir, timeRange, onSortField, onSortDir, onTimeRange, t }) {
    const [open, setOpen] = useState(false);
    // Direction labels adapt to the field: stars → asc/desc, added → oldest/newest.
    const sortDirLabel = (dir) => sortField === 'added'
        ? dir === 'desc' ? 'sortNewest' : 'sortOldest'
        : dir === 'desc' ? 'sortDesc' : 'sortAsc';
    const items = useMemo(() => [
        { type: 'label', id: 'f-sort', text: t('filterSort') },
        ...SORT_FIELD_OPTIONS.map(opt => ({ id: 'field:' + opt.key, label: t(opt.label) })),
        { type: 'separator', id: 'f-sep1' },
        { type: 'label', id: 'f-dir', text: t('filterDir') },
        ...SORT_DIR_OPTIONS.map(dir => ({ id: 'dir:' + dir, label: t(sortDirLabel(dir)) })),
        { type: 'separator', id: 'f-sep2' },
        { type: 'label', id: 'f-time', text: t('filterTime') },
        ...TIME_OPTIONS.map(opt => ({ id: 'time:' + opt.key, label: t(opt.label) })),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- sortDirLabel closes only over sortField, already a dep.
    ], [t, sortField]);
    const selectedIds = useMemo(() => ['field:' + sortField, 'dir:' + sortDir, 'time:' + timeRange], [sortField, sortDir, timeRange]);
    const onSelect = (id) => {
        if (id.startsWith('field:'))
            onSortField(id.slice(6));
        else if (id.startsWith('dir:'))
            onSortDir(id.slice(4));
        else if (id.startsWith('time:'))
            onTimeRange(id.slice(5));
    };
    return (_jsx(Menu, { open: open, onClose: () => setOpen(false), onSelect: onSelect, selectedIds: selectedIds, align: "end", portal: true, anchor: (_jsx(Button, { variant: "outline", size: "sm", icon: open ? _jsx(IconChevronUpOutline14, { size: 14 }) : _jsx(IconChevronDownOutline14, { size: 14 }), onClick: () => setOpen(o => !o), children: t('filter') })), items: items }));
}
/** First/prev/numbered/next/last controls plus a per-page-size menu — one
 * implementation for every paged list, driven entirely by `usePagination`'s
 * return value. Owns its own page-size dropdown open state for the same
 * reason `FilterMenu` owns its own. */
function Pager({ currentPage, totalPages, pageSize, onGoToPage, onChangePageSize, t }) {
    const [sizeOpen, setSizeOpen] = useState(false);
    return (_jsxs("div", { className: css.pager, children: [_jsx("div", { className: css.pagerPages, children: totalPages > 1 && (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "outline", size: "sm", disabled: currentPage === 1, onClick: () => onGoToPage(1), "aria-label": t('firstPage'), children: "\u00AB" }), _jsx(Button, { variant: "outline", size: "sm", icon: _jsx(IconChevronLeftOutline14, { size: 14 }), disabled: currentPage === 1, onClick: () => onGoToPage(currentPage - 1), children: t('prevPage') }), pageItems(currentPage, totalPages).map((item, i) => (item === '…'
                            ? _jsx("span", { className: css.pageEllipsis, children: "\u2026" }, 'e' + i)
                            : (_jsx(Button, { variant: item === currentPage ? 'primary' : 'outline', size: "sm", onClick: () => onGoToPage(item), children: item }, item)))), _jsxs(Button, { variant: "outline", size: "sm", disabled: currentPage === totalPages, onClick: () => onGoToPage(currentPage + 1), children: [t('nextPage'), _jsx(IconChevronRightOutline14, { size: 14 })] }), _jsx(Button, { variant: "outline", size: "sm", disabled: currentPage === totalPages, onClick: () => onGoToPage(totalPages), "aria-label": t('lastPage'), children: "\u00BB" }), _jsx("span", { className: css.pageInfo, children: t('pageInfo').replace('{0}', String(currentPage)).replace('{1}', String(totalPages)) })] })) }), _jsx(Menu, { open: sizeOpen, onClose: () => setSizeOpen(false), onSelect: id => onChangePageSize(Number(id)), selectedId: String(pageSize), align: "end", portal: true, anchor: (_jsx(Button, { variant: "outline", size: "sm", icon: _jsx(IconChevronDownOutline14, { size: 14 }), onClick: () => setSizeOpen(o => !o), children: t('perPage') + ' ' + pageSize })), items: PAGE_SIZES.map(size => ({ id: String(size), label: String(size) })) })] }));
}
/**
 * Card avatar: the plugin owner's GitHub avatar (no API, browser-cached),
 * falling back to the initial-letter tile when it can't load.
 */
function OwnerAvatar({ name, owner }) {
    const [failed, setFailed] = useState(false);
    if (failed || owner === '') {
        return (_jsx("div", { className: css.av, style: { background: avatarColor(name) }, children: name.replace(/^dsh[-_]/i, '').charAt(0).toUpperCase() || 'P' }));
    }
    return (_jsx("img", { className: css.av, src: `https://github.com/${encodeURIComponent(owner)}.png?size=96`, alt: "", loading: "lazy", onError: () => setFailed(true) }));
}
/**
 * AppStore-style screenshot strip in the install detail dialog (#61).
 * Curated registry screenshots win; otherwise images are extracted from the
 * repo README. Requests start only once the dialog opens; failures — no
 * README, no images, broken links — degrade to rendering nothing at all.
 */
function ScreenshotStrip({ plugin, onOpen }) {
    const [shots, setShots] = useState([]);
    const [broken, setBroken] = useState([]);
    useEffect(() => {
        let live = true;
        setShots([]);
        setBroken([]);
        pluginScreenshots(plugin).then((list) => { if (live)
            setShots(list); });
        return () => { live = false; };
    }, [plugin]);
    const visible = shots.filter(src => !broken.includes(src));
    if (visible.length === 0)
        return null;
    return (_jsx("div", { className: css.shots, children: visible.map((src, i) => (_jsx("img", { className: css.shot, src: thumbUrl(src, 300), alt: "", loading: "lazy", decoding: "async", referrerPolicy: "no-referrer", onClick: () => onOpen(visible, i), onError: () => setBroken(prev => prev.includes(src) ? prev : prev.concat(src)) }, src))) }));
}
/**
 * Advances an index every `intervalMs` while `count > 1` — the shared clock
 * behind both a card's auto-cycling thumbnail and the lightbox. A manual
 * jump (clicking a dot, an arrow, opening on a specific shot) restarts the
 * clock instead of letting it fire again moments later: without that, a
 * deliberate "go back one" reads as broken when it auto-advances right past
 * where the user just navigated to.
 */
function useAutoCarousel(count, initial, intervalMs = 3500) {
    const [index, setIndexState] = useState(initial);
    const [resetTick, setResetTick] = useState(0);
    useEffect(() => {
        if (count <= 1)
            return;
        const timer = setInterval(() => { setIndexState(i => (i + 1) % count); }, intervalMs);
        return () => clearInterval(timer);
    }, [count, intervalMs, resetTick]);
    const setIndex = (i) => {
        if (count <= 0)
            return;
        setIndexState(((i % count) + count) % count);
        setResetTick(t => t + 1);
    };
    return [index, setIndex];
}
/**
 * A card thumbnail (or dialog strip image) renders at well under 150px on
 * screen; the curated screenshot behind it can be a full-resolution PNG
 * several hundred KB to a few MB — GitHub's own hosts offer no resized
 * variant, so rendering the original meant downloading full-size images for
 * a strip nobody asked to see full-size. images.weserv.nl resizes
 * server-side (by decoded HEIGHT, `fit=inside` so it never crops, `we=1` so
 * it never upscales something already smaller) before the bytes reach the
 * browser. The lightbox — an explicit "show me this big" — still requests
 * the ORIGINAL directly: proxying that one too would add a hop with nothing
 * left to save, and once the thumbnail is genuinely smaller it can no longer
 * share a cache entry with the full-size open anyway.
 */
function thumbUrl(src, height) {
    return `https://images.weserv.nl/?url=${encodeURIComponent(src.replace(/^https?:\/\//, ''))}&h=${String(height)}&fit=inside&we=1`;
}
/**
 * True once the wrapped element has scrolled within `rootMargin` of the
 * viewport. Falls back to true immediately where IntersectionObserver is
 * unavailable (old browsers, jsdom without a stub) — a missing observer
 * should degrade to eager loading, not a permanently empty thumbnail.
 * Native `img loading="lazy"` already defers the network fetch on its own,
 * but its trigger distance isn't ours to tune, and scrolling a 400+ entry
 * catalog queues every off-screen card's request the instant the browser
 * decides to start prefetching — this hook is what lets CardShot not even
 * SET `src` until a card is actually close.
 */
function useNearViewport(rootMargin = '200px') {
    const [near, setNear] = useState(typeof IntersectionObserver === 'undefined');
    const [node, setNode] = useState(null);
    useEffect(() => {
        if (near || node === null)
            return;
        const obs = new IntersectionObserver((entries) => {
            if (entries.some(entry => entry.isIntersecting))
                setNear(true);
        }, { rootMargin });
        obs.observe(node);
        return () => obs.disconnect();
    }, [near, node, rootMargin]);
    return [setNode, near];
}
/**
 * A card's own thumbnail strip — curated screenshots only (#61 supplement):
 * this data already rode along with the catalog fetch that drew the grid,
 * so showing it costs nothing extra. README-scraped fallback images stay
 * dialog-only, where fetching one repo's README on click is a single
 * request instead of one per visible card.
 *
 * Horizontal scroll at each image's own aspect ratio, not an auto-cycling
 * single crop: cropping every shot into one fixed box hid most of a tall
 * screenshot, and cycling on a timer meant the card you were looking at
 * kept changing under you. Scrolling is a gesture the user drives.
 */
/** Thumbnails per card. The dialog shows every screenshot; a grid of cards
 * pulling six full-size PNGs each is what makes the first paint crawl. */
const CARD_SHOT_LIMIT = 3;
function CardShot({ plugin, onOpen }) {
    const shots = safeScreenshots(plugin.screenshots);
    const [broken, setBroken] = useState([]);
    const visible = shots.filter(src => !broken.includes(src)).slice(0, CARD_SHOT_LIMIT);
    const [setStripRef, near] = useNearViewport();
    if (visible.length === 0)
        return null;
    return (_jsx("div", { ref: setStripRef, className: css.cardShots, children: visible.map((src, i) => (_jsx("img", { className: css.cardShot, src: near ? thumbUrl(src, 200) : undefined, alt: "", loading: "lazy", decoding: "async", fetchPriority: "low", referrerPolicy: "no-referrer", onClick: (e) => { e.stopPropagation(); onOpen(visible, i); }, onError: () => setBroken(prev => prev.includes(src) ? prev : prev.concat(src)) }, src))) }));
}
/**
 * Two masonry columns holding the cards in ranked order.
 *
 * Cards are dealt alternately (0,2,4… left; 1,3,5… right) rather than split
 * down the middle, so the sort order still reads left-to-right then down —
 * the ranking is the whole point of the sort menu above it. Each column is
 * its own flex stack, so a tall card only pushes down the cards beneath IT
 * instead of leaving a hole beside its shorter neighbour.
 *
 * Below the two-up breakpoint the CSS collapses to one column, and dealing
 * alternately would then interleave the list wrongly — so at one column the
 * cards stay in a single stack in their original order.
 */
function Masonry({ items, render, columns = 2 }) {
    const wide = useMediaWide();
    if (!wide || columns < 2) {
        return _jsx("div", { className: css.masonry, children: _jsx("div", { className: css.masonryCol, children: items.map(render) }) });
    }
    const buckets = Array.from({ length: columns }, () => []);
    items.forEach((item, index) => { buckets[index % columns].push(item); });
    return (_jsx("div", { className: css.masonry, children: buckets.map((bucket, index) => (_jsx("div", { className: css.masonryCol, children: bucket.map(render) }, index))) }));
}
/**
 * Whether the layout is at its two-up width. Matches the CSS breakpoint
 * exactly: the column split is decided in JS but rendered by CSS, and the
 * two disagreeing would deal cards into columns the stylesheet has already
 * stacked.
 */
function useMediaWide() {
    const query = '(min-width: 681px)';
    const subscribe = useCallback((notify) => {
        if (typeof matchMedia !== 'function')
            return () => { };
        const list = matchMedia(query);
        list.addEventListener('change', notify);
        return () => list.removeEventListener('change', notify);
    }, []);
    return useSyncExternalStore(subscribe, () => (typeof matchMedia === 'function' ? matchMedia(query).matches : true), 
    // Server/jsdom without matchMedia: assume the two-up layout, which is
    // what the stylesheet defaults to before any media query applies.
    () => true);
}
/**
 * A card's description, clamped to 5 lines so one wordy entry doesn't blow
 * the two-up grid's row height out for whatever sits beside it — the grid
 * already tolerates SOME height variance by design (`.card`'s `align-self:
 * start`), just not an unbounded one. The toggle only renders when the text
 * actually overflows the clamp: a two-line description has nothing to
 * "expand", so no button beats a button that does nothing.
 */
function CardDesc({ text, t }) {
    const ref = useRef(null);
    const [expanded, setExpanded] = useState(false);
    const [canExpand, setCanExpand] = useState(false);
    useLayoutEffect(() => {
        const el = ref.current;
        if (el === null)
            return;
        setCanExpand(el.scrollHeight > el.clientHeight + 1);
    }, [text]);
    return (_jsxs("div", { children: [_jsx("div", { ref: ref, className: expanded ? css.desc : `${css.desc} ${css.descClamp}`, children: text }), canExpand && (_jsx("button", { type: "button", className: css.descToggle, "aria-label": expanded ? t('descCollapse') : t('descExpand'), onClick: () => setExpanded(e => !e), children: expanded ? _jsx(IconChevronUpOutline14, { size: 14 }) : _jsx(IconChevronDownOutline14, { size: 14 }) }))] }));
}
/**
 * Full-bleed image preview, opened from a card thumbnail or a dialog's
 * screenshot strip. Not the shared Modal primitive: Modal is chrome for a
 * decision (title, description, footer actions); this is just the same
 * already-downloaded image shown bigger — there is no separate "thumbnail"
 * vs "full size" asset to fetch.
 */
function ScreenshotLightbox({ shots, startIndex, onClose, t }) {
    const [index, setIndex] = useAutoCarousel(shots.length, startIndex, 4000);
    useEffect(() => {
        // Capture phase + stopPropagation: the Settings dialog underneath is a
        // Modal with its own Escape-to-close handling, also on window/document.
        // Without this, one Escape press closed both layers at once — verified
        // on a real host — because the modal's bubble-phase listener still fired
        // after this one. Capture runs first and this stops it from reaching
        // bubble phase at all, so only the top layer responds to one press.
        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                onClose();
            }
            else if (e.key === 'ArrowLeft') {
                e.stopPropagation();
                setIndex(index - 1);
            }
            else if (e.key === 'ArrowRight') {
                e.stopPropagation();
                setIndex(index + 1);
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [index]);
    // The primitives' own Modal (the confirm/settings dialog underneath)
    // portals itself to document.body too, so plain in-tree rendering here
    // put the lightbox BEHIND it regardless of z-index — a portal only wins a
    // stacking tie against another portal by mounting later, not by CSS alone.
    // Reported on a real host: "大的预览图层级不对，现在在弹窗的后面".
    return createPortal(_jsxs("div", { className: css.lightbox, onClick: onClose, children: [_jsx("button", { className: css.lightboxClose, "aria-label": t('lightboxClose'), onClick: onClose, children: "\u00D7" }), _jsx("img", { className: css.lightboxImg, src: shots[index], alt: "", onClick: e => e.stopPropagation() }), shots.length > 1 && (_jsxs(_Fragment, { children: [_jsx("button", { className: `${css.lightboxNav} ${css.lightboxPrev}`, "aria-label": t('lightboxPrev'), onClick: (e) => { e.stopPropagation(); setIndex(index - 1); }, children: _jsx(IconChevronLeftOutline14, { size: 18 }) }), _jsx("button", { className: `${css.lightboxNav} ${css.lightboxNext}`, "aria-label": t('lightboxNext'), onClick: (e) => { e.stopPropagation(); setIndex(index + 1); }, children: _jsx(IconChevronRightOutline14, { size: 18 }) }), _jsx("div", { className: css.lightboxDots, onClick: e => e.stopPropagation(), children: shots.map((src, i) => (_jsx("span", { className: i === index ? `${css.lightboxDot} ${css.lightboxDotOn}` : css.lightboxDot, onClick: () => setIndex(i) }, src))) })] }))] }), document.body);
}
/**
 * Official-style market glyph: the shared block-grid brand mark converted to
 * the official monochrome icon form (16×16, fill="currentColor") so it
 * follows the active theme. Mirrors the settings-nav glyph used for the
 * "market" section id.
 */
function MarketLogo({ size = 16, style, animated = false }) {
    return (_jsxs("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true", style: style, children: [_jsxs("g", { fill: "currentColor", children: [_jsx("rect", { x: "1.96", y: "3.36", width: "3.3", height: "3.3", rx: "0.53" }), _jsx("rect", { x: "5.71", y: "3.36", width: "3.3", height: "3.3", rx: "0.53" }), _jsx("rect", { x: "1.96", y: "7.11", width: "3.3", height: "3.3", rx: "0.53" }), _jsx("rect", { x: "5.71", y: "7.11", width: "3.3", height: "3.3", rx: "0.53" }), _jsx("rect", { x: "9.46", y: "7.11", width: "3.3", height: "3.3", rx: "0.53" }), _jsx("rect", { x: "1.96", y: "10.86", width: "3.3", height: "3.3", rx: "0.53" }), _jsx("rect", { x: "5.71", y: "10.86", width: "3.3", height: "3.3", rx: "0.53" }), _jsx("rect", { x: "9.46", y: "10.86", width: "3.3", height: "3.3", rx: "0.53" })] }), _jsx("rect", { className: animated ? css.logoPlug : undefined, x: "10.74", y: "2.09", width: "3.3", height: "3.3", rx: "0.53", fill: "currentColor", transform: animated ? undefined : 'rotate(9 12.39 3.74)' })] }));
}
/**
 * Module-scope caches so re-entering the section renders instantly instead
 * of refetching and rebuilding from a spinner (#30 by @StarsTom). Module
 * state survives section switches; a background refetch keeps it current.
 */
let cachedRegistry = null;
let cachedInstalled = null;
let cachedRepoIdentities = null;
let cachedRepoHints = null;
/** Discover grid page-size choices — the catalog grows daily, so cap each page. */
const PAGE_SIZES = [24, 48, 96];
const DEFAULT_PAGE_SIZE = 24;
const WEBDAV_STORAGE_KEY = 'dshm-webdav';
function savedWebdav() {
    try {
        const value = JSON.parse(localStorage.getItem(WEBDAV_STORAGE_KEY) ?? '{}');
        return {
            url: typeof value.url === 'string' ? value.url : '',
            username: typeof value.username === 'string' ? value.username : '',
            // The password never persists in the browser: plugins run same-origin
            // with dshmarket, so a stored password would be readable by any plugin
            // client on this host and become the weakest credential in the profile
            // (review #63). It lives in server config / memory only.
            password: '',
            auto: value.auto === true,
        };
    }
    catch {
        return { url: '', username: '', password: '', auto: false };
    }
}
function backupDependencies(value) {
    if (value === null || typeof value !== 'object')
        throw new Error('invalid backup');
    const backup = value;
    if (backup.format !== 'dsh-profile-backup' || backup.version !== 0.2)
        throw new Error('unsupported backup format');
    const files = backup.files;
    if (!Array.isArray(files))
        throw new Error('unsupported backup format');
    const manifest = files.find(file => file !== null && typeof file === 'object' && file.path === 'package.json');
    if (manifest?.json === null || typeof manifest?.json !== 'object' || Array.isArray(manifest.json))
        throw new Error('backup package.json is invalid');
    const dependencies = manifest.json.dependencies;
    if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies))
        return {};
    if (!Object.values(dependencies).every(spec => typeof spec === 'string'))
        throw new Error('backup dependencies are invalid');
    return dependencies;
}
function installedRepoIdentities(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return {};
    const identities = {};
    for (const [name, ids] of Object.entries(value)) {
        if (!Array.isArray(ids))
            continue;
        const strings = ids.filter((id) => typeof id === 'string');
        if (strings.length > 0)
            identities[name] = strings;
    }
    return identities;
}
function installedRepoHints(value) {
    return installedRepoIdentities(value);
}
function installedMap(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return {};
    const installed = {};
    for (const [name, spec] of Object.entries(value)) {
        if (typeof spec === 'string')
            installed[name] = spec;
    }
    return installed;
}
function sameInstalledMap(left, right) {
    const names = Object.keys(left);
    return names.length === Object.keys(right).length && names.every(name => left[name] === right[name]);
}
/** Sort field choices in the filter panel. */
const SORT_FIELD_OPTIONS = [
    { key: 'downloads', label: 'sortDownloads' },
    { key: 'stars', label: 'sortStars' },
    { key: 'added', label: 'sortAdded' },
];
/** Sort direction choices in the filter panel (labels depend on the field). */
const SORT_DIR_OPTIONS = ['desc', 'asc'];
/** Published-within choices in the filter panel. */
const TIME_OPTIONS = [
    { key: 'all', label: 'timeAll' },
    { key: 'day', label: 'timeDay' },
    { key: 'week', label: 'timeWeek' },
    { key: 'month', label: 'timeMonth' },
    { key: 'quarter', label: 'timeQuarter' },
    { key: 'year', label: 'timeYear' },
];
export function MarketSection(props) {
    const t = props.t;
    const initialWebdav = useMemo(savedWebdav, []);
    const localeSnap = useSyncExternalStore(cb => props.locale.subscribe(cb), () => props.locale.getSnapshot());
    const lang = String(localeSnap.active).toLowerCase().startsWith('zh') ? 'zh' : 'en';
    // null when the composition has no theme service — the Themes tab hides.
    const themeSnap = useSyncExternalStore(props.themeStore.subscribe, props.themeStore.getSnapshot);
    const [data, setData] = useState(cachedRegistry);
    const [loadError, setLoadError] = useState(null);
    const [installed, setInstalledState] = useState(cachedInstalled ?? {});
    const setInstalled = useCallback((value) => { cachedInstalled = value; setInstalledState(value); }, []);
    const [repoIdentities, setRepoIdentitiesState] = useState(cachedRepoIdentities ?? {});
    const setRepoIdentities = useCallback((value) => {
        cachedRepoIdentities = value;
        setRepoIdentitiesState(value);
    }, []);
    const [repoHints, setRepoHintsState] = useState(cachedRepoHints ?? {});
    const setRepoHints = useCallback((value) => {
        cachedRepoHints = value;
        setRepoHintsState(value);
    }, []);
    const [installedFiles, setInstalledFiles] = useState([]);
    const [skins, setSkins] = useState([]);
    const [tab, setTab] = useState(() => {
        const saved = sessionStorage.getItem('dshm-tab');
        if (saved !== null)
            sessionStorage.removeItem('dshm-tab');
        return saved || 'discover';
    });
    const [q, setQ] = useState('');
    /** Per-tab searches stay independent: discover / themes / installed. */
    const [qThemes, setQThemes] = useState('');
    const [qInstalled, setQInstalled] = useState('');
    const [cat, setCat] = useState('all');
    const [confirming, setConfirming] = useState(null);
    /**
     * Every mutating operation the user started. Records outlive the card that
     * started them, so paginating or searching cannot take a pending decision
     * off screen.
     */
    const [records, setRecords] = useState([]);
    const recordSeq = useRef(0);
    /** Raised by the card marker, so "查看详情" lands on the record itself. */
    const [operationsOpen, setOperationsOpen] = useState(false);
    const openOperations = useCallback(() => setOperationsOpen(true), []);
    /**
     * Two plugins can ship under one name from different authors, so a roster
     * row that shows only the package name cannot tell the user which of their
     * plugins a swap would uninstall. Resolve through the catalog for the
     * author and avatar a card would show, and fall back to the bare name for
     * anything installed outside it.
     */
    const describePlugin = useCallback((name) => {
        const entry = data?.plugins.find(plugin => plugin.npm === name || plugin.name === name);
        if (entry === undefined)
            return { title: name };
        return {
            title: pluginName(entry.name),
            author: entry.owner === '' ? undefined : entry.owner,
            avatar: _jsx(OwnerAvatar, { name: entry.name, owner: entry.owner || '' }),
        };
    }, [data]);
    /** Ids are sequential rather than random so a replayed session is stable. */
    const nextRecordId = useCallback(() => {
        recordSeq.current += 1;
        return `op-${String(recordSeq.current)}`;
    }, []);
    const [replacing, setReplacing] = useState(false);
    /** Shared by every screenshot source (card thumbnail, dialog strip). */
    const [lightbox, setLightbox] = useState(null);
    const openLightbox = (shots, index) => setLightbox({ shots, index });
    const [busyUrl, setBusyUrl] = useState(null);
    /** Consecutive idle polls with a pending install that never landed (#32). */
    const idleStrikes = useRef(0);
    /** Same idle-strike bookkeeping for an update whose response was lost. */
    const updateIdleStrikes = useRef(0);
    const [doneUrls, setDoneUrls] = useState([]);
    const [installError, setInstallError] = useState(null);
    const [compatibilityNotice, setCompatibilityNotice] = useState(null);
    const [rollingBack, setRollingBack] = useState(false);
    /** Log export lifecycle for visible feedback (#84): idle → busy → done/fail. */
    const [exportState, setExportState] = useState('idle');
    /**
     * Programmatic log download with explicit feedback (#84) — the plain
     * `<a download>` gave no sign anything happened, and the error banner's
     * "export the log" wording pointed at text that was not clickable at all.
     * Success/failure surface as a primitives Toast (body portal, no layout
     * impact) instead of inline text.
     */
    const doExportLog = useCallback(() => {
        setExportState('busy');
        fetch('/dsh-market/logs')
            .then(async (res) => {
            if (!res.ok)
                throw new Error(`HTTP ${String(res.status)}`);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = 'dsh-market-log.txt';
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(url);
            setExportState('done');
        })
            .catch(() => setExportState('fail'));
    }, []);
    /** Stable onDone for the export Toast — a fresh closure per render would
     * reset the Toast's auto-dismiss timer on every parent re-render. */
    const exportToastDone = useCallback(() => setExportState('idle'), []);
    const [updates, setUpdates] = useState({});
    const [updatingName, setUpdatingName] = useState(null);
    // Plugin blocked by pnpm's fresh-release safety wait; arms the update-now button.
    const [staleName, setStaleName] = useState(null);
    /** Determinate percent parsed from pnpm's Progress line, when available. */
    const [progressPct, setProgressPct] = useState(null);
    /**
     * Blocked build scripts from the last install or update: enables
     * approve-and-retry (#6; updates in #69). Exactly one of `plugin`
     * (retry installs it) / `updateName` (retry re-runs the update) is set.
     */
    const [buildsSkipped, setBuildsSkipped] = useState(null);
    const [updatingAll, setUpdatingAll] = useState(false);
    const [updatedNames, setUpdatedNames] = useState([]);
    const [hotUrls, setHotUrls] = useState([]);
    const [hotNames, setHotNames] = useState([]);
    const [progressLine, setProgressLine] = useState(null);
    /** Per-package activation states from /dsh-market/installed + operations. */
    const [activations, setActivations] = useState({});
    /** #60: persisted disable list + custom groups, straight from /installed. */
    const [disabledNames, setDisabledNames] = useState([]);
    /**
     * Patch-layer flags (port of dsh-plugin-hub): packages whose bundle rows
     * the user patch layer disables / force-enables. The UI treats them as the
     * real switch state so hand-edited cordis.patch.yml toggles are visible.
     */
    const [patchDisabledNames, setPatchDisabledNames] = useState([]);
    const [groups, setGroups] = useState({});
    const [groupOrder, setGroupOrder] = useState([]);
    /** Installed-tab sub-view: flat list or groups (All-plugins was removed —
     * it duplicated the Discover tab). */
    const [installedView, setInstalledView] = useState('list');
    const [togglingName, setTogglingName] = useState(null);
    // Group editor state (create / rename / delete / assign).
    const [creatingGroup, setCreatingGroup] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    const [renamingGroup, setRenamingGroup] = useState(null);
    const [renamingValue, setRenamingValue] = useState('');
    const [deletingGroup, setDeletingGroup] = useState(null);
    /** Open group picker: which group and whether it adds plugins or themes. */
    const [addPanel, setAddPanel] = useState(null);
    const [assignFor, setAssignFor] = useState(null);
    const [assignTarget, setAssignTarget] = useState('');
    /** Structured progress from pnpm ndjson (P1-6). */
    const [progressPhase, setProgressPhase] = useState(null);
    const [progressCurrent, setProgressCurrent] = useState(null);
    const [progressDone, setProgressDone] = useState(0);
    const [cancelling, setCancelling] = useState(false);
    /** Server-side operation lock from /dsh-market/status (#91). */
    const [hostBusy, setHostBusy] = useState(false);
    /**
     * The market's own version, shown beside the heading. Most bug reports
     * arrive as a photo of the screen, and without a version in frame the
     * first reply always has to ask which one it was.
     */
    const [version, setVersion] = useState(null);
    /** Non-live activation results from the last operation, shown as a banner. */
    const [activationWarnings, setActivationWarnings] = useState([]);
    const [hostDependencyFindings, setHostDependencyFindings] = useState([]);
    /** Plugin name awaiting uninstall confirmation (Modal). */
    const [removeConfirm, setRemoveConfirm] = useState(null);
    const [removingName, setRemovingName] = useState(null);
    const [removedCount, setRemovedCount] = useState(0);
    /** Toggles whose live fiber did not follow the switch — restart to apply. */
    const [toggleRestart, setToggleRestart] = useState(0);
    /**
     * Dismissal of the host-reported restart notice, keyed to the current boot
     * so it reappears after a restart that did not happen and after any new
     * change. sessionStorage, not local: closing the tab is a fresh start.
     */
    const [restartNoticeDismissed, setRestartNoticeDismissed] = useState(false);
    /** Client-part plugins toggled this session — their UI needs a refresh. */
    const [refreshNames, setRefreshNames] = useState([]);
    const [envReady, setEnvReady] = useState(true);
    const [envFixing, setEnvFixing] = useState(false);
    const [envFailed, setEnvFailed] = useState(false);
    const [bootId, setBootId] = useState(null);
    /** One-click restart (#14 by @ysyyhhh): server capability + in-flight state. */
    const [restartEnabled, setRestartEnabled] = useState(false);
    /** Supervisor the host detected around itself, when it named one (#229). */
    const [supervisor, setSupervisor] = useState(null);
    const [restarting, setRestarting] = useState(false);
    const [showTop, setShowTop] = useState(false);
    const [backupBusy, setBackupBusy] = useState(false);
    const [backupMessage, setBackupMessage] = useState(null);
    const [backupRestored, setBackupRestored] = useState(false);
    const [pendingBackup, setPendingBackup] = useState(null);
    const [pendingDependencies, setPendingDependencies] = useState({});
    const [webdavUrl, setWebdavUrl] = useState(initialWebdav.url);
    const [webdavUser, setWebdavUser] = useState(initialWebdav.username);
    const [webdavPassword, setWebdavPassword] = useState(initialWebdav.password);
    const [autoBackup, setAutoBackup] = useState(initialWebdav.auto);
    /** GitHub token — session memory only, never written to any storage. */
    const [gistToken, setGistToken] = useState('');
    /** Gist id — persisted across reloads (non-sensitive: the Gist itself is private). */
    const [gistId, setGistId] = useState(() => {
        try {
            return localStorage.getItem('dshm-gist-id') ?? '';
        }
        catch {
            return '';
        }
    });
    /** Export mode: 'update' PATCHes the Gist in the field, 'create' makes a new one. */
    const [gistMode, setGistMode] = useState(() => {
        try {
            return localStorage.getItem('dshm-gist-id') ? 'update' : 'create';
        }
        catch {
            return 'create';
        }
    });
    const [gistBusy, setGistBusy] = useState(false);
    const [gistMessage, setGistMessage] = useState(null);
    const [gistOk, setGistOk] = useState(false);
    const [gistResult, setGistResult] = useState(null);
    /** Export picker: open state, selected plugin names, include-config flag. */
    const [exportOpen, setExportOpen] = useState(false);
    const [exportSelection, setExportSelection] = useState(new Set());
    const [exportIncludeConfig, setExportIncludeConfig] = useState(false);
    /** Export failure shown INSIDE the picker so it is never hidden behind it. */
    const [exportError, setExportError] = useState(null);
    /** Bundle-only plugin names from /dsh-market/installed (picker list). */
    const [installedBundles, setInstalledBundles] = useState([]);
    const bodyRef = useRef(null);
    /** Hidden file input behind the Import button (a Button can't host an <input>). */
    const fileInputRef = useRef(null);
    const [sortField, setSortField] = useState('downloads');
    const [sortDir, setSortDir] = useState('desc');
    const [timeRange, setTimeRange] = useState('all');
    const [catsOpen, setCatsOpen] = useState(false);
    /** Themes tab: independent from Discover's sort/time state above — a
     * search or sort choice in one tab has no business resetting the other. */
    const [themeSortField, setThemeSortField] = useState('downloads');
    const [themeSortDir, setThemeSortDir] = useState('desc');
    const [themeTimeRange, setThemeTimeRange] = useState('all');
    /** WebDAV provider-preset dropdown (primitives Menu). */
    const [presetOpen, setPresetOpen] = useState(false);
    /** Install-command disclosure inside the confirm dialog. */
    const [cmdOpen, setCmdOpen] = useState(false);
    /** Per-row "why is it not live" disclosure (installed tab). */
    const [whyOpen, setWhyOpen] = useState(null);
    /** Restore-confirm dialog (replaces window.confirm). */
    const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
    /** Plugins that failed to install during a restore (replaces window.alert). */
    const [restoreErrors, setRestoreErrors] = useState([]);
    // How many category pills fit in the two collapsed rows (measured once —
    // the settings panel width is fixed); null = measuring render with all
    // pills clamped, then slice so the chevron flows inline after the last one.
    const [visibleCats, setVisibleCats] = useState(null);
    /** Same idea as `visibleCats`, but how many fit in a single row — used to
     *  shrink an expanded (2+ row) category list while the sticky header is
     *  pinned during scroll, distinct from the two-row collapsed default. */
    const [visibleCatsOneRow, setVisibleCatsOneRow] = useState(null);
    const catsWrapRef = useRef(null);
    // Whether the sticky header is currently pinned to the top of the scroll
    // area. Tracked via a sentinel just above it rather than a scrollTop
    // threshold: the threshold would have to hard-code the header's offset
    // (padding, sticky `top`), which drifts silently whenever that CSS
    // changes. The sentinel just reports what's actually true on screen.
    const [catsStuck, setCatsStuck] = useState(false);
    const [catsSentinel, setCatsSentinel] = useState(null);
    const refreshInstalled = useCallback((force) => {
        fetch('/dsh-market/installed', { cache: 'no-store' })
            .then(res => res.json())
            .then(body => {
            setInstalled(body.installed || {});
            setRepoIdentities(installedRepoIdentities(body.repoIdentities));
            setRepoHints(installedRepoHints(body.repoHints));
            setInstalledFiles(Array.isArray(body.present) ? body.present : Object.keys(body.installed || {}));
            setSkins(body.live || []);
            if (Array.isArray(body.disabled))
                setDisabledNames(body.disabled);
            if (Array.isArray(body.patchDisabled))
                setPatchDisabledNames(body.patchDisabled);
            if (body.groups && typeof body.groups === 'object')
                setGroups(body.groups);
            if (Array.isArray(body.groupOrder))
                setGroupOrder(body.groupOrder);
            setInstalledBundles(Array.isArray(body.bundles) ? body.bundles.filter((name) => typeof name === 'string') : []);
            if (body.activation && typeof body.activation === 'object')
                setActivations(body.activation);
            const findings = body.diagnostics?.schema === 'dsh-market/diagnostics/v1'
                && Array.isArray(body.diagnostics.findings)
                ? body.diagnostics.findings.filter(isHostDependencyFinding)
                : [];
            setHostDependencyFindings(findings);
        })
            .catch(() => { });
        fetch('/dsh-market/updates' + (force === true ? '?force=1' : ''), { cache: 'no-store' })
            .then(res => res.json())
            .then(body => setUpdates(body.updates || {}))
            .catch(() => { });
    }, []);
    /** Lookup set for the persisted disable list (#60). */
    const disabledSet = useMemo(() => new Set(disabledNames), [disabledNames]);
    /** Effective switch state: market disable list ∪ user-patch-layer disables. */
    const effectiveDisabledSet = useMemo(() => new Set([...disabledNames, ...patchDisabledNames]), [disabledNames, patchDisabledNames]);
    const loadCatalog = useCallback(() => {
        setLoadError(null);
        return fetch('/dsh-market/registry', { cache: 'no-store' })
            .then(async (res) => {
            const body = (await res.json().catch(() => ({})));
            if (!res.ok)
                throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${String(res.status)}`);
            return body;
        })
            .then((body) => {
            if (body.registry === undefined)
                throw new Error('the catalog response carried no data');
            cachedRegistry = body.registry;
            setData(body.registry);
            setLoadError(null);
        })
            // Report WHY. An unreachable catalog used to be answered with a
            // bundled copy, so "cannot reach the registry" and "the catalog is
            // smaller today" looked identical on screen — and the second reading
            // is the one users reached.
            .catch((error) => { setLoadError(error instanceof Error ? error.message : String(error)); });
    }, []);
    useEffect(() => {
        void loadCatalog();
        fetch('/dsh-market/status', { cache: 'no-store' })
            .then(res => res.json())
            .then(status => {
            setEnvReady(status.pnpm !== false);
            if (typeof status.boot === 'string') {
                setBootId(status.boot);
                // A dismissal only silences the notice for the boot it was made
                // in: if the user dismissed instead of restarting, the next boot
                // (or a stale dismissal from a previous one) shows it again.
                try {
                    setRestartNoticeDismissed(sessionStorage.getItem('dshm-restart-dismissed') === status.boot);
                }
                catch { /* storage unavailable */ }
            }
            setRestartEnabled(status.restart === true);
            setSupervisor(typeof status.supervisor === 'string' ? status.supervisor : null);
            if (typeof status.version === 'string' && status.version !== '')
                setVersion(status.version);
        })
            .catch(() => { });
        refreshInstalled();
    }, [refreshInstalled, loadCatalog]);
    // Pending-restart flags survive tab switches and page reloads, scoped to
    // one host process: a different boot id means the restart happened and the
    // stale banner must not resurrect.
    useEffect(() => {
        if (bootId === null)
            return;
        const saved = readSession('dshm-restart');
        if (saved === null)
            return;
        if (saved.boot !== bootId) {
            sessionStorage.removeItem('dshm-restart');
            return;
        }
        if (Array.isArray(saved.doneUrls) && saved.doneUrls.length > 0)
            setDoneUrls(saved.doneUrls);
        if (Array.isArray(saved.updated) && saved.updated.length > 0)
            setUpdatedNames(saved.updated);
        if (typeof saved.removed === 'number' && saved.removed > 0)
            setRemovedCount(saved.removed);
        if (typeof saved.toggled === 'number' && saved.toggled > 0)
            setToggleRestart(saved.toggled);
    }, [bootId]);
    useEffect(() => {
        if (bootId === null)
            return;
        if (doneUrls.length === 0 && updatedNames.length === 0 && removedCount === 0 && toggleRestart === 0) {
            // Nothing pending: drop any stale entry (e.g. a hot mount cleared the
            // only doneUrl) so a same-boot remount cannot resurrect the banner (#73).
            sessionStorage.removeItem('dshm-restart');
            return;
        }
        sessionStorage.setItem('dshm-restart', JSON.stringify({
            boot: bootId,
            doneUrls,
            updated: updatedNames,
            removed: removedCount,
            toggled: toggleRestart,
        }));
    }, [bootId, doneUrls, updatedNames, removedCount, toggleRestart]);
    const fixEnv = useCallback(() => {
        setEnvFixing(true);
        setEnvFailed(false);
        fetch('/dsh-market/setup-pnpm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
            .then(res => res.json())
            .then(body => {
            if (body.ok) {
                setEnvReady(true);
            }
            else {
                setEnvFailed(true);
                if (typeof body.error === 'string')
                    setInstallError(body.error);
            }
        })
            .catch(() => setEnvFailed(true))
            .finally(() => setEnvFixing(false));
    }, []);
    // Recover an install whose HTTP response was lost (page navigated away or
    // the connection dropped): the pending marker survives in sessionStorage and
    // the poll below converges the button state from the host's ground truth.
    useEffect(() => {
        const pending = readSession('dshm-pending');
        if (pending !== null && typeof pending.url === 'string')
            setBusyUrl(pending.url);
        // Same recovery for an update in flight: closing the config page unmounts
        // this section and drops `updatingName` with it, so the running row's
        // progress vanished on reopen. The marker restores the row and the poll
        // below converges it from the host's ground truth.
        const updating = readSession('dshm-updating');
        if (updating !== null && typeof updating.name === 'string' && updating.name !== '')
            setUpdatingName(updating.name);
    }, []);
    useEffect(() => {
        if (busyUrl === null && updatingName === null) {
            setProgressLine(null);
            setProgressPhase(null);
            setProgressCurrent(null);
            setProgressDone(0);
            setCancelling(false);
            return;
        }
        const timer = setInterval(() => {
            fetch('/dsh-market/status', { cache: 'no-store' })
                .then(res => res.json())
                .then(status => {
                setHostBusy(status.busy === true);
                if (status.active) {
                    setCancelling(status.cancelling === true);
                    if (status.phase !== null && status.phase !== undefined) {
                        // Structured pnpm progress: stage + current package + count.
                        setProgressPhase(status.phase);
                        setProgressCurrent(status.currentPackage ?? null);
                        setProgressDone(status.done ?? 0);
                        setProgressLine(null);
                        if (typeof status.size === 'number' && status.size > 0 && typeof status.downloaded === 'number') {
                            setProgressPct(Math.max(4, Math.min(96, Math.round(status.downloaded / status.size * 100))));
                        }
                    }
                    else {
                        setProgressLine((status.lastLine || '…') + '  (' + status.seconds + 's)');
                        setProgressPhase(null);
                        setProgressCurrent(null);
                        setProgressDone(0);
                        const m = /resolved (\d+), reused (\d+), downloaded (\d+), added (\d+)/.exec(status.lastLine || '');
                        if (m !== null && Number(m[1]) > 0) {
                            const done = Number(m[2]) + Number(m[3]) + Number(m[4]);
                            setProgressPct(Math.max(4, Math.min(96, Math.round(done / Number(m[1]) * 100))));
                        }
                    }
                }
                else {
                    setProgressLine(null);
                    setProgressPct(null);
                    setProgressPhase(null);
                    setProgressCurrent(null);
                    setProgressDone(0);
                    setCancelling(false);
                    const statusInstalled = installedMap(status.installed);
                    if (!sameInstalledMap(installed, statusInstalled))
                        refreshInstalled();
                    const pending = readSession('dshm-pending');
                    // status.busy (#91): pnpm exited but the install route still
                    // holds the operation lock (validation, hot-mount). Neither
                    // declare the install done nor count an idle strike yet — a
                    // premature banner here invited a restart click into a 409.
                    if (pending !== null && busyUrl !== null && status.busy !== true) {
                        const nowInstalled = data !== null && data.plugins.some(p => p.url === busyUrl && isInstalled(p, statusInstalled, repoIdentities, data.plugins, repoHints));
                        if (nowInstalled) {
                            idleStrikes.current = 0;
                            sessionStorage.removeItem('dshm-pending');
                            setDoneUrls(urls => urls.includes(busyUrl) ? urls : urls.concat(busyUrl));
                            setBusyUrl(null);
                        }
                        else if (++idleStrikes.current >= 2) {
                            // Host is idle and the plugin never landed: the install died
                            // (e.g. exit 127) with its response lost. Without this the
                            // button says "installing" forever — across reloads (#32).
                            idleStrikes.current = 0;
                            sessionStorage.removeItem('dshm-pending');
                            setBusyUrl(null);
                            setInstallError(t('installFail') + ' — ' + t('exportLog'));
                        }
                    }
                    // An update whose response was lost — the page was closed mid-run
                    // and reopened via the dshm-updating marker — converges the same
                    // way. Once the host reports the operation fully settled (pnpm
                    // exited AND the mutation lock released), hand the running row
                    // back to the refreshed listing instead of showing "updating"
                    // forever. Two idle polls guard the brief window before the host
                    // has actually started the command.
                    if (updatingName !== null && status.busy !== true) {
                        if (++updateIdleStrikes.current >= 2) {
                            updateIdleStrikes.current = 0;
                            sessionStorage.removeItem('dshm-updating');
                            setUpdatingName(null);
                            refreshInstalled();
                        }
                    }
                    else {
                        updateIdleStrikes.current = 0;
                    }
                }
            })
                .catch(() => { });
        }, 2000);
        return () => clearInterval(timer);
    }, [busyUrl, updatingName, data, installed, repoIdentities, repoHints, refreshInstalled]);
    const scrollToTop = () => {
        const el = bodyRef.current;
        if (el) {
            // jsdom (tests) lacks Element.scrollTo — fall back to the assignment.
            if (typeof el.scrollTo === 'function')
                el.scrollTo({ top: 0, behavior: 'smooth' });
            else
                el.scrollTop = 0;
        }
    };
    const plugins = useMemo(() => (data === null ? [] : visiblePlugins(data.plugins, {
        category: cat, query: q, lang,
        sort: `${sortField}-${sortDir}`,
        sinceDays: timeRange === 'all' ? undefined : TIME_RANGE_DAYS[timeRange],
    })), [data, q, cat, lang, sortField, sortDir, timeRange]);
    const { currentPage, totalPages, pageSize, goToPage, changePageSize } = usePagination(plugins.length, [q, cat, sortField, sortDir, timeRange], scrollToTop);
    const pagePlugins = plugins.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    const themePlugins = useMemo(() => (data === null ? [] : visiblePlugins(data.plugins, {
        category: 'theme', query: qThemes, lang,
        sort: `${themeSortField}-${themeSortDir}`,
        sinceDays: themeTimeRange === 'all' ? undefined : TIME_RANGE_DAYS[themeTimeRange],
    })), [data, qThemes, lang, themeSortField, themeSortDir, themeTimeRange]);
    const themePagination = usePagination(themePlugins.length, [qThemes, themeSortField, themeSortDir, themeTimeRange], scrollToTop);
    const themePagePlugins = themePlugins.slice((themePagination.currentPage - 1) * themePagination.pageSize, themePagination.currentPage * themePagination.pageSize);
    /** Download a host endpoint as a file — primitives Button can't be an <a download>.
     * Prefers the server's Content-Disposition filename (e.g. the timestamped
     * backup export) and falls back to the caller's name. */
    const downloadFile = useCallback((url, filename) => {
        fetch(url)
            .then(res => {
            if (!res.ok)
                throw new Error('HTTP ' + res.status);
            const disposition = res.headers.get('content-disposition');
            if (disposition !== null) {
                const match = /filename="?([^";]+)"?/.exec(disposition);
                if (match !== null && match[1] !== undefined && match[1] !== '')
                    filename = match[1];
            }
            return res.blob();
        })
            .then(blob => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        })
            .catch(error => setInstallError(String(error)));
    }, []);
    const doRollback = useCallback((rollbackId) => {
        setRollingBack(true);
        setInstallError(null);
        fetch('/dsh-market/rollback', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ rollbackId }),
        })
            .then(res => res.json().then(body => ({ status: res.status, body })))
            .then(({ status, body }) => {
            if (status === 200 && body.ok) {
                setCompatibilityNotice(null);
                refreshInstalled();
            }
            else {
                setInstallError(String(body.error || body.detail || 'rollback failed'));
            }
        })
            .catch(error => setInstallError(String(error)))
            .finally(() => setRollingBack(false));
    }, [refreshInstalled]);
    const compatibilitySummary = (risks) => {
        if (risks.length === 0)
            return '';
        const first = risks[0];
        return `${first.plugin}: ${first.peer} ${first.range} vs ${first.resolved}`;
    };
    /** Which name now resolves from two layers, and which layers those are. */
    const shadowSummary = (entries) => {
        if (entries.length === 0)
            return '';
        const first = entries[0];
        const rest = entries.length > 1 ? ` (+${entries.length - 1})` : '';
        return `${first.name} — ${first.layers.join(' / ')}${rest}`;
    };
    const doInstall = useCallback((plugin) => {
        setBuildsSkipped(null);
        setConfirming(null);
        setInstallError(null);
        setActivationWarnings([]);
        setBusyUrl(plugin.url);
        // One record per attempt. A retry appends rather than reusing the old
        // one, so the card resolves to the newest and its Install button returns.
        const recordId = nextRecordId();
        setRecords(list => enqueue(list, {
            id: recordId, kind: 'install', name: plugin.name, url: plugin.url, state: 'running',
        }));
        sessionStorage.setItem('dshm-pending', JSON.stringify({ url: plugin.url }));
        fetch('/dsh-market/install', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url: plugin.url }),
        })
            .then(res => res.json().then(body => ({ status: res.status, body })))
            .then(({ status, body }) => {
            setBusyUrl(null);
            sessionStorage.removeItem('dshm-pending');
            if (status === 200 && body.ok && body.hot && plugin.category === 'theme') {
                // Themes auto-activate on install; reload straight into the Themes
                // tab so the new look is on screen immediately.
                sessionStorage.setItem('dshm-toast', JSON.stringify([plugin.name]));
                sessionStorage.setItem('dshm-tab', 'themes');
                location.reload();
                return;
            }
            if (body.cancelled === true) {
                // User-cancelled: quiet reset, nothing to report.
                setRecords(list => drop(list, recordId));
                refreshInstalled();
                if (body.partial === true)
                    setInstallError(t('partialNote'));
                return;
            }
            if (status === 200 && body.ok) {
                sessionStorage.setItem('dshm-tab', 'installed');
                if (body.activation && typeof body.activation === 'object') {
                    setActivations(prev => ({ ...prev, ...body.activation }));
                    const warns = Object.entries(body.activation)
                        .filter(([, info]) => info.state !== 'live' && info.state !== 'missing')
                        .map(([name, info]) => ({ name, info }));
                    setActivationWarnings(warns);
                }
                if (body.hot) {
                    // The status-poll recovery path may have already counted this URL
                    // as pending-restart before the install response confirmed a hot
                    // mount; a hot plugin must not stay in doneUrls (#73).
                    setDoneUrls(urls => urls.filter(url => url !== plugin.url));
                    setHotUrls(urls => urls.includes(plugin.url) ? urls : urls.concat(plugin.url));
                    setHotNames(names => names.includes(plugin.name) ? names : names.concat(plugin.name));
                }
                else {
                    setDoneUrls(urls => urls.includes(plugin.url) ? urls : urls.concat(plugin.url));
                }
                if (body.compatibility?.code === 'soft-incompatible') {
                    setCompatibilityNotice(body.compatibility);
                }
                // `warned` keeps the ✓: the plugin IS installed, so calling a
                // compatibility risk a failure would misreport what happened.
                setRecords(list => patchRecord(list, recordId, body.compatibility?.code === 'soft-incompatible'
                    ? { state: 'warned', reason: t('compatRiskBanner') }
                    : { state: 'done', needsRefresh: body.hot !== true }));
                refreshInstalled();
            }
            else {
                if (status === 409) {
                    const busyReason = body.agentsBusy === true
                        ? t('agentBusyInstall') + (Array.isArray(body.runningAgents) && body.runningAgents.length > 0 ? ` (${body.runningAgents.join(', ')})` : '')
                        : t('busyWait');
                    setRecords(list => patchRecord(list, recordId, { state: 'failed', reason: busyReason }));
                    setOperationsOpen(true);
                    return;
                }
                // A clash is not a failure to report and forget: the host already
                // reverted it, so what remains is a decision. `input` keeps the
                // record in the panel until the user answers it.
                if (Array.isArray(body.conflictGroups) && body.conflictGroups.length > 0) {
                    setRecords(list => patchRecord(list, recordId, {
                        state: 'input', conflicts: body.conflictGroups,
                    }));
                    // Raise the panel for anything that needs an answer. A red dot on
                    // a closed panel is not a report; out of sight is out of mind.
                    setOperationsOpen(true);
                    return;
                }
                if (Array.isArray(body.ignoredBuilds) && body.ignoredBuilds.length > 0) {
                    setBuildsSkipped({ plugin, names: body.ignoredBuilds.map(String) });
                }
                const text = (v) => typeof v === 'string' ? v : (v && typeof v.text === 'string') ? v.text : v == null ? '' : JSON.stringify(v);
                const detail = text(body.error) || humanOutput([text(body.stderr), text(body.stdout)].filter(Boolean).join('\n')) || ('exit ' + body.exitCode);
                setRecords(list => patchRecord(list, recordId, { state: 'failed', reason: detail.trim().slice(-600) }));
                setOperationsOpen(true);
            }
        })
            .catch(() => {
            // #100: a long install can outlive its HTTP response (loopback
            // stacks and proxies reset idle connections) while pnpm keeps
            // working server-side — declaring failure here produced a false
            // "install failed, export the log" with an EMPTY log (the route
            // only logs when it finishes), followed by the plugin quietly
            // appearing minutes later. Keep dshm-pending and the busy button
            // instead, and let the status poll decide: its recovery path marks
            // success once the plugin lands (busy-aware since #91) and strikes
            // out genuinely dead installs (#32).
        });
    }, [nextRecordId, refreshInstalled, t]);
    /**
     * Resolve a loader-id clash the only way one profile allows: uninstall the
     * plugins holding the ids, then retry the install. Sequential because each
     * route takes the host's mutation lock, so a parallel burst would 409.
     *
     * A failure part-way leaves plugins already gone. Nothing reinstalls them
     * automatically (a rollback would itself be an install that can fail), so
     * the message names them — reporting only "failed" would leave the user
     * guessing which of their plugins survived.
     */
    const doReplace = useCallback(async (record, plugin) => {
        setInstallError(null);
        setReplacing(true);
        const removed = [];
        try {
            for (const group of record.conflicts ?? []) {
                const response = await fetch('/dsh-market/uninstall', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ name: group.owner }),
                });
                const body = await response.json();
                if (response.status !== 200 || body.ok !== true) {
                    const text = (v) => typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v);
                    const detail = (text(body.error) || humanOutput(text(body.stderr)) || 'error').trim().slice(-400);
                    const reason = removed.length === 0
                        ? `${t('installFail')}: ${group.owner} — ${detail}`
                        : `${t('conflictReplaceFailed')} ${removed.join(', ')} — ${detail}`;
                    setRecords(list => patchRecord(list, record.id, { state: 'failed', conflicts: undefined, reason }));
                    setOperationsOpen(true);
                    refreshInstalled();
                    return;
                }
                removed.push(group.owner);
            }
        }
        finally {
            setReplacing(false);
        }
        // The clash record is done with; the retry opens its own, so the card
        // resolves to the new attempt rather than the answered decision.
        setRecords(list => drop(list, record.id));
        refreshInstalled();
        doInstall(plugin);
    }, [doInstall, refreshInstalled, t]);
    /**
     * Answer a clash. `keep` is not a no-op to skip: it is the user declining
     * the install, so the record retires rather than lingering as unanswered.
     */
    const resolveConflict = useCallback((record, choice) => {
        if (choice === 'keep') {
            setRecords(list => patchRecord(list, record.id, {
                state: 'failed', conflicts: undefined, reason: t('conflictDeclined'),
            }));
            return;
        }
        const plugin = data?.plugins.find(candidate => candidate.url === record.url);
        if (plugin === undefined)
            return;
        void doReplace(record, plugin);
    }, [data, doReplace, t]);
    /**
     * Restart the host and reload once the boot id changes (#14 by @ysyyhhh).
     * The 202 races the process's SIGTERM, so network errors on the initial
     * request are expected and treated as "restart under way".
     */
    const doRestart = useCallback(() => {
        if (bootId === null || restarting)
            return;
        const previousBoot = bootId;
        setRestarting(true);
        setInstallError(null);
        const awaitNewBoot = () => {
            const deadline = Date.now() + 60000;
            const poll = () => {
                fetch('/dsh-market/status', { cache: 'no-store' })
                    .then(res => res.json())
                    .then((next) => {
                    if (typeof next.boot === 'string' && next.boot !== previousBoot) {
                        location.reload();
                        return;
                    }
                    retry();
                })
                    .catch(retry);
            };
            const retry = () => {
                if (Date.now() > deadline) {
                    setRestarting(false);
                    setInstallError(t('restartTimeout'));
                    return;
                }
                setTimeout(poll, 1500);
            };
            poll();
        };
        const requestRestart = (attemptsLeft) => {
            fetch('/dsh-market/restart', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
                .then(res => res.json().then(body => ({ status: res.status, body })))
                .then(({ status, body }) => {
                if (status === 202 && body.ok === true) {
                    awaitNewBoot();
                    return;
                }
                // 409 = the install route still holds the operation lock for its
                // post-processing (#91) — a short quiet retry beats surfacing
                // "cannot restart while a plugin operation is running" to a user
                // who just followed our own banner.
                if (status === 409 && attemptsLeft > 0) {
                    setTimeout(() => requestRestart(attemptsLeft - 1), 1500);
                    return;
                }
                setRestarting(false);
                setInstallError(t('restartFail') + ': ' + String(body.error || ('HTTP ' + String(status))));
            })
                .catch(awaitNewBoot); // the host may die mid-response; keep polling
        };
        requestRestart(10);
    }, [bootId, restarting, t]);
    /** Cancel the running plugin command (#6 by @qichuang321). */
    const doCancel = useCallback(() => {
        fetch('/dsh-market/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
            .catch(() => { });
    }, []);
    const doUpdate = useCallback((name, force = false) => {
        setInstallError(null);
        setActivationWarnings([]);
        setStaleName(null);
        setUpdatingName(name);
        updateIdleStrikes.current = 0;
        // Mirror the install flow's dshm-pending marker: closing the config page
        // unmounts this section and drops `updatingName`, so the running row's
        // progress was lost on reopen. The marker survives the unmount and lets a
        // reopen restore the row while the status poll converges the outcome.
        sessionStorage.setItem('dshm-updating', JSON.stringify({ name }));
        return fetch('/dsh-market/update', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(force ? { name, force: true } : { name }),
        })
            .then(res => res.json().then(body => ({ status: res.status, body })))
            .then(({ status, body }) => {
            // A response means the host settled the request (even a 4xx/5xx), so
            // the running row can hand back now. Only a lost response keeps the
            // marker + row for the poll to converge.
            sessionStorage.removeItem('dshm-updating');
            setUpdatingName(null);
            if (body.cancelled === true) {
                refreshInstalled();
                if (body.partial === true)
                    setInstallError(t('partialNote'));
                return;
            }
            if (status === 200 && body.ok) {
                setUpdatedNames(names => names.concat(name));
                if (body.activation && typeof body.activation === 'object') {
                    setActivations(prev => ({ ...prev, ...body.activation }));
                }
                if (body.compatibility?.code === 'soft-incompatible') {
                    setCompatibilityNotice(body.compatibility);
                }
                refreshInstalled();
            }
            else {
                if (status === 409) {
                    if (body.agentsBusy === true) {
                        const running = Array.isArray(body.runningAgents) && body.runningAgents.length > 0 ? ` (${body.runningAgents.join(', ')})` : '';
                        setInstallError(t('agentBusyUpdate') + running);
                        return;
                    }
                    setInstallError(t('busyWait'));
                    return;
                }
                if (body.stale === true)
                    setStaleName(name);
                // Blocked build scripts during an update (#69): same
                // approve-and-retry banner as the install flow, retrying the update.
                if (Array.isArray(body.ignoredBuilds) && body.ignoredBuilds.length > 0) {
                    setBuildsSkipped({ updateName: name, names: body.ignoredBuilds.map(String) });
                }
                const text = (v) => typeof v === 'string' ? v : (v && typeof v.text === 'string') ? v.text : v == null ? '' : JSON.stringify(v);
                const detail = text(body.error) || humanOutput([text(body.stderr), text(body.stdout)].filter(Boolean).join('\n')) || ('exit ' + body.exitCode);
                setInstallError(t('updateFail') + ': ' + name + ' — ' + detail.trim().slice(-600));
            }
        })
            .catch(() => {
            // A lost response does not mean the update stopped (the route holds
            // its reply until pnpm finishes, #100): keep the marker AND the
            // running row, and let the status poll converge the outcome instead
            // of declaring a false failure — mirroring the install flow's catch.
        });
    }, [refreshInstalled, t]);
    const doUseSkin = useCallback((name) => {
        setInstallError(null);
        fetch('/dsh-market/use-skin', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name }),
        })
            .then(res => res.json().then(body => ({ status: res.status, body })))
            .then(({ status, body }) => {
            if (status === 200 && body.ok) {
                sessionStorage.setItem('dshm-toast', JSON.stringify([name]));
                sessionStorage.setItem('dshm-toast-mode', 'theme');
                sessionStorage.setItem('dshm-tab', 'themes');
                location.reload();
            }
            else {
                setInstallError(String(body.error || 'failed'));
            }
        })
            .catch(error => setInstallError(String(error)));
    }, []);
    const doUninstall = useCallback((name) => {
        setRemoveConfirm(null);
        setInstallError(null);
        setActivationWarnings([]);
        setRemovingName(name);
        return fetch('/dsh-market/uninstall', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name }),
        })
            .then(res => res.json().then(body => ({ status: res.status, body })))
            .then(({ status, body }) => {
            if (status === 200 && body.ok) {
                if (!body.hot)
                    setRemovedCount(n => n + 1);
                refreshInstalled();
            }
            else {
                if (body.cancelled === true) {
                    refreshInstalled();
                    if (body.partial === true)
                        setInstallError(t('partialNote'));
                    return;
                }
                const text = (v) => typeof v === 'string' ? v : (v && typeof v.text === 'string') ? v.text : v == null ? '' : JSON.stringify(v);
                setInstallError((text(body.error) || humanOutput(text(body.stderr)) || 'error').trim().slice(-600));
            }
        })
            .catch(error => setInstallError(String(error)))
            .finally(() => setRemovingName(null));
    }, [refreshInstalled]);
    /** Live enable/disable of one installed plugin (#60). `reload` opts the
     * card-level theme flow into a page refresh so the visual result lands
     * immediately (mirrors the use-skin reload on activate). */
    const doToggle = useCallback((name, enabled, reload = false) => {
        setTogglingName(name);
        setInstallError(null);
        return fetch('/dsh-market/toggle', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name, enabled }),
        })
            .then(res => res.json().then(body => ({ status: res.status, body })))
            .then(({ status, body }) => {
            if (status === 200 && body.ok) {
                if (Array.isArray(body.disabled))
                    setDisabledNames(body.disabled);
                if (Array.isArray(body.live))
                    setSkins(body.live);
                if (body.activation && typeof body.activation === 'object') {
                    setActivations(prev => ({ ...prev, ...body.activation }));
                }
                // A toggle whose fiber did not follow the switch joins the
                // pending-restart banner (same path as installs/updates/removals).
                if (body.restart === true)
                    setToggleRestart(n => n + 1);
                // A client-part plugin's UI is already in the page — refresh to
                // show the change (mirrors the install hot banner).
                if (body.refresh === true)
                    setRefreshNames(names => names.includes(name) ? names : names.concat(name));
                refreshInstalled();
                if (reload) {
                    // Land back in the Themes tab with the stock look on screen.
                    // Drop a stale install/switch toast so it cannot resurrect.
                    sessionStorage.removeItem('dshm-toast');
                    sessionStorage.removeItem('dshm-toast-mode');
                    sessionStorage.setItem('dshm-tab', 'themes');
                    location.reload();
                }
            }
            else {
                const text = (v) => typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v);
                // The server's bilingual reason (e.g. host cannot hot-mount —
                // restart required) beats the generic failure line.
                setInstallError(text(body.reason) || text(body.error) || t('toggleFail'));
                // The durable state (state.json + patch layer) was still written,
                // so a restart applies it even though the live drive failed.
                if (body.restart === true)
                    setToggleRestart(n => n + 1);
                if (body.refresh === true)
                    setRefreshNames(names => names.includes(name) ? names : names.concat(name));
            }
        })
            .catch(error => setInstallError(String(error)))
            .finally(() => setTogglingName(null));
    }, [refreshInstalled, t]);
    /** Adopt the groups payload returned by POST /dsh-market/groups. */
    const setGroupPayload = useCallback((body) => {
        if (body.groups && typeof body.groups === 'object')
            setGroups(body.groups);
        if (Array.isArray(body.groupOrder))
            setGroupOrder(body.groupOrder);
        if (Array.isArray(body.disabled))
            setDisabledNames(body.disabled);
    }, []);
    /** One POST /dsh-market/groups round trip (create/rename/delete/members/toggle). */
    const doGroupAction = useCallback((payload) => {
        setInstallError(null);
        return fetch('/dsh-market/groups', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
        })
            .then(res => res.json().then(body => ({ status: res.status, body })))
            .then(({ status, body }) => {
            if (status === 200 && body.ok) {
                setGroupPayload(body);
                // Batch toggles whose members did not follow the switch join the
                // pending-restart banner too.
                if (Array.isArray(body.restartMembers) && body.restartMembers.length > 0) {
                    setToggleRestart(n => n + body.restartMembers.length);
                }
                if (Array.isArray(body.refreshMembers) && body.refreshMembers.length > 0) {
                    setRefreshNames(names => [...new Set([...names, ...body.refreshMembers])]);
                }
                refreshInstalled();
                return true;
            }
            const text = (v) => typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v);
            setInstallError(text(body.error) || t('toggleFail'));
            if (Array.isArray(body.restartMembers) && body.restartMembers.length > 0) {
                setToggleRestart(n => n + body.restartMembers.length);
            }
            if (Array.isArray(body.refreshMembers) && body.refreshMembers.length > 0) {
                setRefreshNames(names => [...new Set([...names, ...body.refreshMembers])]);
            }
            return false;
        })
            .catch(error => { setInstallError(String(error)); return false; });
    }, [refreshInstalled, setGroupPayload, t]);
    const doGroupToggle = useCallback((name, enabled) => {
        return doGroupAction({ action: 'toggle', name, enabled });
    }, [doGroupAction]);
    const doCreateGroup = useCallback(() => {
        const name = newGroupName.trim();
        if (name === '')
            return;
        void doGroupAction({ action: 'create', name }).then(ok => {
            if (ok) {
                setCreatingGroup(false);
                setNewGroupName('');
            }
        });
    }, [doGroupAction, newGroupName]);
    const doRenameGroup = useCallback((name) => {
        const newName = renamingValue.trim();
        if (newName === '' || newName === name) {
            setRenamingGroup(null);
            return;
        }
        void doGroupAction({ action: 'rename', name, newName }).then(ok => {
            if (ok) {
                setRenamingGroup(null);
                setRenamingValue('');
            }
        });
    }, [doGroupAction, renamingValue]);
    const doDeleteGroup = useCallback((name) => {
        void doGroupAction({ action: 'delete', name }).then(ok => {
            if (ok)
                setDeletingGroup(null);
        });
    }, [doGroupAction]);
    const doAssign = useCallback((name) => {
        const group = assignTarget;
        if (group === '')
            return;
        const members = groups[group] ?? [];
        void doGroupAction({ action: 'set-members', name: group, members: [...members, name] }).then(ok => {
            if (ok) {
                setAssignFor(null);
                setAssignTarget('');
            }
        });
    }, [assignTarget, doGroupAction, groups]);
    const doRemoveMember = useCallback((group, name) => {
        const members = (groups[group] ?? []).filter(member => member !== name);
        void doGroupAction({ action: 'set-members', name: group, members });
    }, [doGroupAction, groups]);
    /** Add one installed plugin to a group (picker stays open for batch adds). */
    const doAddMember = useCallback((group, name) => {
        const members = groups[group] ?? [];
        void doGroupAction({ action: 'set-members', name: group, members: [...members, name] });
    }, [doGroupAction, groups]);
    // The market itself stays out of the batch: its update reloads this page
    // mid-run, which would strand the remaining items.
    const selfName = installed['dshmarket'] !== undefined ? 'dshmarket' : 'dsh-market';
    const updatableNames = Object.keys(installed).filter(name => name !== selfName && !updatedNames.includes(name) && updates[name] && updates[name].updateAvailable);
    // The market manages itself from its own settings card (Settings → Plugins
    // → Plugin configuration), not as a row here — listing it in both places
    // read as two different controls for the same thing.
    const installedOtherCount = Object.keys(installed).filter(name => name !== selfName).length;
    const doUpdateAll = useCallback(() => {
        const names = updatableNames.slice();
        setUpdatingAll(true);
        const next = () => {
            const name = names.shift();
            if (name === undefined) {
                setUpdatingAll(false);
                return;
            }
            doUpdate(name).then(next, next);
        };
        next();
    }, [updatableNames, doUpdate]);
    const finishRestore = useCallback((body) => {
        const errors = Array.isArray(body.errors) ? body.errors : [];
        // Machine-specific dependency paths (#205): a `link:/Users/…` spec from
        // the machine that wrote the backup names a directory that does not
        // exist here, so pnpm cannot satisfy it. Listed with the other restore
        // problems rather than in a banner of its own — from the operator's
        // side it is one question ("what went wrong with my restore?").
        const unportable = Array.isArray(body.unportable) ? body.unportable : [];
        // Partial failures surface inline in the Backup tab (previously a
        // window.alert); the restore itself still completes.
        setRestoreErrors([
            ...errors.map(item => `${String(item.name)}: ${String(item.error)}`),
            ...unportable.map(item => `${String(item.name)}: ${t('restoreUnportable')} (${String(item.spec)})`),
        ]);
        setBackupRestored(true);
        setBackupMessage(t('restoreDone'));
        if (errors.length === 0) {
            setPendingBackup(null);
            setPendingDependencies({});
        }
        refreshInstalled(true);
    }, [refreshInstalled, t]);
    const previewBackup = useCallback((backup) => {
        const dependencies = backupDependencies(backup);
        setPendingBackup(backup);
        setPendingDependencies(dependencies);
        setBackupMessage(t('restorePreviewDone'));
        setRestoreErrors([]);
        setTab('installed');
    }, [t]);
    /** Actually run the restore; the confirm dialog gates this (previously window.confirm). */
    const doRestore = useCallback(() => {
        if (pendingBackup === null)
            return Promise.resolve();
        setRestoreConfirmOpen(false);
        setBackupBusy(true);
        setBackupMessage(null);
        setRestoreErrors([]);
        return fetch('/dsh-market/restore', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ backup: pendingBackup }),
        }).then(async (response) => {
            const body = await response.json();
            if (!response.ok)
                throw new Error(String(body.error || 'restore failed'));
            finishRestore(body);
        }).catch(error => setBackupMessage(String(error))).finally(() => setBackupBusy(false));
    }, [finishRestore, pendingBackup]);
    const runWebdav = useCallback((action) => {
        if (webdavUrl.trim() === '')
            return;
        setBackupBusy(true);
        setBackupMessage(null);
        setRestoreErrors([]);
        fetch('/dsh-market/webdav', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action, url: webdavUrl.trim(), username: webdavUser, password: webdavPassword }),
        }).then(async (response) => {
            const body = await response.json();
            if (!response.ok)
                throw new Error(String(body.error || 'WebDAV failed'));
            if (action === 'restore') {
                previewBackup(body.backup);
            }
            if (action === 'backup') {
                try {
                    localStorage.setItem('dshm-webdav-last', String(Date.now()));
                }
                catch { /* storage unavailable */ }
                setBackupMessage(t('backupDone'));
            }
        }).catch(error => setBackupMessage(String(error))).finally(() => setBackupBusy(false));
    }, [previewBackup, t, webdavPassword, webdavUrl, webdavUser]);
    /** Map the server's token-source string to a localized label. */
    const gistSourceLabel = (source) => {
        if (source === 'token')
            return t('gistSrcToken');
        if (source === 'env')
            return t('gistSrcEnv');
        if (source === 'gh')
            return t('gistSrcGh');
        return source;
    };
    /** Turn any failure (server error, network error, timeout) into a friendly message. */
    const gistErrorMessage = (error) => {
        const err = error;
        const name = typeof err?.name === 'string' ? err.name : '';
        const code = typeof err?.code === 'string' ? err.code : '';
        if (code === 'timeout' || name === 'TimeoutError' || name === 'AbortError')
            return t('gistErrTimeout');
        if (code === 'network')
            return t('gistErrNetwork');
        if (code === 'auth')
            return t('gistErrAuth');
        if (code === 'notfound')
            return t('gistErrNotFound');
        if (code === 'rate-limit')
            return t('gistErrRateLimit');
        if (code === 'invalid')
            return t('gistErrInvalid');
        // Network-level fetch failures surface as TypeError("Failed to fetch").
        if (error instanceof TypeError)
            return t('gistErrNetwork');
        return String(error);
    };
    const runGist = useCallback((action) => {
        setGistBusy(true);
        setGistMessage(null);
        setGistOk(false);
        setGistResult(null);
        setRestoreErrors([]);
        setExportError(null);
        const body = { action, token: gistToken.trim() };
        // Import always targets the field; export targets it only in update mode
        // (create mode deliberately ignores the field and makes a new Gist).
        if (action === 'import')
            body.gistId = gistId.trim();
        if (action === 'export' && gistMode === 'update') {
            if (gistId.trim() === '') {
                setGistBusy(false);
                setGistMessage(t('gistErrNoId'));
                setGistOk(false);
                return;
            }
            body.gistId = gistId.trim();
        }
        if (action === 'export') {
            // All plugins selected → full backup (with config); partial → only
            // the checked plugins, config optional via the picker flag.
            const allNames = new Set([...Object.keys(installed), ...installedBundles]);
            const allSelected = exportSelection.size === allNames.size && exportSelection.size > 0;
            if (!allSelected) {
                body.includeDeps = [...exportSelection];
                if (exportIncludeConfig)
                    body.includeConfig = true;
            }
        }
        fetch('/dsh-market/gist', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
            // Fallback ceiling only — the server answers structured errors (with a
            // code) within 25 s, so a wedged host cannot leave the user staring at
            // "working…" forever.
            signal: AbortSignal.timeout(30_000),
        }).then(async (response) => {
            let body = {};
            try {
                body = await response.json();
            }
            catch { /* non-JSON response */ }
            if (!response.ok) {
                const error = new Error(String(body.error || 'Gist failed'));
                if (typeof body.code === 'string')
                    error.code = body.code;
                throw error;
            }
            if (action === 'export') {
                setGistResult(body);
                // Backfill the id so the next export updates this Gist instead of
                // creating yet another one.
                const ref = body;
                if (typeof ref.gistId === 'string' && ref.gistId !== '') {
                    setGistId(ref.gistId);
                    // A fresh export flips the mode to update so the next export
                    // PATCHes the same Gist instead of creating yet another one.
                    setGistMode('update');
                    try {
                        localStorage.setItem('dshm-gist-id', ref.gistId);
                    }
                    catch { /* storage unavailable */ }
                }
                setGistMessage(t('gistExportDone'));
                setGistOk(true);
                setExportOpen(false);
            }
            else if (action === 'import') {
                previewBackup(body.backup);
            }
            else {
                // verify: tell the user which token source actually served the request.
                const source = typeof body.source === 'string' ? body.source : '';
                setGistMessage(t('gistVerifySource').replace('{0}', gistSourceLabel(source)));
                setGistOk(true);
            }
        }).catch(error => {
            const message = gistErrorMessage(error);
            setGistMessage(message);
            setGistOk(false);
            // Keep the picker open (selection preserved) and show the failure
            // inside it — never hidden behind the dialog.
            if (action === 'export')
                setExportError(message);
        }).finally(() => setGistBusy(false));
    }, [exportIncludeConfig, exportSelection, gistId, gistToken, installed, installedBundles, previewBackup, t]);
    /** The picker list: dependency plugins + bundle-only plugins, deduplicated. */
    const exportOptions = useMemo(() => {
        const names = new Set([...Object.keys(installed), ...installedBundles]);
        return [...names].sort();
    }, [installed, installedBundles]);
    /** Classify an install spec for the export picker badge. */
    const specKind = (spec) => {
        if (spec === undefined)
            return 'bundle';
        if (/^file:/i.test(spec))
            return 'file';
        if (/^(github:|git\+|git:)/i.test(spec))
            return 'git';
        return 'npm';
    };
    const openExportPicker = useCallback(() => {
        const names = new Set([...Object.keys(installed), ...installedBundles]);
        setExportSelection(new Set(names));
        setExportIncludeConfig(false);
        setExportOpen(true);
    }, [installed, installedBundles]);
    useEffect(() => {
        // Persist only the non-secret WebDAV settings; the password stays
        // server-side/in-memory (see savedWebdav). Storage itself may be
        // unavailable (e.g. the client test env), so never let it crash the UI.
        try {
            localStorage.setItem(WEBDAV_STORAGE_KEY, JSON.stringify({ url: webdavUrl, username: webdavUser, auto: autoBackup }));
        }
        catch { /* storage unavailable — config just won't survive reload */ }
        if (!autoBackup || webdavUrl.trim() === '')
            return;
        let last = 0;
        try {
            last = Number(localStorage.getItem('dshm-webdav-last')) || 0;
        }
        catch { /* ignore */ }
        if (Date.now() - last >= 24 * 60 * 60 * 1000)
            runWebdav('backup');
    }, [autoBackup, runWebdav, webdavUrl, webdavUser]);
    const sessionPendingRestart = doneUrls.length + updatedNames.length + removedCount + toggleRestart + (backupRestored ? 1 : 0);
    /**
     * Plugins the HOST reports as restart-pending, independent of what this
     * browser session happens to remember. Installing and then reloading the
     * page used to leave no restart affordance at all: the banner is built
     * from session state, while the Installed tab only says "activates on
     * restart" in passing — so the user was told a restart was needed and
     * given nothing to press. Dismissible, because a standing banner nobody
     * wants to act on right now is just noise (it returns next session, or
     * as soon as another change lands).
     */
    const hostPendingNames = Object.keys(activations).filter(name => activations[name]?.state === 'restart');
    const showHostPending = hostPendingNames.length > 0 && !restartNoticeDismissed && sessionPendingRestart === 0;
    const pendingRestart = sessionPendingRestart > 0 ? sessionPendingRestart : (showHostPending ? hostPendingNames.length : 0);
    const displayedInstalled = pendingBackup === null ? installed : { ...pendingDependencies, ...installed };
    const missingRestoreCount = Object.keys(pendingDependencies).filter(name => !installedFiles.includes(name)).length;
    // Self-update lives in the header button and the settings card, not this
    // tab's row list (the market itself is filtered out below) — so a pending
    // self-update alone must not light up a dot pointing at an empty-looking tab.
    const hasUpdates = Object.keys(installed).some(name => name !== selfName && !updatedNames.includes(name) && updates[name] && updates[name].updateAvailable);
    /** Live status line: structured phase, or the human-line fallback. */
    const phasePart = progressPhase != null
        ? phaseLabel(progressPhase, t)
            + (progressCurrent !== null ? ' · ' + progressCurrent : '')
            + (progressDone > 0 ? ' · ' + t('packagesDone').replace('{0}', String(progressDone)) : '')
        : progressLine || t('progressHint');
    const progressText = cancelling ? t('cancelling') + ' · ' + phasePart : phasePart;
    /** Whether the catalog carries ANY theme-category entry at all — distinct
     * from `themePlugins.length === 0` above (which also fires the instant a
     * search/sort/time filter matches nothing) so the two empty states read
     * differently: "there's nothing here yet" vs "nothing matches your filter". */
    const anyThemePlugins = data === null ? [] : themePluginsOf(data.plugins);
    /** The catalog entry a deprecated plugin's `replacement` names, if any. */
    const replacementOf = (p) => p.deprecated === true && p.replacement !== undefined
        ? data?.plugins.find(r => r.name === p.replacement)
        : undefined;
    const pluginCard = (p) => {
        const desc = (p.description && (p.description[lang] || p.description.en)) || '';
        const done = doneUrls.includes(p.url) || hotUrls.includes(p.url);
        const already = isInstalled(p, installed, repoIdentities, data?.plugins, repoHints);
        const busy = busyUrl === p.url;
        const replacement = replacementOf(p);
        // The card reflects its own latest operation. Without this a rejected
        // install leaves the card looking untouched, and pressing Install again
        // is the obvious next move — which is how the same clash gets hit twice.
        const record = recordForUrl(records, p.url);
        const blocked = record !== null && (record.state === 'input' || record.state === 'failed');
        return (_jsxs("div", { className: blocked ? `${css.card} ${css.cardBlocked}` : css.card, children: [_jsxs("div", { className: css.row1, children: [_jsxs("div", { style: { minWidth: 0 }, children: [_jsxs("a", { className: `${css.nm} ${css.nmLink}`, href: p.url, target: "_blank", rel: "noreferrer", title: p.name, children: [pluginName(p.name), p.deprecated === true && _jsx("span", { className: css.depBadge, children: t('deprecatedBadge') })] }), _jsxs("div", { className: css.byline, children: [_jsx(OwnerAvatar, { name: p.name, owner: p.owner || '' }), _jsx("span", { className: css.owner, title: p.owner, children: p.owner }), typeof p.downloads === 'number' && (_jsx(Tooltip, { label: String(p.downloads), side: "top", children: _jsx("span", { className: css.star, children: '· ↓ ' + formatCount(p.downloads) }) })), typeof p.stars === 'number' && (_jsx(Tooltip, { label: String(p.stars), side: "top", children: _jsx("span", { className: css.star, children: '· ★ ' + formatCount(p.stars) }) }))] })] }), _jsx("span", { className: css.grow }), _jsx("div", { className: css.cardAction, children: done
                                ? _jsx("span", { className: css.okState, children: t('installedBadge') })
                                : already
                                    ? _jsx("span", { className: css.okState, children: t('alreadyInstalled') })
                                    : busy
                                        ? _jsx(Button, { variant: "primary", size: "sm", className: css.installBtn, disabled: true, children: t('installing') })
                                        : blocked
                                            ? (_jsxs("button", { type: "button", className: css.cardBlockedMark, onClick: openOperations, children: [_jsx(IconWarningOutline16, { size: 13 }), t('opBlockedCard')] }))
                                            : (_jsx(Button, { variant: "primary", size: "sm", className: css.installBtn, disabled: busyUrl !== null || !envReady, onClick: () => setConfirming(p), children: t('install') })) })] }), _jsx(CardDesc, { text: desc, t: t }), _jsx(CardShot, { plugin: p, onOpen: openLightbox }), p.deprecated === true && (_jsx("div", { className: css.deprecate, children: _jsxs("div", { className: css.depLine, children: [_jsxs("span", { children: ["\u26A0\uFE0F ", t('deprecatedWarn')] }), replacement !== undefined && (_jsx("a", { className: css.src, href: replacement.url, target: "_blank", rel: "noreferrer", children: t('replacementHint') + ' ' + replacement.name }))] }) })), _jsxs("div", { className: css.foot, children: [_jsx("span", { className: css.tag, children: (data.categories[p.category] && (data.categories[p.category][lang] || data.categories[p.category].en)) || p.category }), _jsx("span", { className: css.grow })] }), busy && (_jsxs("div", { className: css.progress, children: [_jsx("span", { className: css.spin, children: _jsx(IconLoadingOutline16, { size: 14 }) }), _jsx("code", { className: css.grow, children: progressText }), progressPct !== null && _jsxs("span", { className: css.pct, children: [progressPct, "%"] }), _jsx(Button, { variant: "outline", size: "sm", disabled: cancelling, onClick: doCancel, children: cancelling ? t('cancelling') : t('cancelOp') }), _jsx("div", { className: css.bar, children: _jsx("div", { className: progressPct !== null ? css.barFill : `${css.barFill} ${css.barWave}`, style: progressPct !== null ? { width: `${progressPct}%` } : undefined }) })] }))] }, p.url));
    };
    const installedNameOf = (p) => matchInstalledName(p, installed, repoIdentities, data?.plugins, repoHints);
    // Plugins loaded at boot (bundle-layer skins) aren't in the shim list but
    // are just as live; the boot manifest is the page's own record of them.
    const bootEntries = (typeof window !== 'undefined' && window.__DSH_BOOT__ && Array.isArray(window.__DSH_BOOT__.entries))
        ? window.__DSH_BOOT__.entries
        : [];
    // Unified card for the Themes tab: install → use/in-use → uninstall.
    const themePluginCard = (p) => {
        const instName = installedNameOf(p);
        if (instName === null)
            return pluginCard(p);
        // A theme switched off via the Installed-tab toggle (or a group switch)
        // stays in the boot manifest, so the disabled set must veto the badge.
        const mounted = (skins.includes(instName) || bootEntries.some(e => e.id === instName)) && !effectiveDisabledSet.has(instName);
        const desc = (p.description && (p.description[lang] || p.description.en)) || '';
        const replacement = replacementOf(p);
        return (_jsxs("div", { className: css.card, children: [_jsx("div", { className: css.row1, children: _jsxs("div", { style: { minWidth: 0 }, children: [_jsxs("a", { className: `${css.nm} ${css.nmLink}`, href: p.url, target: "_blank", rel: "noreferrer", title: p.name, children: [pluginName(p.name), p.deprecated === true && _jsx("span", { className: css.depBadge, children: t('deprecatedBadge') })] }), _jsxs("div", { className: css.byline, children: [_jsx(OwnerAvatar, { name: p.name, owner: p.owner || '' }), _jsx("span", { className: css.owner, title: p.owner, children: p.owner }), typeof p.downloads === 'number' && (_jsx(Tooltip, { label: String(p.downloads), side: "top", children: _jsx("span", { className: css.star, children: '· ↓ ' + formatCount(p.downloads) }) })), typeof p.stars === 'number' && (_jsx(Tooltip, { label: String(p.stars), side: "top", children: _jsx("span", { className: css.star, children: '· ★ ' + formatCount(p.stars) }) }))] })] }) }), _jsx(CardDesc, { text: desc, t: t }), _jsx(CardShot, { plugin: p, onOpen: openLightbox }), p.deprecated === true && (_jsx("div", { className: css.deprecate, children: _jsxs("div", { className: css.depLine, children: [_jsxs("span", { children: ["\u26A0\uFE0F ", t('deprecatedWarn')] }), replacement !== undefined && (_jsx("a", { className: css.src, href: replacement.url, target: "_blank", rel: "noreferrer", children: t('replacementHint') + ' ' + replacement.name }))] }) })), _jsxs("div", { className: css.foot, children: [_jsx("span", { className: css.grow }), removingName === instName
                            ? _jsx(Button, { variant: "outline", size: "sm", disabled: true, children: t('uninstalling') })
                            : _jsx(Button, { variant: "outline", size: "sm", onClick: () => setRemoveConfirm(instName), children: t('uninstall') }), effectiveDisabledSet.has(instName) && _jsx("span", { className: css.spec, children: t('disabledState') }), mounted
                            ? _jsxs(_Fragment, { children: [_jsx("span", { className: css.okState, children: t('themeActive') }), _jsx(Button, { variant: "outline", size: "sm", disabled: togglingName !== null, onClick: () => doToggle(instName, false, true), children: t('themeDeactivate') })] })
                            : _jsx(Button, { variant: "primary", size: "sm", onClick: () => doUseSkin(instName), children: t('themeApply') })] })] }, p.url));
    };
    const themeCard = (id, label, swatch) => {
        const active = themeSnap !== null && themeSnap.preference === id;
        return (_jsxs("div", { className: css.card, children: [_jsx("div", { className: css.swatches, children: swatch.map((c, i) => _jsx("i", { style: { background: c } }, i)) }), _jsxs("div", { className: css.foot, children: [_jsx("span", { className: css.nm, children: label }), _jsx("span", { className: css.grow }), active
                            ? _jsx("span", { className: css.okState, children: t('themeActive') })
                            : (_jsx(Button, { variant: "primary", size: "sm", onClick: () => { try {
                                    props.theme.setTheme(id);
                                }
                                catch (error) {
                                    setInstallError(String(error));
                                } }, children: t('themeApply') }))] })] }, 'th-' + id));
    };
    const categories = data === null ? [] : Object.keys(data.categories);
    useLayoutEffect(() => { setVisibleCats(null); setVisibleCatsOneRow(null); }, [lang, categories.length]);
    useLayoutEffect(() => {
        if (catsOpen || visibleCats !== null)
            return;
        const el = catsWrapRef.current;
        if (el === null)
            return;
        const chips = [...el.children].filter((c) => c.dataset?.chip === '1');
        if (chips.length === 0)
            return;
        const first = chips[0];
        const rowThreeTop = first.offsetTop + (first.offsetHeight + 6) * 2 - 3;
        let fits = 0;
        for (const chip of chips) {
            if (chip.offsetTop < rowThreeTop)
                fits += 1;
        }
        // Reserve the tail slot of row two for the chevron itself.
        setVisibleCats(fits >= chips.length ? fits : Math.max(1, fits - 1));
        // Same measuring pass, one row's worth instead of two — used only while
        // the sticky header is pinned during scroll (#188-adjacent request), to
        // shrink an OPEN multi-row category list down to its first row without
        // touching the user's actual open/closed choice.
        const rowTwoTop = first.offsetTop + first.offsetHeight + 6 - 3;
        let fitsOneRow = 0;
        for (const chip of chips) {
            if (chip.offsetTop < rowTwoTop)
                fitsOneRow += 1;
        }
        setVisibleCatsOneRow(fitsOneRow >= chips.length ? fitsOneRow : Math.max(1, fitsOneRow - 1));
    }, [catsOpen, visibleCats, data]);
    useEffect(() => {
        if (catsSentinel === null || typeof IntersectionObserver === 'undefined')
            return;
        const observer = new IntersectionObserver(([entry]) => setCatsStuck(entry !== undefined && !entry.isIntersecting), { root: bodyRef.current, threshold: 0 });
        observer.observe(catsSentinel);
        return () => observer.disconnect();
    }, [catsSentinel]);
    /**
     * Becoming stuck auto-collapses an open row — a REAL `catsOpen` flip, not
     * a display-only override. An earlier version faked this by computing a
     * separate "effectively open" value for rendering while leaving `catsOpen`
     * itself true; the chevron's own click handler only ever toggled the real
     * `catsOpen`, so while stuck it flipped a value the render path had
     * already stopped consulting — clicking "expand" did nothing visible
     * (reported: "吸顶滚动了之后，展开没反应了"). Driving the same state the
     * chevron drives means the chevron always works, stuck or not.
     */
    const catsAutoCollapsedRef = useRef(false);
    useLayoutEffect(() => {
        if (catsStuck) {
            if (catsOpen) {
                setCatsOpen(false);
                catsAutoCollapsedRef.current = true;
            }
        }
        else if (catsAutoCollapsedRef.current) {
            setCatsOpen(true);
            catsAutoCollapsedRef.current = false;
        }
    }, [catsStuck]);
    /**
     * A fresh install (hotUrls/hotNames) and a toggle/group action
     * (refreshNames) both end in the same place — "reload the page" — and
     * used to render as two near-identical banners stacked on top of each
     * other when both happened in one session (reported as "为啥有三个状态横幅
     * 啊，太奇怪了"). They're merged into one count and one banner; only the
     * restart banner (a full host restart, a different action entirely) stays
     * separate.
     */
    const pendingRefreshNames = useMemo(() => [...new Set([...hotNames, ...refreshNames])], [hotNames, refreshNames]);
    /** Installed plugins the market itself cannot group (#60). */
    const groupableNames = Object.keys(installed).filter(name => name !== 'dsh-market' && name !== 'dshmarket');
    /** Names already inside some group; everything else shows under "ungrouped". */
    const groupedNames = useMemo(() => new Set(Object.values(groups).flat()), [groups]);
    const ungroupedNames = groupableNames.filter(name => !groupedNames.has(name));
    /** Installed package names the catalog classifies as themes (client-side
     * mirror of the server's classification; themes are exclusive per group). */
    const installedThemeNames = useMemo(() => {
        const names = new Set();
        if (data === null)
            return names;
        for (const [name, spec] of Object.entries(installed)) {
            const entry = entryForDep(data.plugins, name, String(spec), repoIdentities[name], repoHints[name]);
            if (entry !== undefined && entry.category === 'theme')
                names.add(name);
        }
        return names;
    }, [data, installed, repoIdentities, repoHints]);
    return (_jsxs("div", { className: css.root, children: [_jsxs("div", { className: css.head, children: [_jsxs("div", { className: css.titleRow, children: [_jsx(MarketLogo, { size: 22, style: { flexShrink: 0 } }), _jsx("h2", { className: css.title, children: t('nav') }), _jsx("a", { className: css.repoLink, href: "https://github.com/dsh-market/dsh-market", target: "_blank", rel: "noreferrer", title: "dsh-market \u00B7 GitHub", children: "dsh-market" }), version !== null && _jsxs("span", { className: css.version, title: t('versionHint'), children: ["v", version] }), (() => {
                                const self = installed['dshmarket'] !== undefined ? 'dshmarket' : 'dsh-market';
                                return updates[self] && updates[self].updateAvailable && !updatedNames.includes(self)
                                    && (_jsx(Button, { variant: "primary", size: "sm", disabled: updatingName !== null || busyUrl !== null, onClick: () => { setTab('installed'); doUpdate(self); }, children: updatingName === self ? t('updating') : t('marketUpdate') }));
                            })(), updatableNames.length >= 2 && (_jsx(Button, { variant: "primary", size: "sm", disabled: updatingAll || updatingName !== null || busyUrl !== null || removingName !== null, onClick: () => { setTab('installed'); doUpdateAll(); }, children: updatingAll ? t('updating') : t('updateAll') + ' (' + updatableNames.length + ')' }))] }), _jsxs("div", { className: css.sub, children: [_jsx("span", { children: t('subtitle') }), _jsx("a", { className: css.submitLink, href: "https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md", target: "_blank", rel: "noreferrer", children: t('submitPlugin') }), _jsx("span", { className: css.grow }), _jsx(Button, { variant: "outline", size: "sm", icon: _jsx(IconDownloadOutline16, { size: 14 }), disabled: exportState === 'busy', onClick: doExportLog, children: exportState === 'busy' ? t('exportingLog') : t('exportLog') })] }), _jsxs("div", { className: css.tabs, children: [_jsx("button", { className: tab === 'discover' ? `${css.tab} ${css.on}` : css.tab, onClick: () => setTab('discover'), children: t('tabDiscover') }), themeSnap !== null && _jsx("button", { className: tab === 'themes' ? `${css.tab} ${css.on}` : css.tab, onClick: () => setTab('themes'), children: t('tabThemes') }), _jsxs("button", { className: tab === 'installed' ? `${css.tab} ${css.on}` : css.tab, onClick: () => { setTab('installed'); refreshInstalled(true); }, children: [t('tabInstalled') + (installedOtherCount > 0 ? ' (' + installedOtherCount + ')' : ''), hasUpdates && _jsx(StateDot, { state: "error", size: 7, className: css.dot })] }), _jsx("button", { className: (tab === 'backup' || tab === 'diagnostics') ? `${css.tab} ${css.on}` : css.tab, onClick: () => { if (tab !== 'backup' && tab !== 'diagnostics')
                                    setTab('backup'); }, children: t('tabAdvanced') }), _jsx("span", { className: css.grow }), _jsx(OperationsPanel, { t: t, describe: describePlugin, records: records, open: operationsOpen, onOpenChange: setOperationsOpen, replacing: replacing, envReady: envReady, onClearSettled: () => setRecords(list => clearSettled(list)), onCancel: () => doCancel(), onDismiss: record => setRecords(list => drop(list, record.id)), onRefresh: () => location.reload(), onResolveConflict: resolveConflict })] }), (tab === 'backup' || tab === 'diagnostics') && (_jsxs("div", { className: css.subTabs, children: [_jsx("button", { className: tab === 'backup' ? `${css.tab} ${css.on}` : css.tab, onClick: () => setTab('backup'), children: t('tabBackup') }), _jsx("button", { className: tab === 'diagnostics' ? `${css.tab} ${css.on}` : css.tab, onClick: () => setTab('diagnostics'), children: t('tabDiagnostics') }), _jsx("span", { className: css.grow })] })), !envReady && (_jsxs("div", { className: css.banner, children: [_jsx(IconCordisPluginOutline14, { size: 14, className: css.bannerIcon }), _jsx("span", { className: css.grow, children: envFailed ? t('envFixFail') : t('envMissing') }), !envFailed && (_jsx(Button, { variant: "primary", size: "sm", disabled: envFixing, onClick: fixEnv, children: envFixing ? t('envFixing') : t('envFix') }))] })), backupMessage !== null && _jsx("div", { className: css.backupMessage, children: backupMessage }), restoreErrors.length > 0 && (_jsxs("div", { className: css.banner, children: [_jsx(IconWarningOutline16, { size: 14, className: css.bannerIcon }), _jsxs("span", { className: css.grow, children: [_jsx("div", { children: _jsx("b", { children: t('restorePartial') }) }), restoreErrors.map(error => _jsx("div", { className: css.spec, children: error }, error))] })] })), tab === 'installed' && pendingBackup !== null && (_jsxs("div", { className: css.banner, children: [_jsx(IconRefreshOutline14, { size: 14, className: css.bannerIcon }), _jsx("span", { className: css.grow, children: t('restoreMissing').replace('{0}', String(missingRestoreCount)) }), _jsx(Button, { variant: "primary", size: "sm", disabled: backupBusy, onClick: () => setRestoreConfirmOpen(true), children: backupBusy ? t('backupWorking') : t('restoreStart') })] })), pendingRefreshNames.length > 0 && (_jsxs("div", { className: css.banner, children: [_jsx(IconSparkle16, { size: 14, className: css.bannerIcon }), _jsxs("span", { className: css.grow, children: [_jsx("b", { children: pendingRefreshNames.length }), " ", t('refreshBanner')] }), _jsx(Button, { variant: "primary", size: "sm", onClick: () => {
                                    if (hotNames.length > 0)
                                        sessionStorage.setItem('dshm-toast', JSON.stringify(hotNames));
                                    sessionStorage.setItem('dshm-tab', 'installed');
                                    location.reload();
                                }, children: t('refresh') })] })), pendingRestart > 0 && (_jsxs("div", { className: css.banner, children: [_jsx(IconRefreshOutline14, { size: 14, className: css.bannerIcon }), _jsxs("span", { className: css.grow, children: [_jsx("b", { children: pendingRestart }), " ", t('restartBanner')] }), _jsx(Tooltip, { label: supervisor === null ? t('restartHint') : t('restartHintSupervised').replace('{0}', supervisor), side: "bottom", children: _jsx("span", { className: css.bannerHint, children: _jsx(IconQuestionOutline14, { size: 14 }) }) }), restartEnabled && (_jsx(Button, { variant: "primary", size: "sm", disabled: restarting || hostBusy || busyUrl !== null || updatingName !== null || removingName !== null, onClick: doRestart, children: restarting ? t('restarting') : t('restartNow') })), showHostPending && (_jsx(Button, { variant: "ghost", size: "sm", "aria-label": t('dismissNotice'), onClick: () => {
                                    setRestartNoticeDismissed(true);
                                    try {
                                        sessionStorage.setItem('dshm-restart-dismissed', String(bootId ?? ''));
                                    }
                                    catch { /* storage unavailable */ }
                                }, children: t('dismiss') }))] })), activationWarnings.length > 0 && (_jsxs("div", { className: css.banner, children: [_jsx(IconWarningOutline16, { size: 14, className: css.bannerIcon }), _jsx("span", { className: css.grow, children: activationWarnings.map(({ name, info }) => (_jsxs("div", { children: [_jsx("b", { children: name }), " \u2014 ", activationMeta(info.state, t).label, info.reasons.length > 0 && _jsxs("span", { className: css.spec, children: ["\uFF08", info.reasons.join(' / '), "\uFF09"] })] }, name))) })] })), tab === 'installed' && _jsx(HostDependencyDiagnostics, { findings: hostDependencyFindings, t: t })] }), buildsSkipped !== null && (_jsxs("div", { className: css.banner, children: [_jsx(IconWarningOutline16, { size: 14, className: css.bannerIcon }), _jsxs("span", { className: css.grow, children: [t('buildsSkipped'), " ", buildsSkipped.names.join(', ')] }), _jsx(Button, { size: "sm", disabled: busyUrl !== null, onClick: () => {
                            const { plugin, updateName, names } = buildsSkipped;
                            setBuildsSkipped(null);
                            fetch('/dsh-market/approve-builds', {
                                method: 'POST',
                                headers: { 'content-type': 'application/json' },
                                body: JSON.stringify({ packages: names }),
                            })
                                .then(res => res.json())
                                .then((body) => {
                                if (!body.ok)
                                    setInstallError(String(body.error || 'approve failed'));
                                else if (plugin !== undefined)
                                    doInstall(plugin);
                                else if (updateName !== undefined)
                                    doUpdate(updateName);
                            })
                                .catch(error => setInstallError(String(error)));
                        }, children: t('approveBuilds') })] })), compatibilityNotice !== null && (_jsxs("div", { className: css.banner, children: [_jsxs("span", { className: css.grow, children: [compatibilityNotice.risks.length > 0 && (_jsxs(_Fragment, { children: [_jsx("b", { children: t('compatRiskBanner') }), " ", compatibilitySummary(compatibilityNotice.risks)] })), compatibilityNotice.shadowedNames !== undefined && compatibilityNotice.shadowedNames.length > 0 && (_jsxs(_Fragment, { children: [compatibilityNotice.risks.length > 0 && ' · ', _jsx("b", { children: t('shadowNameBanner') }), " ", shadowSummary(compatibilityNotice.shadowedNames)] })), compatibilityNotice.brokenBundles !== undefined && compatibilityNotice.brokenBundles.length > 0 && (_jsxs(_Fragment, { children: [(compatibilityNotice.risks.length > 0
                                        || (compatibilityNotice.shadowedNames?.length ?? 0) > 0) && ' · ', _jsx("b", { children: t('brokenBundleBanner') }), ' ', compatibilityNotice.brokenBundles.map(entry => entry.name).join(', ')] }))] }), _jsx(Button, { variant: "outline", size: "sm", onClick: () => setTab('diagnostics'), children: t('goDiagnose') }), _jsx(Button, { variant: "primary", size: "sm", disabled: rollingBack, onClick: () => void doRollback(compatibilityNotice.rollbackId), children: rollingBack ? t('rollingBack') : t('rollbackNow') })] })), installError !== null && (_jsxs("div", { className: css.err, children: [installError, _jsxs("div", { className: css.staleAction, children: [staleName !== null && (_jsx(Button, { size: "sm", onClick: () => doUpdate(staleName, true), children: t('updateNow') })), _jsx(Button, { size: "sm", variant: "outline", icon: _jsx(IconDownloadOutline16, { size: 14 }), disabled: exportState === 'busy', onClick: doExportLog, children: exportState === 'busy' ? t('exportingLog') : t('exportLog') })] })] })), _jsx("div", { className: css.body, ref: bodyRef, onScroll: e => setShowTop(e.currentTarget.scrollTop > 400), children: tab === 'backup'
                    ? (_jsxs("div", { className: css.backupGrid, children: [_jsxs("section", { className: css.backupCard, children: [_jsx("h3", { children: t('backupLocal') }), _jsx("p", { children: t('backupHint') }), _jsx("p", { className: css.backupWarn, children: t('credsWarning') }), _jsxs("div", { className: css.backupActions, children: [_jsx(Button, { variant: "primary", size: "sm", icon: _jsx(IconDownloadOutline16, { size: 14 }), disabled: backupBusy, onClick: () => downloadFile('/dsh-market/backup', 'dsh-profile-backup.json'), children: backupBusy ? t('backupWorking') : t('backupDownload') }), _jsx(Button, { variant: "outline", size: "sm", icon: _jsx(IconFolderOpen16, { size: 14 }), disabled: backupBusy, onClick: () => fileInputRef.current?.click(), children: backupBusy ? t('backupWorking') : t('backupImport') }), _jsx("input", { ref: fileInputRef, type: "file", accept: "application/json,.json", className: css.hiddenFile, tabIndex: -1, "aria-hidden": "true", disabled: backupBusy, onChange: event => {
                                                    const file = event.currentTarget.files?.[0];
                                                    event.currentTarget.value = '';
                                                    if (file !== undefined)
                                                        file.text().then(text => previewBackup(JSON.parse(text))).catch(error => setBackupMessage(String(error)));
                                                } })] })] }), _jsxs("section", { className: css.backupCard, children: [_jsx("h3", { children: t('webdav') }), _jsx(Menu, { open: presetOpen, onClose: () => setPresetOpen(false), onSelect: id => {
                                            const urls = {
                                                jianguoyun: 'https://dav.jianguoyun.com/dav/dsh-profile-backup.json',
                                                koofr: 'https://app.koofr.net/dav/Koofr/dsh-profile-backup.json',
                                                nextcloud: 'https://nextcloud.example/remote.php/dav/files/USERNAME/dsh-profile-backup.json',
                                            };
                                            if (urls[id] !== undefined)
                                                setWebdavUrl(urls[id]);
                                        }, align: "start", anchor: (_jsx(Button, { variant: "outline", size: "sm", icon: _jsx(IconChevronDownOutline14, { size: 14 }), onClick: () => setPresetOpen(o => !o), children: t('webdavPreset') })), items: [
                                            { id: 'custom', label: t('webdavPreset') },
                                            { id: 'jianguoyun', label: '坚果云 / Nutstore' },
                                            { id: 'koofr', label: 'Koofr' },
                                            { id: 'nextcloud', label: 'Nextcloud' },
                                        ] }), _jsx(Input, { className: css.backupInput, icon: _jsx(IconLinkOutline14, { size: 14 }), type: "url", value: webdavUrl, placeholder: t('webdavUrl'), onChange: e => setWebdavUrl(e.target.value) }), _jsx(Input, { className: css.backupInput, autoComplete: "username", value: webdavUser, placeholder: t('webdavUser'), onChange: e => setWebdavUser(e.target.value) }), _jsx(Input, { className: css.backupInput, type: "password", autoComplete: "current-password", value: webdavPassword, placeholder: t('webdavPassword'), onChange: e => setWebdavPassword(e.target.value) }), _jsxs("div", { className: css.backupActions, children: [_jsx(Button, { variant: "primary", size: "sm", disabled: backupBusy || webdavUrl.trim() === '', onClick: () => runWebdav('backup'), children: backupBusy ? t('backupWorking') : t('webdavUpload') }), _jsx(Button, { variant: "outline", size: "sm", disabled: backupBusy || webdavUrl.trim() === '', onClick: () => runWebdav('restore'), children: t('webdavRestore') })] }), _jsxs("label", { className: css.backupCheck, children: [_jsx("input", { type: "checkbox", checked: autoBackup, onChange: e => setAutoBackup(e.target.checked) }), t('autoBackup')] }), _jsx("p", { children: t('webdavNote') }), _jsx("p", { className: css.backupWarn, children: t('credsWarning') })] }), _jsxs("section", { className: css.backupCard, children: [_jsx("h3", { children: t('gist') }), _jsx(Input, { className: css.backupInput, type: "password", autoComplete: "off", value: gistToken, placeholder: t('gistToken'), onChange: e => setGistToken(e.target.value) }), _jsx(Input, { className: css.backupInput, icon: _jsx(IconLinkOutline14, { size: 14 }), value: gistId, placeholder: t('gistId'), onChange: e => setGistId(e.target.value) }), _jsxs("div", { className: css.backupActions, children: [_jsxs("label", { className: css.backupCheck, children: [_jsx("input", { type: "radio", name: "gist-mode", checked: gistMode === 'update', onChange: () => setGistMode('update') }), t('gistModeUpdate')] }), _jsxs("label", { className: css.backupCheck, children: [_jsx("input", { type: "radio", name: "gist-mode", checked: gistMode === 'create', onChange: () => setGistMode('create') }), t('gistModeCreate')] })] }), _jsxs("div", { className: css.backupActions, children: [_jsx(Button, { variant: "outline", size: "sm", disabled: gistBusy, onClick: () => runGist('verify'), children: gistBusy ? t('backupWorking') : t('gistVerify') }), _jsx(Button, { variant: "primary", size: "sm", disabled: gistBusy || (gistMode === 'update' && gistId.trim() === ''), onClick: openExportPicker, children: gistBusy ? t('backupWorking') : t('gistExport') }), _jsx(Button, { variant: "outline", size: "sm", disabled: gistBusy || gistId.trim() === '', onClick: () => runGist('import'), children: t('gistImport') })] }), gistResult !== null && (_jsxs("p", { className: css.backupCheck, children: [_jsx("span", { children: t('gistCreated') }), ' ', _jsx("a", { className: css.src, href: gistResult.gistUrl, target: "_blank", rel: "noreferrer", children: gistResult.gistUrl })] })), gistMessage !== null && (_jsx("div", { className: gistOk ? css.backupMessage : css.backupWarn, children: gistMessage })), _jsx("p", { children: t('gistNote') })] })] }))
                    : tab === 'discover'
                        ? loadError !== null
                            ? _jsxs("div", { className: css.empty, children: [_jsx("div", { children: t('loadFail') }), _jsx("div", { className: css.err, children: loadError }), _jsx(Button, { variant: "outline", size: "sm", className: css.retryBtn, onClick: () => { void loadCatalog(); }, children: t('loadRetry') })] })
                            : data === null
                                ? _jsxs("div", { className: css.loading, children: [_jsx("span", { className: css.logoMark, children: _jsx(MarketLogo, { size: 26, animated: true }) }), t('loading')] })
                                : (_jsxs(_Fragment, { children: [_jsx("div", { ref: setCatsSentinel }), _jsxs("div", { className: css.stickyHead, children: [_jsx("div", { className: css.tabSearchRow, children: _jsx(Input, { className: css.tabSearch, icon: _jsx(IconSearchOutline16, { size: 14 }), placeholder: t('searchPh'), value: q, onChange: e => setQ(e.target.value) }) }), _jsx("div", { className: css.cats, children: _jsxs("div", { className: css.catsRow, children: [_jsx("div", { ref: catsWrapRef, className: visibleCats === null ? `${css.catsWrap} ${css.catsCollapsed}` : css.catsWrap, children: (() => {
                                                                    // Collapsed, the selected category is pulled to the front so it never hides.
                                                                    // Whenever collapsed (default, or auto-collapsed by the sticky
                                                                    // header going stuck — see catsAutoCollapsedRef above), a stuck
                                                                    // header uses the one-row budget instead of the two-row one so an
                                                                    // already-open list that just got pinned shrinks further.
                                                                    const budget = catsStuck ? visibleCatsOneRow : visibleCats;
                                                                    const ordered = orderedCategories(categories, cat, catsOpen, budget);
                                                                    const shown = catsOpen || budget === null ? ordered : ordered.slice(0, Math.max(0, budget - 1));
                                                                    return (_jsxs(_Fragment, { children: [_jsx(Pill, { "data-chip": "1", active: cat === 'all', onClick: () => setCat('all'), children: t('all') + ' (' + formatCount(data.count) + ')' }), shown.map(id => (_jsx(Pill, { "data-chip": "1", active: cat === id, onClick: () => setCat(id), children: (data.categories[id] && (data.categories[id][lang] || data.categories[id].en)) || id }, id))), _jsx(Button, { variant: "ghost", size: "sm", className: css.catsToggle, icon: catsOpen ? _jsx(IconChevronUpOutline14, { size: 14 }) : _jsx(IconChevronDownOutline14, { size: 14 }), "aria-label": catsOpen ? t('catsLess') : t('catsMore'), onClick: () => {
                                                                                    // An explicit click always wins — don't let the next
                                                                                    // stuck/unstuck transition second-guess it.
                                                                                    catsAutoCollapsedRef.current = false;
                                                                                    setCatsOpen(o => !o);
                                                                                } })] }));
                                                                })() }), _jsx(FilterMenu, { sortField: sortField, sortDir: sortDir, timeRange: timeRange, onSortField: setSortField, onSortDir: setSortDir, onTimeRange: setTimeRange, t: t })] }) })] }), plugins.length === 0
                                            ? _jsx("div", { className: css.empty, children: t('empty') })
                                            : (_jsxs(_Fragment, { children: [_jsx(Masonry, { items: pagePlugins, render: pluginCard }), _jsx(Pager, { currentPage: currentPage, totalPages: totalPages, pageSize: pageSize, onGoToPage: goToPage, onChangePageSize: changePageSize, t: t })] }))] }))
                        : tab === 'themes' && themeSnap !== null
                            ? (_jsxs(_Fragment, { children: [_jsx("div", { className: css.tabSearchRow, children: _jsx(Input, { className: css.tabSearch, icon: _jsx(IconSearchOutline16, { size: 14 }), placeholder: t('searchPh'), value: qThemes, onChange: e => setQThemes(e.target.value) }) }), (() => {
                                        const extra = themeSnap.themes.filter(def => def.id !== 'light' && def.id !== 'dark');
                                        return extra.length > 0 && (_jsx("div", { className: `${css.grid} ${css.themesGrid}`, children: extra.map(def => themeCard(def.id, def.id, themeSwatch(def))) }));
                                    })(), _jsx("div", { className: css.cats, children: _jsxs("div", { className: css.catsRow, children: [_jsx("span", { className: css.grow }), _jsx(FilterMenu, { sortField: themeSortField, sortDir: themeSortDir, timeRange: themeTimeRange, onSortField: setThemeSortField, onSortDir: setThemeSortDir, onTimeRange: setThemeTimeRange, t: t })] }) }), data === null
                                        ? _jsxs("div", { className: css.loading, children: [_jsx("span", { className: css.logoMark, children: _jsx(MarketLogo, { size: 26, animated: true }) }), t('loading')] })
                                        : anyThemePlugins.length === 0
                                            ? _jsx("div", { className: css.empty, children: t('themeEmpty') })
                                            : themePlugins.length === 0
                                                ? _jsx("div", { className: css.empty, children: t('empty') })
                                                : (_jsxs(_Fragment, { children: [_jsx(Masonry, { items: themePagePlugins, render: themePluginCard }), _jsx(Pager, { currentPage: themePagination.currentPage, totalPages: themePagination.totalPages, pageSize: themePagination.pageSize, onGoToPage: themePagination.goToPage, onChangePageSize: themePagination.changePageSize, t: t })] }))] }))
                            : tab === 'diagnostics'
                                ? _jsx(Diagnostics, { t: t })
                                : (_jsxs(_Fragment, { children: [_jsxs("div", { className: css.viewBar, children: [_jsx("button", { type: "button", className: installedView === 'list' ? `${css.viewBtn} ${css.viewOn}` : css.viewBtn, onClick: () => setInstalledView('list'), children: t('tabList') }), _jsx("button", { type: "button", className: installedView === 'groups' ? `${css.viewBtn} ${css.viewOn}` : css.viewBtn, onClick: () => setInstalledView('groups'), children: t('tabGroups') })] }), _jsx("div", { className: css.tabSearchRow, children: _jsx(Input, { className: css.tabSearch, icon: _jsx(IconSearchOutline16, { size: 14 }), placeholder: t('searchPh'), value: qInstalled, onChange: e => setQInstalled(e.target.value) }) }), installedView === 'groups'
                                            ? (_jsxs(_Fragment, { children: [_jsx("div", { className: css.groupCreate, children: creatingGroup
                                                            ? (_jsxs(_Fragment, { children: [_jsx(Input, { className: css.inlineInput, placeholder: t('groupNamePh'), value: newGroupName, onChange: e => setNewGroupName(e.target.value), onKeyDown: e => { if (e.key === 'Enter')
                                                                            doCreateGroup(); }, autoFocus: true }), _jsx(Button, { variant: "primary", size: "sm", onClick: doCreateGroup, children: t('groupCreate') }), _jsx(Button, { variant: "ghost", size: "sm", onClick: () => { setCreatingGroup(false); setNewGroupName(''); }, children: t('cancel') })] }))
                                                            : _jsx(Button, { variant: "outline", size: "sm", onClick: () => setCreatingGroup(true), children: t('groupNew') }) }), groupOrder.length === 0
                                                        ? _jsx("div", { className: css.empty, children: t('noGroups') })
                                                        : groupOrder.map(gid => {
                                                            const members = groups[gid] ?? [];
                                                            const sw = groupSwitchState(members, effectiveDisabledSet);
                                                            return (_jsxs("div", { className: css.groupRow, children: [_jsxs("div", { className: css.groupHead, children: [_jsx("button", { type: "button", role: "switch", "aria-checked": sw === 'on' ? true : sw === 'off' ? false : 'mixed', "aria-label": (sw !== 'on' ? t('enable') : t('disable')) + ' ' + gid, className: sw === 'on' ? `${css.switch} ${css.switchOn}` : sw === 'mixed' ? `${css.switch} ${css.switchMixed}` : css.switch, disabled: togglingName !== null || sw === 'empty', onClick: () => doGroupToggle(gid, sw !== 'on'), children: _jsx("span", { className: css.switchKnob }) }), _jsx("span", { className: css.groupName, children: gid }), sw === 'mixed' && _jsx("span", { className: css.groupHint, children: t('groupMixed') }), _jsx("span", { className: css.grow }), _jsxs("div", { className: css.groupActions, children: [renamingGroup === gid
                                                                                        ? (_jsxs(_Fragment, { children: [_jsx(Input, { className: css.inlineInput, placeholder: t('groupNamePh'), value: renamingValue, onChange: e => setRenamingValue(e.target.value), onKeyDown: e => { if (e.key === 'Enter')
                                                                                                        doRenameGroup(gid); }, autoFocus: true }), _jsx(Button, { variant: "primary", size: "sm", onClick: () => doRenameGroup(gid), children: t('groupRename') }), _jsx(Button, { variant: "ghost", size: "sm", onClick: () => { setRenamingGroup(null); setRenamingValue(''); }, children: t('cancel') })] }))
                                                                                        : _jsx(Button, { variant: "ghost", size: "sm", onClick: () => { setRenamingGroup(gid); setRenamingValue(gid); }, children: t('groupRename') }), deletingGroup === gid
                                                                                        ? _jsx(Button, { variant: "primary", size: "sm", className: css.dangerArmed, onClick: () => doDeleteGroup(gid), children: t('groupConfirmDelete') })
                                                                                        : _jsx(Button, { variant: "outline", size: "sm", className: css.dangerBtn, onClick: () => setDeletingGroup(gid), children: t('groupDelete') }), _jsx(Button, { variant: "outline", size: "sm", onClick: () => setAddPanel(addPanel !== null && addPanel.group === gid && addPanel.kind === 'plugin'
                                                                                            ? null
                                                                                            : { group: gid, kind: 'plugin' }), children: t('groupAdd') }), _jsx(Button, { variant: "outline", size: "sm", disabled: members.some(member => installedThemeNames.has(member)), onClick: () => setAddPanel(addPanel !== null && addPanel.group === gid && addPanel.kind === 'theme'
                                                                                            ? null
                                                                                            : { group: gid, kind: 'theme' }), children: t('groupAddTheme') })] })] }), addPanel !== null && addPanel.group === gid && (() => {
                                                                        const candidates = addPanel.kind === 'theme'
                                                                            ? [...installedThemeNames].filter(name => !members.includes(name))
                                                                            : groupableNames.filter(name => !members.includes(name) && !installedThemeNames.has(name));
                                                                        return (_jsx("div", { className: css.groupAddPanel, children: candidates.length === 0
                                                                                ? _jsx("div", { className: css.groupHint, children: t('groupAddEmpty') })
                                                                                : candidates.map(name => (_jsxs("div", { className: css.groupMember, children: [_jsx("span", { className: css.nm, children: name }), effectiveDisabledSet.has(name) && _jsx("span", { className: css.spec, children: t('disabledState') }), _jsx("span", { className: css.grow }), _jsx(Button, { variant: "outline", size: "sm", onClick: () => doAddMember(gid, name), children: addPanel.kind === 'theme' ? t('groupAddTheme') : t('groupAdd') })] }, name))) }));
                                                                    })(), _jsxs("div", { className: css.groupMembers, children: [members.length === 0 && _jsx("div", { className: css.groupHint, children: t('groupEmpty') }), members.map(member => (_jsxs("div", { className: css.groupMember, children: [_jsx("span", { className: css.nm, children: member }), effectiveDisabledSet.has(member) && _jsx("span", { className: css.spec, children: t('disabledState') }), _jsx("span", { className: css.grow }), _jsx("button", { type: "button", role: "switch", "aria-checked": !effectiveDisabledSet.has(member), "aria-label": (effectiveDisabledSet.has(member) ? t('enable') : t('disable')) + ' ' + member, className: effectiveDisabledSet.has(member) ? css.switch : `${css.switch} ${css.switchOn}`, disabled: togglingName !== null, onClick: () => doToggle(member, effectiveDisabledSet.has(member)), children: _jsx("span", { className: css.switchKnob }) }), _jsx(Button, { variant: "ghost", size: "sm", onClick: () => doRemoveMember(gid, member), children: t('groupRemove') })] }, member)))] })] }, gid));
                                                        }), _jsx("div", { className: css.sect, children: t('ungrouped') }), ungroupedNames.length === 0
                                                        ? _jsx("div", { className: css.empty, children: t('installedEmpty') })
                                                        : ungroupedNames.map(name => {
                                                            const entry = data === null ? undefined : entryForDep(data.plugins, name, String(installed[name]), repoIdentities[name], repoHints[name]);
                                                            const off = effectiveDisabledSet.has(name);
                                                            return (_jsxs("div", { className: css.irow, children: [_jsxs("div", { style: { minWidth: 0 }, children: [_jsxs("div", { className: css.nm, children: [name, entry?.deprecated === true && _jsx("span", { className: css.depBadge, children: t('deprecatedBadge') })] }), _jsx("div", { className: css.act, children: off
                                                                                    ? _jsxs("span", { className: css.actWarn, children: [_jsx(StateDot, { state: "warning", size: 7 }), t('disabledState')] })
                                                                                    : _jsxs("span", { className: css.actLive, children: [_jsx(StateDot, { state: "done", size: 7 }), t('stateLive')] }) })] }), _jsx("span", { className: css.grow }), assignFor === name
                                                                        ? (_jsxs("div", { className: css.assignRow, children: [_jsxs("select", { className: css.assignSelect, value: assignTarget, onChange: e => setAssignTarget(e.target.value), children: [_jsx("option", { value: "", children: t('groupNamePh') }), groupOrder.map(gid => _jsx("option", { value: gid, children: gid }, gid))] }), _jsx(Button, { variant: "primary", size: "sm", disabled: assignTarget === '', onClick: () => doAssign(name), children: t('groupAssign') }), _jsx(Button, { variant: "ghost", size: "sm", onClick: () => { setAssignFor(null); setAssignTarget(''); }, children: t('cancel') })] }))
                                                                        : _jsx(Button, { variant: "outline", size: "sm", disabled: groupOrder.length === 0, onClick: () => { setAssignFor(name); setAssignTarget(''); }, children: t('groupAssign') })] }, 'ug-' + name));
                                                        })] }))
                                            : Object.keys(displayedInstalled).filter(name => name !== selfName).length === 0
                                                ? _jsx("div", { className: css.empty, children: t('installedEmpty') })
                                                : (_jsx("div", { className: css.pairGrid, children: Object.entries(displayedInstalled)
                                                        .filter(([name, spec]) => {
                                                        // The market manages itself from its own settings
                                                        // card, not as a row in this list (#188-adjacent).
                                                        if (name === selfName)
                                                            return false;
                                                        const needle = qInstalled.trim().toLowerCase();
                                                        if (needle === '')
                                                            return true;
                                                        if (name.toLowerCase().includes(needle))
                                                            return true;
                                                        if (String(spec).toLowerCase().includes(needle))
                                                            return true;
                                                        const entry = data === null ? undefined : entryForDep(data.plugins, name, String(spec), repoIdentities[name], repoHints[name]);
                                                        if (entry !== undefined) {
                                                            const desc = (entry.description && (entry.description[lang] || entry.description.en)) || '';
                                                            if (desc.toLowerCase().includes(needle))
                                                                return true;
                                                            if ((entry.owner || '').toLowerCase().includes(needle))
                                                                return true;
                                                        }
                                                        return false;
                                                    })
                                                        .map(([name, spec]) => {
                                                        const missing = pendingBackup !== null && !installedFiles.includes(name);
                                                        const entry = data === null ? undefined : entryForDep(data.plugins, name, String(spec), repoIdentities[name], repoHints[name]);
                                                        const status = updates[name];
                                                        const act = activations[name];
                                                        const meta = act !== undefined ? activationMeta(act.state, t) : null;
                                                        const version = status && status.version ? 'v' + status.version : '';
                                                        const specText = String(spec);
                                                        // A plain range beside the resolved version says the
                                                        // same thing twice. Every other spec — github:, file:,
                                                        // link:, a tag — is the only place the row says where
                                                        // the plugin came from, so it stays.
                                                        const specRedundant = version !== '' && /^[\^~]?\d/.test(specText);
                                                        const ghSpec = /^github:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:#|$)/.exec(specText);
                                                        const repoUrl = entry !== undefined ? entry.url : ghSpec !== null ? 'https://github.com/' + ghSpec[1] : null;
                                                        const off = effectiveDisabledSet.has(name);
                                                        // Switches only where they make sense: everything in
                                                        // the disable list (to re-enable), plus live/restart
                                                        // states. inert/broken rows keep their diagnosis
                                                        // without a misleading toggle (#60).
                                                        const toggleable = off || (act !== undefined && (act.state === 'live' || act.state === 'restart'));
                                                        return (_jsxs("div", { className: missing ? `${css.irow} ${css.irowMissing}` : css.irow, children: [_jsxs("div", { style: { minWidth: 0 }, children: [_jsxs("div", { className: css.nm, children: [repoUrl !== null
                                                                                    ? _jsx("a", { className: css.nameLink, href: repoUrl + '#readme', target: "_blank", rel: "noreferrer", title: t('readme'), children: name })
                                                                                    : name, entry?.deprecated === true && _jsx("span", { className: css.depBadge, children: t('deprecatedBadge') }), version && _jsx("span", { className: css.owner, children: ' ' + version })] }), specRedundant
                                                                            ? null
                                                                            : repoUrl !== null
                                                                                ? _jsx("a", { className: `${css.spec} ${css.src}`, href: repoUrl, target: "_blank", rel: "noreferrer", style: { display: 'inline-block' }, children: specText })
                                                                                : _jsx("div", { className: css.spec, children: specText }), entry !== undefined && (_jsx("div", { className: `${css.desc} ${css.descTight}`, children: (entry.description && (entry.description[lang] || entry.description.en)) || '' })), !off && act !== undefined && meta !== null && (_jsxs("div", { className: css.act, children: [meta.dot !== 'done' && (_jsxs("span", { className: meta.dot === 'error' ? css.actBroken : css.actWarn, children: [_jsx(StateDot, { state: meta.dot, size: 7 }), meta.label] })), act.state !== 'live' && act.reasons.length > 0 && (_jsx(DisclosureRow, { icon: _jsx(IconQuestionOutline14, { size: 14 }), title: t('actWhy'), open: whyOpen === name, expandable: true, expandOnRowClick: true, onToggle: () => setWhyOpen(whyOpen === name ? null : name), className: css.actWhy, children: _jsx("div", { className: css.spec, children: act.reasons.join(' / ') }) }))] })), entry !== undefined && entry.deprecated === true && (_jsx("div", { className: css.deprecate, style: { marginTop: 8 }, children: _jsxs("div", { className: css.depLine, children: [_jsxs("span", { children: ["\u26A0\uFE0F ", t('deprecatedWarn')] }), entry.replacement !== undefined && (_jsx("span", { className: css.src, children: t('replacementHint') + ' ' + entry.replacement }))] }) })), updatingName === name && (_jsxs("div", { className: css.progress, children: [_jsx("span", { className: css.spin, children: _jsx(IconLoadingOutline16, { size: 14 }) }), _jsx("code", { className: css.grow, children: progressText }), progressPct !== null && _jsxs("span", { className: css.pct, children: [progressPct, "%"] }), _jsx(Button, { variant: "outline", size: "sm", disabled: cancelling, onClick: doCancel, children: cancelling ? t('cancelling') : t('cancelOp') }), _jsx("div", { className: css.bar, children: _jsx("div", { className: progressPct !== null ? css.barFill : `${css.barFill} ${css.barWave}`, style: progressPct !== null ? { width: `${progressPct}%` } : undefined }) })] }))] }), _jsxs("div", { className: css.irowActions, children: [!missing && (_jsxs("span", { className: css.stateTag, "data-on": off ? 'false' : 'true', children: [_jsx("span", { className: css.stateDot, "data-on": off ? 'false' : 'true' }), off ? t('disabledState') : t('switchOnLabel')] })), toggleable && (_jsx("button", { type: "button", role: "switch", "aria-checked": !off, "aria-label": (off ? t('enable') : t('disable')) + ' ' + name, className: off ? css.switch : `${css.switch} ${css.switchOn}`, disabled: togglingName !== null || busyUrl !== null || updatingName !== null || removingName !== null, onClick: () => doToggle(name, off), children: _jsx("span", { className: css.switchKnob }) })), _jsx("span", { className: css.grow }), entry !== undefined && entry.deprecated === true && entry.replacement !== undefined && (() => {
                                                                            const replacement = data?.plugins.find(r => r.name === entry.replacement);
                                                                            if (replacement === undefined)
                                                                                return null;
                                                                            return (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "outline", size: "sm", onClick: () => { setCat('all'); setQ(entry.replacement); setTab('discover'); }, children: t('viewReplacement') }), !isInstalled(replacement, installed, repoIdentities, data?.plugins, repoHints) && (_jsx(Button, { variant: "outline", size: "sm", onClick: () => setConfirming(replacement), children: t('installReplacement') }))] }));
                                                                        })(), _jsxs("span", { className: css.irowTrailing, children: [missing
                                                                                    ? _jsx("span", { className: css.metaTag, children: t('notInstalled') })
                                                                                    : updatedNames.includes(name)
                                                                                        ? _jsx("span", { className: `${css.metaTag} ${css.metaTagOk}`, children: act?.state === 'live' ? t('updatedLive') : t('updated') })
                                                                                        : updatingName === name
                                                                                            ? _jsx(Button, { variant: "primary", size: "sm", className: css.warnBtn, disabled: true, children: t('updating') })
                                                                                            : status && status.updateAvailable
                                                                                                ? (_jsx(Button, { variant: "primary", size: "sm", className: css.warnBtn, disabled: updatingName !== null, onClick: () => doUpdate(name), children: t('update') }))
                                                                                                : status && status.kind === 'linked'
                                                                                                    ? _jsx("span", { className: css.metaTag, title: t('linkedDev'), children: t('linkedDev') })
                                                                                                    : _jsx("span", { className: css.metaTag, title: t('upToDate'), children: t('upToDate') }), !missing && name !== 'dsh-market' && name !== 'dshmarket' && (removingName === name
                                                                                    ? _jsx(Button, { variant: "outline", size: "sm", className: css.dangerBtn, disabled: true, children: t('uninstalling') })
                                                                                    : (_jsx(Button, { variant: "outline", size: "sm", className: css.dangerBtn, disabled: removingName !== null || busyUrl !== null || updatingName !== null, onClick: () => setRemoveConfirm(name), children: t('uninstall') })))] })] })] }, name));
                                                    }) }))] })) }), showTop && (_jsx(Tooltip, { label: t('backTop'), side: "top", children: _jsx("span", { className: css.top, children: _jsx(Button, { variant: "outline", className: css.topBtn, "aria-label": t('backTop'), onClick: () => { const el = bodyRef.current; if (el)
                            el.scrollTo({ top: 0, behavior: 'smooth' }); }, children: _jsx(IconChevronUpOutline14, { size: 16 }) }) }) })), confirming !== null && (_jsxs(Modal, { open: true, onClose: () => { setConfirming(null); setCmdOpen(false); }, title: t('confirmTitle') + ' ' + confirming.name + '?', footer: (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "ghost", onClick: () => { setConfirming(null); setCmdOpen(false); }, children: t('cancel') }), _jsx(Button, { variant: "primary", onClick: () => doInstall(confirming), children: t('confirmInstall') })] })), children: [_jsxs("div", { className: css.byline, children: [_jsx(OwnerAvatar, { name: confirming.name, owner: confirming.owner || '' }), _jsx("span", { className: css.owner, title: confirming.owner, children: confirming.owner }), typeof confirming.downloads === 'number' && (_jsx(Tooltip, { label: String(confirming.downloads), side: "top", children: _jsx("span", { className: css.star, children: '· ↓ ' + formatCount(confirming.downloads) }) })), typeof confirming.stars === 'number' && (_jsx(Tooltip, { label: String(confirming.stars), side: "top", children: _jsx("span", { className: css.star, children: '· ★ ' + formatCount(confirming.stars) }) })), _jsx("span", { className: css.grow }), _jsx("span", { className: css.tag, children: (data.categories[confirming.category] && (data.categories[confirming.category][lang] || data.categories[confirming.category].en)) || confirming.category })] }), confirming.added && _jsx("div", { className: css.metaInline, children: t('published') + ' ' + confirming.added }), _jsx(CardDesc, { text: (confirming.description && (confirming.description[lang] || confirming.description.en)) || '', t: t }), _jsx(ScreenshotStrip, { plugin: confirming, onOpen: openLightbox }), _jsx(DisclosureRow, { icon: _jsx(IconCodeOutline16, { size: 16 }), title: t('cmdDetails'), open: cmdOpen, expandable: true, expandOnRowClick: true, onToggle: () => setCmdOpen(o => !o), children: _jsx("div", { className: css.cmd, children: confirming.install }) }), looksTerminal(confirming, lang) && (_jsxs("p", { className: css.warnLine, children: [_jsx(IconWarningOutline16, { size: 14, className: css.bannerIcon }), ' ' + t('terminalWarn') + ' ', _jsx("a", { className: css.src, href: confirming.url + '#readme', target: "_blank", rel: "noreferrer", children: t('readme') })] })), confirming.deprecated === true && (() => {
                        const replacement = replacementOf(confirming);
                        return (_jsx("div", { className: css.deprecate, children: _jsxs("div", { className: css.depLine, children: [_jsxs("span", { children: ["\u26A0\uFE0F ", t('deprecatedWarn')] }), replacement !== undefined && (_jsx("a", { className: css.src, href: replacement.url, target: "_blank", rel: "noreferrer", children: t('replacementHint') + ' ' + replacement.name }))] }) }));
                    })(), _jsxs("p", { className: css.modalNote, children: [_jsx(IconWarningOutline16, { size: 14, className: css.bannerIcon }), ' ' + t('confirmWarn')] })] })), lightbox !== null && (_jsx(ScreenshotLightbox, { shots: lightbox.shots, startIndex: lightbox.index, onClose: () => setLightbox(null), t: t })), removeConfirm !== null && (_jsx(Modal, { open: true, onClose: () => setRemoveConfirm(null), title: t('uninstall') + ' ' + removeConfirm + '?', description: t('uninstallConfirmDesc'), footer: (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "ghost", onClick: () => setRemoveConfirm(null), children: t('cancel') }), _jsx(Button, { variant: "primary", disabled: removingName !== null, onClick: () => doUninstall(removeConfirm), children: t('uninstall') })] })) })), restoreConfirmOpen && pendingBackup !== null && (_jsx(Modal, { open: true, onClose: () => setRestoreConfirmOpen(false), title: t('restoreConfirm'), footer: (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "ghost", onClick: () => setRestoreConfirmOpen(false), children: t('cancel') }), _jsx(Button, { variant: "primary", disabled: backupBusy, onClick: doRestore, children: t('confirm') })] })) })), exportOpen && (_jsxs(Modal, { open: true, onClose: () => setExportOpen(false), title: t('gistExportSelect'), description: t('gistExportHint'), footer: (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "ghost", onClick: () => setExportOpen(false), children: t('cancel') }), _jsx(Button, { variant: "primary", disabled: gistBusy || exportSelection.size === 0, onClick: () => runGist('export'), children: gistBusy ? t('backupWorking') : t('gistExportGo') })] })), children: [exportOptions.length === 0 && _jsx("p", { children: t('gistNoPlugins') }), exportOptions.length > 0 && (_jsxs(_Fragment, { children: [_jsxs("div", { className: css.backupActions, children: [_jsx(Button, { size: "sm", variant: "outline", onClick: () => setExportSelection(new Set(exportOptions)), children: t('gistSelectAll') }), _jsx(Button, { size: "sm", variant: "outline", onClick: () => setExportSelection(new Set()), children: t('gistSelectNone') })] }), _jsx("div", { className: css.backupCheckList, children: exportOptions.map(name => (_jsxs("label", { className: css.backupCheck, children: [_jsx("input", { type: "checkbox", checked: exportSelection.has(name), onChange: e => {
                                                const next = new Set(exportSelection);
                                                if (e.currentTarget.checked)
                                                    next.add(name);
                                                else
                                                    next.delete(name);
                                                setExportSelection(next);
                                            } }), _jsx("span", { className: css.grow, children: name }), specKind(installed[name]) === 'git' && _jsx("span", { className: `${css.specTag} ${css.specTagGit}`, children: "git" }), specKind(installed[name]) === 'file' && _jsx("span", { className: `${css.specTag} ${css.specTagFile}`, children: t('gistSpecLocal') }), _jsx("span", { className: css.spec, title: installed[name], children: installed[name] ?? t('bundleTag') })] }, name))) }), _jsxs("label", { className: css.backupCheck, children: [_jsx("input", { type: "checkbox", checked: exportIncludeConfig, onChange: e => setExportIncludeConfig(e.target.checked) }), t('gistIncludeConfig')] }), exportIncludeConfig && _jsx("p", { className: css.backupWarn, children: t('credsWarning') }), exportError !== null && _jsx("p", { className: css.backupWarn, children: exportError })] }))] })), exportState === 'done' && (_jsx(Toast, { text: t('exportedLog'), icon: _jsx(IconCheckOutline16, { size: 14 }), onDone: exportToastDone })), exportState === 'fail' && (_jsx(Toast, { text: t('exportLogFail'), icon: _jsx(IconWarningOutline16, { size: 14 }), onDone: exportToastDone }))] }));
}
//# sourceMappingURL=MarketSection.js.map