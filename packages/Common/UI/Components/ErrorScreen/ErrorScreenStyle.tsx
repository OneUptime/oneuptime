import React, { ReactElement } from "react";

/*
 * The error boundary's screens (ErrorBoundary's Fallback, and
 * ChunkLoadRecovery's while a part of the app will not download) are styled
 * with their own stylesheet rather than with the app's
 * Tailwind classes on purpose. One of the failures this boundary exists to
 * catch is a stale bundle whose CSS chunk 404s, and an error screen that
 * depends on the very stylesheet that failed is an unstyled error screen. The
 * tokens below read the shared theme variables when they are present (so the
 * card matches the dashboard, light or dark) and fall back to the same literal
 * values the design system uses when they are not.
 */
export const ERROR_SCREEN_CSS: string = `
.oneuptime-error-boundary,
.oueb-part {
  --oueb-surface: var(--ou-surface-primary, #ffffff);
  --oueb-surface-muted: var(--ou-surface-secondary, #f9fafb);
  --oueb-border: var(--ou-border-default, #e5e7eb);
  --oueb-border-subtle: var(--ou-border-subtle, #f3f4f6);
  --oueb-text: var(--ou-text-primary, #111827);
  --oueb-text-secondary: var(--ou-text-secondary, #4b5563);
  --oueb-text-muted: var(--ou-text-muted, #6b7280);
  --oueb-accent: #4f46e5;
  --oueb-accent-hover: #4338ca;
  --oueb-accent-ring: rgb(79 70 229 / 45%);
  --oueb-danger-surface: #fef2f2;
  --oueb-danger-border: #fee2e2;
  --oueb-danger-icon: #dc2626;
  --oueb-success-text: var(--ou-success-text, #166534);
  --oueb-danger-text: var(--ou-danger-text, #b91c1c);
  --oueb-shadow: var(--ou-card-shadow, 0 1px 3px rgb(15 23 42 / 8%));
  --oueb-accent-surface: var(--ou-accent-soft, #eef2ff);
  --oueb-accent-border: var(--ou-accent-muted, #e0e7ff);
  --oueb-warning-surface: #fffbeb;
  --oueb-warning-icon: #f59e0b;
  color: var(--oueb-text);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}

/*
 * On the page's own background (the body paints it in every frontend), so
 * the screen is not a slightly different box inside the page.
 */
.oneuptime-error-boundary {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 60vh;
  padding: 3rem 1.5rem;
  background-color: transparent;
}

html.dark .oneuptime-error-boundary,
html.dark .oueb-part {
  --oueb-accent: #6366f1;
  --oueb-accent-hover: #818cf8;
  --oueb-accent-ring: rgb(129 140 248 / 55%);
  --oueb-danger-surface: rgb(153 27 27 / 22%);
  --oueb-danger-border: rgb(248 113 113 / 24%);
  --oueb-danger-icon: #fca5a5;
  /* Theme.css's dark bg-amber-50 and text-amber-500. */
  --oueb-warning-surface: rgb(120 53 15 / 32%);
  --oueb-warning-icon: #fbbf24;
}

.oneuptime-error-boundary *,
.oneuptime-error-boundary *::before,
.oneuptime-error-boundary *::after,
.oueb-part,
.oueb-part *,
.oueb-part *::before,
.oueb-part *::after {
  box-sizing: border-box;
}

.oueb-card {
  width: 100%;
  max-width: 34rem;
  padding: 2rem;
  border: 1px solid var(--oueb-border);
  border-radius: 1rem;
  background-color: var(--oueb-surface);
  box-shadow: var(--oueb-shadow);
  animation: oueb-enter 260ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes oueb-enter {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}

.oueb-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  border: 1px solid var(--oueb-danger-border);
  border-radius: 0.75rem;
  background-color: var(--oueb-danger-surface);
  color: var(--oueb-danger-icon);
}

.oueb-badge svg {
  width: 1.375rem;
  height: 1.375rem;
}

/* A new version loading: the accent, not the alarm. */
.oueb-badge-info {
  border-color: var(--oueb-accent-border);
  background-color: var(--oueb-accent-surface);
  color: var(--oueb-accent);
}

/* Offline, or the server not answering: nothing is broken on this page. */
.oueb-badge-neutral {
  border-color: var(--oueb-border);
  background-color: var(--oueb-surface-muted);
  color: var(--oueb-text-secondary);
}

.oueb-spinner {
  display: inline-block;
  flex-shrink: 0;
  width: 1.25rem;
  height: 1.25rem;
  border: 2px solid currentColor;
  border-inline-end-color: transparent;
  border-radius: 9999px;
  animation: oueb-spin 800ms linear infinite;
}

@keyframes oueb-spin {
  to { transform: rotate(360deg); }
}

/*
 * One part of a page - a dashboard widget, a widget's settings - in its own
 * place, the rest of the page staying. Drawn the way such a part draws its
 * own states (the widget's DashboardWidgetFallback): an icon in a soft
 * circle above one short line and a small button, in the middle of the
 * part, on the part's own surface - not a box inside its box. The outer box
 * scrolls and the inner one is centred with auto margins, so a part shorter
 * than the words starts at its top and scrolls instead of cutting them off.
 */
.oueb-part {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: auto;
}

.oueb-part-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  max-width: min(100%, 20rem);
  margin: auto;
  padding: 0.25rem 0.5rem;
  text-align: center;
}

.oueb-part-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 9999px;
  background-color: var(--oueb-surface-muted);
  color: var(--oueb-text-muted);
}

.oueb-part-icon svg {
  width: 1.25rem;
  height: 1.25rem;
}

/* The new version loading, or waiting for a reload: the accent. */
.oueb-part-icon-info {
  background-color: var(--oueb-accent-surface);
  color: var(--oueb-accent);
}

/* It could not be loaded: the amber of a widget that cannot be drawn. */
.oueb-part-icon-warning {
  background-color: var(--oueb-warning-surface);
  color: var(--oueb-warning-icon);
}

.oueb-part-icon .oueb-spinner {
  width: 1.125rem;
  height: 1.125rem;
}

.oueb-part-text {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.25rem;
  color: var(--oueb-text-secondary);
  text-wrap: pretty;
}

.oueb-part-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
  margin-top: 0.25rem;
}

.oueb-button-small {
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  font-size: 0.8125rem;
  line-height: 1.125rem;
}

.oueb-button-small svg {
  width: 0.875rem;
  height: 0.875rem;
}

/*
 * A title that wraps (German, Persian, a phone) wraps into even lines rather
 * than leaving its last word alone on the second, and the message does not
 * end on a single word. Browsers without text-wrap wrap as before.
 */
.oueb-title {
  margin: 1.25rem 0 0;
  font-size: 1.125rem;
  font-weight: 600;
  line-height: 1.5rem;
  letter-spacing: -0.01em;
  color: var(--oueb-text);
  text-wrap: balance;
}

.oueb-message {
  margin: 0.375rem 0 0;
  font-size: 0.875rem;
  line-height: 1.375rem;
  color: var(--oueb-text-muted);
  text-wrap: pretty;
}

.oueb-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1.5rem;
}

.oueb-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.5625rem 1rem;
  border: 1px solid transparent;
  border-radius: 0.5rem;
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.25rem;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
}

.oueb-button svg {
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
}

.oueb-button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--oueb-surface), 0 0 0 4px var(--oueb-accent-ring);
}

.oueb-button-primary {
  background-color: var(--oueb-accent);
  color: #ffffff;
  box-shadow: 0 1px 2px rgb(15 23 42 / 10%);
}

.oueb-button-primary:hover {
  background-color: var(--oueb-accent-hover);
}

.oueb-button-secondary {
  border-color: var(--oueb-border);
  background-color: var(--oueb-surface);
  color: var(--oueb-text-secondary);
  box-shadow: 0 1px 2px rgb(15 23 42 / 5%);
}

.oueb-button-secondary:hover {
  background-color: var(--oueb-surface-muted);
  color: var(--oueb-text);
}

.oueb-button-ghost {
  padding: 0.4375rem 0.75rem;
  background-color: transparent;
  color: var(--oueb-accent);
}

.oueb-button-ghost:hover {
  background-color: var(--oueb-surface-muted);
}

.oueb-support {
  margin-top: 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--oueb-border-subtle);
}

.oueb-support-title {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--oueb-text-secondary);
}

.oueb-support-text {
  margin: 0.375rem 0 0;
  font-size: 0.75rem;
  line-height: 1.125rem;
  color: var(--oueb-text-muted);
}

.oueb-support-actions {
  display: flex;
  align-items: center;
  margin-top: 0.75rem;
  margin-inline-start: -0.75rem;
}

.oueb-support-email {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin: 0.5rem 0 0;
  font-size: 0.75rem;
  line-height: 1.125rem;
  color: var(--oueb-text-muted);
}

.oueb-support-email svg {
  width: 0.875rem;
  height: 0.875rem;
  flex-shrink: 0;
}

.oueb-link {
  border-radius: 0.25rem;
  color: var(--oueb-accent);
  font-weight: 500;
  text-decoration: none;
}

.oueb-link:hover {
  text-decoration: underline;
}

.oueb-link:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--oueb-surface), 0 0 0 4px var(--oueb-accent-ring);
}

.oueb-status {
  margin-top: 0.75rem;
  font-size: 0.75rem;
  line-height: 1.125rem;
  color: var(--oueb-text-muted);
}

.oueb-status:empty {
  display: none;
}

.oueb-status-success {
  color: var(--oueb-success-text);
}

.oueb-status-error {
  color: var(--oueb-danger-text);
}

.oueb-details {
  margin-top: 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--oueb-border-subtle);
}

.oueb-details summary {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--oueb-text-muted);
  cursor: pointer;
  list-style: none;
  user-select: none;
}

.oueb-details summary::-webkit-details-marker {
  display: none;
}

.oueb-details summary:hover {
  color: var(--oueb-text-secondary);
}

.oueb-details summary:focus-visible {
  outline: none;
  color: var(--oueb-text);
  text-decoration: underline;
}

.oueb-details summary svg {
  width: 0.875rem;
  height: 0.875rem;
  transition: transform 150ms ease;
}

.oueb-details[open] summary svg {
  transform: rotate(90deg);
}

.oueb-error-message {
  margin: 0.75rem 0 0;
  padding: 0.75rem;
  max-height: 10rem;
  overflow: auto;
  border: 1px solid var(--oueb-border-subtle);
  border-radius: 0.5rem;
  background-color: var(--oueb-surface-muted);
  color: var(--oueb-text-secondary);
  font-family: "Courier Prime", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.75rem;
  line-height: 1.125rem;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 30rem) {
  .oneuptime-error-boundary {
    padding: 2rem 1rem;
  }

  .oueb-card {
    padding: 1.5rem;
  }

  .oueb-actions .oueb-button {
    flex: 1 1 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .oueb-card {
    animation: none;
  }

  .oueb-spinner {
    animation-duration: 2400ms;
  }

  .oueb-details summary svg,
  .oueb-button {
    transition: none;
  }
}
`;

export type GetIconFunction = (path: string) => ReactElement;

/* Heroicons outline paths, inlined so the fallback needs no icon bundle. */
export const getIcon: GetIconFunction = (path: string): ReactElement => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
};

export const ALERT_ICON_PATH: string =
  "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z";

export const RELOAD_ICON_PATH: string =
  "M16.023 9.348h4.992V4.356m0 4.992-3.181-3.183a8.25 8.25 0 0 0-13.803 3.7M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7";

export const DOWNLOAD_ICON_PATH: string =
  "M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3";

export const MAIL_ICON_PATH: string =
  "M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75";

export const CHEVRON_ICON_PATH: string = "m8.25 4.5 7.5 7.5-7.5 7.5";

// Heroicons "signal-slash": offline.
export const OFFLINE_ICON_PATH: string =
  "m3 3 8.735 8.735m0 0a.374.374 0 1 1 .53.53m-.53-.53.53.53m0 0L21 21M14.652 9.348a3.75 3.75 0 0 1 0 5.304m2.121-7.425a6.75 6.75 0 0 1 0 9.546m2.121-11.667c3.808 3.807 3.808 9.98 0 13.788m-9.546-4.242a3.733 3.733 0 0 1-1.06-2.122m-1.061 4.243a6.75 6.75 0 0 1-1.625-6.929m-.496 9.05c-3.068-3.067-3.664-7.67-1.79-11.334M12 12h.008v.008H12V12Z";

// Heroicons "cloud": a server that does not answer.
export const CLOUD_ICON_PATH: string =
  "M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z";
