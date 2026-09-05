import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import useComponentOutsideClick from "Common/UI/Types/UseComponentOutsideClick";
import {
  REPLAY_BUFFERING_GRACE_MS,
  REPLAY_BUFFERING_RETRY_HINT_MS,
  ReplayPhase,
} from "./Engine/ReplayEngineTypes";
import { REPLAY_KEY_SEEK_JL_MS } from "./ReplayKeyboardMap";
import { formatReplayClock, formatReplayOffset } from "./ReplayTimeFormat";

/*
 * The controls row: play/pause, the clock, -10s/+10s, speed, skip idle,
 * prev/next error, next frustration, the "?" sheet and the overflow menu.
 *
 * Every button reflects the engine's PHASE, not a boolean: "Play" while
 * paused, "Pause" while playing or buffering, "Watch again" when ended,
 * "Retry" on error, disabled with "Loading footage" before the first
 * chunk. That is what keeps the button honest when the engine is between
 * states - a viewer who pressed Play and sees "Pause" plus a buffering
 * pill knows the press landed.
 */

/*
 * 1.5x and 3x are the two most-used speeds in every comparable product
 * and were missing; sub-1x speeds exist for the moments engineers scrub
 * for - a flash of wrong UI, a race visible for three frames. The array
 * is the source of truth for the "<" and ">" keys as well.
 */
export const REPLAY_SPEEDS: Array<number> = [0.25, 0.5, 1, 1.5, 2, 3, 4, 8];

export function formatReplaySpeed(speed: number): string {
  return `${speed}x`;
}

/* The nearest listed speed, so a persisted odd value still maps to a step. */
export function getReplaySpeedIndex(speed: number): number {
  let bestIndex: number = 0;
  let bestDistance: number = Number.POSITIVE_INFINITY;

  REPLAY_SPEEDS.forEach((candidate: number, index: number): void => {
    const distance: number = Math.abs(candidate - speed);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
}

export function stepReplaySpeed(speed: number, direction: 1 | -1): number {
  const index: number = getReplaySpeedIndex(speed);
  const nextIndex: number = Math.min(
    REPLAY_SPEEDS.length - 1,
    Math.max(0, index + direction),
  );

  return REPLAY_SPEEDS[nextIndex] ?? speed;
}

export interface ReplayControlsProps {
  phase: ReplayPhase;
  currentTimeMs: number;
  durationMs: number;
  speed: number;
  isSkipInactiveEnabled: boolean;
  /* Seeking target while phase is "seeking", for the pill copy. */
  pendingSeekMs?: number | null | undefined;
  /* Domain copy for phase "error"; never a bare library string. */
  errorMessage?: string | null | undefined;
  hasPrevError: boolean;
  hasNextError: boolean;
  hasNextFrustration: boolean;
  isFollowEnabled?: boolean | undefined;
  isMouseTrailEnabled?: boolean | undefined;

  onPlayPause: () => void;
  onSeekRelative: (deltaMs: number) => void;
  onSpeedChange: (speed: number) => void;
  onSkipInactiveChange: (isEnabled: boolean) => void;
  onPrevError: () => void;
  onNextError: () => void;
  onNextFrustration: () => void;
  onShowShortcuts: () => void;
  onRetry?: (() => void) | undefined;
  onFollowChange?: ((isEnabled: boolean) => void) | undefined;
  onMouseTrailChange?: ((isEnabled: boolean) => void) | undefined;
}

type BufferingStage = "hidden" | "pill" | "retry";

const SMALL_BUTTON_CLASS: string =
  "inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium ring-1 ring-inset transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
const SMALL_BUTTON_ENABLED_CLASS: string =
  "bg-white text-gray-700 ring-gray-300 hover:bg-gray-50";
const SMALL_BUTTON_DISABLED_CLASS: string =
  "cursor-not-allowed bg-gray-50 text-gray-300 ring-gray-200";

interface PlayButtonCopy {
  label: string;
  icon: IconProp;
  isDisabled: boolean;
}

function getPlayButtonCopy(phase: ReplayPhase): PlayButtonCopy {
  switch (phase) {
    case "loading":
      return {
        label: "Loading footage",
        icon: IconProp.Play,
        isDisabled: true,
      };
    case "seeking":
    case "paused":
      return { label: "Play (Space)", icon: IconProp.Play, isDisabled: false };
    case "buffering":
    case "playing":
      return {
        label: "Pause (Space)",
        icon: IconProp.Pause,
        isDisabled: false,
      };
    case "ended":
      return {
        label: "Watch again (Space)",
        icon: IconProp.Refresh,
        isDisabled: false,
      };
    case "error":
      return { label: "Retry", icon: IconProp.Refresh, isDisabled: false };
    default: {
      const unreachable: never = phase;
      return unreachable;
    }
  }
}

const ReplayControls: FunctionComponent<ReplayControlsProps> = (
  props: ReplayControlsProps,
): ReactElement => {
  const {
    phase,
    currentTimeMs,
    durationMs,
    speed,
    onPlayPause,
    onRetry,
    onSeekRelative,
    onSpeedChange,
  } = props;

  const isWaiting: boolean =
    phase === "buffering" || phase === "seeking" || phase === "loading";

  /*
   * Buffering shows nothing for the first 300ms so a fast fetch never
   * flashes a pill, then an indigo pulse, then after 8s the pulse offers
   * Retry. Timed from when THIS component saw the wait begin; the engine's
   * clock is not needed for a 300ms grace.
   */
  const [bufferingStage, setBufferingStage] =
    useState<BufferingStage>("hidden");

  useEffect(() => {
    if (!isWaiting) {
      setBufferingStage("hidden");
      return;
    }

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

  const playCopy: PlayButtonCopy = getPlayButtonCopy(phase);

  const handlePlayClick: () => void = useCallback((): void => {
    if (phase === "error" && onRetry) {
      onRetry();
      return;
    }

    onPlayPause();
  }, [phase, onPlayPause, onRetry]);

  /* ---- Speed: a compact trigger opening a radiogroup (finding 21). ---- */

  const {
    ref: speedRef,
    isComponentVisible: isSpeedOpen,
    setIsComponentVisible: setIsSpeedOpen,
  } = useComponentOutsideClick(false);
  const speedTriggerRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  const speedRadioRefs: React.MutableRefObject<
    Array<HTMLButtonElement | null>
  > = useRef<Array<HTMLButtonElement | null>>([]);

  const selectSpeed: (value: number) => void = useCallback(
    (value: number): void => {
      onSpeedChange(value);
    },
    [onSpeedChange],
  );

  const closeSpeed: (shouldRefocusTrigger: boolean) => void = useCallback(
    (shouldRefocusTrigger: boolean): void => {
      setIsSpeedOpen(false);

      if (shouldRefocusTrigger && speedTriggerRef.current) {
        speedTriggerRef.current.focus();
      }
    },
    [setIsSpeedOpen],
  );

  /*
   * Arrow keys move the checked radio (the WAI-ARIA radiogroup pattern:
   * selection follows focus), Escape returns to the trigger.
   */
  const handleSpeedKeyDown: (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => void = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      const currentIndex: number = getReplaySpeedIndex(speed);
      let nextIndex: number | null = null;

      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        nextIndex = Math.min(REPLAY_SPEEDS.length - 1, currentIndex + 1);
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        nextIndex = Math.max(0, currentIndex - 1);
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = REPLAY_SPEEDS.length - 1;
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeSpeed(true);
        return;
      } else {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const nextSpeed: number | undefined = REPLAY_SPEEDS[nextIndex];

      if (nextSpeed !== undefined) {
        selectSpeed(nextSpeed);
        speedRadioRefs.current[nextIndex]?.focus();
      }
    },
    [speed, selectSpeed, closeSpeed],
  );

  useEffect(() => {
    if (isSpeedOpen) {
      speedRadioRefs.current[getReplaySpeedIndex(speed)]?.focus();
    }
    /*
     * Only on open: re-focusing on every speed change would yank focus
     * from the trigger when the ">" key changes speed with the menu shut.
     */
  }, [isSpeedOpen]);

  const isPaused: boolean = phase !== "playing" && phase !== "buffering";

  const hasOverflow: boolean = Boolean(
    props.onFollowChange || props.onMouseTrailChange,
  );

  const seekBack: () => void = useCallback((): void => {
    onSeekRelative(-REPLAY_KEY_SEEK_JL_MS);
  }, [onSeekRelative]);

  const seekForward: () => void = useCallback((): void => {
    onSeekRelative(REPLAY_KEY_SEEK_JL_MS);
  }, [onSeekRelative]);

  const canSeek: boolean = phase !== "loading" && phase !== "error";

  let waitingCopy: string = "Loading footage";

  if (phase === "seeking") {
    waitingCopy = `Seeking to ${formatReplayOffset(
      props.pendingSeekMs ?? currentTimeMs,
    )}`;
  } else if (phase === "loading") {
    waitingCopy = "Loading the first footage";
  }

  return (
    <div
      data-testid="replay-controls"
      className="flex flex-wrap items-center gap-2"
    >
      <button
        type="button"
        data-testid="replay-play-pause"
        data-phase={phase}
        disabled={playCopy.isDisabled}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 ${
          playCopy.isDisabled
            ? "cursor-not-allowed bg-indigo-300"
            : phase === "error"
              ? "bg-rose-600 hover:bg-rose-700"
              : "bg-indigo-600 hover:bg-indigo-700"
        }`}
        onClick={handlePlayClick}
        aria-label={playCopy.label}
        title={playCopy.label}
      >
        <Icon icon={playCopy.icon} className="h-4 w-4" />
      </button>

      <div
        data-testid="replay-time"
        className="font-mono text-xs tabular-nums text-gray-700"
        aria-live="off"
      >
        {formatReplayClock(currentTimeMs, durationMs, isPaused)}
      </div>

      <div className="inline-flex items-center gap-1">
        <button
          type="button"
          data-testid="replay-seek-back"
          disabled={!canSeek}
          className={`${SMALL_BUTTON_CLASS} ${
            canSeek ? SMALL_BUTTON_ENABLED_CLASS : SMALL_BUTTON_DISABLED_CLASS
          }`}
          onClick={seekBack}
          aria-label="Back 10 seconds (J)"
          title="Back 10 seconds (J)"
        >
          <Icon icon={IconProp.Backward} className="h-3.5 w-3.5" />
          10s
        </button>
        <button
          type="button"
          data-testid="replay-seek-forward"
          disabled={!canSeek}
          className={`${SMALL_BUTTON_CLASS} ${
            canSeek ? SMALL_BUTTON_ENABLED_CLASS : SMALL_BUTTON_DISABLED_CLASS
          }`}
          onClick={seekForward}
          aria-label="Forward 10 seconds (L)"
          title="Forward 10 seconds (L)"
        >
          10s
          <Icon icon={IconProp.Forward} className="h-3.5 w-3.5" />
        </button>
      </div>

      <div ref={speedRef} className="relative">
        <button
          ref={speedTriggerRef}
          type="button"
          data-testid="replay-speed"
          aria-haspopup="true"
          aria-expanded={isSpeedOpen}
          aria-label={`Playback speed ${formatReplaySpeed(speed)}`}
          title="Playback speed (< slower, > faster)"
          className={`${SMALL_BUTTON_CLASS} ${SMALL_BUTTON_ENABLED_CLASS} min-w-[3.25rem] justify-center tabular-nums`}
          onClick={(): void => {
            setIsSpeedOpen(!isSpeedOpen);
          }}
        >
          {formatReplaySpeed(speed)}
        </button>

        {isSpeedOpen && (
          <div
            role="radiogroup"
            aria-label="Playback speed"
            data-testid="replay-speed-menu"
            className="absolute left-0 z-20 mt-1 flex min-w-[5rem] flex-col rounded-md border border-gray-200 bg-white py-1 shadow-lg"
            onKeyDown={handleSpeedKeyDown}
          >
            {REPLAY_SPEEDS.map((value: number, index: number): ReactElement => {
              const isChecked: boolean = getReplaySpeedIndex(speed) === index;

              return (
                <button
                  key={value}
                  ref={(element: HTMLButtonElement | null): void => {
                    speedRadioRefs.current[index] = element;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={isChecked}
                  tabIndex={isChecked ? 0 : -1}
                  data-testid={`replay-speed-option-${value}`}
                  className={`px-3 py-1 text-left text-xs tabular-nums focus:outline-none focus-visible:bg-indigo-50 ${
                    isChecked
                      ? "bg-indigo-50 font-semibold text-indigo-700"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                  onClick={(): void => {
                    selectSpeed(value);
                    closeSpeed(true);
                  }}
                >
                  {formatReplaySpeed(value)}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/*
       * Off by default; see DEFAULT_SKIP_INACTIVE. Idle stretches are
       * drawn on the track and every skip shows a toast, so a jump is
       * never mistaken for a bug.
       */}
      <div
        className="inline-flex items-center"
        title="Jump past stretches with no user input. Each skip is announced and the idle stretch is drawn on the track."
      >
        <Toggle
          value={props.isSkipInactiveEnabled}
          onChange={props.onSkipInactiveChange}
          title="Skip idle"
          dataTestId="replay-skip-idle"
        />
      </div>

      <div
        className="inline-flex items-center gap-1"
        role="group"
        aria-label="Jump between signals"
      >
        <button
          type="button"
          data-testid="replay-prev-error"
          disabled={!props.hasPrevError}
          className={`${SMALL_BUTTON_CLASS} ${
            props.hasPrevError
              ? "bg-white text-rose-700 ring-rose-200 hover:bg-rose-50"
              : SMALL_BUTTON_DISABLED_CLASS
          }`}
          onClick={props.onPrevError}
          aria-label="Previous error (Shift+E)"
          title={
            props.hasPrevError
              ? "Previous error (Shift+E)"
              : "No error before the playhead"
          }
        >
          <Icon icon={IconProp.ChevronLeft} className="h-3 w-3" />
          <Icon icon={IconProp.Alert} className="h-3 w-3" />
        </button>
        <button
          type="button"
          data-testid="replay-next-error"
          disabled={!props.hasNextError}
          className={`${SMALL_BUTTON_CLASS} ${
            props.hasNextError
              ? "bg-white text-rose-700 ring-rose-200 hover:bg-rose-50"
              : SMALL_BUTTON_DISABLED_CLASS
          }`}
          onClick={props.onNextError}
          aria-label="Next error (E)"
          title={
            props.hasNextError
              ? "Next error (E)"
              : "No error after the playhead"
          }
        >
          <Icon icon={IconProp.Alert} className="h-3 w-3" />
          Next error
        </button>
        <button
          type="button"
          data-testid="replay-next-frustration"
          disabled={!props.hasNextFrustration}
          className={`${SMALL_BUTTON_CLASS} ${
            props.hasNextFrustration
              ? "bg-white text-amber-700 ring-amber-200 hover:bg-amber-50"
              : SMALL_BUTTON_DISABLED_CLASS
          }`}
          onClick={props.onNextFrustration}
          aria-label="Next frustration (N)"
          title={
            props.hasNextFrustration
              ? "Next frustration (N)"
              : "No rage, dead or error click after the playhead"
          }
        >
          <Icon icon={IconProp.CursorArrowRays} className="h-3 w-3" />
          Frustration
        </button>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {bufferingStage !== "hidden" && isWaiting && (
          <div
            data-testid="replay-buffering-pill"
            data-stage={bufferingStage}
            role="status"
            className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200"
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-500" />
            {bufferingStage === "retry" ? "Still loading" : waitingCopy}
            {bufferingStage === "retry" && onRetry && (
              <button
                type="button"
                data-testid="replay-buffering-retry"
                className="rounded px-1 font-semibold underline decoration-indigo-300 underline-offset-2 hover:text-indigo-900"
                onClick={onRetry}
              >
                Retry
              </button>
            )}
          </div>
        )}

        {phase === "error" && props.errorMessage && (
          <div
            data-testid="replay-error-pill"
            role="alert"
            className="inline-flex max-w-[24rem] items-center gap-2 truncate rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700 ring-1 ring-inset ring-rose-200"
          >
            <Icon icon={IconProp.Alert} className="h-3 w-3 shrink-0" />
            <span className="truncate">{props.errorMessage}</span>
          </div>
        )}

        <button
          type="button"
          data-testid="replay-shortcuts-button"
          className={`${SMALL_BUTTON_CLASS} ${SMALL_BUTTON_ENABLED_CLASS} w-8 justify-center`}
          onClick={props.onShowShortcuts}
          aria-label="Keyboard shortcuts (?)"
          title="Keyboard shortcuts (?)"
        >
          <Icon icon={IconProp.Keyboard} className="h-4 w-4" />
        </button>

        {hasOverflow && (
          <MoreMenu
            text=""
            ariaLabel="More player options"
            dataTestId="replay-more-menu"
            menuIcon={IconProp.EllipsisHorizontal}
          >
            {props.onMouseTrailChange ? (
              <MoreMenuItem
                key="mouse-trail"
                icon={IconProp.CursorArrowRays}
                text={
                  props.isMouseTrailEnabled
                    ? "Hide mouse trail"
                    : "Show mouse trail"
                }
                onClick={(): void => {
                  props.onMouseTrailChange?.(!props.isMouseTrailEnabled);
                }}
              />
            ) : (
              <React.Fragment key="mouse-trail-none" />
            )}
            {props.onFollowChange ? (
              <MoreMenuItem
                key="follow"
                icon={IconProp.Bolt}
                text={
                  props.isFollowEnabled
                    ? "Stop following the playhead in the rail (M)"
                    : "Follow the playhead in the rail (M)"
                }
                onClick={(): void => {
                  props.onFollowChange?.(!props.isFollowEnabled);
                }}
              />
            ) : (
              <React.Fragment key="follow-none" />
            )}
          </MoreMenu>
        )}
      </div>
    </div>
  );
};

export default ReplayControls;
