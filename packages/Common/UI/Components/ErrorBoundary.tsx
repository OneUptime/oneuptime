import { downloadErrorSupportBundle } from "../Utils/ErrorSupportBundle";
import { isChunkLoadError, reloadPage } from "../Utils/NewVersion/ChunkLoadError";
import NewVersion, { NewVersionAudience } from "../Utils/NewVersion/NewVersion";
import { Translator } from "../Utils/TranslateTemplate";
import useTranslator from "../Utils/UseTranslator";
import {
  ALERT_ICON_PATH,
  CHEVRON_ICON_PATH,
  DOWNLOAD_ICON_PATH,
  ERROR_SCREEN_CSS,
  MAIL_ICON_PATH,
  RELOAD_ICON_PATH,
  getIcon,
} from "./ErrorScreen/ErrorScreenStyle";
import ChunkLoadRecovery, {
  ChunkLoadRecoveryVariant,
} from "./NewVersion/ChunkLoadRecovery";
import TranslatedSentence from "./TranslatedSentence/TranslatedSentence";
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

/*
 * What a part of the app that will not download means, and how many times
 * the page reloads for it, live with the rest of the new-version handling
 * (Utils/NewVersion/ChunkLoadError). Exported from here too, where they were
 * first written.
 */
export {
  CHUNK_LOAD_RELOAD_COOLDOWN_IN_MS,
  CHUNK_LOAD_RELOAD_STORAGE_KEY,
  handleChunkLoadError,
  hasRecentlyReloadedForChunkLoadError,
  isChunkLoadError,
  markChunkLoadErrorReload,
  reloadPage,
} from "../Utils/NewVersion/ChunkLoadError";
export type {
  HandleChunkLoadErrorFunction,
  HasRecentlyReloadedFunction,
  IsChunkLoadErrorFunction,
  MarkChunkLoadErrorReloadFunction,
  ReloadPageFunction,
} from "../Utils/NewVersion/ChunkLoadError";

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
  /*
   * The screen's own words, for an error that has them (a page whose code
   * would not download even after reloading). "Something went wrong" when
   * not given.
   */
  title?: string | undefined;
  message?: string | undefined;
  // "Try again" draws the page again; pointless when that cannot help.
  showTryAgain?: boolean | undefined;
  /*
   * The support bundle and the address to send it to. Status pages and
   * public dashboards leave it out: their visitors have nobody at
   * OneUptime to send it to.
   */
  showSupport?: boolean | undefined;
}

type SupportBundleStatusType = "success" | "error";

interface SupportBundleStatus {
  message: string;
  type: SupportBundleStatusType;
}

/** Where a reviewed support bundle should be sent. */
export const SUPPORT_EMAIL: string = "support@oneuptime.com";

export const Fallback: FunctionComponent<FallbackComponentProps> = (
  props: FallbackComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
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
          translator.translateText(
            "Support bundle downloaded. Review it, then attach it to your email.",
          ) || "",
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Unable to download the error support bundle:", error);
      setSupportBundleStatus({
        type: "error",
        message:
          translator.translateText(
            "The support bundle could not be downloaded. Please try again.",
          ) || "",
      });
    }
  };

  return (
    <div
      data-testid="error-boundary-fallback"
      className="oneuptime-error-boundary"
    >
      <style>{ERROR_SCREEN_CSS}</style>
      <div className="oueb-card">
        <div className="oueb-badge">{getIcon(ALERT_ICON_PATH)}</div>
        <div role="alert">
          <h1 className="oueb-title" data-testid="error-boundary-title">
            {props.title || translator.translateText("Something went wrong")}
          </h1>
          <p className="oueb-message">
            {props.message ||
              translator.translateText(
                "An unexpected error has occurred. Please reload the page to continue",
              )}
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
            {translator.translateText("Reload page")}
          </button>
          {props.showTryAgain === false ? (
            <></>
          ) : (
            <button
              type="button"
              data-testid="error-boundary-try-again"
              className="oueb-button oueb-button-secondary"
              onClick={() => {
                props.resetErrorBoundary();
              }}
            >
              {translator.translateText("Try again")}
            </button>
          )}
        </div>
        {props.showSupport === false ? (
          <></>
        ) : (
          <div className="oueb-support">
            <p className="oueb-support-title">
              {translator.translateText("Still stuck?")}
            </p>
            <p className="oueb-support-text">
              {translator.translateText(
                "Download a local diagnostics file with the error stack, component stack, scrubbed page URL, browser details, and OneUptime build. It never reads cookies, saved browser data, or form contents. Review it before sharing it with OneUptime Support.",
              )}
            </p>
            <div className="oueb-support-actions">
              <button
                type="button"
                data-testid="error-boundary-download-support-bundle"
                className="oueb-button oueb-button-ghost"
                onClick={downloadSupportBundle}
              >
                {getIcon(DOWNLOAD_ICON_PATH)}
                {translator.translateText("Download support bundle")}
              </button>
            </div>
            <p className="oueb-support-email">
              {getIcon(MAIL_ICON_PATH)}
              <span>
                <TranslatedSentence
                  template="Send it to {{email}}"
                  slots={{
                    email: (
                      <a
                        className="oueb-link"
                        data-testid="error-boundary-support-email"
                        href={`mailto:${SUPPORT_EMAIL}`}
                      >
                        {SUPPORT_EMAIL}
                      </a>
                    ),
                  }}
                />
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
        )}
        {errorMessage ? (
          <details className="oueb-details">
            <summary>
              {getIcon(CHEVRON_ICON_PATH)}
              {translator.translateText("Error details")}
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

/*
 * The error screen for a page whose code would not download even after the
 * reload that should have fetched it: what happened, in plain words, with
 * Reload and - for the people who use OneUptime - the support bundle. Not
 * "Try again": that draws the same failed download again.
 */
const ChunkLoadFailedFallback: FunctionComponent<FallbackComponentProps> = (
  props: FallbackComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <Fallback
      {...props}
      title={translator.translateText("This page couldn't be loaded")}
      message={translator.translateText(
        "A file it needs couldn't be downloaded from the server. Try reloading in a moment.",
      )}
      showTryAgain={false}
      showSupport={NewVersion.getAudience() === NewVersionAudience.Members}
    />
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

    if (isChunkLoadError(error)) {
      /*
       * Usually a new version deployed under this tab, which
       * ChunkLoadRecovery moves the page onto. It logs an error of its own
       * when the part really is gone.
       */
      // eslint-disable-next-line no-console
      console.warn("A part of this page did not download:", error);
    } else {
      /*
       * Surface the error. Without this the only trace of a crash is the
       * blank screen itself, because the boundary swallows what React would
       * otherwise rethrow to window.onerror (and therefore to RUM).
       */
      // eslint-disable-next-line no-console
      console.error("Uncaught error rendering the app:", error);
    }

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
        if (isChunkLoadError(fallbackProps.error)) {
          const error: Error =
            fallbackProps.error instanceof Error
              ? fallbackProps.error
              : new Error(String(fallbackProps.error));

          return (
            <ChunkLoadRecovery
              error={error}
              variant={ChunkLoadRecoveryVariant.Page}
              renderFailed={(): ReactElement => {
                return (
                  <ChunkLoadFailedFallback
                    {...fallbackProps}
                    getCapturedErrorDetails={getCapturedErrorDetails}
                  />
                );
              }}
            />
          );
        }

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
