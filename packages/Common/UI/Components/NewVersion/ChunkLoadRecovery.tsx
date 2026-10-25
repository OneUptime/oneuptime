import PageLoader from "../Loader/PageLoader";
import {
  ALERT_ICON_PATH,
  CLOUD_ICON_PATH,
  ERROR_SCREEN_CSS,
  OFFLINE_ICON_PATH,
  RELOAD_ICON_PATH,
  getIcon,
} from "../ErrorScreen/ErrorScreenStyle";
import {
  handleChunkLoadError,
  hasRecentlyReloadedForChunkLoadError,
  isPageBeingLeft,
  markChunkLoadErrorReload,
} from "../../Utils/NewVersion/ChunkLoadError";
import NewVersion, {
  NewVersionAudience,
} from "../../Utils/NewVersion/NewVersion";
import {
  ServerBuildCheckResult,
  ServerBuildStatus,
} from "../../Utils/NewVersion/ServerBuildCheck";
import UnsavedChanges from "../../Utils/NewVersion/UnsavedChanges";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * What a page shows when a part of its code will not download - in place of
 * "Something went wrong" and a sudden reload.
 *
 * The usual reason is a new version of OneUptime deployed while the tab was
 * open: the code this tab asks for belongs to the build before it. So it asks
 * the server first (NewVersion.probe), and then:
 *
 *   - the server serves another build: the page says it is loading the new
 *     version and reloads into the same address, scrolled back to where the
 *     reader was;
 *   - the server serves this build: the download was cut short, and one
 *     reload fetches it again - behind the page's own loader;
 *   - offline, or the server does not answer (restarting, the network
 *     down): it says so, and loads by itself once it can - never a reload
 *     into the browser's own error page;
 *   - the reader has unsaved changes: it asks before the reload that would
 *     lose them;
 *   - it reloaded for this less than half a minute ago and it still fails:
 *     the part is gone for good, and the page says it could not be loaded.
 *
 * The Page variant takes the whole page's place (the app's ErrorBoundary);
 * the Part variant takes one part's (ContainedErrorBoundary), and the rest
 * of the page stays.
 */

export enum ChunkLoadRecoveryVariant {
  Page = "page",
  Part = "part",
}

export enum ChunkLoadRecoveryStep {
  // Asking the server why: the page's own loader.
  Checking = "checking",
  // A new version: says so, and reloads into it.
  Updating = "updating",
  // This version: reloads once more, behind the loader.
  Reloading = "reloading",
  Offline = "offline",
  // The server does not answer, or cannot serve now.
  Unreachable = "unreachable",
  // A reload would load it, but would lose unsaved changes: asks first.
  NeedsReload = "needs-reload",
  // Reloaded already, and it still will not load.
  Failed = "failed",
}

export interface ChunkLoadRecoveryInput {
  isPageBeingLeft: boolean;
  isReloadInProgress: boolean;
  isOffline: boolean;
  // What the server said; null when this tab names no build to compare.
  check: ServerBuildCheckResult | null;
  hasRecentlyReloaded: boolean;
  hasUnsavedChanges: boolean;
}

export interface ChunkLoadRecoveryDecision {
  step: ChunkLoadRecoveryStep;
  // Whether to reload now.
  reload: boolean;
}

export const decideChunkLoadRecovery: (
  input: ChunkLoadRecoveryInput,
) => ChunkLoadRecoveryDecision = (
  input: ChunkLoadRecoveryInput,
): ChunkLoadRecoveryDecision => {
  // Leaving cut the download off: the next page is on its way.
  if (input.isPageBeingLeft) {
    return { step: ChunkLoadRecoveryStep.Checking, reload: false };
  }

  // Another part of the page is already reloading into the new version.
  if (input.isReloadInProgress) {
    return { step: ChunkLoadRecoveryStep.Updating, reload: false };
  }

  if (input.isOffline) {
    return { step: ChunkLoadRecoveryStep.Offline, reload: false };
  }

  const status: ServerBuildStatus | null = input.check?.status ?? null;

  if (
    status === ServerBuildStatus.Unreachable ||
    status === ServerBuildStatus.Unavailable
  ) {
    return { step: ChunkLoadRecoveryStep.Unreachable, reload: false };
  }

  // The server answers (or there is nothing to ask): a reload loads it.
  if (input.hasRecentlyReloaded) {
    return { step: ChunkLoadRecoveryStep.Failed, reload: false };
  }

  if (input.hasUnsavedChanges) {
    return { step: ChunkLoadRecoveryStep.NeedsReload, reload: false };
  }

  const isNewVersion: boolean =
    status === ServerBuildStatus.New || status === ServerBuildStatus.NoManifest;

  return {
    step: isNewVersion
      ? ChunkLoadRecoveryStep.Updating
      : ChunkLoadRecoveryStep.Reloading,
    reload: true,
  };
};

// How often a page whose server does not answer asks again.
export const CHUNK_LOAD_RETRY_INTERVAL_IN_MS: number = 10 * 1000;

export interface ComponentProps {
  error: Error;
  variant: ChunkLoadRecoveryVariant;
  /*
   * The Page variant, once a reload has not helped: the app's error screen,
   * worded for this (ErrorBoundary's Fallback). Without it, a card of the
   * same kind says the page could not be loaded.
   */
  renderFailed?: (() => ReactElement) | undefined;
  /*
   * The Part variant in a short part (a two-row dashboard tile): no icon,
   * as the part's own fallback drops it there, so the words and the button
   * fit inside it.
   */
  isCompact?: boolean | undefined;
}

const isBrowserOffline: () => boolean = (): boolean => {
  return typeof navigator !== "undefined" && navigator.onLine === false;
};

const isPageVisible: () => boolean = (): boolean => {
  return (
    typeof document === "undefined" || document.visibilityState !== "hidden"
  );
};

// The reader asked for the reload: once, into the same place.
const reloadNow: () => void = (): void => {
  markChunkLoadErrorReload(Date.now());
  NewVersion.reloadKeepingPlace();
};

interface CardCopy {
  title: string;
  message: string;
}

const ChunkLoadRecovery: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const translate: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const [step, setStep] = useState<ChunkLoadRecoveryStep>(
    ChunkLoadRecoveryStep.Checking,
  );
  const stepRef: React.MutableRefObject<ChunkLoadRecoveryStep> =
    useRef<ChunkLoadRecoveryStep>(ChunkLoadRecoveryStep.Checking);
  const isMounted: React.MutableRefObject<boolean> = useRef<boolean>(true);
  const runId: React.MutableRefObject<number> = useRef<number>(0);

  const isMembers: boolean =
    NewVersion.getAudience() === NewVersionAudience.Members;

  const showStep: (next: ChunkLoadRecoveryStep) => void = (
    next: ChunkLoadRecoveryStep,
  ): void => {
    stepRef.current = next;
    setStep(next);
  };

  const run: () => Promise<void> = useCallback(async (): Promise<void> => {
    runId.current++;
    const thisRun: number = runId.current;

    /*
     * Trying again from "offline" or "can't reach the server" keeps that
     * screen up while it asks, instead of flashing the loader every ten
     * seconds.
     */
    if (
      stepRef.current !== ChunkLoadRecoveryStep.Offline &&
      stepRef.current !== ChunkLoadRecoveryStep.Unreachable
    ) {
      showStep(ChunkLoadRecoveryStep.Checking);
    }

    const isOffline: boolean = isBrowserOffline();
    const shouldAsk: boolean =
      !isOffline && !isPageBeingLeft() && !NewVersion.isReloadInProgress();

    const check: ServerBuildCheckResult | null = shouldAsk
      ? await NewVersion.probe()
      : null;

    if (!isMounted.current || thisRun !== runId.current) {
      return;
    }

    const decision: ChunkLoadRecoveryDecision = decideChunkLoadRecovery({
      isPageBeingLeft: isPageBeingLeft(),
      isReloadInProgress: NewVersion.isReloadInProgress(),
      isOffline: isOffline || isBrowserOffline(),
      check: check,
      hasRecentlyReloaded: hasRecentlyReloadedForChunkLoadError(Date.now()),
      hasUnsavedChanges: UnsavedChanges.hasUnsavedChanges(),
    });

    showStep(decision.step);

    if (decision.reload && !handleChunkLoadError(props.error)) {
      // The page started to leave, or another part reloaded, meanwhile.
      showStep(
        NewVersion.isReloadInProgress()
          ? ChunkLoadRecoveryStep.Updating
          : ChunkLoadRecoveryStep.Failed,
      );
      return;
    }

    if (decision.step === ChunkLoadRecoveryStep.Failed) {
      // eslint-disable-next-line no-console
      console.error(
        "A part of this page could not be downloaded, even after reloading:",
        props.error,
      );
    }
  }, [props.error]);

  useEffect(() => {
    isMounted.current = true;
    void run();

    return () => {
      isMounted.current = false;
    };
  }, [run]);

  /*
   * A page that says it itself does not need the notice saying it too. One
   * part of a page leaves it: the notice speaks for the whole app.
   */
  useEffect(() => {
    if (props.variant !== ChunkLoadRecoveryVariant.Page) {
      return undefined;
    }

    return NewVersion.holdNotice();
  }, [props.variant]);

  // Offline, or no answer: load by itself as soon as it can.
  useEffect(() => {
    if (
      step !== ChunkLoadRecoveryStep.Offline &&
      step !== ChunkLoadRecoveryStep.Unreachable
    ) {
      return undefined;
    }

    const onOnline: () => void = (): void => {
      void run();
    };

    window.addEventListener("online", onOnline);

    const retry: ReturnType<typeof setInterval> | null =
      step === ChunkLoadRecoveryStep.Unreachable
        ? setInterval(() => {
            if (isPageVisible()) {
              void run();
            }
          }, CHUNK_LOAD_RETRY_INTERVAL_IN_MS)
        : null;

    return () => {
      window.removeEventListener("online", onOnline);

      if (retry) {
        clearInterval(retry);
      }
    };
  }, [step, run]);

  const retryButtonText: string =
    step === ChunkLoadRecoveryStep.Offline
      ? translate("Try again")
      : translate("Try now");

  const hasRetry: boolean =
    step === ChunkLoadRecoveryStep.Offline ||
    step === ChunkLoadRecoveryStep.Unreachable;

  const hasReload: boolean =
    step === ChunkLoadRecoveryStep.NeedsReload ||
    step === ChunkLoadRecoveryStep.Failed;

  const reloadButtonText: string = translate("Reload page");

  if (props.variant === ChunkLoadRecoveryVariant.Part) {
    const isLoading: boolean =
      step === ChunkLoadRecoveryStep.Checking ||
      step === ChunkLoadRecoveryStep.Reloading ||
      step === ChunkLoadRecoveryStep.Updating;

    let text: string = "";
    let iconPath: string = ALERT_ICON_PATH;
    /*
     * The circle's colour says which kind of moment it is: the accent while
     * the new version loads or waits for a reload, the amber a widget that
     * cannot be drawn shows (DashboardWidgetFallback) once it could not be
     * loaded, and a quiet grey while the network is away.
     */
    let toneClassName: string = "oueb-part-icon-info";

    if (step === ChunkLoadRecoveryStep.Updating) {
      text = translate("Loading the latest version...");
    } else if (isLoading) {
      text = translate("Loading...");
    } else if (step === ChunkLoadRecoveryStep.Offline) {
      text = translate(
        "You're offline. This will load when you're back online.",
      );
      iconPath = OFFLINE_ICON_PATH;
      toneClassName = "";
    } else if (step === ChunkLoadRecoveryStep.Unreachable) {
      text = translate("Can't reach the server. Trying again automatically.");
      iconPath = CLOUD_ICON_PATH;
      toneClassName = "";
    } else if (step === ChunkLoadRecoveryStep.NeedsReload) {
      text = translate(
        "This needs the latest version. Save your changes, then reload the page.",
      );
      iconPath = RELOAD_ICON_PATH;
    } else {
      text = translate("This couldn't be loaded.");
      toneClassName = "oueb-part-icon-warning";
    }

    /*
     * Small plain buttons, as a widget's own Try again: one part of a page
     * does not get the page's loudest button.
     */

    return (
      <div
        className="oueb-part"
        data-testid="chunk-load-recovery"
        data-variant={props.variant}
        data-step={step}
        role={step === ChunkLoadRecoveryStep.Failed ? "alert" : "status"}
        aria-live="polite"
      >
        <style>{ERROR_SCREEN_CSS}</style>
        <div className="oueb-part-body">
          {props.isCompact ? (
            <></>
          ) : (
            <span
              className={`oueb-part-icon ${toneClassName}`.trim()}
              data-testid="chunk-load-recovery-icon"
              aria-hidden="true"
            >
              {isLoading ? (
                <span className="oueb-spinner" />
              ) : (
                getIcon(iconPath)
              )}
            </span>
          )}
          <p className="oueb-part-text">{text}</p>
          {hasRetry || hasReload ? (
            <div className="oueb-part-actions">
              {hasRetry ? (
                <button
                  type="button"
                  className="oueb-button oueb-button-secondary oueb-button-small"
                  data-testid="chunk-load-recovery-retry"
                  onClick={() => {
                    void run();
                  }}
                >
                  {getIcon(RELOAD_ICON_PATH)}
                  {retryButtonText}
                </button>
              ) : (
                <></>
              )}
              {hasReload ? (
                <button
                  type="button"
                  className="oueb-button oueb-button-secondary oueb-button-small"
                  data-testid="chunk-load-recovery-reload"
                  onClick={reloadNow}
                >
                  {getIcon(RELOAD_ICON_PATH)}
                  {reloadButtonText}
                </button>
              ) : (
                <></>
              )}
            </div>
          ) : (
            <></>
          )}
        </div>
      </div>
    );
  }

  if (
    step === ChunkLoadRecoveryStep.Checking ||
    step === ChunkLoadRecoveryStep.Reloading
  ) {
    /*
     * The loader the page was showing while its code downloaded, so a quick
     * answer and a reload pass for one long load.
     */
    return (
      <div
        data-testid="chunk-load-recovery"
        data-variant={props.variant}
        data-step={step}
      >
        <PageLoader isVisible={true} />
      </div>
    );
  }

  if (step === ChunkLoadRecoveryStep.Failed && props.renderFailed) {
    return (
      <div
        data-testid="chunk-load-recovery"
        data-variant={props.variant}
        data-step={step}
      >
        {props.renderFailed()}
      </div>
    );
  }

  const getCopy: () => CardCopy = (): CardCopy => {
    if (step === ChunkLoadRecoveryStep.Updating) {
      return isMembers
        ? {
            title: translate("Updating to the new version"),
            message: translate(
              "OneUptime was updated while you had it open. This page will open in the new version in a moment.",
            ),
          }
        : {
            title: translate("Loading the latest version"),
            message: translate(
              "A newer version of this page is available. It's loading now.",
            ),
          };
    }

    if (step === ChunkLoadRecoveryStep.Offline) {
      return {
        title: translate("You're offline"),
        message: translate(
          "This page needs an internet connection to load. It will load as soon as you're back online.",
        ),
      };
    }

    if (step === ChunkLoadRecoveryStep.Unreachable) {
      return {
        title: translate("Can't reach the server"),
        message: translate(
          "It may be restarting after an update. This page will load as soon as the server is back.",
        ),
      };
    }

    if (step === ChunkLoadRecoveryStep.NeedsReload) {
      return {
        title: isMembers
          ? translate("A new version of OneUptime is ready")
          : translate("A newer version of this page is ready"),
        message: translate(
          "This page needs the new version to open. Reloading discards changes you haven't saved.",
        ),
      };
    }

    return {
      title: translate("This page couldn't be loaded"),
      message: translate(
        "A file it needs couldn't be downloaded from the server. Try reloading in a moment.",
      ),
    };
  };

  const copy: CardCopy = getCopy();

  const badgeClassName: string =
    step === ChunkLoadRecoveryStep.Updating ||
    step === ChunkLoadRecoveryStep.NeedsReload
      ? "oueb-badge oueb-badge-info"
      : step === ChunkLoadRecoveryStep.Failed
        ? "oueb-badge"
        : "oueb-badge oueb-badge-neutral";

  let badge: ReactElement = getIcon(ALERT_ICON_PATH);

  if (step === ChunkLoadRecoveryStep.Updating) {
    badge = <span className="oueb-spinner" />;
  } else if (step === ChunkLoadRecoveryStep.Offline) {
    badge = getIcon(OFFLINE_ICON_PATH);
  } else if (step === ChunkLoadRecoveryStep.Unreachable) {
    badge = getIcon(CLOUD_ICON_PATH);
  } else if (step === ChunkLoadRecoveryStep.NeedsReload) {
    badge = getIcon(RELOAD_ICON_PATH);
  }

  return (
    <div
      className="oneuptime-error-boundary"
      data-testid="chunk-load-recovery"
      data-variant={props.variant}
      data-step={step}
    >
      <style>{ERROR_SCREEN_CSS}</style>
      <div className="oueb-card">
        <div className={badgeClassName} aria-hidden="true">
          {badge}
        </div>
        <div
          role={step === ChunkLoadRecoveryStep.Failed ? "alert" : "status"}
          aria-live="polite"
        >
          <h1 className="oueb-title" data-testid="chunk-load-recovery-title">
            {copy.title}
          </h1>
          <p className="oueb-message">{copy.message}</p>
        </div>
        {hasRetry || hasReload ? (
          <div className="oueb-actions">
            {hasRetry ? (
              <button
                type="button"
                className="oueb-button oueb-button-primary"
                data-testid="chunk-load-recovery-retry"
                onClick={() => {
                  void run();
                }}
              >
                {getIcon(RELOAD_ICON_PATH)}
                {retryButtonText}
              </button>
            ) : (
              <></>
            )}
            {hasReload ? (
              <button
                type="button"
                className="oueb-button oueb-button-primary"
                data-testid="chunk-load-recovery-reload"
                onClick={reloadNow}
              >
                {getIcon(RELOAD_ICON_PATH)}
                {reloadButtonText}
              </button>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default ChunkLoadRecovery;
