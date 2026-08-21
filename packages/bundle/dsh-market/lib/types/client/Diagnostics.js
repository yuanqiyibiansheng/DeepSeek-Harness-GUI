import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Diagnostics tab — issue #98: renders the profile composition check report
 * served by the host route /dsh-market/check (see src/check.ts). Below the
 * report sits the phase 2 action panel: community-bundle ordering (reorder
 * locally with ↑/↓ or drag, POST to /dsh-market/bundle-order) plus the AI-fix
 * clipboard prompt for HARD issues. The phase 3 snapshots & rollback and
 * plugin presets panels ship in later stacked PRs.
 *
 * Read-only view of the loading-layer stack and the conflict surface: bundle
 * order (official vs community), duplicate loader entry ids, peer dependency
 * mismatches, multi-version core packages, overrides and orphan patches. The
 * report shape mirrors the CheckReport interface in src/check.ts; it is
 * re-declared here because the client bundle is built independently of the
 * host tree.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, DisclosureRow, IconChevronDownOutline14, IconChevronRightOutline14, IconLoadingOutline16, IconRefreshOutline14, StateDot } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './Market.module.css';
/**
 * A collapsible report section: header shows title + count + chevron; the
 * body stays mounted (hidden via CSS when collapsed) so every block keeps
 * its state. ALL blocks are collapsed by default — the summary strip above
 * gives the overview, and a problem block's title is highlighted and its
 * collapsed `overview` line shows the first issue, so nothing important is
 * hidden. Expand a block to see its full content.
 */
function Section(props) {
    const { title, count, empty, defaultOpen, problem = true, overview, alwaysShowBody = false, children } = props;
    const [open, setOpen] = useState(defaultOpen ?? false);
    const alert = problem && count > 0;
    return (_jsxs("section", { className: css.diagSection, children: [_jsxs("button", { type: "button", className: css.collapseHead, onClick: () => setOpen(o => !o), "aria-expanded": open, children: [_jsx("span", { className: css.collapseIcon, children: open ? _jsx(IconChevronDownOutline14, { size: 14 }) : _jsx(IconChevronRightOutline14, { size: 14 }) }), alert && _jsx("span", { className: css.diagAlert, children: "\u26A0" }), _jsx("span", { className: `${css.collapseTitle}${alert ? ` ${css.diagAlert}` : ''}`, children: title }), _jsxs("span", { className: css.diagCount, children: ["(", count, ")"] }), _jsx("span", { className: css.grow })] }), !open && overview !== undefined && _jsx("div", { className: css.sectionOverview, children: overview }), _jsx("div", { className: css.collapseBody, style: open ? undefined : { display: 'none' }, children: count === 0 && !alwaysShowBody ? _jsx("div", { className: css.diagEmpty, children: empty }) : children })] }));
}
/** A collapsible section that KEEPS its children mounted (hidden via CSS when
 * collapsed) so the ordering panel below retains its loaded data and
 * in-progress edits across collapses.
 */
function CollapsibleSection(props) {
    const { title, count, open, onToggle, children } = props;
    return (_jsxs("section", { className: css.diagSection, children: [_jsxs("button", { type: "button", className: css.collapseHead, onClick: onToggle, "aria-expanded": open, children: [_jsx("span", { className: css.collapseIcon, children: open ? _jsx(IconChevronDownOutline14, { size: 14 }) : _jsx(IconChevronRightOutline14, { size: 14 }) }), _jsx("span", { className: css.collapseTitle, children: title }), count !== undefined && _jsxs("span", { className: css.diagCount, children: ["(", count, ")"] }), _jsx("span", { className: css.grow })] }), _jsx("div", { className: css.collapseBody, style: open ? undefined : { display: 'none' }, children: children })] }));
}
/** Map an orphan patch reason (src/check.ts) to a locale key for its badge. */
function orphanKindLabel(reason) {
    if (reason === 'insert is not an array')
        return 'orphanInsertNotArray';
    if (reason === 'insert target not found')
        return 'orphanInsertTargetMissing';
    if (reason === 'insert target is not a group')
        return 'orphanInsertTargetNotGroup';
    if (reason === 'id required for non-insert patch')
        return 'orphanIdRequired';
    if (reason === 'patch target not found')
        return 'orphanPatchTargetMissing';
    if (reason.startsWith('name mismatch'))
        return 'orphanNameMismatch';
    return 'orphanReasonOther';
}
/**
 * Fetch and render the profile check report. Refetches on every mount, so
 * switching tabs away and back re-runs the (cheap, read-only) analysis; the
 * ordering panel calls `refresh()` after applying an order.
 */
export function Diagnostics(props) {
    const { t } = props;
    const [report, setReport] = useState(null);
    const [error, setError] = useState(null);
    const [orderOpen, setOrderOpen] = useState(false);
    const [explainOpen, setExplainOpen] = useState(false);
    const [peerInfoOpen, setPeerInfoOpen] = useState(false);
    const [fixMsg, setFixMsg] = useState(null);
    /** The built AI-fix prompt when the clipboard path failed — rendered as a
     * selectable text block so the user can still copy it manually. */
    const [fixFallback, setFixFallback] = useState(null);
    /** Bump to re-run the /dsh-market/check fetch after an order apply. */
    const [version, setVersion] = useState(0);
    const refresh = useCallback(() => setVersion(v => v + 1), []);
    // --- issue #98 phase 2 (step 1): community-bundle ordering ---------------
    /** Community bundle names from the report, in declared order. */
    const communityNames = useMemo(() => report === null ? [] : report.bundles.filter(bundle => bundle.kind === 'community').map(bundle => bundle.name), [report]);
    /** Local editing state: re-synced whenever the report (re)loads. */
    const [order, setOrder] = useState(communityNames);
    const [orderMsg, setOrderMsg] = useState(null);
    const [orderErr, setOrderErr] = useState(null);
    const [orderBusy, setOrderBusy] = useState(false);
    /** Current-vs-candidate composition diff from a rejected static-composition
     * validation (#125 review): what the candidate would change, shown as a hint. */
    const [orderDiff, setOrderDiff] = useState(null);
    /**
     * Content identity of the last community order this draft synced to. A
     * refresh() refetch returns a NEW array even when the order is unchanged,
     * so a naive `setOrder(communityNames)` effect would wipe the user's
     * in-progress drag/↑↓ edits on every unrelated re-check. Only resync when
     * the report's community order actually CHANGED (apply order) — an
     * identical refetch keeps the draft (review M2).
     */
    const syncedOrderRef = useRef(null);
    useEffect(() => {
        const synced = syncedOrderRef.current;
        const same = synced !== null
            && synced.length === communityNames.length
            && communityNames.every((name, i) => name === synced[i]);
        if (same)
            return;
        syncedOrderRef.current = communityNames;
        setOrder(communityNames);
    }, [communityNames]);
    /** Swap one community bundle with its neighbour (-1 up, +1 down). */
    const moveBundle = (index, delta) => {
        setOrder(prev => {
            const next = [...prev];
            const target = index + delta;
            if (target < 0 || target >= next.length)
                return prev;
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });
    };
    // --- drag & drop reordering (draft only — saved by 应用顺序 / Apply order) ---
    /** Row being dragged (index into the local `order` draft). */
    const [dragIndex, setDragIndex] = useState(null);
    /** Row currently under the pointer, highlighted as the drop target. */
    const [dragOverIndex, setDragOverIndex] = useState(null);
    const onRowDragStart = (index) => (event) => {
        if (orderBusy) {
            event.preventDefault();
            return;
        }
        setDragIndex(index);
        event.dataTransfer?.setData?.('text/plain', order[index] ?? '');
        if (event.dataTransfer !== undefined)
            event.dataTransfer.effectAllowed = 'move';
    };
    const onRowDragOver = (index) => (event) => {
        if (dragIndex === null || dragIndex === index)
            return;
        // preventDefault marks the row as a valid drop target (no auto-scroll).
        event.preventDefault();
        if (event.dataTransfer !== undefined)
            event.dataTransfer.dropEffect = 'move';
        setDragOverIndex(index);
    };
    const onRowDragLeave = (index) => () => {
        setDragOverIndex(prev => prev === index ? null : prev);
    };
    const onRowDrop = (index) => (event) => {
        event.preventDefault();
        const from = dragIndex;
        setDragIndex(null);
        setDragOverIndex(null);
        if (from === null || from === index)
            return;
        // Reorder the LOCAL draft only; the host is told via 应用顺序 / Apply order.
        setOrder(prev => {
            const next = [...prev];
            const [moved] = next.splice(from, 1);
            next.splice(index, 0, moved);
            return next;
        });
    };
    const onRowDragEnd = () => {
        setDragIndex(null);
        setDragOverIndex(null);
    };
    /** POST the current community order; the host statically validates the
     * candidate composition (dry-run replay) before writing. */
    const applyOrder = (target) => {
        if (orderBusy)
            return;
        setOrderBusy(true);
        setOrderMsg(null);
        setOrderErr(null);
        setOrderDiff(null);
        fetch('/dsh-market/bundle-order', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ order: target ?? order }),
        })
            .then(async (res) => {
            const body = (await res.json().catch(() => null));
            if (!res.ok || body?.ok !== true) {
                // A rejected static-composition validation (422) carries the
                // current-vs-candidate diff — surface what the candidate would
                // change as an informational hint (issue #125 review).
                const diff = body?.trial?.diff;
                const overrides = diff?.overrides?.length ?? 0;
                const orphans = diff?.orphans?.length ?? 0;
                const duplicates = diff?.duplicates?.length ?? 0;
                setOrderDiff(overrides + orphans + duplicates > 0 ? { overrides, orphans, duplicates } : null);
                const firstMessage = body?.trial?.errors?.[0]?.message;
                setOrderErr(body?.trial !== undefined
                    ? t('orderTrialFail').replace('{0}', firstMessage !== undefined ? String(firstMessage) : '')
                    : String(body?.error ?? `HTTP ${String(res.status)}`));
                return;
            }
            setOrderDiff(null);
            setOrderMsg(t('orderApplied'));
            // Refetch the report so communityNames / the ordering draft reflect
            // the applied order.
            refresh();
        })
            .catch((err) => setOrderErr(err instanceof Error ? err.message : String(err)))
            .finally(() => setOrderBusy(false));
    };
    useEffect(() => {
        let live = true;
        // Do NOT null the report here: a refresh() (manual re-check, or after an
        // order apply) must keep the previous data visible and must not clobber
        // the in-progress ordering draft, which re-syncs from communityNames only
        // when the report actually changes (review M2).
        setError(null);
        fetch('/dsh-market/check', { cache: 'no-store' })
            .then(async (res) => {
            if (!res.ok)
                throw new Error(`HTTP ${String(res.status)}`);
            const body = (await res.json());
            if (live)
                setReport(body);
        })
            .catch((err) => {
            if (live)
                setError(err instanceof Error ? err.message : String(err));
        });
        return () => { live = false; };
    }, [version]);
    if (error !== null) {
        return _jsxs("div", { className: css.err, children: [t('checkLoadFail'), error] });
    }
    if (report === null) {
        return (_jsxs("div", { className: css.loading, children: [_jsx("span", { className: css.spin, children: _jsx(IconLoadingOutline16, { size: 22 }) }), t('checkLoading')] }));
    }
    const summary = report.summary;
    const suggested = report.suggestedOrder ?? null;
    // Confirmed mismatches vs informational entries (satisfied / unknown).
    const peerConfirmed = report.peerMismatches.filter(peer => peer.satisfied === false);
    const peerInfo = report.peerMismatches.filter(peer => peer.satisfied !== false);
    // Category counts for the overview strip: conflicts / dependencies / order.
    // Conflicts = HARD duplicate loader entries only; same-name rows are
    // informational and stay out of the conflict count (review #109).
    const catConflict = report.duplicates.length;
    const catDeps = report.peerMismatches.length + report.multiVersion.length;
    const catOrder = report.orderConflicts?.length ?? 0;
    const anyIssue = catConflict + catDeps + catOrder > 0;
    // AI-fix only shows for HARD issues — things that actually break the
    // profile (boot errors, duplicate entries, confirmed peer mismatches).
    // Purely informational/warning states stay quiet so the agent is not
    // nudged into risky changes without a clear problem (conservative UX).
    // duplicateNames (same-name rows) is informational only and never counts
    // as a hard issue (review #109).
    const hasHardIssues = summary.errors.length > 0
        || report.duplicates.length > 0
        || report.peerMismatches.some(peer => peer.satisfied === false);
    /**
     * Build the AI-fix prompt (errors/warnings/order conflicts + scope) and
     * copy it to the clipboard. The user pastes it into a new conversation
     * and decides whether to send — the agent never runs automatically.
     * (A previous auto-open/prefill attempt was dropped: it was unreliable
     * across host versions, so plain copy + toast is the contract.)
     */
    const startAgentFix = () => {
        const lines = [];
        lines.push(t('aiFixIntro').replace('{0}', report.profile));
        lines.push('');
        if (summary.errors.length > 0) {
            lines.push(`${t('checkErrors')}:`);
            for (const e of summary.errors)
                lines.push(`- ${e}`);
            lines.push('');
        }
        if (summary.warnings.length > 0) {
            lines.push(`${t('checkWarnings')}:`);
            for (const w of summary.warnings)
                lines.push(`- ${w}`);
            lines.push('');
        }
        if ((report.orderConflicts ?? []).length > 0) {
            lines.push(`${t('catOrder')}:`);
            for (const c of report.orderConflicts ?? [])
                lines.push(`- ${c.name}: ${c.reason}`);
            lines.push('');
        }
        lines.push(t('aiFixScope'));
        lines.push('');
        lines.push(t('aiFixConservative'));
        const prompt = lines.join('\n');
        // Clipboard-first; on any failure (missing API or a rejected promise) show
        // the prompt in a selectable block so the user can still copy it by hand —
        // a bare "clipboard unavailable" message left nothing to copy.
        setFixMsg(null);
        setFixFallback(null);
        const fallback = () => setFixFallback(prompt);
        if (typeof navigator.clipboard?.writeText === 'function') {
            navigator.clipboard.writeText(prompt)
                .then(() => setFixMsg(t('aiFixCopied')))
                .catch(fallback);
        }
        else {
            fallback();
        }
    };
    return (_jsxs("div", { className: css.diagPage, children: [_jsxs("div", { className: css.diagSummary, children: [_jsxs("span", { className: summary.ok ? css.okState : css.err, children: [_jsx(StateDot, { state: summary.ok ? 'done' : 'error', size: 8 }), summary.ok ? (anyIssue ? t('checkIssues') : t('diagOkAll')) : t('checkIssues')] }), _jsxs("span", { className: css.diagSummaryItem, title: t('checkDuplicates'), children: [_jsx(StateDot, { state: "error", size: 8 }), t('catConflict'), ": ", catConflict] }), _jsxs("span", { className: css.diagSummaryItem, title: t('checkPeerMismatches'), children: [_jsx(StateDot, { state: "warning", size: 8 }), t('catDeps'), ": ", catDeps] }), _jsxs("span", { className: css.diagSummaryItem, title: t('checkOrderTip'), children: [_jsx(StateDot, { state: "warning", size: 8 }), t('catOrder'), ": ", catOrder] }), _jsx("span", { className: css.grow }), hasHardIssues && (_jsx(Button, { variant: "outline", size: "sm", onClick: startAgentFix, title: t('aiFixHint'), children: t('aiFix') })), _jsx(Button, { variant: "ghost", size: "sm", "aria-label": t('checkRefresh'), onClick: refresh, children: _jsx(IconRefreshOutline14, { size: 14 }) }), _jsxs("span", { className: css.diagSummaryMeta, title: report.profile, children: [t('checkProfile'), ": ", report.profile] }), _jsx("span", { className: css.diagSummaryMeta, children: new Date(report.scannedAt).toLocaleString() })] }), fixMsg !== null && _jsx("div", { className: css.okState, children: fixMsg }), fixFallback !== null && (_jsxs("div", { className: css.fixFallback, children: [_jsx("p", { className: css.panelNote, children: t('aiFixFail') }), _jsx("textarea", { readOnly: true, rows: 10, className: css.fixFallbackText, value: fixFallback, onFocus: e => e.currentTarget.select() })] })), _jsxs(CollapsibleSection, { title: t('diagExplain'), open: explainOpen, onToggle: () => setExplainOpen(o => !o), children: [_jsx("p", { className: css.panelNote, children: t('diagExplainText') }), _jsxs("div", { className: css.diagList, children: [_jsx("div", { className: css.spec, children: t('diagTermBundle') }), _jsx("div", { className: css.spec, children: t('diagTermEntry') }), _jsx("div", { className: css.spec, children: t('diagTermPeer') }), _jsx("div", { className: css.spec, children: t('diagTermShadow') }), _jsx("div", { className: css.spec, children: t('diagTermOrphan') }), _jsx("div", { className: css.spec, children: t('diagTermOrder') })] })] }), _jsx(Section, { title: t('checkErrors'), count: summary.errors.length, empty: t('checkErrorsEmpty'), overview: summary.errors.length > 0 ? summary.errors[0] : undefined, children: _jsx("div", { className: css.diagList, children: summary.errors.map((line, i) => (_jsx("div", { className: css.err, children: line }, i))) }) }), _jsx(Section, { title: t('checkWarnings'), count: summary.warnings.length, empty: t('checkWarningsEmpty'), overview: summary.warnings.length > 0 ? summary.warnings[0] : undefined, children: _jsx("div", { className: css.diagList, children: summary.warnings.map((line, i) => (_jsx("div", { className: css.warnLine, children: _jsx("span", { children: line }) }, i))) }) }), _jsx(Section, { title: t('checkBundles'), count: report.bundles.length, empty: t('checkBundlesEmpty'), problem: false, overview: _jsxs("span", { children: [t('checkOfficial'), " \u00D7 ", report.bundles.filter(b => b.kind === 'official').length, ' · ', t('checkCommunity'), " \u00D7 ", report.bundles.filter(b => b.kind === 'community').length] }), children: report.bundles.map((bundle, i) => (_jsxs("div", { className: css.diagBundle, children: [_jsxs("div", { className: css.diagRow, children: [_jsx("span", { className: css.diagIndex, children: i + 1 }), _jsx("span", { className: css.diagArrow, children: "\u2192" }), _jsx("span", { className: css.nm, children: bundle.name }), _jsx("span", { className: bundle.kind === 'official' ? css.diagBadgeOfficial : css.diagBadgeCommunity, children: bundle.kind === 'official' ? t('checkOfficial') : t('checkCommunity') }), bundle.error !== null && _jsx("span", { className: css.err, children: bundle.error }), bundle.parseError !== null && _jsxs("span", { className: css.err, children: [t('checkPatch'), ": ", bundle.parseError] })] }), _jsxs("div", { className: css.diagMeta, children: [_jsx("span", { className: css.diagKey, children: t('checkSource') }), _jsx("code", { className: css.spec, children: bundle.source })] }), _jsxs("div", { className: css.diagMeta, children: [_jsx("span", { className: css.diagKey, children: t('checkEntries') }), _jsx("code", { className: css.spec, children: bundle.entries.length > 0 ? bundle.entries.join(', ') : '—' })] }), bundle.directory !== null && (_jsxs("div", { className: css.diagMeta, children: [_jsx("span", { className: css.diagKey, children: t('checkDir') }), _jsx("code", { className: css.spec, children: bundle.directory })] })), bundle.patchPath !== null && (_jsxs("div", { className: css.diagMeta, children: [_jsx("span", { className: css.diagKey, children: t('checkPatch') }), _jsx("code", { className: css.spec, children: bundle.patchPath })] }))] }, bundle.name))) }), _jsx(Section, { title: t('checkDuplicates'), count: report.duplicates.length, empty: t('checkDuplicatesEmpty'), overview: report.duplicates.length > 0 ? `${report.duplicates[0]?.id} × ${report.duplicates[0]?.count}` : undefined, children: _jsx("div", { className: css.diagList, children: report.duplicates.map(dup => (_jsxs("div", { className: css.diagRow, children: [_jsx("code", { className: css.diagVal, children: dup.id }), _jsxs("span", { className: css.err, children: ["\u00D7 ", dup.count] }), _jsx("span", { className: css.spec, children: dup.layers.join(' / ') })] }, dup.id))) }) }), _jsxs(Section, { title: t('checkPeerMismatches'), count: peerConfirmed.length, empty: t('checkPeerEmpty'), overview: report.peerMismatches.length > 0
                    ? t('checkPeerOverview')
                        .replace('{0}', String(peerConfirmed.length))
                        .replace('{1}', String(peerInfo.length))
                    : undefined, 
                // The body must render even with zero CONFIRMED mismatches when
                // informational entries exist — otherwise the disclosure holding them
                // would be unreachable (count-0 sections render only the empty text).
                alwaysShowBody: peerInfo.length > 0, children: [peerConfirmed.length === 0 ? (_jsx("div", { className: css.diagEmpty, children: t('checkPeerEmpty') })) : (_jsx("div", { className: css.diagList, children: peerConfirmed.map((peer, i) => (_jsxs("div", { className: css.diagRow, children: [_jsx("code", { className: css.diagVal, children: peer.name }), _jsx("span", { className: css.nm, children: peer.plugin }), _jsxs("span", { className: css.spec, children: [t('checkRange'), ": ", peer.range] }), _jsxs("span", { className: css.spec, children: [t('checkResolved'), ": ", peer.resolved ?? '—'] }), _jsx("span", { className: css.diagBadgeShadow, children: t('checkUnsatisfied') })] }, i))) })), peerInfo.length > 0 && (_jsx(DisclosureRow, { icon: _jsx(IconChevronDownOutline14, { size: 14 }), title: `${t('checkPeerInfo').replace('{0}', String(peerInfo.length))} (${peerInfo.length})`, expandable: true, open: peerInfoOpen, onToggle: () => setPeerInfoOpen(o => !o), children: _jsx("div", { className: css.diagList, children: peerInfo.map((peer, i) => (_jsxs("div", { className: css.diagRow, children: [_jsx("code", { className: css.diagVal, children: peer.name }), _jsx("span", { className: css.nm, children: peer.plugin }), _jsxs("span", { className: css.spec, children: [t('checkRange'), ": ", peer.range] }), _jsxs("span", { className: css.spec, children: [t('checkResolved'), ": ", peer.resolved ?? '—'] }), peer.satisfied === true
                                        ? _jsx("span", { className: css.okState, children: t('checkSatisfied') })
                                        : _jsx("span", { className: css.spec, children: t('checkUnknown') })] }, i))) }) }))] }), _jsx(Section, { title: t('checkMultiVersion'), count: report.multiVersion.length, empty: t('checkMultiEmpty'), overview: report.multiVersion.length > 0 ? `${report.multiVersion[0]?.name}: ${report.multiVersion[0]?.versions.join(' / ')}` : undefined, children: _jsx("div", { className: css.diagList, children: report.multiVersion.map(mv => (_jsxs("div", { className: css.diagRow, children: [_jsx("code", { className: css.diagVal, children: mv.name }), _jsx("span", { className: css.spec, children: mv.versions.join(' / ') }), mv.hoisted !== null && _jsxs("span", { className: css.spec, children: [t('checkHoisted'), ": ", mv.hoisted] })] }, mv.name))) }) }), _jsx(Section, { title: t('checkOverrides'), count: report.overrides.length, empty: t('checkOverridesEmpty'), overview: report.overrides.length > 0 ? `${report.overrides[0]?.id} ← ${report.overrides[0]?.layer}` : undefined, children: _jsx("div", { className: css.diagList, children: report.overrides.map((ov, i) => (_jsxs("div", { className: css.ovRow, children: [_jsx("code", { className: css.diagVal, children: ov.id }), _jsx("span", { className: css.ovArrow, children: "\u2190" }), _jsx("span", { className: css.ovByTag, children: ov.layer }), _jsx("span", { className: css.spec, children: t('checkOverridden') }), _jsx("span", { className: css.ovFrom, children: ov.overriddenLayers.join(', ') })] }, i))) }) }), _jsx(Section, { title: t('checkOrphans'), count: report.orphans.length, empty: t('checkOrphansEmpty'), overview: report.orphans.length > 0 ? `${report.orphans[0]?.id}（${t(orphanKindLabel(report.orphans[0]?.reason ?? ''))}）` : undefined, children: _jsx("div", { className: css.diagList, children: report.orphans.map((orphan, i) => (_jsxs("div", { className: css.orphRow, children: [_jsx("span", { className: css.orphBadge, children: t(orphanKindLabel(orphan.reason)) }), _jsx("code", { className: css.diagVal, children: orphan.id }), _jsx("span", { className: css.nm, children: orphan.layer }), _jsx("span", { className: css.spec, children: orphan.reason })] }, i))) }) }), _jsxs(CollapsibleSection, { title: t('orderSection'), count: order.length, open: orderOpen, onToggle: () => setOrderOpen(o => !o), children: [_jsx("p", { className: css.panelNote, children: t('orderDragHint') }), report.orderConflicts !== undefined && report.orderConflicts.length > 0 && (_jsxs("div", { className: css.diagList, children: [_jsx("span", { className: css.diagKey, children: t('orderConflicts') }), report.orderConflicts.map((conflict, i) => (_jsxs("div", { className: css.warnLine, children: [conflict.name, " \u2014 ", conflict.reason] }, i)))] })), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }, children: [_jsx(Button, { variant: "primary", size: "sm", disabled: order.length === 0 || orderBusy, onClick: () => applyOrder(), children: orderBusy ? '…' : t('orderApply') }), suggested !== null && suggested.ok === true
                                && suggested.order.join('\u0000') !== communityNames.join('\u0000')
                                && (_jsx(Button, { variant: "outline", size: "sm", disabled: orderBusy, onClick: () => applyOrder(suggested.order), children: t('orderSuggestApply') })), suggested !== null && suggested.ok === true
                                && suggested.order.join('\u0000') === communityNames.join('\u0000')
                                && _jsx("span", { className: css.okState, children: t('orderAlreadyOptimal') }), order.join('\u0000') !== communityNames.join('\u0000') && (_jsx(Button, { variant: "ghost", size: "sm", disabled: orderBusy, onClick: () => setOrder(communityNames), children: t('orderReset') })), orderMsg !== null && _jsx("span", { className: css.okState, children: orderMsg }), orderErr !== null && _jsx("span", { className: css.err, children: orderErr })] }), orderDiff !== null && (_jsx("div", { className: css.panelNote, children: t('orderDiffHint').replace('{0}', String(orderDiff.overrides)).replace('{1}', String(orderDiff.orphans)).replace('{2}', String(orderDiff.duplicates)) })), suggested !== null && suggested.ok === false && (_jsxs("div", { className: css.warnLine, children: [t('orderSuggestHint'), " \u26A0 ", suggested.cycle.join(' → ')] })), report.duplicateNames !== undefined && report.duplicateNames.length > 0 && (_jsxs("div", { className: css.diagList, children: [_jsx("span", { className: css.diagKey, children: t('duplicateNames') }), report.duplicateNames.map((dup, i) => (_jsxs("div", { className: css.panelNote, children: [dup.name, " \u00D7 ", dup.count, " \u2014 ", dup.layers.join(' / ')] }, i)))] })), order.length === 0
                        ? _jsx("div", { className: css.diagEmpty, children: "\u2014" })
                        : (_jsx("div", { className: css.diagList, children: order.map((name, i) => (_jsxs("div", { draggable: !orderBusy, className: [
                                    css.diagRow,
                                    dragIndex === i ? css.dragging : '',
                                    dragOverIndex === i ? css.dragOver : '',
                                ].filter(Boolean).join(' '), onDragStart: onRowDragStart(i), onDragOver: onRowDragOver(i), onDragLeave: onRowDragLeave(i), onDrop: onRowDrop(i), onDragEnd: onRowDragEnd, children: [_jsx("span", { className: css.dragHandle, "aria-label": t('orderDrag'), title: t('orderDrag'), children: "\u283F" }), _jsx("span", { className: css.diagIndex, children: i + 1 }), _jsx("span", { className: css.nm, children: name }), _jsx("span", { className: css.grow }), _jsx(Button, { variant: "ghost", size: "sm", draggable: false, "aria-label": t('orderUp'), disabled: i === 0 || orderBusy, onClick: () => moveBundle(i, -1), children: t('orderUp') }), _jsx(Button, { variant: "ghost", size: "sm", draggable: false, "aria-label": t('orderDown'), disabled: i >= order.length - 1 || orderBusy, onClick: () => moveBundle(i, 1), children: t('orderDown') })] }, name))) }))] })] }));
}
//# sourceMappingURL=Diagnostics.js.map