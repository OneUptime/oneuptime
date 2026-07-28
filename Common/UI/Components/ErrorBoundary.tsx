import React, { FunctionComponent, ReactElement, ReactNode } from "react";
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
  onError?: ((error: Error) => void) | undefined;
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

export const Fallback: FunctionComponent<FallbackProps> = (
  props: FallbackProps,
): ReactElement => {
  const errorMessage: string =
    props.error && typeof props.error.message === "string"
      ? props.error.message
      : "";

  return (
    <div
      role="alert"
      data-testid="error-boundary-fallback"
      style={{
        minHeight: "60vh",
        width: "100%",
        padding: "2rem",
        backgroundColor: "var(--ou-background-primary, #fdfdfd)",
        color: "var(--ou-text-primary, #111827)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: "32rem" }}>
        <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
          An unexpected error has occurred. Please reload the page to continue
        </div>
        <div
          style={{
            fontSize: "0.875rem",
            color: "var(--ou-text-secondary, #6b7280)",
            marginBottom: "1.25rem",
          }}
        >
          The rest of the app is still working. You can retry this page or
          reload to start fresh.
        </div>
        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            justifyContent: "center",
          }}
        >
          <button
            type="button"
            data-testid="error-boundary-try-again"
            onClick={() => {
              props.resetErrorBoundary();
            }}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.375rem",
              border: "1px solid var(--ou-border-primary, #d1d5db)",
              backgroundColor: "transparent",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <button
            type="button"
            data-testid="error-boundary-reload"
            onClick={() => {
              reloadPage();
            }}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.375rem",
              border: "1px solid transparent",
              backgroundColor: "var(--ou-brand-primary, #4f46e5)",
              color: "#ffffff",
              cursor: "pointer",
            }}
          >
            Reload page
          </button>
        </div>
        {errorMessage ? (
          <div
            data-testid="error-boundary-error-message"
            style={{
              marginTop: "1.25rem",
              fontSize: "0.75rem",
              color: "var(--ou-text-secondary, #6b7280)",
              wordBreak: "break-word",
            }}
          >
            {errorMessage}
          </div>
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
  type OnErrorFunction = (error: Error) => void;

  const onError: OnErrorFunction = (error: Error): void => {
    /*
     * Surface the error. Without this the only trace of a crash is the blank
     * screen itself, because the boundary swallows what React would otherwise
     * rethrow to window.onerror (and therefore to RUM).
     */
    // eslint-disable-next-line no-console
    console.error("Uncaught error rendering the app:", error);

    // A stale bundle recovers by reloading, so do that instead of blaming the user.
    handleChunkLoadError(error);

    props.onError?.(error);
  };

  return (
    <NativeErrorBoundary
      FallbackComponent={Fallback}
      onError={onError}
      resetKeys={[props.resetKey]}
    >
      {props.children}
    </NativeErrorBoundary>
  );
};

export default ErrorBoundary;
