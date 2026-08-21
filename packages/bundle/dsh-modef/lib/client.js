window.__ModuleLoader__.load({
	id: "@magiczerowxy/dsh-modef",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const { bindSnapshotSelector } = require("@deepseek-ai/dsh-client-web-react");

		// ------------------------------------------------------------------
		// Locale dictionaries
		// ------------------------------------------------------------------
		const NS = "modelEffort";
		const zh = {
			"trigger.fallback": "选择模型",
			"trigger.aria": "选择模型，当前 {model}",
			"menu.aria": "模型列表",
			"status.loading": "正在刷新模型列表…",
			"error.load": "模型列表加载失败：{message}",
			"retry": "重试",
			"empty.models": "没有可用的模型。",
			"warning.groupLoad": "{name} 加载失败：{message}",
			"effort.label": "推理",
			"effort.title": "推理强度",
			"effort.help": "当前等级说明",
			"effort.triggerAria": "推理强度，当前 {level}，点击调节",
			"effort.aria": "推理强度，当前 {level}",
			"effort.default": "Default",
			"effort.error": "推理强度设置失败",
			"effort.panelAria": "调节推理强度",
			"range.faster": "Faster",
			"range.smarter": "Smarter",
			"settings.advancedEffort.title": "高级的推理强度选择",
			"settings.advancedEffort.desc": "开启后推理强度使用滑块式调节，并可在下方选择最高档的动画样式；关闭则使用 DSH 默认设计。",
			"settings.style.title": "推理强度动画样式",
			"settings.style.desc": "选择最高档位的喷射动画效果。",
			"style.sprayFlow": "喷射流光",
			"style.undertow": "暗流涌动",
			"settings.on": "已开启",
			"settings.off": "已关闭"
		};
		const en = {
			"trigger.fallback": "Select model",
			"trigger.aria": "Select model, current {model}",
			"menu.aria": "Model list",
			"status.loading": "Refreshing model list…",
			"error.load": "Model list failed to load: {message}",
			"retry": "Retry",
			"empty.models": "No models available.",
			"warning.groupLoad": "{name} failed to load: {message}",
			"effort.label": "Thinking",
			"effort.title": "Effort",
			"effort.help": "About the current level",
			"effort.triggerAria": "Reasoning effort, current {level}, click to adjust",
			"effort.aria": "Reasoning effort, current {level}",
			"effort.default": "Default",
			"effort.error": "Failed to set reasoning effort",
			"effort.panelAria": "Adjust reasoning effort",
			"range.faster": "Faster",
			"range.smarter": "Smarter",
			"settings.advancedEffort.title": "Advanced effort slider",
			"settings.advancedEffort.desc": "Use the slider-style effort control and pick an animation style for the max tier below; off falls back to the default DSH design.",
			"settings.style.title": "Effort animation style",
			"settings.style.desc": "Choose the animation style for the maximum effort tier.",
			"style.sprayFlow": "Spray Flow",
			"style.undertow": "Dark Undercurrent",
			"settings.on": "On",
			"settings.off": "Off"
		};

		// Same glyph as the shipped IconChevronDownOutline14 (used by permission presets / model select)
		const CHEVRON_ICON = React.createElement(
			"svg",
			{ viewBox: "0 0 14 14", fill: "none", xmlns: "http://www.w3.org/2000/svg" },
			React.createElement("path", {
				d: "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z",
				fill: "currentColor"
			})
		);

		// Registered max-tier animation styles. Add a new effect by appending an
		// entry here (id, display label) and branching on its id in the control.
		const EFFECT_STYLES = [
			{ id: "spray-flow", titleKey: "style.sprayFlow" },
			{ id: "undertow", titleKey: "style.undertow" }
		];
		const DEFAULT_STYLE = "spray-flow";

		// Module-scoped flag: the undertow entry animation must play only when
		// the tier actually switches into MAX. Reopening the effort panel
		// remounts the slider, so component state cannot remember this — a
		// module variable survives the remount.
		let undertowEntered = false;

		// "暗流涌动" (undertow) dot-matrix texture + ejected sparks: a dense
		// grid of small rounded rects shown only on the MAX tier. The bar's
		// background is a horizontal gradient (purple right → white left) and
		// every cell takes the same gradient slightly deepened, so the matrix
		// reads as a fine low-res texture. Small square sparks are ejected
		// from the right edge and run left across the texture, fading out —
		// a continuous right→left spray with no wave cycling.
		const MATRIX_COLS = 64;
		const MATRIX_ROWS = 6;
		const MATRIX = (function () {
			const cells = [];
			// Cells take the background gradient slightly deepened (×0.88) so
			// the texture stays visible. Row-major order matches the CSS grid
			// fill, keeping the gradient horizontal (left white → right purple).
			const bgFrom = [255, 255, 255];
			const bgTo = [168, 85, 247];
			for (let row = 0; row < MATRIX_ROWS; row++) {
				for (let c = 0; c < MATRIX_COLS; c++) {
					const t = MATRIX_COLS === 1 ? 0 : c / (MATRIX_COLS - 1);
					const r = Math.round((bgFrom[0] + (bgTo[0] - bgFrom[0]) * t) * 0.88);
					const g = Math.round((bgFrom[1] + (bgTo[1] - bgFrom[1]) * t) * 0.88);
					const b = Math.round((bgFrom[2] + (bgTo[2] - bgFrom[2]) * t) * 0.88);
					cells.push({
						col: c,
						row: row,
						color: "rgb(" + r + "," + g + "," + b + ")"
					});
				}
			}
			return cells;
		})();
		// Ejected sparks: cell-sized white squares that spawn near the right
		// edge and run left, each with its own height, speed, delay and
		// random mid-left fade-out point.
		const RUNNERS = (function () {
			const list = [];
			for (let k = 0; k < 100; k++) {
				list.push({
					y: 10 + Math.random() * 80,
					from: 88 + Math.random() * 10,
					to: 24 + Math.random() * 14,
					dur: 1.1 + Math.random() * 0.9,
					delay: Math.random() * 1.2
				});
			}
			return list;
		})();

		// Rocket-exhaust spray: dense near nozzle, longer reach leftwards (+8 per tier)
		const SPRAY = (function () {
			const list = [];
			// launch = ignition delay in seconds. Entering MAX restarts every
			// particle's ignite animation, so short-range nozzle particles fire
			// first and the plume fans outward ("starting to spray").
			const push = function (n, x0, x1, y0, y1, d0, d1, du0, du1, s0, s1, tl, p0, p1, l0, l1) {
				for (let k = 0; k < n; k++) {
					list.push({
						x: x0 + Math.random() * (x1 - x0),
						y: y0 + Math.random() * (y1 - y0),
						dist: -(d0 + Math.random() * (d1 - d0)),
						dur: du0 + Math.random() * (du1 - du0),
						delay: Math.random() * 2.3,
						launch: l0 + Math.random() * (l1 - l0),
						s: s0 + Math.random() * (s1 - s0),
						tl: tl,
						pk: p0 + Math.random() * (p1 - p0)
					});
				}
			};
			push(18, 92, 100, 22, 78, 40, 80, 1.0, 1.5, 3, 4.5, 3.2, 0.8, 1, 0, 0.08);
			push(18, 93, 99, 28, 72, 80, 120, 1.4, 1.9, 2.5, 3.5, 2.6, 0.7, 0.9, 0.06, 0.22);
			push(20, 95, 100, 33, 67, 140, 180, 1.9, 2.4, 2, 3, 2.2, 0.6, 0.8, 0.22, 0.45);
			push(17, 97, 100, 40, 60, 190, 230, 2.4, 2.8, 2, 2.5, 2, 0.5, 0.7, 0.45, 0.7);
			return list;
		})();

		const CSS = [
			".dms-root{position:relative;display:flex;align-items:center;gap:6px;min-width:0}",
			".dms-trigger{display:flex;align-items:center;gap:4px;height:28px;max-width:180px;padding:0 4px 0 8px;border:none;border-radius:24px;background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:13px;font-weight:500;line-height:20px;cursor:pointer}",
			".dms-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
			".dms-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);outline:none}",
			".dms-trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}",
			".dms-triggerLabel{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".dms-chevron{flex:none;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;color:var(--dsw-alias-label-caption);will-change:transform}",
			".dms-menu{position:absolute;right:0;bottom:calc(100% + 8px);z-index:20;display:flex;flex-direction:column;width:min(240px,100vw - 32px);max-height:min(360px,100vh - 96px);padding:4px;border:1px solid var(--dsw-alias-border-inverted);border-radius:12px;background:var(--dsw-specific-menu);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);font-family:inherit;overflow:hidden}",
			".dms-groups{overflow-y:auto;min-height:0;flex:1 1 auto}",
			".dms-groupTitle{padding:8px 10px 4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption)}",
			".dms-option{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:7px 8px;border:none;border-radius:8px;background:transparent;color:inherit;font-family:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}",
			".dms-option:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".dms-option:disabled{opacity:.5;cursor:default}",
			".dms-optionSelected{background:var(--dsw-alias-interactive-bg-hover)}",
			".dms-optionCopy{min-width:0;display:flex;flex-direction:column;gap:2px}",
			".dms-modelName{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".dms-description{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption)}",
			".dms-check{flex:none;color:var(--dsw-alias-brand-primary);font-size:12px;line-height:20px}",
			".dms-status{padding:10px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}",
			".dms-error,.dms-warning{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:4px;padding:7px 8px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}",
			".dms-warning{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-warn-label)}",
			".dms-retry{flex:none;border:none;background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer;padding:0}",
			".dms-effortTrigger{display:flex;align-items:center;gap:4px;height:28px;padding:0 8px;border:none;border-radius:24px;background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:13px;font-weight:500;line-height:20px;cursor:pointer}",
			".dms-effortTrigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
			".dms-effortTrigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);outline:none}",
			".dms-effortTrigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}",
			".dms-effortCaption{flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption)}",
			".dms-effortValue{flex:none;max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".dms-labelGrad{background:linear-gradient(90deg,#e9d5ff,#c4b5fd,#a855f7,#7c3aed);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;animation:dms-textflow 3.5s ease-in-out infinite}",
			".dms-panel{position:absolute;right:-87px;bottom:calc(100% + 8px);z-index:20;width:min(239px,100vw - 32px);padding:15px;border:1px solid rgba(0,0,0,.06);border-radius:14px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.03),0 0 16px rgba(0,0,0,.06),0 8px 16px rgba(0,0,0,.06);color:#18181b;font-family:inherit;user-select:none;transform-origin:bottom right;animation:dms-pop-in .3s cubic-bezier(.2,.9,.3,1)}",
			".dms-panelClosing{animation:dms-pop-out .3s cubic-bezier(.2,.9,.3,1) forwards;pointer-events:none}",
			".dms-panelHeader{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:11px;padding-left:4px}",
			".dms-labelGroup{display:flex;align-items:baseline}",
			".dms-panelTitle{font-size:12px;color:#52525b;font-weight:500}",
			".dms-panelValue{color:#3b82f6;font-weight:600;margin-left:5px;font-size:13px}",
			".dms-rangeLabels{display:flex;justify-content:space-between;font-size:13px;font-weight:400;margin:-13px 0 3px;padding:0 12px;font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei','Helvetica Neue',Helvetica,Arial,sans-serif)}",
			".dms-rangeLeft{color:#3B82F6}",
			".dms-rangeRight{color:#8B5CF6}",
			".dms-slider{position:relative;height:32px;display:flex;align-items:center;cursor:pointer;outline:none;touch-action:none;margin:0 10px;transition:opacity .25s ease}",
			".dms-slider[aria-disabled=\"true\"]{opacity:.55;cursor:default}",
			".dms-track{position:absolute;left:0;right:0;top:calc(50% - 8.5px);transform:translateY(-50%);height:24px;border-radius:7px;background-color:#e9e9ec;box-shadow:0 2px 8px rgba(0,0,0,.08),0 0 0 1px rgba(0,0,0,.03)}",
			".dms-fill{position:absolute;left:0;top:0;bottom:0;border-radius:7px;background-color:#93C5FD;transition:background-color .5s cubic-bezier(.4,0,.2,1)}",
			".dms-fillHigh{background-color:#3B82F6}",
			".dms-fillMax{background-color:#3B82F6}",
			".dms-fillSheen{position:absolute;inset:0;border-radius:7px;background:linear-gradient(110deg,#1D4ED8,#2563EB 30%,#4F46E5 55%,#7C3AED 80%,#A855F7);background-size:250% 100%;opacity:0;box-shadow:inset 0 1px 1px rgba(255,255,255,.35);transition:opacity .5s cubic-bezier(.4,0,.2,1)}",
			".dms-fillMax.dms-fx-spray-flow .dms-fillSheen{opacity:1;animation:dms-sheen 5s ease-in-out infinite}",
			".dms-fillGlint{position:absolute;inset:0;border-radius:7px;background:linear-gradient(105deg,transparent 42%,rgba(255,255,255,.38) 50%,transparent 58%);background-size:220% 100%;opacity:0;transition:opacity .5s cubic-bezier(.4,0,.2,1);pointer-events:none}",
			".dms-fillMax.dms-fx-spray-flow .dms-fillGlint{opacity:1;animation:dms-glint 3.6s ease-in-out infinite}",
			".dms-fillSpray{position:absolute;inset:0;border-radius:7px;overflow:hidden;opacity:0;transition:opacity .5s cubic-bezier(.4,0,.2,1);pointer-events:none}",
			".dms-fillMax.dms-fx-spray-flow .dms-fillSpray{opacity:1}",
			".dms-sprayCore{position:absolute;top:0;bottom:0;right:0;width:72%;border-radius:7px;background:linear-gradient(270deg,rgba(255,255,255,.38) 0%,rgba(255,255,255,.16) 28%,rgba(255,255,255,.05) 55%,rgba(255,255,255,0) 100%);filter:blur(2.5px);opacity:0;transition:opacity .5s cubic-bezier(.4,0,.2,1);pointer-events:none;transform-origin:right center}",
			".dms-fillMax.dms-fx-spray-flow .dms-sprayCore{opacity:1;animation:dms-corebreath 1.6s ease-in-out infinite}",
			".dms-sprayNozzle{position:absolute;top:50%;right:0;width:30px;height:24px;margin-top:-12px;border-radius:50%;background:radial-gradient(ellipse at center,rgba(255,255,255,.7) 0%,rgba(255,255,255,.3) 45%,rgba(255,255,255,0) 72%);filter:blur(1px);opacity:0;pointer-events:none}",
			".dms-fillMax.dms-fx-spray-flow .dms-sprayNozzle{opacity:1;animation:dms-nozzle 1.6s ease-in-out infinite}",
			".dms-sprayWrap{position:absolute;inset:0;opacity:0;animation:dms-ignite .55s ease-out var(--launch,0s) both;pointer-events:none}",
			".dms-sprayDot{position:absolute;left:var(--x,95%);top:var(--y,50%);width:calc(var(--s,3px) * var(--tl,3));height:var(--s,3px);margin-top:calc(var(--s,3px) / -2);border-radius:50%;background:linear-gradient(90deg,rgba(255,255,255,1) 0%,rgba(255,255,255,.55) 30%,rgba(255,255,255,0) 100%);filter:drop-shadow(0 0 2px rgba(255,255,255,.75));opacity:0;animation:dms-spray var(--dur,1.5s) linear var(--delay,0s) infinite}",
			".dms-undertowBg{position:absolute;left:0;right:0;top:calc(50% - 8.5px);transform:translateY(-50%);height:24px;border-radius:7px;background:linear-gradient(90deg,#ffffff 0%,#a855f7 100%);clip-path:inset(0 0 0 0);pointer-events:none}",
			".dms-matrix{position:absolute;left:0;right:0;top:calc(50% - 8.5px);transform:translateY(-50%);height:24px;border-radius:7px;overflow:hidden;padding:2px 3px;display:grid;grid-template-columns:repeat(64,1fr);grid-template-rows:repeat(6,1fr);gap:1px;clip-path:inset(0 0 0 0);pointer-events:none;-webkit-mask-image:linear-gradient(90deg,transparent 0%,transparent 20%,#000 80%,#000 100%);mask-image:linear-gradient(90deg,transparent 0%,transparent 20%,#000 80%,#000 100%)}",
			".dms-reveal{position:absolute;left:0;right:0;top:calc(50% - 8.5px);transform:translateY(-50%);height:24px;border-radius:7px;overflow:hidden;pointer-events:none}",
			".dms-revealSheet{position:absolute;left:0;top:0;bottom:0;width:130%;background:linear-gradient(90deg,#3B82F6 0%,#3B82F6 70%,transparent 100%);animation:dms-reveal-move .85s cubic-bezier(.25,.7,.3,1) .05s both}",
			".dms-revealSheet.dms-revealDone{animation:none;transform:translateX(-100%)}",
			".dms-undertowBg.dms-undertowExit{animation:dms-shrink-rl .5s cubic-bezier(.3,.7,.3,1) both}",
			".dms-matrix.dms-matrixExit{animation:dms-shrink-rl .5s cubic-bezier(.3,.7,.3,1) both}",
			".dms-cell{border-radius:1px;background:var(--cell-color,#d6d6db);pointer-events:none}",
			".dms-runner{position:absolute;top:var(--run-y,50%);width:2.5px;height:2.5px;margin-top:-1.25px;border-radius:.5px;background:#fff;box-shadow:0 0 4px rgba(255,255,255,.95);animation:dms-run var(--run-dur,1.4s) linear var(--run-delay,0s) infinite}",
			".dms-dots{position:absolute;left:9px;right:9px;top:calc(50% - 8.5px);height:0;z-index:3;pointer-events:none;transition:opacity .25s ease}",
			".dms-dotsHidden{opacity:0}",
			".dms-dot{position:absolute;top:0;width:3px;height:3px;border-radius:50%;background:#e6e6ea;transform:translate(-50%,-50%);pointer-events:none}",
			".dms-dotActive{background:#fff}",
			".dms-dotMax{background:#c4b5fd}",
			".dms-thumb{position:absolute;left:0;top:calc(50% - 8.5px);width:22px;height:26px;border-radius:6px;background:#fff;border:1px solid #e4e4e7;box-shadow:0 1px 4px rgba(0,0,0,.25);z-index:4;transform:translate(-11px,-50%);display:flex;justify-content:center;align-items:center;transition:box-shadow .15s ease;will-change:transform}",
			".dms-thumbIcon{width:9px;height:9px}",
			".dms-slider:active .dms-thumb{box-shadow:0 2px 8px rgba(0,0,0,.3)}",
			".dms-slider:focus-visible .dms-thumb{box-shadow:0 0 0 3px rgba(59,130,246,.4)}",
			".dms-panelError{font-size:12px;line-height:18px;color:#dc2626;margin-top:7px}",
			"@keyframes dms-pop-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}",
			"@keyframes dms-pop-out{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(8px)}}",
			"@keyframes dms-sheen{0%{background-position:0% 50%;box-shadow:inset 0 1px 1px rgba(255,255,255,.35),0 0 8px rgba(124,58,237,.3)}50%{background-position:100% 50%;box-shadow:inset 0 1px 1px rgba(255,255,255,.35),0 0 20px rgba(124,58,237,.6)}100%{background-position:0% 50%;box-shadow:inset 0 1px 1px rgba(255,255,255,.35),0 0 8px rgba(124,58,237,.3)}}",
			"@keyframes dms-glint{0%,52%{background-position:150% 0}62%,100%{background-position:-50% 0}}",
			"@keyframes dms-corebreath{0%,100%{opacity:.62;transform:scaleX(1)}50%{opacity:.85;transform:scaleX(.97)}}",
			"@keyframes dms-nozzle{0%,100%{opacity:.6;transform:scale(1)}50%{opacity:.78;transform:scale(1.16)}}",
			"@keyframes dms-spray{0%{opacity:0;transform:translate(0,0)}8%{opacity:var(--pk,.9)}65%{opacity:calc(var(--pk,.9)*.35)}100%{opacity:0;transform:translate(var(--dist,-60px),0)}}",
			"@keyframes dms-ignite{from{opacity:0}to{opacity:1}}",
			"@keyframes dms-enter-lr{0%{opacity:0}100%{opacity:1}}",
			"@keyframes dms-reveal-move{0%{transform:translateX(0)}100%{transform:translateX(-100%)}}",
			"@keyframes dms-shrink-rl{0%{clip-path:inset(0 0 0 0);opacity:1}100%{clip-path:inset(0 100% 0 0);opacity:0}}",
			"@keyframes dms-run{0%{left:var(--run-from,92%);opacity:1}62%{opacity:1}100%{left:var(--run-to,30%);opacity:0}}",
			"@keyframes dms-textflow{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}",
			"@media (prefers-reduced-motion:reduce){.dms-panel,.dms-panelClosing{animation:none}}",
			".dms-settingRow{border-bottom:1px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:16px 0;display:flex}",
			".dms-settingRowText{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}",
			".dms-settingRowTitle{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}",
			".dms-settingRowDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}",
			".dms-settingSwitch{width:44px;height:26px;background:var(--dsw-alias-interactive-bg-hover);cursor:pointer;border:none;border-radius:999px;flex:none;position:relative;transition:background .15s}",
			".dms-settingSwitch[aria-checked=true]{background:var(--dsw-alias-state-business-primary)}",
			".dms-settingSwitch:disabled{opacity:.5;cursor:default}",
			".dms-settingKnob{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.35);transition:transform .15s}",
			".dms-settingSwitch[aria-checked=true] .dms-settingKnob{transform:translateX(18px)}",
			".dms-styleSelect{position:relative;flex:none}",
			".dms-styleSelect select{height:30px;min-width:132px;padding:0 30px 0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:20px;cursor:pointer;appearance:none;-webkit-appearance:none;background-image:url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\");background-repeat:no-repeat;background-position:right 8px center}",
			".dms-styleSelect select:hover{border-color:var(--dsw-alias-border-l3)}",
			".dms-styleSelect select:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}",
			".dms-styleSelect:disabled select{opacity:.5;cursor:default}"
		].join('\n');

		// Inject styles once; idempotent across hot reloads / re-mounts.
		const CSS_TAG = "@magiczerowxy/dsh-modef/client.css";
		function injectStyles() {
			if (typeof document === "undefined") return;
			if (document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG) + "]")) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "@magiczerowxy/dsh-modef";
			tag.dataset.pluginCss = CSS_TAG;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		function useDirectoryState(directory) {
			const [, force] = React.useState(0);
			React.useEffect(function () {
				return directory.subscribe(function () {
					force(function (v) { return v + 1; });
				});
			}, [directory]);
			return directory.getSnapshot();
		}

		var easeOutCubic = function (p) { var q = 1 - p; return 1 - q * q * q; };
		var easeOutQuad = function (p) { var q = 1 - p; return 1 - q * q; };

		// JS-driven chevron rotation: immune to CSS transition gaps (node rebuilds, stylesheet reloads)
		var createChevronAnimator = function () {
			var st = { raf: null, deg: 0 };
			return {
				state: st,
				animate: function (el, open) {
					if (!el) return;
					var target = open ? 180 : 0;
					if (st.raf !== null) { cancelAnimationFrame(st.raf); st.raf = null; }
					var from = st.deg;
					if (Math.abs(from - target) < 0.5) { st.deg = target; el.style.transform = "rotate(" + target + "deg)"; return; }
					var dur = 200;
					var start = performance.now ? performance.now() : Date.now();
					var step = function (now) {
						var p = (now - start) / dur;
						if (p > 1) p = 1;
						var eased = 1 - Math.pow(1 - p, 3);
						st.deg = from + (target - from) * eased;
						el.style.transform = "rotate(" + st.deg + "deg)";
						if (p < 1) st.raf = requestAnimationFrame(step); else st.raf = null;
					};
					st.raf = requestAnimationFrame(step);
				}
			};
		};

		function ModelEffortControl(props) {
			const locked = props.locked;
			const available = props.available;
			const directory = props.directory;
			const load = props.load;
			const select = props.select;
			const t = props.t;
			const initialStyle = props.style;
			const settingsScope = props.settingsScope;

			// Live-read the selected animation style so switching it in the
			// settings page takes effect immediately on the open slider.
			let liveStyle = initialStyle;
			if (settingsScope) {
				const useStyleScope = bindSnapshotSelector(settingsScope);
				const styleSnap = useStyleScope(function (s) { return s; });
				if (styleSnap && styleSnap.status === "ready" && styleSnap.value && typeof styleSnap.value.effortStyle === "string") {
					liveStyle = styleSnap.value.effortStyle;
				}
			}
			const activeStyle = EFFECT_STYLES.some(function (s) { return s.id === liveStyle; }) ? liveStyle : DEFAULT_STYLE;
			// True when the "喷射流光" effect owns the max-tier visuals.
			const fxSprayFlow = activeStyle === "spray-flow";
			// True when the "暗流涌动" dot-matrix effect owns the max-tier visuals.
			const fxUndertow = activeStyle === "undertow";

			const state = useDirectoryState(directory);
			const [modelOpen, setModelOpen] = React.useState(false);
			const [effortOpen, setEffortOpen] = React.useState(false);
			const [effortClosing, setEffortClosing] = React.useState(false);
			const [dragRatio, setDragRatio] = React.useState(null);
			const [settledLabel, setSettledLabel] = React.useState(null);
			const [fillMode, setFillMode] = React.useState("base");
			const [pendingError, setPendingError] = React.useState(null);
			// Bumped every time the slider settles into MAX, remounting the spray
			// so the ignition stagger plays from the nozzle outward.
			const [sprayEpoch, setSprayEpoch] = React.useState(0);
			const wasMaxRef = React.useRef(false);
			// Exit animation state: when the tier leaves MAX the undertow
			// effect stays mounted briefly while a blue sheet sweeps in from
			// the left, then unmounts.
			const [exitPhase, setExitPhase] = React.useState(false);
			const exitTimerRef = React.useRef(null);
			const prevMaxRef = React.useRef(false);
			// Locks the user-chosen target tier while the async model-directory
			// select is in flight, so the handle does not snap back to the old
			// tier (whose stopIndex is still current) before it updates.
			const pendingTargetRef = React.useRef(null);
			// Locks the reveal decision for one mount: dragging re-renders many
			// times and recomputing per render would kill the entry animation
			// mid-play (the sheet class would flip to "done").
			const revealLockRef = React.useRef(null);
			const rootRef = React.useRef(null);
			const triggerRef = React.useRef(null);
			const effortTriggerRef = React.useRef(null);
			const modelChevronRef = React.useRef(null);
			const effortChevronRef = React.useRef(null);
			const sliderRef = React.useRef(null);
			const fillRef = React.useRef(null);
			const thumbRef = React.useRef(null);
			const dotRefs = React.useRef([]);
			const rafRef = React.useRef(null);
			const mountRetryRef = React.useRef(null);
			const pointerActiveRef = React.useRef(false);
			const visualRatioRef = React.useRef(0);
			const visualIdxRef = React.useRef(0);
			const pendingCommitRef = React.useRef(null);
			const itemRefs = React.useRef([]);
			const lastActionRef = React.useRef("load");
			const closeTimerRef = React.useRef(null);
			const uid = React.useRef("dms-" + Math.random().toString(36).slice(2, 8)).current;
			const chevronsRef = React.useRef(null);
			if (chevronsRef.current === null) {
				chevronsRef.current = { model: createChevronAnimator(), effort: createChevronAnimator() };
			}

			React.useEffect(function () {
				if (available) { lastActionRef.current = "load"; load(); }
			}, [available]);

			React.useEffect(function () {
				if (!modelOpen && !effortOpen && !effortClosing) return;
				const onDown = function (event) {
					if (!rootRef.current || !rootRef.current.contains(event.target)) {
						setModelOpen(false);
						if (effortOpen && !effortClosing) requestCloseEffort(false);
					}
				};
				document.addEventListener("mousedown", onDown);
				return function () { document.removeEventListener("mousedown", onDown); };
			}, [modelOpen, effortOpen, effortClosing]);

			React.useEffect(function () {
				return function () {
					if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
					if (mountRetryRef.current !== null) cancelAnimationFrame(mountRetryRef.current);
					if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
					if (chevronsRef.current) {
						if (chevronsRef.current.model.state.raf !== null) cancelAnimationFrame(chevronsRef.current.model.state.raf);
						if (chevronsRef.current.effort.state.raf !== null) cancelAnimationFrame(chevronsRef.current.effort.state.raf);
					}
				};
			}, []);

			React.useEffect(function () {
				if (modelChevronRef.current) chevronsRef.current.model.animate(modelChevronRef.current, modelOpen);
			}, [modelOpen]);

			React.useEffect(function () {
				if (effortChevronRef.current) chevronsRef.current.effort.animate(effortChevronRef.current, effortOpen && !effortClosing);
			}, [effortOpen, effortClosing]);

			React.useEffect(function () {
				if (rafRef.current === null && dragRatio === null && pendingCommitRef.current === null && pendingTargetRef.current === null) {
					if (Math.abs(visualRatioRef.current - committedRatio) > 0.001) {
						visualRatioRef.current = committedRatio;
						applyVisual(committedRatio);
					}
					if (visualIdxRef.current !== stopIndex) {
						visualIdxRef.current = stopIndex;
						updateDots();
						updateFillState();
						setSettledLabel(stops[stopIndex] !== undefined ? stops[stopIndex].name : effortLabel);
					}
				}
			});

			React.useEffect(function () {
				if (pendingError === null) return;
				const timer = setTimeout(function () { setPendingError(null); }, 3000);
				return function () { clearTimeout(timer); };
			}, [pendingError]);

			if (!available) return null;

			const choices = [];
			for (let gi = 0; gi < state.groups.length; gi++) {
				const group = state.groups[gi];
				for (let mi = 0; mi < group.models.length; mi++) choices.push({ group: group, model: group.models[mi] });
			}
			let currentChoice = null;
			if (state.current != null) {
				const found = choices.findIndex(function (c) {
					return c.group.id === state.current.provider && c.model.id === state.current.model;
				});
				currentChoice = found >= 0 ? choices[found] : null;
			}
			const reasoning = currentChoice != null ? currentChoice.model.reasoning : undefined;
			const effectiveEffort = state.current != null && state.current.reasoningEffort !== undefined
				? state.current.reasoningEffort
				: (reasoning !== undefined ? reasoning.defaultEffort : undefined);
			const busy = state.status === "selecting";

			const stops = [];
			if (reasoning !== undefined) {
				if (reasoning.defaultEffort === undefined) stops.push({ id: undefined, name: t("effort.default"), description: undefined });
				const efforts = reasoning.efforts || [];
				for (let i = 0; i < efforts.length; i++) stops.push({ id: efforts[i].id, name: efforts[i].name, description: efforts[i].description });
			}
			let stopIndex = stops.findIndex(function (s) { return s.id === effectiveEffort; });
			if (stopIndex < 0) {
				let di = -1;
				if (reasoning !== undefined) di = stops.findIndex(function (s) { return s.id === reasoning.defaultEffort; });
				stopIndex = di >= 0 ? di : 0;
			}
			// Release the pending-target lock once the model directory has
			// actually caught up to the chosen tier.
			if (pendingTargetRef.current !== null && stopIndex === pendingTargetRef.current) {
				pendingTargetRef.current = null;
			}

			const modelLabel = currentChoice != null ? currentChoice.model.name : t("trigger.fallback");
			const effortLabel = stops.length > 0 ? stops[stopIndex].name : undefined;
			const showEffort = stops.length >= 1;
			const committedRatio = stops.length > 1 ? stopIndex / (stops.length - 1) : 1;
			// While the target is pending, the handle stays on the chosen tier
			// instead of snapping back to the stale committed ratio.
			const pendingTarget = pendingTargetRef.current;
			const pendingRatio = pendingTarget !== null && stops.length > 1 ? pendingTarget / (stops.length - 1) : null;
			const effortLabelNow = settledLabel !== null ? settledLabel : effortLabel;

			const applyVisual = function (ratio) {
				if (ratio < 0) ratio = 0;
				else if (ratio > 1) ratio = 1;
				visualRatioRef.current = ratio;
				const w = sliderRef.current ? sliderRef.current.clientWidth : 0;
				const usable = Math.max(0, w - 18);
				const px = 9 + ratio * usable;
				if (fillRef.current) fillRef.current.style.width = px + "px";
				if (thumbRef.current) thumbRef.current.style.transform = "translate(" + (px - 11) + "px, -50%)";
			};
			const syncMountVisual = function () {
				const w = sliderRef.current ? sliderRef.current.clientWidth : 0;
				if (w <= 0) {
					if (mountRetryRef.current !== null) cancelAnimationFrame(mountRetryRef.current);
					mountRetryRef.current = requestAnimationFrame(function () {
						mountRetryRef.current = null;
						syncMountVisual();
					});
					return;
				}
				const idle = rafRef.current === null && dragRatio === null && pendingCommitRef.current === null && pendingTargetRef.current === null;
				const r = idle ? committedRatio : visualRatioRef.current;
				const usable = Math.max(0, w - 18);
				const px = 9 + r * usable;
				if (fillRef.current) fillRef.current.style.width = px + "px";
				if (thumbRef.current) thumbRef.current.style.transform = "translate(" + (px - 11) + "px, -50%)";
				if (idle && visualIdxRef.current !== stopIndex) {
					visualIdxRef.current = stopIndex;
					updateDots();
					updateFillState();
					setSettledLabel(stops[stopIndex] !== undefined ? stops[stopIndex].name : effortLabel);
				}
			};
			const sliderRefCb = function (node) {
				sliderRef.current = node;
				if (node) syncMountVisual();
			};
			const fillRefCb = function (node) {
				fillRef.current = node;
				if (node) syncMountVisual();
			};
			const thumbRefCb = function (node) {
				thumbRef.current = node;
				if (node) syncMountVisual();
			};
			const ratioOfIndex = function (idx) {
				return stops.length > 1 ? idx / (stops.length - 1) : 1;
			};
			const updateDots = function () {
				const n = dotRefs.current.length;
				if (n === 0) return;
				const i = visualIdxRef.current;
				const maxK = n - 1;
				for (let k = 0; k < n; k++) {
					const el = dotRefs.current[k];
					if (!el) continue;
					el.className = "dms-dot"
						+ (k === i && k !== maxK ? " dms-dotActive" : "")
						+ (k === maxK ? " dms-dotMax" : "");
				}
			};
			const updateFillState = function () {
				const n = stops.length;
				const i = visualIdxRef.current;
				const isMax = n > 1 && i === n - 1;
				const isHigh = n > 1 && i === n - 2;
				setFillMode(isMax ? "max" : isHigh ? "high" : "base");
			};

			const showModel = function () { closeEffortNow(); setModelOpen(true); lastActionRef.current = "load"; load(); };
			const closeModel = function (refocus) {
				setModelOpen(false);
				if (refocus) queueMicrotask(function () { if (triggerRef.current) triggerRef.current.focus(); });
			};
			const reload = function () { lastActionRef.current = "load"; load(); };
			const chooseModel = function (group, model) {
				if (state.current != null && state.current.provider === group.id && state.current.model === model.id) {
					closeModel(true);
					return;
				}
				lastActionRef.current = "select";
				select({ provider: group.id, model: model.id }).then(function (ok) { if (ok) closeModel(true); });
			};
			const cancelClose = function () {
				if (closeTimerRef.current !== null) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
			};
			const openEffort = function () {
				cancelClose();
				setModelOpen(false);
				setEffortClosing(false);
				setEffortOpen(true);
			};
			const requestCloseEffort = function (refocus) {
				if (!effortOpen || effortClosing) return;
				setEffortClosing(true);
				cancelClose();
				let delay = 300;
				if (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) delay = 0;
				closeTimerRef.current = setTimeout(function () {
					closeTimerRef.current = null;
					setEffortOpen(false);
					setEffortClosing(false);
					if (refocus) queueMicrotask(function () { if (effortTriggerRef.current) effortTriggerRef.current.focus(); });
				}, delay);
			};
			const closeEffortNow = function () {
				cancelClose();
				setEffortClosing(false);
				setEffortOpen(false);
			};
			const commitEffort = function (idx, keepOpen) {
				if (state.current == null || idx < 0 || idx >= stops.length) return;
				if (idx === stopIndex) {
					if (!keepOpen) requestCloseEffort(true);
					return;
				}
				pendingCommitRef.current = idx;
				pendingTargetRef.current = idx;
				const stop = stops[idx];
				const selection = { provider: state.current.provider, model: state.current.model };
				if (stop.id !== undefined) selection.reasoningEffort = stop.id;
				select(selection).then(function (ok) {
					pendingCommitRef.current = null;
					if (!ok) setPendingError(t("effort.error"));
					else if (!keepOpen) requestCloseEffort(true);
				});
			};
			const indexFromRatio = function (r) {
				return Math.max(0, Math.min(stops.length - 1, Math.round(r * (stops.length - 1))));
			};
			const ratioOf = function (clientX) {
				const rect = sliderRef.current ? sliderRef.current.getBoundingClientRect() : null;
				if (!rect || rect.width <= 0) return 0;
				const r = (clientX - rect.left) / rect.width;
				return r < 0 ? 0 : r > 1 ? 1 : r;
			};
			const onSliderPointerDown = function (event) {
				if (locked || busy || stops.length < 2) return;
				event.preventDefault();
				if (sliderRef.current && typeof sliderRef.current.setPointerCapture === "function") {
					sliderRef.current.setPointerCapture(event.pointerId);
				}
				if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
				pointerActiveRef.current = true;
				const idx = indexFromRatio(ratioOf(event.clientX));
				visualIdxRef.current = idx;
				setDragRatio(ratioOfIndex(idx));
				animateSnap(visualRatioRef.current, ratioOfIndex(idx), idx, true);
			};
			const onSliderPointerMove = function (event) {
				if (!pointerActiveRef.current) return;
				const idx = indexFromRatio(ratioOf(event.clientX));
				if (idx === visualIdxRef.current) return;
				visualIdxRef.current = idx;
				setDragRatio(ratioOfIndex(idx));
				animateSnap(visualRatioRef.current, ratioOfIndex(idx), idx, true);
			};
			const onSliderPointerUp = function (event) {
				if (!pointerActiveRef.current) return;
				pointerActiveRef.current = false;
				const idx = indexFromRatio(ratioOf(event.clientX));
				if (idx !== visualIdxRef.current) {
					visualIdxRef.current = idx;
					setDragRatio(ratioOfIndex(idx));
					animateSnap(visualRatioRef.current, ratioOfIndex(idx), idx, false);
				} else if (rafRef.current === null) {
					setDragRatio(null);
				}
				commitEffort(idx, true);
			};
			const onSliderPointerCancel = function () {
				pointerActiveRef.current = false;
				setDragRatio(null);
			};
			const animateSnap = function (fromRatio, toRatio, idx, fast) {
				if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
				const settled = ratioOfIndex(idx);
				if (Math.abs(toRatio - fromRatio) < 0.002) {
					applyVisual(settled);
					if (!pointerActiveRef.current) setDragRatio(null);
					setSettledLabel(stops[idx] !== undefined ? stops[idx].name : effortLabel);
					updateDots();
					updateFillState();
					return;
				}
				applyVisual(fromRatio);
				const duration = fast ? 120 : 220;
				const easing = fast ? easeOutQuad : easeOutCubic;
				const start = performance.now ? performance.now() : Date.now();
				const step = function (now) {
					let p = (now - start) / duration;
					if (p > 1) p = 1;
					applyVisual(fromRatio + (toRatio - fromRatio) * easing(p));
					if (p < 1) rafRef.current = requestAnimationFrame(step);
					else {
						rafRef.current = null;
						applyVisual(settled);
						if (!pointerActiveRef.current) setDragRatio(null);
						setSettledLabel(stops[idx] !== undefined ? stops[idx].name : effortLabel);
						updateDots();
						updateFillState();
					}
				};
				rafRef.current = requestAnimationFrame(step);
			};
			const onSliderKeyDown = function (event) {
				if (locked || busy || stops.length < 2) return;
				let next = null;
				if (event.key === "ArrowRight" || event.key === "ArrowUp") next = Math.min(stops.length - 1, stopIndex + 1);
				else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = Math.max(0, stopIndex - 1);
				else if (event.key === "Home") next = 0;
				else if (event.key === "End") next = stops.length - 1;
				else return;
				event.preventDefault();
				const from = visualRatioRef.current;
				const to = ratioOfIndex(next);
				visualIdxRef.current = next;
				setDragRatio(to);
				animateSnap(from, to, next, false);
				commitEffort(next, true);
			};
			const moveFocus = function (offset) {
				const items = itemRefs.current.filter(function (i) { return i !== null; });
				if (items.length === 0) return;
				const active = items.findIndex(function (i) { return i === document.activeElement; });
				const next = items[(Math.max(active, 0) + offset + items.length) % items.length];
				if (next) next.focus();
			};
			const onRootKeyDown = function (event) {
				if (event.key === "Escape") {
					if (modelOpen) { event.preventDefault(); closeModel(true); }
					else if (effortOpen) { event.preventDefault(); requestCloseEffort(true); }
					return;
				}
				if (modelOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
					event.preventDefault();
					moveFocus(event.key === "ArrowDown" ? 1 : -1);
				}
			};

			itemRefs.current = [];
			let itemIndex = 0;
			const itemRef = function () {
				const at = itemIndex++;
				return function (node) { itemRefs.current[at] = node; };
			};

			let shownIdx = indexFromRatio(dragRatio != null ? dragRatio : (pendingRatio !== null ? pendingRatio : committedRatio));
			const maxIdx = stops.length - 1;
			const dotNodes = stops.length > 1 ? React.createElement(
				"div",
				// At MAX every tier dot hides (the effect visuals replace them).
				{ className: "dms-dots" + (shownIdx === maxIdx ? " dms-dotsHidden" : "") },
				stops.map(function (s, i) {
					return React.createElement("span", {
						key: i,
						ref: function (node) { dotRefs.current[i] = node; },
						className: "dms-dot"
							+ (i === shownIdx && i !== maxIdx ? " dms-dotActive" : "")
							+ (i === maxIdx ? " dms-dotMax" : ""),
						style: { left: (i / (stops.length - 1)) * 100 + "%" }
					});
				})
			) : null;

			const idleNow = rafRef.current === null && dragRatio === null && pendingCommitRef.current === null;
			const visIdx = visualIdxRef.current;
			const targetMode = stops.length > 1 && visIdx === stops.length - 1 ? "max" : (stops.length > 1 && visIdx === stops.length - 2 ? "high" : "base");
			const effMode = idleNow ? targetMode : fillMode;
			// During the exit fade the fill stays MAX-blue so the effect fades
			// out over its own color; only after the fade completes does the
			// fill transition to the target tier color.
			const fillModeNow = exitPhase ? "max" : effMode;
			const fillClass = "dms-fill" + (fillModeNow === "max" ? " dms-fillMax" : fillModeNow === "high" ? " dms-fillHigh" : "")
				+ (fillModeNow === "max" && fxSprayFlow ? " dms-fx-spray-flow" : "");
			const gradClass = effMode === "max" ? " dms-labelGrad" : "";

			// Exit detection: leaving MAX starts the left→right cover animation
			// and unmounts the effect after it completes; re-entering MAX
			// cancels a pending exit.
			React.useEffect(function () {
				const nowMax = effMode === "max";
				const wasMax = prevMaxRef.current;
				prevMaxRef.current = nowMax;
				if (wasMax && !nowMax) {
					setExitPhase(true);
					if (exitTimerRef.current !== null) clearTimeout(exitTimerRef.current);
					exitTimerRef.current = setTimeout(function () {
						exitTimerRef.current = null;
						setExitPhase(false);
					}, 550);
				}
				else if (nowMax && exitTimerRef.current !== null) {
					clearTimeout(exitTimerRef.current);
					exitTimerRef.current = null;
					setExitPhase(false);
				}
			}, [effMode]);

			// Ignition: remount the spray each time the control settles into MAX,
			// replaying every particle's launch delay (nozzle first, then outward).
			React.useEffect(function () {
				const nowMax = effMode === "max" && fxSprayFlow;
				if (nowMax && !wasMaxRef.current) setSprayEpoch(function (e) { return e + 1; });
				wasMaxRef.current = nowMax;
			});

			// Spray-flow effect: the blue-purple stream + rocket exhaust plume.
			const sprayEl = fxSprayFlow ? React.createElement(
				"div",
				// Bumping the key remounts the spray on every entry into MAX, so
				// the ignite delays replay and the plume visibly starts spraying
				// from the nozzle instead of appearing all at once.
				{ key: "spray-" + sprayEpoch, className: "dms-fillSpray" },
				React.createElement("div", { className: "dms-sprayCore" }),
				React.createElement("div", { className: "dms-sprayNozzle" }),
				SPRAY.map(function (p, i) {
					return React.createElement(
						"span",
						{ key: i, className: "dms-sprayWrap", style: { "--launch": p.launch + "s" } },
						React.createElement("span", {
							className: "dms-sprayDot",
							style: {
								"--x": p.x + "%",
								"--y": p.y + "%",
								"--s": p.s + "px",
								"--tl": p.tl,
								"--dist": p.dist + "px",
								"--dur": p.dur + "s",
								"--delay": p.delay + "s",
								"--pk": p.pk
							}
						})
					);
				})
			) : null;

			// Undertow effect: shown on the MAX tier (plus the brief exit
			// phase). A horizontal white→purple gradient backs the bar; the
			// static dot-matrix texture follows the gradient and cell-sized
			// white sparks are ejected from the right edge, running left and
			// fading out. The reveal animation plays only on a real tier
			// switch into MAX (module flag survives panel remounts).
			const nowMaxTier = effMode === "max";
			if (!nowMaxTier) undertowEntered = false;
			const undertowVisible = fxUndertow && (effMode === "max" || exitPhase);
			// Lock the reveal decision for this mount so repeated renders
			// (dragging) cannot kill the entry animation mid-play.
			if (undertowVisible) {
				if (revealLockRef.current === null) {
					revealLockRef.current = nowMaxTier && !undertowEntered;
					if (nowMaxTier) undertowEntered = true;
				}
			} else {
				revealLockRef.current = null;
			}
			const revealFirst = undertowVisible && revealLockRef.current === true;
			const matrixEl = undertowVisible ? React.createElement(
				React.Fragment, null,
				React.createElement("div", { className: "dms-undertowBg" + (exitPhase ? " dms-undertowExit" : "") }),
				React.createElement(
					"div", { className: "dms-matrix" + (exitPhase ? " dms-matrixExit" : "") },
					MATRIX.map(function (cell, i) {
						return React.createElement("span", {
							key: i,
							className: "dms-cell",
							style: { "--cell-color": cell.color }
						});
					}),
					RUNNERS.map(function (r, i) {
						return React.createElement("span", {
							key: "run-" + i,
							className: "dms-runner",
							style: {
								"--run-y": r.y + "%",
								"--run-from": r.from + "%",
								"--run-to": r.to + "%",
								"--run-dur": r.dur + "s",
								"--run-delay": r.delay + "s"
							}
						});
					})
				),
				// Right→left reveal on entry: one soft-edged blue sheet (solid
				// with a feathered right edge) slides away leftwards, so the
				// new colors wash in smoothly from the right with a blurred
				// edge. On panel remounts (no tier switch) the sheet is
				// already gone. On exit the whole effect simply fades out;
				// the fill stays MAX-blue during the fade and only then
				// transitions to the target tier color.
				React.createElement(
					"div", { className: "dms-reveal" },
					React.createElement("div", { className: "dms-revealSheet" + (revealFirst ? "" : " dms-revealDone") })
				)
			) : null;

			const modelEl = React.createElement(
				"button",
				{
					ref: triggerRef,
					type: "button",
					className: "dms-trigger",
					"aria-label": t("trigger.aria", { model: modelLabel }),
					"aria-haspopup": "menu",
					"aria-expanded": modelOpen,
					title: modelLabel,
					disabled: locked,
					onClick: function () { if (modelOpen) closeModel(); else showModel(); }
				},
				React.createElement("span", { className: "dms-triggerLabel" }, modelLabel),
				React.createElement(
					"span",
					{ ref: function (node) { modelChevronRef.current = node; }, className: "dms-chevron" },
					CHEVRON_ICON
				)
			);

			let effortEl = null;
			if (showEffort) {
				effortEl = React.createElement(
					"button",
					{
						ref: effortTriggerRef,
						type: "button",
						className: "dms-effortTrigger",
						"aria-label": t("effort.triggerAria", { level: effortLabelNow }),
						"aria-haspopup": "dialog",
						"aria-expanded": effortOpen,
						title: effortLabelNow,
						disabled: locked,
						onClick: function () {
							if (effortOpen) {
								if (effortClosing) { cancelClose(); setEffortClosing(false); }
								else requestCloseEffort(true);
							} else {
								openEffort();
							}
						}
					},
					React.createElement("span", { className: "dms-effortCaption" + gradClass }, t("effort.label")),
					React.createElement("span", { className: "dms-effortValue" + gradClass }, effortLabelNow),
					React.createElement(
						"span",
						{ ref: function (node) { effortChevronRef.current = node; }, className: "dms-chevron" },
						CHEVRON_ICON
					)
				);

				if (effortOpen || effortClosing) {
					const isMax = maxIdx > 0 && shownIdx === maxIdx;
					const sliderEl = React.createElement(
						"div",
						{
							ref: sliderRefCb,
							className: "dms-slider",
							role: "slider",
							tabIndex: locked || busy ? -1 : 0,
							"aria-label": t("effort.aria", { level: effortLabelNow }),
							"aria-disabled": locked || busy,
							"aria-valuemin": 0,
							"aria-valuemax": Math.max(0, maxIdx),
							"aria-valuenow": shownIdx,
							"aria-valuetext": effortLabelNow,
							onPointerDown: onSliderPointerDown,
							onPointerMove: onSliderPointerMove,
							onPointerUp: onSliderPointerUp,
							onPointerCancel: onSliderPointerCancel,
							onKeyDown: onSliderKeyDown
						},
						React.createElement("div", { className: "dms-track" },
							React.createElement(
								"div",
								{ ref: fillRefCb, className: fillClass },
								React.createElement("div", { className: "dms-fillSheen" }),
								React.createElement("div", { className: "dms-fillGlint" }),
								sprayEl
							)
						),
						matrixEl,
						dotNodes,
						React.createElement(
							"div",
							{ ref: thumbRefCb, className: "dms-thumb" },
							React.createElement(
								"svg",
								{ className: "dms-thumbIcon", viewBox: "0 0 24 24" },
								React.createElement("path", {
									d: "M8 3L4 7l4 4M16 3l4 4-4 4M4 12h16M4 12l4 4-4 4M20 12l-4 4 4 4",
									stroke: "#71717a",
									strokeWidth: 2,
									strokeLinecap: "round",
									strokeLinejoin: "round",
									fill: "none"
								})
							)
						)
					);
					const panel = React.createElement(
						"div",
						{
							className: effortClosing ? "dms-panel dms-panelClosing" : "dms-panel",
							role: "dialog",
							"aria-label": t("effort.panelAria")
						},
						React.createElement(
							"div", { className: "dms-panelHeader" },
							React.createElement(
								"div", { className: "dms-labelGroup" },
								React.createElement("span", { className: "dms-panelTitle" }, t("effort.title")),
								React.createElement(
									"span",
									{ className: "dms-panelValue" + gradClass },
									effortLabelNow
								)
							)
						),
						React.createElement(
							"div", { className: "dms-rangeLabels" },
							React.createElement("span", { className: "dms-rangeLeft" }, t("range.faster")),
							React.createElement("span", { className: "dms-rangeRight" }, t("range.smarter"))
						),
						sliderEl,
						pendingError != null ? React.createElement("div", { className: "dms-panelError" }, pendingError) : null
					);
					effortEl = React.createElement(React.Fragment, null, effortEl, panel);
				}
			}

			const menu = modelOpen
				? React.createElement(
					"div",
					{
						id: uid + "-menu",
						className: "dms-menu",
						role: "menu",
						"aria-label": t("menu.aria"),
						"aria-busy": state.status === "loading" || busy
					},
					state.status === "loading" ? React.createElement("div", { className: "dms-status" }, t("status.loading")) : null,
					state.error != null && lastActionRef.current === "load"
						? React.createElement(
							"div", { className: "dms-error" },
							React.createElement("span", null, t("error.load", { message: state.error })),
							React.createElement("button", { type: "button", className: "dms-retry", onClick: reload }, t("retry"))
						)
						: null,
					state.failures.map(function (failure) {
						return React.createElement(
							"div", { className: "dms-warning", key: failure.id },
							React.createElement("span", null, t("warning.groupLoad", { name: failure.name, message: failure.message })),
							React.createElement("button", { type: "button", className: "dms-retry", onClick: reload }, t("retry"))
						);
					}),
					React.createElement(
						"div", { className: "dms-groups" },
						state.groups.map(function (group) {
							return React.createElement(
								"section", { key: group.id, role: "group" },
								React.createElement("div", { className: "dms-groupTitle" }, group.name),
								group.models.map(function (model) {
									const selected = state.current != null && state.current.provider === group.id && state.current.model === model.id;
									return React.createElement(
										"button",
										{
											key: model.id,
											ref: itemRef(),
											type: "button",
											role: "menuitemradio",
											"aria-checked": selected,
											className: selected ? "dms-option dms-optionSelected" : "dms-option",
											title: model.name,
											disabled: busy,
											onClick: function () { chooseModel(group, model); }
										},
										React.createElement(
											"span", { className: "dms-optionCopy" },
											React.createElement("span", { className: "dms-modelName" }, model.name),
											model.description !== undefined ? React.createElement("span", { className: "dms-description" }, model.description) : null
										),
										React.createElement("span", { className: "dms-check" }, selected ? "\u2713" : null)
									);
								})
							);
						}),
						state.status === "ready" && choices.length === 0
							? React.createElement("div", { className: "dms-status" }, t("empty.models"))
							: null
					)
				)
				: null;

			return React.createElement(
				"div",
				{ ref: rootRef, className: "dms-root", onKeyDown: onRootKeyDown },
				modelEl,
				effortEl,
				menu
			);
		}

		function apply(ctx) {
			injectStyles();
			ctx.effect(function () { return ctx.locale.register(NS, { zh, en }); }, "dsh-modef: dictionaries");
			const t = ctx.locale.bind(NS);

			// ---- Settings: 高级的推理强度选择 (General settings row) ----
			const scope = ctx.settingsScope.bind({ namespace: "dsh-modef" });
			const enabledNow = () => {
				try {
					const snap = scope.getSnapshot();
					return !!(snap && snap.status === "ready" && snap.value && snap.value.advancedEffort === true);
				}
				catch { return false; }
			};
			const currentStyle = () => {
				try {
					const snap = scope.getSnapshot();
					if (snap && snap.status === "ready" && snap.value && typeof snap.value.effortStyle === "string") {
						const known = EFFECT_STYLES.some(function (s) { return s.id === snap.value.effortStyle; });
						if (known) return snap.value.effortStyle;
					}
				}
				catch { /* fall through */ }
				return DEFAULT_STYLE;
			};

			// The General-settings toggle row.
			const AdvancedRow = ({ useScope, scope: rowScope }) => {
				const snap = useScope((s) => s);
				const ready = snap && snap.status === "ready";
				const enabled = !!(ready && snap.value && snap.value.advancedEffort === true);
				return React.createElement(
					"div", { className: "dms-settingRow" },
					React.createElement(
						"div", { className: "dms-settingRowText" },
						React.createElement("div", { className: "dms-settingRowTitle" }, t("settings.advancedEffort.title")),
						React.createElement("div", { className: "dms-settingRowDesc" }, t("settings.advancedEffort.desc"))
					),
					React.createElement(
						"button",
						{
							type: "button",
							role: "switch",
							"aria-checked": enabled,
							"aria-label": t("settings.advancedEffort.title"),
							title: enabled ? t("settings.on") : t("settings.off"),
							className: "dms-settingSwitch",
							disabled: !ready || !snap.writable,
							onClick: () => { rowScope.set("advancedEffort", !enabled).catch(() => {}); }
						},
						React.createElement("span", { className: "dms-settingKnob" })
					)
				);
			};
			const useScope = bindSnapshotSelector(scope);
			ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "dsh-modef-advanced-effort",
				order: 26,
				inject: () => ({ useScope, scope })
			}, AdvancedRow), "dsh-modef: advanced effort row");

			// The General-settings style picker row (shown only while the master
			// toggle is on). A native <select> avoids clipping inside the modal.
			const StyleRow = ({ useScope: useStyleScope, scope: styleScope }) => {
				const snap = useStyleScope((s) => s);
				const ready = snap && snap.status === "ready";
				const advancedOn = !!(ready && snap.value && snap.value.advancedEffort === true);
				if (!advancedOn) return null;
				const current = ready && snap.value && typeof snap.value.effortStyle === "string"
					? snap.value.effortStyle
					: DEFAULT_STYLE;
				const currentDef = EFFECT_STYLES.find(function (s) { return s.id === current; }) || EFFECT_STYLES[0];
				return React.createElement(
					"div", { className: "dms-settingRow" },
					React.createElement(
						"div", { className: "dms-settingRowText" },
						React.createElement("div", { className: "dms-settingRowTitle" }, t("settings.style.title")),
						React.createElement("div", { className: "dms-settingRowDesc" }, t("settings.style.desc"))
					),
					React.createElement(
						"div", { className: "dms-styleSelect" },
						React.createElement(
							"select",
							{
								"aria-label": t("settings.style.title"),
								value: currentDef.id,
								disabled: !ready || !snap.writable,
								onChange: function (event) { styleScope.set("effortStyle", event.target.value).catch(function () {}); }
							},
							EFFECT_STYLES.map(function (s) {
								return React.createElement("option", { key: s.id, value: s.id }, t(s.titleKey));
							})
						)
					)
				);
			};
			ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "dsh-modef-effort-style",
				order: 27,
				inject: () => ({ useScope, scope })
			}, StyleRow), "dsh-modef: effort style row");

			// ---- Conditional composer seat: claim only when the toggle is on ----
			let seatDisposer = null;
			const syncSeat = () => {
				const enabled = enabledNow();
				if (enabled && !seatDisposer) {
					ctx.inject(["modelDirectories", "sessions"], (scope2) => {
						const models = scope2.modelDirectories;
						const sessions = scope2.sessions;
						seatDisposer = scope2.slots.inject("conversation.input.model", function () {
							return scope2.slots.register({
								name: "conversation.input.model",
								// Single slot: one registration per priority; the lowest
								// priority renders. The official model selector sits at
								// priority 0 — shadow it with a lower priority while the
								// advanced-effort toggle is on, and the official control
								// returns automatically when this seat is disposed.
								priority: -100,
								inject: function (sessionId) {
									const directory = models.directoryFor(sessionId);
									const available = sessions && typeof sessions.subagentAddress === "function"
										? sessions.subagentAddress(sessionId) === void 0
										: true;
									return {
										available: available,
										directory: directory.store,
										load: function () { if (available) directory.load().catch(function () {}); },
										select: function (selection) {
											return available
												? directory.select(selection).then(function () { return true; }, function () { return false; })
												: Promise.resolve(false);
										},
										t: t,
										// Live style + settings scope so the control can follow
										// style changes while mounted.
										style: currentStyle(),
										settingsScope: scope
									};
								}
							}, ModelEffortControl);
						});
					});
				}
				else if (!enabled && seatDisposer) {
					try { seatDisposer(); } catch (e) { /* already disposed */ }
					seatDisposer = null;
				}
			};
			scope.subscribe(syncSeat);
			syncSeat();
		}

		exports.apply = apply;
		exports.inject = ["locale", "slots", "settingsScope", "modelDirectories", "sessions"];
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
