import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import OneUptimeDate from "Common/Types/Date";
import { SessionReplayGap } from "Common/Types/Rum/SessionReplay";
import {
  REPLAY_BUFFERING_GRACE_MS,
  REPLAY_BUFFERING_RETRY_HINT_MS,
  ReplayEngineSnapshot,
  ReplayIdleBand,
  ReplayRecordedSize,
} from "./Engine/ReplayEngineTypes";
import { ReplaySignal } from "./Rail/ReplaySignalTypes";
import { ReplayStageFit } from "./ReplayStage";
import { ReplayHeaderTab, copyTextToClipboard } from "./ReplayHeader";
import {
  ReplayFootageAbsence,
  SessionReplayManifestChunk,
} from "./ReplayManifest";
import { formatReplayDuration, formatReplayOffset } from "./ReplayTimeFormat";
import { IDLE_SKIP_MIN_REMAINING_MS } from "./ReplayPlaybackIntent";
import { SealedReasonCopy } from "./FidelityNoticeCopy";

/*
 * Everything drawn OVER or AROUND the picture that is not the picture:
 * the URL bar above it (product-gap-6), the viewport chip with Fit / 1:1,
 * the idle chip, and the phase overlays - loading, seeking, buffering,
 * the gap interstitial, the idle-skip toast, the seek-clamped notice,
 * the ended card, the error card, and the "no footage" empty state.
 *
 * Every one of these used to be a block inserted ABOVE the stage, which
 * pushed the picture down mid-playback and could not be seen in theater
 * mode (player-shell-7, -10). They are positioned inside the stage box
 * now, announced through role=status, and rendered from the engine
 * snapshot's domain fields - never from a bare rrweb or HTTP string.
 *
 * The stage itself renders the sr-only data-testid="replay-phase" live
 * region; this file renders one only in the no-footage mode, where there
 * is no stage at all, so there is always exactly one on the page.
 */

export interface ReplayNavigationUrl {
  offsetMs: number;
  url: string;
}

export interface ReplayUrlAtPlayheadInput {
  /* Exact navigation moments from decoded chunks, any order. */
  navigations: Array<ReplayNavigationUrl>;
  /* Manifest chunk rows, whose `url` is known before decode. */
  chunks: Array<SessionReplayManifestChunk>;
  currentTimeMs: number;
  /* header.entryUrl, the seed before anything else is known. */
  entryUrl: string;
}

/*
 * The page the end user was on at the playhead. Exact navigation rows
 * win once their chunk is decoded; before that the chunk row's own URL
 * (stamped at flush time) is the best evidence; the entry URL seeds t=0.
 * Between a decoded navigation and a later undecoded chunk the LATER
 * evidence wins, because the user may have navigated inside the chunk
 * the player has not read yet.
 */
export function resolveUrlAtPlayhead(input: ReplayUrlAtPlayheadInput): string {
  let bestUrl: string = input.entryUrl || "";
  let bestOffsetMs: number = -1;

  for (const navigation of input.navigations) {
    if (
      navigation.url &&
      navigation.offsetMs <= input.currentTimeMs &&
      navigation.offsetMs >= bestOffsetMs
    ) {
      bestUrl = navigation.url;
      bestOffsetMs = navigation.offsetMs;
    }
  }

  for (const chunk of input.chunks) {
    if (
      chunk.url &&
      chunk.chunkStartOffsetMs <= input.currentTimeMs &&
      chunk.chunkStartOffsetMs > bestOffsetMs
    ) {
      bestUrl = chunk.url;
      bestOffsetMs = chunk.chunkStartOffsetMs;
    }
  }

  return bestUrl;
}

/* Navigation rows -> {offsetMs, url}; detail.to is the destination. */
export function navigationUrlsFromSignals(
  signals: Array<ReplaySignal>,
): Array<ReplayNavigationUrl> {
  const result: Array<ReplayNavigationUrl> = [];

  for (const signal of signals) {
    if (signal.kind !== "navigation") {
      continue;
    }

    const to: unknown = signal.detail["to"];

    if (typeof to === "string" && to.length > 0) {
      result.push({ offsetMs: signal.offsetMs, url: to });
    }
  }

  return result;
}

/* The idle / background-tab band the playhead is inside, if any. */
export function findIdleBandAt(
  bands: ReadonlyArray<ReplayIdleBand> | null | undefined,
  currentTimeMs: number,
): ReplayIdleBand | null {
  if (!bands) {
    return null;
  }

  for (const band of bands) {
    if (currentTimeMs >= band.startMs && currentTimeMs < band.endMs) {
      return band;
    }
  }

  return null;
}

/* Only a web URL gets an "open" link; a route path or a blank does not. */
const OPENABLE_URL_PATTERN: RegExp = /^https?:\/\//;

/* How long the gap interstitial and the idle-skip toast stay up. */
export const REPLAY_GAP_TOAST_MS: number = 2000;
export const REPLAY_IDLE_SKIP_TOAST_MS: number = 1500;

export interface ReplayStageOverlaysProps {
  snapshot: ReplayEngineSnapshot;
  /* The stage. Omitted in the no-footage mode (`absence` set). */
  children?: ReactNode;
  /* Recording rows for the URL bar (navigation kind). */
  signals: Array<ReplaySignal>;
  chunks: Array<SessionReplayManifestChunk>;
  entryUrl: string;

  /* Viewport chip: the recorded size and the scale the stage is drawing at. */
  recordedSize: ReplayRecordedSize | null;
  scale: number;
  fit: ReplayStageFit;
  onFitChange: (fit: ReplayStageFit) => void;

  onPlayPause: () => void;
  onWatchAgain: () => void;
  /* RETRY when the engine says retryable; the shell decides otherwise. */
  onRetry: () => void;
  /* "Still loading": re-seek the current offset when nothing is retryable. */
  onStillLoadingRetry: () => void;
  onSkipIdle: (band: ReplayIdleBand) => void;
  /* sessionId / tab / anchor / generation, for the "Copy diagnostic" action. */
  getDiagnostic: () => string;

  /* Set when the active tab has played out and another tab continues. */
  continueInTab?: ReplayHeaderTab | null | undefined;
  onSwitchTab?: ((tabId: string) => void) | undefined;

  /*
   * A shell-level transient notice ("Opened at the moment of the log
   * line"), drawn like the engine's own seek-clamped notice.
   */
  shellNotice?: string | null | undefined;
  /* No-footage mode: replaces the stage with an explained empty state. */
  absence?: ReplayFootageAbsence | null | undefined;
  sealedReason?: SealedReasonCopy | null | undefined;
  isLive?: boolean | undefined;
}

type BufferingStage = "hidden" | "pill" | "retry";

interface TransientToast<T> {
  value: T;
  /* Identity of the snapshot field that raised it, to dedupe. */
  source: T;
}

const PILL_CLASS: string =
  "pointer-events-auto inline-flex items-center gap-2 rounded-full bg-gray-900/85 px-3 py-1.5 text-xs font-medium text-white shadow-lg ring-1 ring-white/10";

/* ---- Absence copy. ---- */

interface AbsenceCopy {
  title: string;
  description: string;
  phaseWord: string;
}

function describeAbsence(
  absence: ReplayFootageAbsence,
  sealedReason: SealedReasonCopy | null | undefined,
): AbsenceCopy {
  switch (absence.kind) {
    case "expired": {
      const expiredOn: string | null =
        absence.expiresAtUnixMs !== null
          ? OneUptimeDate.getDateAsLocalFormattedString(
              new Date(absence.expiresAtUnixMs),
              true,
            )
          : null;
      const retention: string =
        absence.retentionDays !== null
          ? `after ${absence.retentionDays} day${
              absence.retentionDays === 1 ? "" : "s"
            } per your retention`
          : "under the application's retention";

      return {
        title: "Footage expired",
        description: `The recording expired ${retention}${
          expiredOn ? ` on ${expiredOn}` : ""
        }. The session's signals are still here: logs, traces and errors load in the rail, and the session facts are in Details.`,
        phaseWord: "expired",
      };
    }
    case "recording-lost":
      return {
        title: "Recording lost",
        description:
          sealedReason?.description ||
          "A recording existed but its chunks never landed, or expired before it could be finalized. Nothing from this session is playable; its logs, traces and errors still load in the rail.",
        phaseWord: "lost",
      };
    case "not-yet-uploaded":
      return {
        title: "Waiting for the first chunk",
        description:
          "This session is live and the recorder has not flushed any footage yet. The player checks for new chunks every 30 seconds and starts on its own when the first one lands.",
        phaseWord: "waiting",
      };
    case "none-stored":
    default:
      return {
        title: "No footage was stored",
        description:
          sealedReason?.description ||
          "The session was finalized without a single chunk. The signals in the rail are everything that remains of it.",
        phaseWord: "empty",
      };
  }
}

/* ---- Component. ---- */

const ReplayStageOverlays: FunctionComponent<ReplayStageOverlaysProps> = (
  props: ReplayStageOverlaysProps,
): ReactElement => {
  const { snapshot } = props;
  const { phase, currentTimeMs } = snapshot;

  /* ---- URL bar. ---- */

  const navigations: Array<ReplayNavigationUrl> = useMemo(() => {
    return navigationUrlsFromSignals(props.signals);
  }, [props.signals]);

  const currentUrl: string = useMemo(() => {
    return resolveUrlAtPlayhead({
      navigations: navigations,
      chunks: props.chunks,
      currentTimeMs: currentTimeMs,
      entryUrl: props.entryUrl,
    });
  }, [navigations, props.chunks, currentTimeMs, props.entryUrl]);

  const [isUrlCopied, setIsUrlCopied] = useState<boolean>(false);
  const urlCopiedTimerRef: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (urlCopiedTimerRef.current !== null) {
        clearTimeout(urlCopiedTimerRef.current);
      }
    };
  }, []);

  const handleCopyUrl: () => void = useCallback((): void => {
    void copyTextToClipboard(currentUrl).then((isCopied: boolean): void => {
      if (!isCopied) {
        return;
      }

      setIsUrlCopied(true);

      if (urlCopiedTimerRef.current !== null) {
        clearTimeout(urlCopiedTimerRef.current);
      }

      urlCopiedTimerRef.current = setTimeout((): void => {
        urlCopiedTimerRef.current = null;
        setIsUrlCopied(false);
      }, 2000);
    });
  }, [currentUrl]);

  /* ---- Buffering grace and retry hint. ---- */

  const isWaiting: boolean = phase === "buffering";
  const [bufferingStage, setBufferingStage] =
    useState<BufferingStage>("hidden");

  useEffect(() => {
    if (!isWaiting) {
      setBufferingStage("hidden");
      return;
    }

    /*
     * Nothing for 300ms so a fast chunk never flashes a pill; the pill
     * after that; and Retry after 8s of nothing arriving. Timed from when
     * THIS component saw the wait begin, which is within a render of the
     * engine's own bufferingSinceMs.
     */
    const pillTimer: ReturnType<typeof setTimeout> = setTimeout((): void => {
      setBufferingStage("pill");
    }, REPLAY_BUFFERING_GRACE_MS);
    const retryTimer: ReturnType<typeof setTimeout> = setTimeout((): void => {
      setBufferingStage("retry");
    }, REPLAY_BUFFERING_RETRY_HINT_MS);

    return () => {
      clearTimeout(pillTimer);
      clearTimeout(retryTimer);
    };
  }, [isWaiting]);

  /* ---- Transient toasts: gap interstitial, idle-skip. ---- */

  const [gapToast, setGapToast] =
    useState<TransientToast<SessionReplayGap> | null>(null);
  const lastGapRef: React.MutableRefObject<SessionReplayGap | null> =
    useRef<SessionReplayGap | null>(null);

  useEffect(() => {
    const gap: SessionReplayGap | null = snapshot.lastGap;

    if (!gap || gap === lastGapRef.current) {
      return;
    }

    lastGapRef.current = gap;
    setGapToast({ value: gap, source: gap });

    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
      setGapToast((current: TransientToast<SessionReplayGap> | null) => {
        return current && current.source === gap ? null : current;
      });
    }, REPLAY_GAP_TOAST_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [snapshot.lastGap]);

  const [idleToast, setIdleToast] =
    useState<TransientToast<ReplayIdleBand> | null>(null);
  const lastIdleSkipRef: React.MutableRefObject<ReplayIdleBand | null> =
    useRef<ReplayIdleBand | null>(null);

  useEffect(() => {
    const band: ReplayIdleBand | null = snapshot.lastIdleSkip;

    if (!band || band === lastIdleSkipRef.current) {
      return;
    }

    lastIdleSkipRef.current = band;
    setIdleToast({ value: band, source: band });

    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
      setIdleToast((current: TransientToast<ReplayIdleBand> | null) => {
        return current && current.source === band ? null : current;
      });
    }, REPLAY_IDLE_SKIP_TOAST_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [snapshot.lastIdleSkip]);

  /* ---- Diagnostic copy with a visible fallback. ---- */

  const [diagnosticText, setDiagnosticText] = useState<string | null>(null);
  const [isDiagnosticCopied, setIsDiagnosticCopied] = useState<boolean>(false);

  const handleCopyDiagnostic: () => void = useCallback((): void => {
    const text: string = props.getDiagnostic();

    void copyTextToClipboard(text).then((isCopied: boolean): void => {
      if (isCopied) {
        setIsDiagnosticCopied(true);
        setDiagnosticText(null);
      } else {
        setDiagnosticText(text);
      }
    });
  }, [props.getDiagnostic]);

  useEffect(() => {
    /* A new error resets the copied state so the button reads fresh. */
    setIsDiagnosticCopied(false);
    setDiagnosticText(null);
  }, [snapshot.error]);

  /* ---- Idle / background chip. ---- */

  const idleBand: ReplayIdleBand | null = useMemo(() => {
    return findIdleBandAt(snapshot.idleBands, currentTimeMs);
  }, [snapshot.idleBands, currentTimeMs]);

  const canSkipIdle: boolean =
    idleBand !== null &&
    idleBand.endMs - currentTimeMs >= IDLE_SKIP_MIN_REMAINING_MS &&
    (phase === "playing" || phase === "paused");

  /* ---- No-footage mode. ---- */

  if (props.absence) {
    const copy: AbsenceCopy = describeAbsence(
      props.absence,
      props.sealedReason,
    );

    return (
      <div
        data-testid="replay-overlay"
        data-replay-overlay="absent"
        className="relative w-full rounded-lg border border-gray-200 bg-gray-50"
      >
        <span
          data-testid="replay-phase"
          className="sr-only"
          aria-live="polite"
          aria-atomic="true"
        >
          {copy.phaseWord}
        </span>
        <div
          data-testid="replay-footage-absent"
          data-kind={props.absence.kind}
          role="status"
        >
          <EmptyState
            id="replay-footage-absent"
            icon={
              props.absence.kind === "not-yet-uploaded"
                ? IconProp.Clock
                : IconProp.VideoCameraSlash
            }
            title={copy.title}
            description={copy.description}
            paddingClassName="pt-16 pb-16"
            footer={
              props.sealedReason && props.absence.kind !== "recording-lost" ? (
                <p
                  className="text-xs text-gray-500"
                  data-testid="replay-footage-absent-sealed"
                >
                  {props.sealedReason.title}: {props.sealedReason.description}
                </p>
              ) : undefined
            }
          />
        </div>
      </div>
    );
  }

  /* ---- Phase overlay, by precedence. ---- */

  let centreOverlay: ReactElement | null = null;

  if (phase === "error" && snapshot.error) {
    centreOverlay = (
      <div
        data-testid="replay-overlay-error"
        role="alert"
        className="pointer-events-auto max-w-md rounded-lg bg-white p-4 text-left shadow-xl ring-1 ring-rose-200"
      >
        <div className="flex items-start gap-2">
          <Icon
            icon={IconProp.ErrorSolid}
            className="mt-0.5 h-4 w-4 shrink-0 text-rose-600"
          />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900">
              Playback stopped
            </div>
            <p className="mt-1 text-xs text-gray-700">
              {snapshot.error.message}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {snapshot.error.retryable && (
            <button
              type="button"
              data-testid="replay-overlay-retry"
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
              onClick={props.onRetry}
            >
              Retry
            </button>
          )}
          <button
            type="button"
            data-testid="replay-overlay-copy-diagnostic"
            className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
            onClick={handleCopyDiagnostic}
          >
            {isDiagnosticCopied ? "Diagnostic copied" : "Copy diagnostic"}
          </button>
        </div>
        {diagnosticText !== null && (
          <textarea
            readOnly={true}
            aria-label="Diagnostic details"
            data-testid="replay-overlay-diagnostic-text"
            className="mt-2 h-24 w-full rounded border border-gray-300 p-1 font-mono text-[10px] text-gray-700"
            value={diagnosticText}
            onFocus={(event: React.FocusEvent<HTMLTextAreaElement>): void => {
              event.currentTarget.select();
            }}
          />
        )}
      </div>
    );
  } else if (phase === "loading") {
    centreOverlay = (
      <div
        data-testid="replay-overlay-loading"
        role="status"
        className={PILL_CLASS}
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
        Loading footage
      </div>
    );
  } else if (phase === "seeking") {
    centreOverlay = (
      <div
        data-testid="replay-overlay-seeking"
        role="status"
        className={PILL_CLASS}
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
        Seeking to {formatReplayOffset(snapshot.pendingSeekMs ?? currentTimeMs)}
      </div>
    );
  } else if (phase === "buffering" && bufferingStage !== "hidden") {
    const waitingCopy: string =
      snapshot.buffer === "stalled"
        ? "Waiting for the next footage"
        : "Buffering";

    centreOverlay = (
      <div
        data-testid="replay-overlay-buffering"
        data-stage={bufferingStage}
        role="status"
        className={PILL_CLASS}
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
        {bufferingStage === "retry" ? (
          <span className="inline-flex items-center gap-2">
            Still loading
            <button
              type="button"
              data-testid="replay-overlay-still-loading-retry"
              className="rounded bg-white/15 px-2 py-0.5 text-[11px] font-semibold hover:bg-white/25"
              onClick={props.onStillLoadingRetry}
            >
              Retry
            </button>
          </span>
        ) : (
          waitingCopy
        )}
      </div>
    );
  } else if (gapToast) {
    centreOverlay = (
      <div
        data-testid="replay-overlay-gap"
        role="status"
        className={`${PILL_CLASS} bg-amber-900/85`}
      >
        <Icon icon={IconProp.Forward} className="h-3.5 w-3.5" />
        Skipped {formatReplayDuration(gapToast.value.missingMs)} - the recorder
        never delivered this stretch
      </div>
    );
  } else if (idleToast) {
    centreOverlay = (
      <div
        data-testid="replay-overlay-idle-skip"
        role="status"
        className={PILL_CLASS}
      >
        <Icon icon={IconProp.Forward} className="h-3.5 w-3.5" />
        Skipped{" "}
        {formatReplayDuration(
          idleToast.value.endMs - idleToast.value.startMs,
        )}{" "}
        {idleToast.value.kind === "background-tab"
          ? "in the background"
          : "idle"}
      </div>
    );
  } else if (phase === "ended") {
    centreOverlay = (
      <div
        data-testid="replay-overlay-ended"
        role="status"
        className="pointer-events-auto rounded-lg bg-white p-4 text-center shadow-xl ring-1 ring-gray-200"
      >
        <div className="text-sm font-semibold text-gray-900">Replay ended</div>
        <p className="mt-1 text-xs text-gray-600">
          {formatReplayDuration(snapshot.durationMs)} of footage played out.
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            data-testid="replay-watch-again"
            className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
            onClick={props.onWatchAgain}
          >
            <Icon icon={IconProp.Refresh} className="h-3.5 w-3.5" />
            Watch again
          </button>
          {props.continueInTab && props.onSwitchTab && (
            <button
              type="button"
              data-testid="replay-ended-continue-in-tab"
              className="inline-flex items-center gap-1 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
              onClick={(): void => {
                props.onSwitchTab?.(props.continueInTab?.tabId ?? "");
              }}
            >
              <Icon icon={IconProp.ArrowRight} className="h-3.5 w-3.5" />
              Continue in {props.continueInTab.label}
            </button>
          )}
        </div>
      </div>
    );
  } else if (phase === "paused") {
    centreOverlay = (
      <button
        type="button"
        data-testid="replay-overlay-paused"
        className="pointer-events-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-gray-900/70 text-white shadow-lg ring-1 ring-white/20 hover:bg-gray-900/85"
        title="Play (Space)"
        aria-label="Play"
        onClick={props.onPlayPause}
      >
        <Icon icon={IconProp.Play} className="h-5 w-5" />
      </button>
    );
  }

  const viewportLabel: string | null = props.recordedSize
    ? `${props.recordedSize.width}x${props.recordedSize.height}`
    : null;
  const scalePercent: number = Math.round(props.scale * 100);

  return (
    <div
      data-testid="replay-overlay"
      data-replay-overlay={phase}
      className="relative flex w-full flex-col"
    >
      {/* URL bar: lock icon, the page at the playhead, copy, open. */}
      <div
        data-testid="replay-url-bar"
        className="mb-1.5 flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs"
      >
        <Icon
          icon={
            currentUrl.startsWith("https://") ? IconProp.Lock : IconProp.Globe
          }
          className="h-3.5 w-3.5 shrink-0 text-gray-400"
        />
        <span
          className="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-700"
          title={currentUrl || "No page URL is known yet"}
          data-testid="replay-url-text"
        >
          {currentUrl || "URL not recorded yet"}
        </span>
        {currentUrl && (
          <button
            type="button"
            data-testid="replay-url-copy"
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-200 hover:text-gray-800"
            title="Copy the URL"
            onClick={handleCopyUrl}
          >
            {isUrlCopied ? "Copied" : "Copy"}
          </button>
        )}
        {currentUrl && OPENABLE_URL_PATTERN.test(currentUrl) && (
          <a
            href={currentUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="replay-url-open"
            className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-200 hover:text-gray-800"
            title="Open the page in a new tab"
          >
            <Icon icon={IconProp.ExternalLink} className="h-3 w-3" />
            open
          </a>
        )}
        {viewportLabel && (
          <span
            data-testid="replay-viewport-chip"
            className="inline-flex shrink-0 items-center gap-1 rounded bg-white px-1.5 py-0.5 text-[11px] tabular-nums text-gray-600 ring-1 ring-inset ring-gray-200"
            title="Recorded viewport and the scale it is drawn at"
          >
            {viewportLabel}
            {props.fit === "contain" && (
              <span className="text-gray-400">-&gt; {scalePercent}%</span>
            )}
          </span>
        )}
        <span
          role="group"
          aria-label="Stage fit"
          className="inline-flex shrink-0 overflow-hidden rounded ring-1 ring-inset ring-gray-200"
          data-testid="replay-fit-toggle"
        >
          <button
            type="button"
            aria-pressed={props.fit === "contain"}
            className={`px-1.5 py-0.5 text-[11px] ${
              props.fit === "contain"
                ? "bg-indigo-50 text-indigo-800"
                : "bg-white text-gray-500 hover:bg-gray-100"
            }`}
            title="Scale the picture to fit the stage"
            onClick={(): void => {
              props.onFitChange("contain");
            }}
          >
            Fit
          </button>
          <button
            type="button"
            aria-pressed={props.fit === "actual"}
            className={`px-1.5 py-0.5 text-[11px] ${
              props.fit === "actual"
                ? "bg-indigo-50 text-indigo-800"
                : "bg-white text-gray-500 hover:bg-gray-100"
            }`}
            title="Draw the picture at its recorded size"
            onClick={(): void => {
              props.onFitChange("actual");
            }}
          >
            1:1
          </button>
        </span>
      </div>

      <div className="relative">
        {props.children}

        {/* Top strip: idle chip, background-tab chip, seek-clamped notice. */}
        <div className="pointer-events-none absolute left-2 right-2 top-2 flex flex-wrap items-start gap-2">
          {idleBand && (
            <button
              type="button"
              data-testid={
                idleBand.kind === "background-tab"
                  ? "replay-background-tab-chip"
                  : "replay-idle-chip"
              }
              data-fidelity={idleBand.fidelity}
              disabled={!canSkipIdle}
              className={`${PILL_CLASS} ${
                canSkipIdle ? "hover:bg-gray-900" : "cursor-default opacity-90"
              }`}
              title={
                canSkipIdle
                  ? "Skip past this stretch (s)"
                  : "The stretch ends in under two seconds"
              }
              onClick={(): void => {
                if (canSkipIdle) {
                  props.onSkipIdle(idleBand);
                }
              }}
            >
              <Icon icon={IconProp.Clock} className="h-3.5 w-3.5" />
              {idleBand.kind === "background-tab"
                ? `Tab was in the background for ${formatReplayDuration(
                    idleBand.endMs - idleBand.startMs,
                  )}`
                : `Idle ${formatReplayDuration(
                    idleBand.endMs - idleBand.startMs,
                  )}${idleBand.fidelity === "coarse" ? " (approx.)" : ""}`}
              {canSkipIdle && (
                <span className="text-indigo-200">skip &gt;</span>
              )}
            </button>
          )}

          {snapshot.notice && (
            <span
              data-testid="replay-overlay-notice"
              role="status"
              className={`${PILL_CLASS} bg-amber-900/85`}
            >
              <Icon icon={IconProp.Info} className="h-3.5 w-3.5" />
              {snapshot.notice.message}
            </span>
          )}

          {props.shellNotice && (
            <span
              data-testid="replay-overlay-shell-notice"
              role="status"
              className={PILL_CLASS}
            >
              <Icon icon={IconProp.Info} className="h-3.5 w-3.5" />
              {props.shellNotice}
            </span>
          )}

          {props.isLive && phase === "ended" && (
            <span role="status" className={PILL_CLASS}>
              Caught up with the live recording
            </span>
          )}
        </div>

        {/* Centre overlay, one at a time. */}
        {centreOverlay && (
          <div
            className={`pointer-events-none absolute inset-0 flex items-center justify-center ${
              phase === "seeking" || phase === "error" ? "bg-gray-900/40" : ""
            }`}
          >
            {centreOverlay}
          </div>
        )}
      </div>
    </div>
  );
};

export default ReplayStageOverlays;
