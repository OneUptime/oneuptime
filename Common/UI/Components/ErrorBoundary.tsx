import { downloadErrorSupportBundle } from "../Utils/ErrorSupportBundle";
import React, {
  ErrorInfo,
  FunctionComponent,
  ReactElement,
  ReactNode,
  useRef,
  useState,
} from "react";
import {
  ErrorBoundary as NativeErrorBoundary,
  FallbackProps,
} from "react-error-boundary";

export interface ComponentProps {
  children?: ReactNode;
  /**
   * When this value changes the boundary clears its error and re-renders its
   * children. Pass the current route (pathname) so navigating away from a page
   * that crashed recovers the app instead of stranding the user on the
   * fallback until they reload.
   */
  resetKey?: string | undefined;
  /** Notified for every caught error. Used by tests and by callers that report. */
  onError?: ((error: Error, errorInfo: ErrorInfo) => void) | undefined;
}

interface CapturedErrorDetails {
  error: unknown;
  componentStack: string | null;
  digest: string | null;
  capturedAt: string;
}

type GetCapturedErrorDetailsFunction = (
  error: unknown,
) => CapturedErrorDetails | null;

interface FallbackComponentProps extends FallbackProps {
  getCapturedErrorDetails?: GetCapturedErrorDetailsFunction | undefined;
}

/**
 * A code-split chunk that fails to download throws during render, and — with
 * no boundary above it — takes the entire React tree down with it. This is the
 * usual cause of an app that "sometimes" goes blank: a user holds a tab open
 * across a deploy, the hashed chunk filenames they were served no longer
 * exist, and the next lazy route they visit 404s.
 *
 * Browsers word this failure differently, hence the list.
 */
const CHUNK_LOAD_ERROR_PATTERNS: Array<RegExp> = [
  /Loading chunk \S+ failed/i,
  /Loading CSS chunk \S+ failed/i,
  /ChunkLoadError/i,
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
];

/** sessionStorage key holding the timestamp of the last chunk-error reload. */
export const CHUNK_LOAD_RELOAD_STORAGE_KEY: string =
  "oneuptime-chunk-load-reload-at";

/**
 * If a reload does not fix the chunk error, reloading again will not either.
 * Only auto-reload when the last attempt is older than this, so a genuinely
 * missing asset degrades to the fallback UI instead of a reload loop.
 */
export const CHUNK_LOAD_RELOAD_COOLDOWN_IN_MS: number = 30 * 1000;

export type IsChunkLoadErrorFunction = (error: unknown) => boolean;

export const isChunkLoadError: IsChunkLoadErrorFunction = (
  error: unknown,
): boolean => {
  if (!error) {
    return false;
  }

  const name: string =
    typeof (error as Error).name === "string" ? (error as Error).name : "";
  const message: string =
    typeof (error as Error).message === "string"
      ? (error as Error).message
      : String(error);

  const text: string = `${name} ${message}`;

  return CHUNK_LOAD_ERROR_PATTERNS.some((pattern: RegExp) => {
    return pattern.test(text);
  });
};

export type HasRecentlyReloadedFunction = (now: number) => boolean;

/**
 * sessionStorage is unavailable in some privacy modes and throws on access, so
 * every read/write here is best-effort. Failing to read is treated as "we have
 * not reloaded yet" — one extra reload is better than a permanently broken page.
 */
export const hasRecentlyReloadedForChunkLoadError: HasRecentlyReloadedFunction =
  (now: number): boolean => {
    try {
      const lastReloadedAt: string | null = window.sessionStorage.getItem(
        CHUNK_LOAD_RELOAD_STORAGE_KEY,
      );

      if (!lastReloadedAt) {
        return false;
      }

      const lastReloadedAtInMs: number = Number(lastReloadedAt);

      if (!Number.isFinite(lastReloadedAtInMs)) {
        return false;
      }

      return now - lastReloadedAtInMs < CHUNK_LOAD_RELOAD_COOLDOWN_IN_MS;
    } catch {
      return false;
    }
  };

export type MarkChunkLoadErrorReloadFunction = (now: number) => void;

export const markChunkLoadErrorReload: MarkChunkLoadErrorReloadFunction = (
  now: number,
): void => {
  try {
    window.sessionStorage.setItem(
      CHUNK_LOAD_RELOAD_STORAGE_KEY,
      now.toString(),
    );
  } catch {
    // Storage is unavailable. The reload still happens, it just is not rate limited.
  }
};

export type ReloadPageFunction = () => void;

export const reloadPage: ReloadPageFunction = (): void => {
  window.location.reload();
};

/**
 * Recover from a stale-bundle error by reloading once. Returns true when a
 * reload was triggered, so the caller knows the fallback is only transient.
 */
export type HandleChunkLoadErrorFunction = (error: unknown) => boolean;

export const handleChunkLoadError: HandleChunkLoadErrorFunction = (
  error: unknown,
): boolean => {
  if (!isChunkLoadError(error)) {
    return false;
  }

  const now: number = Date.now();

  if (hasRecentlyReloadedForChunkLoadError(now)) {
    return false;
  }

  markChunkLoadErrorReload(now);
  reloadPage();

  return true;
};

/*
 * The fallback is styled with its own stylesheet rather than with the app's
 * Tailwind classes on purpose. One of the failures this boundary exists to
 * catch is a stale bundle whose CSS chunk 404s, and an error screen that
 * depends on the very stylesheet that failed is an unstyled error screen. The
 * tokens below read the shared theme variables when they are present (so the
 * card matches the dashboard, light or dark) and fall back to the same literal
 * values the design system uses when they are not.
 */
const ERROR_BOUNDARY_CSS: string = `
.oneuptime-error-boundary {
  --oueb-canvas: var(--ou-background-primary, #f9fafb);
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
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 60vh;
  padding: 3rem 1.5rem;
  background-color: var(--oueb-canvas);
  color: var(--oueb-text);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}

html.dark .oneuptime-error-boundary {
  --oueb-accent: #6366f1;
  --oueb-accent-hover: #818cf8;
  --oueb-accent-ring: rgb(129 140 248 / 55%);
  --oueb-danger-surface: rgb(153 27 27 / 22%);
  --oueb-danger-border: rgb(248 113 113 / 24%);
  --oueb-danger-icon: #fca5a5;
}

.oneuptime-error-boundary *,
.oneuptime-error-boundary *::before,
.oneuptime-error-boundary *::after {
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

.oueb-title {
  margin: 1.25rem 0 0;
  font-size: 1.125rem;
  font-weight: 600;
  line-height: 1.5rem;
  letter-spacing: -0.01em;
  color: var(--oueb-text);
}

.oueb-message {
  margin: 0.375rem 0 0;
  font-size: 0.875rem;
  line-height: 1.375rem;
  color: var(--oueb-text-muted);
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
  margin-left: -0.75rem;
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

  .oueb-details summary svg,
  .oueb-button {
    transition: none;
  }
}
`;

type SupportBundleStatusType = "success" | "error";

interface SupportBundleStatus {
  message: string;
  type: SupportBundleStatusType;
}

type GetIconFunction = (path: string) => ReactElement;

/* Heroicons outline paths, inlined so the fallback needs no icon bundle. */
const getIcon: GetIconFunction = (path: string): ReactElement => {
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

const ALERT_ICON_PATH: string =
  "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z";

const RELOAD_ICON_PATH: string =
  "M16.023 9.348h4.992V4.356m0 4.992-3.181-3.183a8.25 8.25 0 0 0-13.803 3.7M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7";

const DOWNLOAD_ICON_PATH: string =
  "M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3";

const MAIL_ICON_PATH: string =
  "M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75";

const CHEVRON_ICON_PATH: string = "m8.25 4.5 7.5 7.5-7.5 7.5";

/** Where a reviewed support bundle should be sent. */
export const SUPPORT_EMAIL: string = "support@oneuptime.com";

export const Fallback: FunctionComponent<FallbackComponentProps> = (
  props: FallbackComponentProps,
): ReactElement => {
  const [supportBundleStatus, setSupportBundleStatus] =
    useState<SupportBundleStatus | null>(null);
  const errorMessage: string =
    props.error && typeof props.error.message === "string"
      ? props.error.message
      : "";

  type DownloadSupportBundleFunction = () => void;

  const downloadSupportBundle: DownloadSupportBundleFunction = (): void => {
    setSupportBundleStatus(null);

    try {
      const capturedErrorDetails: CapturedErrorDetails | null =
        props.getCapturedErrorDetails?.(props.error) || null;

      downloadErrorSupportBundle({
        error: props.error,
        componentStack: capturedErrorDetails?.componentStack,
        digest: capturedErrorDetails?.digest,
        capturedAt: capturedErrorDetails?.capturedAt,
      });

      setSupportBundleStatus({
        type: "success",
        message:
          "Support bundle downloaded. Review it, then attach it to your email.",
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Unable to download the error support bundle:", error);
      setSupportBundleStatus({
        type: "error",
        message:
          "The support bundle could not be downloaded. Please try again.",
      });
    }
  };

  return (
    <div
      data-testid="error-boundary-fallback"
      className="oneuptime-error-boundary"
    >
      <style>{ERROR_BOUNDARY_CSS}</style>
      <div className="oueb-card">
        <div className="oueb-badge">{getIcon(ALERT_ICON_PATH)}</div>
        <div role="alert">
          <h1 className="oueb-title">Something went wrong</h1>
          <p className="oueb-message">
            An unexpected error has occurred. Please reload the page to continue
          </p>
        </div>
        <div className="oueb-actions">
          <button
            type="button"
            data-testid="error-boundary-reload"
            className="oueb-button oueb-button-primary"
            onClick={() => {
              reloadPage();
            }}
          >
            {getIcon(RELOAD_ICON_PATH)}
            Reload page
          </button>
          <button
            type="button"
            data-testid="error-boundary-try-again"
            className="oueb-button oueb-button-secondary"
            onClick={() => {
              props.resetErrorBoundary();
            }}
          >
            Try again
          </button>
        </div>
        <div className="oueb-support">
          <p className="oueb-support-title">Still stuck?</p>
          <p className="oueb-support-text">
            Download a local diagnostics file with the error stack, component
            stack, scrubbed page URL, browser details, and OneUptime build. It
            never reads cookies, saved browser data, or form contents. Review it
            before sharing it with OneUptime Support.
          </p>
          <div className="oueb-support-actions">
            <button
              type="button"
              data-testid="error-boundary-download-support-bundle"
              className="oueb-button oueb-button-ghost"
              onClick={downloadSupportBundle}
            >
              {getIcon(DOWNLOAD_ICON_PATH)}
              Download support bundle
            </button>
          </div>
          <p className="oueb-support-email">
            {getIcon(MAIL_ICON_PATH)}
            <span>
              Send it to{" "}
              <a
                className="oueb-link"
                data-testid="error-boundary-support-email"
                href={`mailto:${SUPPORT_EMAIL}`}
              >
                {SUPPORT_EMAIL}
              </a>
            </span>
          </p>
          <div
            role="status"
            data-testid="error-boundary-support-bundle-status"
            className={`oueb-status ${
              supportBundleStatus
                ? `oueb-status-${supportBundleStatus.type}`
                : ""
            }`}
          >
            {supportBundleStatus?.message || ""}
          </div>
        </div>
        {errorMessage ? (
          <details className="oueb-details">
            <summary>
              {getIcon(CHEVRON_ICON_PATH)}
              Error details
            </summary>
            <pre
              data-testid="error-boundary-error-message"
              className="oueb-error-message"
            >
              {errorMessage}
            </pre>
          </details>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

const ErrorBoundary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const capturedErrorDetailsRef: React.MutableRefObject<CapturedErrorDetails | null> =
    useRef<CapturedErrorDetails | null>(null);

  type OnErrorFunction = (error: Error, errorInfo: ErrorInfo) => void;

  const onError: OnErrorFunction = (
    error: Error,
    errorInfo: ErrorInfo,
  ): void => {
    capturedErrorDetailsRef.current = {
      error: error,
      componentStack: errorInfo.componentStack || null,
      digest: errorInfo.digest || null,
      capturedAt: new Date().toISOString(),
    };

    /*
     * Surface the error. Without this the only trace of a crash is the blank
     * screen itself, because the boundary swallows what React would otherwise
     * rethrow to window.onerror (and therefore to RUM).
     */
    // eslint-disable-next-line no-console
    console.error("Uncaught error rendering the app:", error);

    // A stale bundle recovers by reloading, so do that instead of blaming the user.
    handleChunkLoadError(error);

    props.onError?.(error, errorInfo);
  };

  const getCapturedErrorDetails: GetCapturedErrorDetailsFunction = (
    error: unknown,
  ): CapturedErrorDetails | null => {
    if (
      !capturedErrorDetailsRef.current ||
      !Object.is(capturedErrorDetailsRef.current.error, error)
    ) {
      return null;
    }

    return capturedErrorDetailsRef.current;
  };

  return (
    <NativeErrorBoundary
      fallbackRender={(fallbackProps: FallbackProps): ReactElement => {
        return (
          <Fallback
            {...fallbackProps}
            getCapturedErrorDetails={getCapturedErrorDetails}
          />
        );
      }}
      onError={onError}
      onReset={() => {
        capturedErrorDetailsRef.current = null;
      }}
      resetKeys={[props.resetKey]}
    >
      {props.children}
    </NativeErrorBoundary>
  );
};

export default ErrorBoundary;
