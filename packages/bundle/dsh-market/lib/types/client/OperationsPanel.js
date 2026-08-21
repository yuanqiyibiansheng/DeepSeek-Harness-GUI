import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The activity entry and its panel: every install, update and uninstall the
 * user started, with the action each outcome calls for.
 *
 * The entry lives in the tab row rather than above the plugin grid, so
 * paginating, searching or switching tab cannot take a record — or a pending
 * decision — off screen. It reports the batch as one aggregate ("installing
 * 3 / 7") instead of one line per plugin.
 */
import { Button, IconCheckOutline16, IconLoadingOutline16, IconWarningOutline16, IconChevronDownOutline14, IconChevronUpOutline14, } from '@deepseek-ai/dsh-client-ui-primitives';
import { useEffect, useRef, useState } from 'react';
import css from './Market.module.css';
import { bucketOf, isSettled, needsUser, queuePosition, sortForPanel, summarize } from "./operations.js";
/** What the two clash outcomes are, in the order they are offered. */
const CHOICES = [
    { id: 'keep', label: 'conflictKeep', note: 'conflictKeepNote' },
    { id: 'swap', label: 'conflictSwap', note: 'conflictSwapNote' },
];
/**
 * What each plugin ends up as under the selected outcome.
 *
 * The consequence is drawn ON the plugins rather than described beside them:
 * pick "keep what I have" and the installed rows tick while the candidate
 * crosses out; pick the other and they swap. The candidate is in this list
 * for the same reason — a decision about which plugin survives has to show
 * what happens to the one being installed, not only to the others.
 */
function OutcomePreview(props) {
    const { t, record, choice } = props;
    const swap = choice === 'swap';
    const candidate = props.describe(record.name);
    const row = (key, info, kept, tag) => (_jsxs("div", { className: kept ? css.rosterRow : `${css.rosterRow} ${css.rosterRowOut}`, children: [info.avatar, _jsxs("span", { className: css.rosterMain, children: [_jsx("span", { className: css.rosterName, title: key, children: info.title }), info.author !== undefined && _jsx("span", { className: css.rosterAuthor, children: info.author })] }), _jsxs("span", { className: kept ? `${css.rosterTag} ${css.rosterTagKeep}` : `${css.rosterTag} ${css.rosterTagDrop}`, children: [kept ? '✓' : '✕', " ", tag] })] }, key));
    return (_jsxs("div", { className: css.roster, children: [row(record.name, candidate, swap, t(swap ? 'conflictOutcomeInstall' : 'conflictOutcomeSkip')), _jsx("div", { className: css.rosterSplit }), (record.conflicts ?? []).map(group => row(group.owner, props.describe(group.owner), !swap, t(swap ? 'conflictOutcomeRemove' : 'conflictOutcomeKeep')))] }));
}
/**
 * The decision attached to a clash. Two outcomes rather than an error plus a
 * destructive button: the default changes nothing, and selecting the other
 * one is itself the consent step, so its cost is stated here.
 */
function ConflictChoice(props) {
    const { t, record, replacing, envReady } = props;
    const [choice, setChoice] = useState('keep');
    const [whyOpen, setWhyOpen] = useState(false);
    return (_jsxs("div", { className: css.opDecision, children: [_jsx("p", { className: css.conflictBody, children: t('conflictBody') }), _jsx(OutcomePreview, { t: t, record: record, choice: choice, describe: props.describe }), _jsx("div", { className: css.choices, children: CHOICES.map(({ id, label, note }) => (_jsxs("label", { className: choice === id ? `${css.choice} ${css.choiceOn}` : css.choice, children: [_jsx("input", { type: "radio", className: css.choiceRadio, name: `dshm-conflict-${record.id}`, checked: choice === id, disabled: replacing, onChange: () => setChoice(id) }), _jsxs("span", { className: css.choiceMain, children: [_jsx("span", { className: css.choiceTitle, children: t(label) }), t(note) !== '' && _jsx("span", { className: css.choiceNote, children: t(note) })] })] }, id))) }), _jsxs("div", { className: css.opDecisionFoot, children: [_jsxs("button", { type: "button", className: css.conflictDetailsToggle, "aria-expanded": whyOpen, onClick: () => setWhyOpen(open => !open), children: [t('conflictDetails'), whyOpen ? _jsx(IconChevronUpOutline14, { size: 12 }) : _jsx(IconChevronDownOutline14, { size: 12 })] }), _jsx("span", { className: css.grow }), _jsx(Button, { variant: choice === 'swap' ? 'outline' : 'primary', size: "sm", className: choice === 'swap' ? css.dangerBtn : undefined, disabled: replacing || (choice === 'swap' && !envReady), onClick: () => props.onResolve(choice), children: replacing ? t('conflictReplacing') : t('confirm') })] }), whyOpen && (_jsxs("div", { className: css.conflictWhy, children: [(record.conflicts ?? []).map(group => (_jsxs("div", { children: [group.owner, ": ", group.ids.join(', ')] }, group.owner))), _jsx("div", { className: css.conflictWhyText, children: t('conflictWhy') })] }))] }));
}
/** Icon for a record's visual bucket — three, not one per state. */
function BucketIcon(props) {
    const bucket = bucketOf(props.record.state);
    if (bucket === 'busy') {
        return props.record.state === 'running'
            ? _jsx("span", { className: css.spin, children: _jsx(IconLoadingOutline16, { size: 13 }) })
            : _jsx("span", { className: css.opQueuedIcon, children: "\u22EF" });
    }
    if (bucket === 'ok')
        return _jsx(IconCheckOutline16, { size: 13, className: css.reassureOk });
    return _jsx(IconWarningOutline16, { size: 14, className: css.conflictIcon });
}
/** The one-line status under a record's name; the bucket carries the rest. */
function statusLine(t, record, ahead) {
    switch (record.state) {
        case 'queued':
            return ahead === null || ahead === 0 ? t('opQueued') : `${t('opQueued')} · ${t('opQueuedAhead')} ${String(ahead)}`;
        case 'running':
            return record.detail ?? t('opRunning');
        case 'input':
            return t('opNeedsChoice');
        case 'failed':
            return record.reason ?? t('installFail');
        case 'warned':
            return record.reason ?? t('opDone');
        case 'done':
            return record.needsRefresh === true ? t('opDoneRefresh') : t('opDone');
    }
}
export function OperationsPanel(props) {
    const { t, records, open } = props;
    const setOpen = props.onOpenChange;
    const wrapRef = useRef(null);
    const summary = summarize(records);
    const busy = summary.running + summary.queued > 0;
    // Dismissing a popover by pressing the control that opened it is the one
    // route nobody looks for. Escape and an outside click are; the header also
    // carries an explicit collapse for anyone who wants a target to aim at.
    // The listener covers the whole wrapper, button included, so the button's
    // own toggle is not undone by this closing first.
    useEffect(() => {
        if (!open)
            return undefined;
        const onKey = (event) => { if (event.key === 'Escape')
            setOpen(false); };
        const onPointer = (event) => {
            const wrap = wrapRef.current;
            if (wrap !== null && !wrap.contains(event.target))
                setOpen(false);
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('mousedown', onPointer);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('mousedown', onPointer);
        };
    }, [open, setOpen]);
    // The entry label is the batch, not a verb with no object: a bare "3" says
    // nothing about what is happening to the profile.
    const label = busy
        ? `${t('opInstalling')} ${String(summary.progressed)}/${String(summary.total)}`
        : summary.attention > 0
            ? `${String(summary.attention)} ${t('opNeedsYou')}`
            : t('opTitle');
    if (records.length === 0 && !open) {
        return (_jsx("button", { type: "button", className: `${css.opEntry} ${css.opEntryQuiet}`, onClick: () => setOpen(true), children: t('opTitle') }));
    }
    return (_jsxs("div", { className: css.opWrap, ref: wrapRef, children: [_jsxs("button", { type: "button", className: summary.attention > 0 ? `${css.opEntry} ${css.opEntryAlert}` : css.opEntry, "aria-expanded": open, onClick: () => setOpen(!open), children: [busy && _jsx("span", { className: css.spin, children: _jsx(IconLoadingOutline16, { size: 12 }) }), label, summary.attention > 0 && _jsx("span", { className: css.opDot })] }), open && (_jsxs("div", { className: css.opPanel, children: [_jsxs("div", { className: css.opHead, children: [_jsx("span", { className: css.opPanelTitle, children: t('opTitle') }), _jsx("span", { className: css.grow }), summary.settled > 0 && (_jsx(Button, { variant: "ghost", size: "sm", onClick: props.onClearSettled, children: t('opClear') })), _jsx(Button, { variant: "ghost", size: "sm", "aria-label": t('opClose'), title: t('opClose'), className: css.opCloseBtn, onClick: () => setOpen(false), children: _jsx(IconChevronUpOutline14, { size: 14 }) })] }), busy && (_jsxs("div", { className: css.opAggregate, children: [_jsx("div", { className: css.opAggregateTop, children: _jsxs("span", { children: [t('opInstalling'), " ", summary.progressed, "/", summary.total] }) }), _jsx("div", { className: css.bar, children: _jsx("div", { className: css.barFill, style: { width: `${String(Math.round(summary.progressed / Math.max(1, summary.total) * 100))}%` } }) }), _jsx("div", { className: css.opAggregateHint, children: t('opLeaveHint') })] })), records.length === 0 && (_jsxs("div", { className: css.opEmpty, children: [t('opEmpty'), _jsx("div", { className: css.opEmptyHint, children: t('opEmptyHint') })] })), sortForPanel(records).map((record) => {
                        const ahead = queuePosition(records, record.id);
                        return (_jsxs("div", { className: needsUser(record) ? `${css.opRow} ${css.opRowAlert}` : css.opRow, children: [_jsx("span", { className: css.opIcon, children: _jsx(BucketIcon, { record: record }) }), _jsxs("div", { className: css.opMain, children: [_jsxs("div", { className: css.opTop, children: [_jsx("span", { className: css.opVerb, children: t(`opKind_${record.kind}`) }), _jsx("span", { className: css.opName, title: record.name, children: record.name })] }), record.state === 'running' && typeof record.percent === 'number' && (_jsx("div", { className: css.bar, children: _jsx("div", { className: css.barFill, style: { width: `${String(record.percent)}%` } }) })), _jsx("div", { className: bucketOf(record.state) === 'attention' ? `${css.opStatus} ${css.opStatusBad}` : css.opStatus, children: statusLine(t, record, ahead) }), needsUser(record) && (_jsx(ConflictChoice, { t: t, record: record, replacing: props.replacing, envReady: props.envReady, describe: props.describe, onResolve: choice => props.onResolveConflict(record, choice) }))] }), _jsxs("div", { className: css.opActions, children: [record.state === 'running' && (_jsx(Button, { variant: "outline", size: "sm", onClick: () => props.onCancel(record), children: t('cancelOp') })), record.state === 'queued' && (_jsx(Button, { variant: "ghost", size: "sm", onClick: () => props.onDismiss(record), children: t('opDequeue') })), record.state === 'done' && record.needsRefresh === true && (_jsx(Button, { variant: "primary", size: "sm", onClick: props.onRefresh, children: t('refresh') })), record.state === 'failed' && props.onRetry !== undefined && (_jsx(Button, { variant: "outline", size: "sm", onClick: () => props.onRetry?.(record), children: t('opRetry') })), isSettled(record) && (_jsx(Button, { variant: "ghost", size: "sm", onClick: () => props.onDismiss(record), children: t('dismissNotice') }))] })] }, record.id));
                    })] }))] }));
}
//# sourceMappingURL=OperationsPanel.js.map