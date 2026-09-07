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
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import useComponentOutsideClick from "Common/UI/Types/UseComponentOutsideClick";
import {
  REPLAY_BUFFERING_GRACE_MS,
  REPLAY_BUFFERING_RETRY_HINT_MS,
  ReplayPhase,
} from "./Engine/ReplayEngineTypes";
import { REPLAY_KEY_SEEK_JL_MS } from "./ReplayKeyboardMap";
import {
  ReplayClockParts,
  formatReplayOffset,
  splitReplayClock,
} from "./ReplayTimeFormat";
import {
  ReplayButtonGroup,
  ReplayClock,
  ReplayPill,
  ReplaySwitch,
  ReplayToolButton,
  ReplayToolbarDivider,
} from "./ReplayUi";

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
 *
 * LAYOUT. Ten controls of equal visual weight in one `flex-wrap` line is
 * what a transport row must not be: nothing led, the eye had to read
 * every chip to find Play, and on a narrow column the row wrapped into a
 * ragged block whose buttons moved between renders. The row now reads
 * left to right in three clusters separated by hairlines -
 *
 *   transport (play, +-10s, clock) | view (speed, skip idle) |
 *   navigation (errors, frustration)
 *
 * - with status and the two "everything else" affordances pushed to the
 * far end. Play is the only filled control, and the only round one, so
 * it is findable without reading. Everything else is a ghost that gains
 * a wash on hover, and buttons that belong together share one recessed
 * track instead of each carrying its own outline.
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

  const clock: ReplayClockParts = splitReplayClock(
    currentTimeMs,
    durationMs,
    isPaused,
  );

  return (
    <div
      data-testid="replay-controls"
      className="flex flex-wrap items-center gap-x-2 gap-y-2"
    >
      {/*
       * The one filled, round control on the row. Hand-rolled rather than
       * a ReplayToolButton because it is deliberately the exception: 36px
       * against the chrome's 32px, and the only place a solid colour
       * means "press this".
       */}
      <button
        type="button"
        data-testid="replay-play-pause"
        data-phase={phase}
        disabled={playCopy.isDisabled}
        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
          playCopy.isDisabled
            ? "cursor-not-allowed bg-gray-300"
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

      <ReplayButtonGroup ariaLabel="Seek by ten seconds">
        <ReplayToolButton
          dataTestId="replay-seek-back"
          icon={IconProp.Backward}
          label="10s"
          isDisabled={!canSeek}
          variant="segment"
          title="Back 10 seconds (J)"
          ariaLabel="Back 10 seconds (J)"
          onClick={seekBack}
        />
        <ReplayToolButton
          dataTestId="replay-seek-forward"
          trailingIcon={IconProp.Forward}
          label="10s"
          isDisabled={!canSeek}
          variant="segment"
          title="Forward 10 seconds (L)"
          ariaLabel="Forward 10 seconds (L)"
          onClick={seekForward}
        />
      </ReplayButtonGroup>

      <ReplayClock
        dataTestId="replay-time"
        currentText={clock.current}
        totalText={clock.total}
      />

      <ReplayToolbarDivider />

      <div ref={speedRef} className="relative shrink-0">
        <ReplayToolButton
          ref={speedTriggerRef}
          dataTestId="replay-speed"
          label={formatReplaySpeed(speed)}
          hasPopup={true}
          isExpanded={isSpeedOpen}
          ariaLabel={`Playback speed ${formatReplaySpeed(speed)}`}
          title="Playback speed (< slower, > faster)"
          className="min-w-[3.25rem] tabular-nums"
          onClick={(): void => {
            setIsSpeedOpen(!isSpeedOpen);
          }}
        />

        {isSpeedOpen && (
          <div
            role="radiogroup"
            aria-label="Playback speed"
            data-testid="replay-speed-menu"
            className="absolute bottom-full left-0 z-20 mb-1.5 flex min-w-[5.5rem] flex-col gap-0.5 rounded-xl border border-gray-200 bg-white p-1 shadow-lg"
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
                  className={`rounded-lg px-2.5 py-1.5 text-left text-xs tabular-nums transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    isChecked
                      ? "bg-indigo-600 font-semibold text-white"
                      : "text-gray-700 hover:bg-gray-100"
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
       * The value is the engine's stored intent (snapshot.skipInactive);
       * the shell owns the default and the persisted preference. Idle
       * stretches are drawn on the track and every skip shows a toast, so
       * a jump is never mistaken for a bug.
       */}
      <ReplaySwitch
        dataTestId="replay-skip-idle"
        label="Skip idle"
        isChecked={props.isSkipInactiveEnabled}
        title="Jump past stretches with no user input. Each skip is announced and the idle stretch is drawn on the track."
        onChange={props.onSkipInactiveChange}
      />

      <ReplayToolbarDivider />

      <ReplayButtonGroup ariaLabel="Jump between signals">
        <ReplayToolButton
          dataTestId="replay-prev-error"
          icon={IconProp.ChevronLeft}
          trailingIcon={IconProp.Alert}
          variant="segment"
          tone="danger"
          isDisabled={!props.hasPrevError}
          ariaLabel="Previous error (Shift+E)"
          title={
            props.hasPrevError
              ? "Previous error (Shift+E)"
              : "No error before the playhead"
          }
          onClick={props.onPrevError}
        />
        <ReplayToolButton
          dataTestId="replay-next-error"
          icon={IconProp.Alert}
          label="Next error"
          variant="segment"
          tone="danger"
          isDisabled={!props.hasNextError}
          ariaLabel="Next error (E)"
          title={
            props.hasNextError
              ? "Next error (E)"
              : "No error after the playhead"
          }
          onClick={props.onNextError}
        />
        <ReplayToolButton
          dataTestId="replay-next-frustration"
          icon={IconProp.CursorArrowRays}
          label="Frustration"
          variant="segment"
          tone="warning"
          isDisabled={!props.hasNextFrustration}
          ariaLabel="Next frustration (N)"
          title={
            props.hasNextFrustration
              ? "Next frustration (N)"
              : "No rage, dead or error click after the playhead"
          }
          onClick={props.onNextFrustration}
        />
      </ReplayButtonGroup>

      <div className="ml-auto flex items-center gap-1.5">
        {/*
         * Visual only, deliberately NOT a live region and with no Retry of
         * its own: the stage says the same thing at the same moment
         * (ReplayStageOverlays' role=status pill plus the sr-only phase
         * word), so two regions meant a screen reader announced "Buffering"
         * or "Seeking to 1:12" twice per event and the viewer saw two Retry
         * buttons after eight seconds. The stage overlay is the announced
         * surface and owns the retry action; this pill just keeps the state
         * visible next to the transport controls.
         */}
        {bufferingStage !== "hidden" && isWaiting && (
          <ReplayPill
            dataTestId="replay-buffering-pill"
            tone="accent"
            hasPulse={true}
            isHiddenFromScreenReaders={true}
          >
            {bufferingStage === "retry" ? "Still loading" : waitingCopy}
          </ReplayPill>
        )}

        {phase === "error" && props.errorMessage && (
          <ReplayPill
            dataTestId="replay-error-pill"
            tone="danger"
            role="alert"
            icon={IconProp.Alert}
            className="max-w-[24rem]"
          >
            {props.errorMessage}
          </ReplayPill>
        )}

        <ReplayToolButton
          dataTestId="replay-shortcuts-button"
          icon={IconProp.Keyboard}
          title="Keyboard shortcuts (?)"
          ariaLabel="Keyboard shortcuts (?)"
          onClick={props.onShowShortcuts}
        />

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
