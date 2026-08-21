import { ANGELINA_ASSETS } from './assets.generated.ts'

const url = (value: string): string => `url("${value}")`

/** CSS is injected at runtime so a GitHub install never needs a public asset host. */
export const ANGELINA_CSS = `
:root {
  --dsh-angelina-light-hero: ${url(ANGELINA_ASSETS.lightHero)};
  --dsh-angelina-dark-hero: ${url(ANGELINA_ASSETS.darkHero)};
  --dsh-angelina-light-parallax-background: ${url(ANGELINA_ASSETS.lightParallaxBackground)};
  --dsh-angelina-light-parallax-foreground: ${url(ANGELINA_ASSETS.lightParallaxForeground)};
}

body[data-ds-theme='angelina-light'],
body[data-ds-theme='angelina-dark'] {
  --dsh-angelina-hero-image: none;
  --dsh-angelina-hero-position: 68% 42%;
  --dsh-angelina-app-scrim: transparent;
  --dsh-angelina-glass-input: rgba(53, 60, 65, 0.58);
  --dsh-angelina-glass-menu: var(--dsh-angelina-glass-dialog);
  --dsh-angelina-glass-dialog: rgba(43, 51, 58, 0.66);
  --dsh-angelina-glass-control: rgba(24, 31, 38, 0.72);
  --dsh-angelina-glass-control-selected: rgba(158, 47, 46, 0.44);
  --dsh-angelina-conversation-glass: color-mix(in srgb, var(--dsw-alias-bg-base) 24%, transparent);
  --dsh-angelina-conversation-filter: blur(3px);
  --dsh-angelina-glass-bubble-filter: blur(14px) saturate(108%);
  --dsh-angelina-glass-composer-border: rgba(255, 255, 255, 0.24);
  --dsh-angelina-glass-menu-border: var(--dsh-angelina-glass-dialog-border);
  --dsh-angelina-glass-dialog-border: rgba(255, 255, 255, 0.2);
  --dsh-angelina-glass-header-border: rgba(95, 88, 85, 0.32);
  --dsh-angelina-glass-composer-highlight: rgba(255, 255, 255, 0.12);
  --dsh-angelina-glass-menu-highlight: var(--dsh-angelina-glass-dialog-highlight);
  --dsh-angelina-glass-header-highlight: rgba(255, 255, 255, 0.3);
  --dsh-angelina-glass-dialog-highlight: rgba(255, 255, 255, 0.12);
  --dsh-angelina-glass-composer-shadow: 0 14px 30px rgba(20, 25, 30, 0.26);
  --dsh-angelina-glass-field-shadow: 0 8px 20px rgba(20, 25, 30, 0.16);
  --dsh-angelina-glass-menu-shadow: var(--dsh-angelina-glass-dialog-shadow);
  --dsh-angelina-glass-dialog-shadow: 0 14px 34px rgba(20, 25, 30, 0.24);
  --dsh-angelina-glass-composer-filter: blur(16px) saturate(104%);
  --dsh-angelina-glass-menu-filter: var(--dsh-angelina-glass-dialog-filter);
  --dsh-angelina-glass-dialog-filter: blur(18px) saturate(104%);
  --dsh-angelina-glass-text: #252426;
  --dsh-angelina-glass-muted: rgba(37, 36, 38, 0.7);
  --dsh-angelina-glass-menu-text: #252426;
  --dsh-angelina-glass-menu-muted: rgba(37, 36, 38, 0.74);
  --dsh-angelina-glass-menu-hover: rgba(158, 47, 46, 0.22);
  --dsh-angelina-chat-text: #252426;
  --dsh-angelina-chat-secondary: rgba(37, 36, 38, 0.82);
  --dsh-angelina-chat-muted: rgba(37, 36, 38, 0.72);
  --dsh-angelina-chat-caption: rgba(37, 36, 38, 0.66);
  --dsh-angelina-glass-accent: #9e2f2e;
  --dsh-angelina-glass-caret: #d86f63;
  --dsh-angelina-question-text: #fffdfa;
  --dsh-angelina-question-secondary: rgba(255, 253, 250, 0.86);
  --dsh-angelina-question-caption: rgba(255, 253, 250, 0.76);
  --dsh-angelina-question-field: rgba(14, 21, 27, 0.64);
  --dsh-angelina-question-field-border: rgba(255, 255, 255, 0.26);
  --dsh-angelina-question-field-highlight: rgba(255, 255, 255, 0.12);
  background-color: var(--dsw-alias-bg-base);
  background-image: var(--dsh-angelina-hero-image);
  background-position: var(--dsh-angelina-hero-position);
  background-size: cover;
  background-attachment: fixed;
}

body[data-ds-theme='angelina-light'] {
  --dsh-angelina-hero-image: var(--dsh-angelina-light-hero);
  --dsh-angelina-app-scrim: linear-gradient(90deg, rgb(235 232 227 / 92%) 0 20%, rgb(235 232 227 / 18%) 54%, rgb(235 232 227 / 4%) 100%);
  --dsh-angelina-parallax-background-image: var(--dsh-angelina-light-parallax-background);
  --dsh-angelina-parallax-foreground-image: var(--dsh-angelina-light-parallax-foreground);
  --dsh-angelina-glass-input: rgba(251, 250, 248, 0.72);
  --dsh-angelina-glass-dialog: rgba(251, 250, 248, 0.76);
  --dsh-angelina-glass-control: rgba(244, 241, 237, 0.88);
  --dsh-angelina-glass-control-selected: rgba(158, 47, 46, 0.18);
  --dsh-angelina-glass-composer-border: rgba(111, 31, 33, 0.18);
  --dsh-angelina-glass-dialog-border: rgba(111, 31, 33, 0.14);
  --dsh-angelina-glass-header-border: rgba(111, 31, 33, 0.16);
  --dsh-angelina-glass-composer-highlight: rgba(255, 255, 255, 0.5);
  --dsh-angelina-glass-header-highlight: rgba(255, 255, 255, 0.48);
  --dsh-angelina-glass-dialog-highlight: rgba(255, 255, 255, 0.42);
  --dsh-angelina-glass-composer-shadow: 0 14px 30px rgba(88, 45, 42, 0.16);
  --dsh-angelina-glass-field-shadow: 0 8px 20px rgba(88, 45, 42, 0.12);
  --dsh-angelina-glass-dialog-shadow: 0 14px 34px rgba(88, 45, 42, 0.14);
  --dsh-angelina-glass-menu-text: #252426;
  --dsh-angelina-glass-menu-muted: rgba(37, 36, 38, 0.66);
  --dsh-angelina-glass-menu-hover: rgba(158, 47, 46, 0.12);
  --dsh-angelina-glass-bubble: color-mix(in srgb, var(--dsw-specific-bubble) 62%, transparent);
  --dsh-angelina-glass-bubble-border: rgba(255, 255, 255, 0.4);
  --dsh-angelina-glass-bubble-highlight: rgba(255, 255, 255, 0.5);
  --dsh-angelina-glass-bubble-shadow: 0 8px 20px rgba(88, 45, 42, 0.16);
}

body[data-ds-theme='angelina-dark'] {
  --dsh-angelina-hero-image: var(--dsh-angelina-dark-hero);
  --dsh-angelina-hero-position: 74% 42%;
  --dsh-angelina-app-scrim: linear-gradient(90deg, rgb(8 13 19 / 94%) 0 20%, rgb(8 13 19 / 30%) 54%, rgb(8 13 19 / 8%) 100%);
  --dsh-angelina-glass-input: rgba(13, 21, 29, 0.72);
  --dsh-angelina-glass-dialog: rgba(10, 17, 24, 0.78);
  --dsh-angelina-glass-control: rgba(13, 21, 29, 0.82);
  --dsh-angelina-glass-control-selected: rgba(200, 91, 85, 0.42);
  --dsh-angelina-glass-dialog-border: rgba(255, 255, 255, 0.16);
  --dsh-angelina-glass-header-border: rgba(218, 228, 233, 0.24);
  --dsh-angelina-glass-header-highlight: rgba(255, 255, 255, 0.14);
  --dsh-angelina-glass-dialog-highlight: rgba(255, 255, 255, 0.1);
  --dsh-angelina-glass-field-shadow: 0 10px 24px rgba(0, 0, 0, 0.24);
  --dsh-angelina-glass-dialog-shadow: 0 16px 38px rgba(0, 0, 0, 0.34);
  --dsh-angelina-glass-menu-text: #f2f0ed;
  --dsh-angelina-glass-menu-muted: rgba(242, 240, 237, 0.62);
  --dsh-angelina-glass-menu-hover: rgba(200, 91, 85, 0.18);
  --dsh-angelina-glass-accent: #c85b55;
  --dsh-angelina-glass-caret: #e78476;
  --dsh-angelina-chat-text: #f5f3f0;
  --dsh-angelina-chat-secondary: rgba(245, 243, 240, 0.84);
  --dsh-angelina-chat-muted: rgba(245, 243, 240, 0.74);
  --dsh-angelina-chat-caption: rgba(245, 243, 240, 0.68);
  --dsh-angelina-parallax-background-image: var(--dsh-angelina-dark-hero);
  --dsh-angelina-parallax-foreground-image: none;
  --dsh-angelina-question-field: rgba(3, 10, 16, 0.72);
  --dsh-angelina-question-field-border: rgba(218, 228, 233, 0.24);
  --dsh-angelina-glass-bubble: color-mix(in srgb, var(--dsw-specific-bubble) 68%, transparent);
  --dsh-angelina-glass-bubble-border: rgba(255, 255, 255, 0.14);
  --dsh-angelina-glass-bubble-highlight: rgba(255, 255, 255, 0.1);
  --dsh-angelina-glass-bubble-shadow: 0 10px 24px rgba(0, 0, 0, 0.28);
}

body[data-ds-theme^='angelina-'] [data-ds-sidebar] {
  background: var(--dsh-angelina-conversation-glass);
  color: var(--dsw-alias-label-primary);
  border-color: var(--dsh-angelina-glass-header-border);
  --dsw-specific-sidebar-fill: var(--dsh-angelina-conversation-glass);
  --dsw-alias-button-elevated-fill: var(--dsh-angelina-glass-input);
  --dsw-alias-button-floating-fill: var(--dsh-angelina-glass-input);
  --dsw-alias-button-floating-hover: var(--dsh-angelina-glass-menu-hover);
  --dsw-alias-interactive-bg-hover: var(--dsh-angelina-glass-menu-hover);
  --dsw-alias-border-l1: var(--dsh-angelina-glass-header-border);
  --dsw-alias-border-l2: var(--dsh-angelina-glass-composer-border);
  --dsw-specific-sidebar-nav-item-hover: var(--dsh-angelina-glass-menu-hover);
  --dsw-specific-sidebar-nav-item-active: var(--dsh-angelina-glass-control-selected);
}

body[data-ds-theme^='angelina-'] [data-ds-sidebar] [data-slot='sidebar.workspaces'],
body[data-ds-theme^='angelina-'] [data-ds-sidebar] [data-slot='sidebar.settings'],
body[data-ds-theme^='angelina-'] [data-ds-sidebar] [data-slot='sidebar.footer.action'] {
  background: transparent;
  color: var(--dsw-alias-label-primary);
}

body[data-ds-theme^='angelina-'] [data-ds-app-frame] > :first-child {
  background: var(--dsh-angelina-conversation-glass);
  border-color: var(--dsh-angelina-glass-header-border);
}

body[data-ds-theme^='angelina-'] [data-ds-conversation-column] {
  background: transparent;
}

body[data-ds-theme^='angelina-'] [data-ds-conversation-column] [data-phase] {
  background-color: transparent;
  background-repeat: no-repeat;
  background-position: var(--dsh-angelina-hero-position);
  background-size: cover;
}

body[data-ds-theme^='angelina-'] [data-ds-conversation-column] [data-phase='hero'],
body[data-ds-theme^='angelina-'] [data-ds-conversation-column] [data-phase='settling'],
body[data-ds-theme^='angelina-'] [data-ds-conversation-column] [data-phase='active'] {
  background-image: var(--dsh-angelina-app-scrim), var(--dsh-angelina-hero-image);
}

body[data-ds-theme^='angelina-'] [data-ds-conversation-column] [data-phase='hero'] svg[class*='heroGlow'] {
  opacity: 0;
}

/* A shallow backdrop blur softens the artwork without filtering descendants. */
body[data-ds-theme^='angelina-'] [data-ds-conversation-column] [data-phase='active'] [data-conversation-scroll] {
  background-color: var(--dsh-angelina-conversation-glass);
  -webkit-backdrop-filter: var(--dsh-angelina-conversation-filter);
  backdrop-filter: var(--dsh-angelina-conversation-filter);
  --dsw-alias-label-primary: var(--dsh-angelina-chat-text);
  --dsw-alias-label-secondary: var(--dsh-angelina-chat-secondary);
  --dsw-alias-label-tertiary: var(--dsh-angelina-chat-muted);
  --dsw-alias-label-caption: var(--dsh-angelina-chat-caption);
  --dsw-alias-label-primary-dimmed: var(--dsh-angelina-chat-muted);
}

body[data-ds-theme^='angelina-'] [data-ds-conversation-column] [data-phase='active'] [data-slot='conversation.session.header'] > header {
  background-color: var(--dsh-angelina-conversation-glass);
  border-bottom-color: var(--dsh-angelina-glass-header-border);
  box-shadow: inset 0 1px 0 var(--dsh-angelina-glass-header-highlight), 0 8px 22px rgba(20, 25, 30, 0.12);
  -webkit-backdrop-filter: var(--dsh-angelina-conversation-filter);
  backdrop-filter: var(--dsh-angelina-conversation-filter);
  --dsw-alias-label-primary: var(--dsh-angelina-chat-text);
  --dsw-alias-label-secondary: var(--dsh-angelina-chat-secondary);
  --dsw-alias-label-tertiary: var(--dsh-angelina-chat-muted);
  --dsw-alias-label-caption: var(--dsh-angelina-chat-caption);
  --dsw-alias-border-l2: var(--dsh-angelina-glass-header-border);
}

body[data-ds-theme^='angelina-'] [data-ds-conversation-column] [data-composer-seat] {
  background: linear-gradient(180deg, color-mix(in srgb, var(--dsw-alias-bg-base) 0%, transparent) 0, color-mix(in srgb, var(--dsw-alias-bg-base) 88%, transparent) 36px);
}

body[data-ds-theme^='angelina-'] [data-ds-conversation-column] [data-composer-card],
body[data-ds-theme^='angelina-'] [data-slot='conversation'] [data-composer-card] {
  background-color: var(--dsh-angelina-glass-input);
  border: 1px solid var(--dsh-angelina-glass-composer-border);
  color: var(--dsh-angelina-glass-text);
  box-shadow: var(--dsh-angelina-glass-composer-shadow), inset 0 1px 0 var(--dsh-angelina-glass-composer-highlight);
  -webkit-backdrop-filter: var(--dsh-angelina-glass-composer-filter);
  backdrop-filter: var(--dsh-angelina-glass-composer-filter);
}

/* Published rc.6 exposes stable slot wrappers but predates the data-ds frame
 * hooks. Keep its opaque shell and conversation phase on the same artwork
 * coordinate system as current Harness builds. */
body[data-ds-theme^='angelina-'] [data-slot='root'] > :first-child {
  background: var(--dsh-angelina-app-scrim), var(--dsh-angelina-hero-image) var(--dsh-angelina-hero-position) / cover fixed;
}

body[data-ds-theme^='angelina-'] [data-slot='conversation'] > [data-phase] {
  background-color: transparent;
  background-repeat: no-repeat;
  background-position: var(--dsh-angelina-hero-position);
  background-size: cover;
}

body[data-ds-theme^='angelina-'] [data-slot='conversation'] > [data-phase='hero'],
body[data-ds-theme^='angelina-'] [data-slot='conversation'] > [data-phase='settling'],
body[data-ds-theme^='angelina-'] [data-slot='conversation'] > [data-phase='active'] {
  background-image: var(--dsh-angelina-app-scrim), var(--dsh-angelina-hero-image);
}

body[data-ds-theme^='angelina-'] [data-slot='conversation'] > [data-phase='hero'] svg[class*='heroGlow'] {
  opacity: 0;
}

body[data-ds-theme^='angelina-'] [data-slot='conversation'] > [data-phase='active'] [data-conversation-scroll] {
  background-color: var(--dsh-angelina-conversation-glass);
  -webkit-backdrop-filter: var(--dsh-angelina-conversation-filter);
  backdrop-filter: var(--dsh-angelina-conversation-filter);
  --dsw-alias-label-primary: var(--dsh-angelina-chat-text);
  --dsw-alias-label-secondary: var(--dsh-angelina-chat-secondary);
  --dsw-alias-label-tertiary: var(--dsh-angelina-chat-muted);
  --dsw-alias-label-caption: var(--dsh-angelina-chat-caption);
  --dsw-alias-label-primary-dimmed: var(--dsh-angelina-chat-muted);
}

body[data-ds-theme^='angelina-'] [data-slot='conversation'] > [data-phase='active'] [data-slot='conversation.session.header'] > header {
  background-color: var(--dsh-angelina-conversation-glass);
  border-bottom-color: var(--dsh-angelina-glass-header-border);
  box-shadow: inset 0 1px 0 var(--dsh-angelina-glass-header-highlight), 0 8px 22px rgba(20, 25, 30, 0.12);
  -webkit-backdrop-filter: var(--dsh-angelina-conversation-filter);
  backdrop-filter: var(--dsh-angelina-conversation-filter);
  --dsw-alias-label-primary: var(--dsh-angelina-chat-text);
  --dsw-alias-label-secondary: var(--dsh-angelina-chat-secondary);
  --dsw-alias-label-tertiary: var(--dsh-angelina-chat-muted);
  --dsw-alias-label-caption: var(--dsh-angelina-chat-caption);
  --dsw-alias-border-l2: var(--dsh-angelina-glass-header-border);
}

body[data-ds-theme^='angelina-'] [data-slot='conversation'] > [data-phase='active'] [data-composer-seat] {
  background: linear-gradient(180deg, color-mix(in srgb, var(--dsw-alias-bg-base) 0%, transparent) 0, color-mix(in srgb, var(--dsw-alias-bg-base) 88%, transparent) 36px);
}

/* The user bubble is a leaf glass surface. Rows are identified through the
 * stable flow markers published in rc.6 and the fork (data-chat-flow-kind,
 * data-pending-steering, data-time-hover-root); the bubble itself has no
 * stable attribute, so it is addressed by its fixed position as the last
 * child div of the row's first child div (image gallery + bubble stack). */
body[data-ds-theme^='angelina-'] :is(
  [data-chat-flow-kind='user'] [data-time-hover-root],
  [data-chat-flow-kind='steering'] [data-time-hover-root],
  [data-pending-steering]
) > div:first-child > div:last-child {
  background-color: var(--dsh-angelina-glass-bubble);
  border: 1px solid var(--dsh-angelina-glass-bubble-border);
  box-shadow: var(--dsh-angelina-glass-bubble-shadow), inset 0 1px 0 var(--dsh-angelina-glass-bubble-highlight);
  -webkit-backdrop-filter: var(--dsh-angelina-glass-bubble-filter);
  backdrop-filter: var(--dsh-angelina-glass-bubble-filter);
}

/* Glass belongs on leaf surfaces. Ancestor filters break fixed dialogs.
 * Floating cards share the settings dialog's density and depth. */
body[data-ds-theme^='angelina-'] :where(
  [role='menu'],
  [role='listbox'],
  [data-radix-popper-content-wrapper] > *
) {
  background-color: var(--dsh-angelina-glass-menu);
  border: 1px solid var(--dsh-angelina-glass-menu-border);
  color: var(--dsh-angelina-glass-menu-text);
  box-shadow: var(--dsh-angelina-glass-menu-shadow), inset 0 1px 0 var(--dsh-angelina-glass-menu-highlight);
  -webkit-backdrop-filter: var(--dsh-angelina-glass-menu-filter);
  backdrop-filter: var(--dsh-angelina-glass-menu-filter);
  --dsw-alias-label-primary: var(--dsh-angelina-glass-menu-text);
  --dsw-alias-label-secondary: var(--dsh-angelina-glass-menu-muted);
  --dsw-alias-label-tertiary: var(--dsh-angelina-glass-menu-muted);
  --dsw-alias-label-caption: var(--dsh-angelina-glass-menu-muted);
  --dsw-alias-interactive-bg-hover: var(--dsh-angelina-glass-menu-hover);
}

/* ModelSelect keeps its group heading on the menu token. That token is a
 * solid light surface in the host theme, so make the heading transparent and
 * let the menu's smoked-glass layer remain continuous behind it. */
body[data-ds-theme^='angelina-'] [role='menu'] section[role='group'] > div[id] {
  background: transparent;
}

body[data-ds-theme^='angelina-'] :where(
  [role='dialog'],
  [data-testid='todo-panel'],
  [data-question-key] > section
) {
  background-color: var(--dsh-angelina-glass-dialog);
  border: 1px solid var(--dsh-angelina-glass-dialog-border);
  color: var(--dsh-angelina-glass-text);
  box-shadow: var(--dsh-angelina-glass-dialog-shadow), inset 0 1px 0 var(--dsh-angelina-glass-dialog-highlight);
  -webkit-backdrop-filter: var(--dsh-angelina-glass-dialog-filter);
  backdrop-filter: var(--dsh-angelina-glass-dialog-filter);
  --dsw-alias-label-primary: var(--dsh-angelina-glass-text);
  --dsw-alias-label-secondary: var(--dsh-angelina-glass-muted);
  --dsw-alias-label-tertiary: var(--dsh-angelina-glass-muted);
  --dsw-alias-label-caption: var(--dsh-angelina-glass-muted);
  --dsw-alias-bg-base: var(--dsh-angelina-glass-control);
  --dsw-alias-bg-layer-1: var(--dsh-angelina-glass-control);
  --dsw-alias-bg-layer-2: var(--dsh-angelina-glass-control);
  --dsw-alias-bg-layer-3: var(--dsh-angelina-glass-control);
  --dsw-alias-bg-module-platform: var(--dsh-angelina-glass-control);
  --dsw-alias-interactive-bg-hover: rgba(245, 243, 240, 0.12);
  --dsw-alias-interactive-bg-hover-solid: rgba(245, 243, 240, 0.16);
  --dsw-specific-sidebar-nav-item-hover: rgba(245, 243, 240, 0.1);
  --dsw-specific-sidebar-nav-item-active: var(--dsh-angelina-glass-control-selected);
  --dsw-alias-border-l1: rgba(255, 255, 255, 0.14);
  --dsw-alias-border-l2: rgba(255, 255, 255, 0.2);
  --dsw-alias-border-l3: rgba(255, 255, 255, 0.28);
  --dsw-alias-fill-tsp-secondary: rgba(245, 243, 240, 0.12);
  --dsw-alias-label-quaternary: var(--dsh-angelina-glass-muted);
  --dsw-alias-label-dimmed: var(--dsh-angelina-glass-muted);
}

body[data-ds-theme^='angelina-'] [data-composer-card] {
  background-color: var(--dsh-angelina-glass-input);
  border: 1px solid var(--dsh-angelina-glass-composer-border);
  color: var(--dsh-angelina-glass-text);
  box-shadow: var(--dsh-angelina-glass-composer-shadow), inset 0 1px 0 var(--dsh-angelina-glass-composer-highlight);
  -webkit-backdrop-filter: var(--dsh-angelina-glass-composer-filter);
  backdrop-filter: var(--dsh-angelina-glass-composer-filter);
  --dsw-alias-label-primary: var(--dsh-angelina-glass-text);
  --dsw-alias-label-secondary: var(--dsh-angelina-glass-muted);
  --dsw-alias-label-tertiary: var(--dsh-angelina-glass-muted);
  --dsw-alias-label-caption: var(--dsh-angelina-glass-muted);
  --dsw-specific-selector: rgba(245, 243, 240, 0.12);
  --dsw-alias-interactive-bg-hover: rgba(245, 243, 240, 0.08);
  --dsw-alias-interactive-bg-hover-solid: rgba(245, 243, 240, 0.14);
}

body[data-ds-theme^='angelina-'] :where(
  input:not([type='checkbox']):not([type='radio']):not([type='range']):not([type='file']),
  textarea,
  select,
  [contenteditable='true']
) {
  background-color: var(--dsh-angelina-glass-input);
  border: 1px solid var(--dsh-angelina-glass-composer-border);
  color: var(--dsh-angelina-glass-text);
  caret-color: var(--dsh-angelina-glass-caret);
  box-shadow: var(--dsh-angelina-glass-field-shadow), inset 0 1px 0 var(--dsh-angelina-glass-composer-highlight);
  -webkit-backdrop-filter: var(--dsh-angelina-glass-composer-filter);
  backdrop-filter: var(--dsh-angelina-glass-composer-filter);
}

/* WorkspaceBrowser owns the search capsule geometry. The broad glass-input
 * rule above must not paint a second rectangle inside that native control. */
body[data-ds-theme^='angelina-'] :is(
  input[placeholder='搜索会话…'],
  input[placeholder='Search sessions...']
) {
  background: transparent;
  background-color: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  color: var(--dsw-alias-label-primary);
  caret-color: var(--dsh-angelina-glass-caret);
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}

body[data-ds-theme^='angelina-'] :is(
  input[placeholder='搜索会话…'],
  input[placeholder='Search sessions...']
)::placeholder {
  color: var(--dsw-alias-label-tertiary);
  opacity: 1;
}

/* The question takeover is a dark glass surface in both Angelina variants.
 * Give its copy a dedicated contrast scale, then let the custom-answer row
 * own the glass while its native input remains a clear writing plane. */
body[data-ds-theme^='angelina-'] [data-question-key],
body[data-ds-theme^='angelina-'] [data-question-key] > section {
  --dsw-alias-label-primary: var(--dsh-angelina-question-text);
  --dsw-alias-label-secondary: var(--dsh-angelina-question-secondary);
  --dsw-alias-label-tertiary: var(--dsh-angelina-question-secondary);
  --dsw-alias-label-caption: var(--dsh-angelina-question-caption);
  --dsw-alias-label-dimmed: var(--dsh-angelina-question-caption);
}

body[data-ds-theme^='angelina-'] [data-question-key] :is([role='radio'], [role='checkbox']) {
  color: var(--dsh-angelina-question-text);
}

body[data-ds-theme^='angelina-'] [data-question-key] [role='radio'] > :first-child {
  background: rgba(255, 255, 255, 0.18);
  color: var(--dsh-angelina-question-text);
}

body[data-ds-theme^='angelina-'] [data-question-key] :has(> input[type='text']) {
  background: var(--dsh-angelina-question-field);
  border: 1px solid var(--dsh-angelina-question-field-border);
  border-radius: 12px;
  box-shadow: 0 8px 20px rgba(3, 8, 12, 0.18), inset 0 1px 0 var(--dsh-angelina-question-field-highlight);
  -webkit-backdrop-filter: blur(10px) saturate(102%);
  backdrop-filter: blur(10px) saturate(102%);
}

body[data-ds-theme^='angelina-'] [data-question-key] :has(> input[type='text']:focus) {
  border-color: color-mix(in srgb, var(--dsh-angelina-glass-caret) 72%, white);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--dsh-angelina-glass-caret) 36%, transparent), inset 0 1px 0 var(--dsh-angelina-question-field-highlight);
}

body[data-ds-theme^='angelina-'] [data-question-key] input[type='text'] {
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  border: 0;
  border-radius: 0;
  color: var(--dsh-angelina-question-text);
  caret-color: var(--dsh-angelina-glass-caret);
  box-shadow: none;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}

body[data-ds-theme^='angelina-'] [data-question-key] input[type='text']::placeholder {
  color: var(--dsh-angelina-question-caption);
  opacity: 1;
}

body[data-ds-theme^='angelina-'] [data-question-key] textarea {
  background: var(--dsh-angelina-question-field);
  border: 1px solid var(--dsh-angelina-question-field-border);
  border-radius: 12px;
  color: var(--dsh-angelina-question-text);
  caret-color: var(--dsh-angelina-glass-caret);
  box-shadow: 0 8px 20px rgba(3, 8, 12, 0.18), inset 0 1px 0 var(--dsh-angelina-question-field-highlight);
  -webkit-backdrop-filter: blur(10px) saturate(102%);
  backdrop-filter: blur(10px) saturate(102%);
}

body[data-ds-theme^='angelina-'] [data-question-key] textarea::placeholder {
  color: var(--dsh-angelina-question-caption);
  opacity: 1;
}

/* PopupSelectView has no semantic role on its outer card, while its inner
 * listbox does. Bind the card by its direct search field so the module's light
 * menu token cannot leave a pale frame around the smoked-glass list. */
body[data-ds-theme^='angelina-'] [data-composer-card] :has(
  > input[aria-label='筛选选项'],
  > input[aria-label='Filter options']
) {
  background: var(--dsh-angelina-glass-menu);
  border: 1px solid var(--dsh-angelina-glass-menu-border);
  color: var(--dsh-angelina-glass-menu-text);
  box-shadow: var(--dsh-angelina-glass-menu-shadow), inset 0 1px 0 var(--dsh-angelina-glass-menu-highlight);
  -webkit-backdrop-filter: var(--dsh-angelina-glass-menu-filter);
  backdrop-filter: var(--dsh-angelina-glass-menu-filter);
  --dsw-alias-label-primary: var(--dsh-angelina-glass-menu-text);
  --dsw-alias-label-secondary: var(--dsh-angelina-glass-menu-muted);
  --dsw-alias-label-tertiary: var(--dsh-angelina-glass-menu-muted);
  --dsw-alias-interactive-bg-hover: var(--dsh-angelina-glass-menu-hover);
}

body[data-ds-theme^='angelina-'] [data-composer-card] :has(
  > input[aria-label='筛选选项'],
  > input[aria-label='Filter options']
) > [role='listbox'] {
  background: transparent;
  border: 0;
  box-shadow: none;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}

/* The search module intentionally starts transparent. Give the field its own
 * bounded glass layer so native input chrome can never turn it white. */
body[data-ds-theme^='angelina-'] [data-composer-card] :is(
  input[aria-label='筛选选项'],
  input[aria-label='Filter options']
) {
  -webkit-appearance: none;
  appearance: none;
  background: var(--dsh-angelina-glass-menu);
  border: 1px solid var(--dsh-angelina-glass-menu-border);
  color: var(--dsh-angelina-glass-menu-text);
  caret-color: var(--dsh-angelina-glass-caret);
  box-shadow: inset 0 1px 0 var(--dsh-angelina-glass-menu-highlight), 0 8px 20px rgba(20, 25, 30, 0.16);
  -webkit-backdrop-filter: var(--dsh-angelina-glass-menu-filter);
  backdrop-filter: var(--dsh-angelina-glass-menu-filter);
}

body[data-ds-theme^='angelina-'] [data-composer-card] :is(
  input[aria-label='筛选选项'],
  input[aria-label='Filter options']
)::placeholder {
  color: var(--dsh-angelina-glass-menu-muted);
}

body[data-ds-theme^='angelina-'] [data-composer-card] :is(textarea, [contenteditable='true']) {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}

body[data-ds-theme^='angelina-'] [data-composer-card] select {
  background-color: transparent;
  border-color: transparent;
  box-shadow: none;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}

body[data-ds-theme^='angelina-'] [data-composer-card] textarea {
  color: transparent;
  caret-color: var(--dsh-angelina-glass-caret);
}

body[data-ds-theme^='angelina-'] [data-composer-card] :is(select, [contenteditable='true']) {
  color: var(--dsh-angelina-glass-muted);
  caret-color: var(--dsh-angelina-glass-caret);
}

body[data-ds-theme^='angelina-'] [data-dsh-angelina-parallax] {
  position: fixed;
  z-index: 0;
  inset: 0;
  overflow: hidden;
  contain: strict;
  pointer-events: none;
}

body[data-ds-theme^='angelina-'] [data-dsh-angelina-parallax] > [data-dsh-angelina-layer] {
  position: absolute;
  inset: -16px;
  background-position: var(--dsh-angelina-hero-position);
  background-size: cover;
  background-repeat: no-repeat;
  backface-visibility: hidden;
  will-change: transform;
}

body[data-ds-theme^='angelina-'] [data-dsh-angelina-parallax] > [data-dsh-angelina-layer='background'] {
  background-image: var(--dsh-angelina-parallax-background-image);
}

body[data-ds-theme^='angelina-'] [data-dsh-angelina-parallax] > [data-dsh-angelina-layer='foreground'] {
  background-image: var(--dsh-angelina-parallax-foreground-image);
}

body[data-dsh-angelina-parallax] {
  isolation: isolate;
  background-image: none;
}

body[data-dsh-angelina-parallax] > #root {
  position: relative;
  z-index: 1;
}

body[data-dsh-angelina-parallax] [data-ds-app-frame] {
  background: var(--dsh-angelina-app-scrim);
}

body[data-dsh-angelina-parallax] [data-slot='root'] > :first-child {
  background: var(--dsh-angelina-app-scrim);
}

body[data-dsh-angelina-parallax] [data-ds-conversation-column] [data-phase='hero'],
body[data-dsh-angelina-parallax] [data-ds-conversation-column] [data-phase='settling'],
body[data-dsh-angelina-parallax] [data-ds-conversation-column] [data-phase='active'] {
  background-image: var(--dsh-angelina-app-scrim);
}

body[data-dsh-angelina-parallax] [data-slot='conversation'] > [data-phase='hero'],
body[data-dsh-angelina-parallax] [data-slot='conversation'] > [data-phase='settling'],
body[data-dsh-angelina-parallax] [data-slot='conversation'] > [data-phase='active'] {
  background-image: var(--dsh-angelina-app-scrim);
}

/* Standalone settings row. */
.dsh-angelina-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}

.dsh-angelina-picker-title {
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 22px;
}

.dsh-angelina-picker-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.dsh-angelina-picker-choice {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  cursor: pointer;
}

.dsh-angelina-picker-choice:hover:not(.is-selected) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-angelina-picker-choice.is-selected {
  border-color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-bg-module-platform);
  box-shadow: 0 0 0 1px var(--dsw-alias-brand-primary);
}

.dsh-angelina-picker-preview {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 5px;
  background-position: center;
  background-size: cover;
}

.dsh-angelina-picker-preview[data-preview='angelina-light'] {
  background-image: var(--dsh-angelina-light-hero);
}

.dsh-angelina-picker-preview[data-preview='angelina-dark'] {
  background-image: var(--dsh-angelina-dark-hero);
}

.dsh-angelina-picker-rail,
.dsh-angelina-picker-panel {
  position: absolute;
  display: block;
  backdrop-filter: blur(3px);
}

.dsh-angelina-picker-rail {
  inset: 0 auto 0 0;
  width: 25%;
  background: rgb(8 13 19 / 48%);
  border-right: 1px solid rgb(255 255 255 / 18%);
}

.dsh-angelina-picker-panel {
  right: 8%;
  bottom: 12%;
  width: 46%;
  height: 24%;
  border-radius: 4px;
  background: rgb(251 250 248 / 78%);
}

.dsh-angelina-picker-preview[data-preview='angelina-dark'] .dsh-angelina-picker-panel {
  background: rgb(17 24 32 / 82%);
}

.dsh-angelina-picker-label {
  min-height: 22px;
  text-align: center;
  font-size: 13px;
  line-height: 22px;
}

@media (max-width: 900px) {
  body[data-ds-theme^='angelina-'] {
    --dsh-angelina-hero-position: 68% 42%;
  }

  body[data-dsh-angelina-parallax] [data-dsh-angelina-layer] {
    transform: none !important;
  }

  .dsh-angelina-picker-grid {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-transparency: reduce) {
  body[data-ds-theme^='angelina-'] [data-ds-conversation-column] [data-phase='active'] [data-conversation-scroll] {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  body[data-ds-theme^='angelina-'] :is(
    [data-chat-flow-kind='user'] [data-time-hover-root],
    [data-chat-flow-kind='steering'] [data-time-hover-root],
    [data-pending-steering]
  ) > div:first-child > div:last-child {
    background-color: var(--dsw-specific-bubble);
    border-color: transparent;
    box-shadow: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  body[data-ds-theme^='angelina-'] :is(
    [data-composer-card],
    [role='menu'],
    [role='listbox'],
    [role='dialog'],
    [data-radix-popper-content-wrapper] > *,
    [data-testid='todo-panel'],
    [data-question-key] > section,
    input,
    textarea,
    select,
    [contenteditable='true']
  ) {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  body[data-ds-theme^='angelina-'] [data-ds-conversation-column] [data-phase='active'] [data-slot='conversation.session.header'] > header {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  body[data-ds-theme^='angelina-'] [data-composer-card] :has(
    > input[aria-label='筛选选项'],
    > input[aria-label='Filter options']
  ) {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  body[data-dsh-angelina-parallax] [data-dsh-angelina-layer] {
    transform: none !important;
  }
}
`

export function installAngelinaStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const existing = document.head.querySelector<HTMLStyleElement>('style[data-dsh-angelina-themes]')
  if (existing !== null) return () => {}
  const style = document.createElement('style')
  style.dataset.dshAngelinaThemes = ''
  style.setAttribute('data-plugin', 'dsh-angelina-themes')
  style.textContent = ANGELINA_CSS
  document.head.append(style)
  return () => { style.remove() }
}
