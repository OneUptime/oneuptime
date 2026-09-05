import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ReplayEngineSnapshot } from "./Engine/ReplayEngineTypes";
import { ReplaySignal } from "./Rail/ReplaySignalTypes";
import ReplayControls, {
  REPLAY_SPEEDS,
  ReplayControlsProps,
  formatReplaySpeed,
  getReplaySpeedIndex,
  stepReplaySpeed,
} from "./ReplayControls";
import ReplayTimeline, {
  REPLAY_TIMELINE_DEFAULT_WIDTH_PX,
  ReplayTimelineProps,
} from "./ReplayTimeline";
import ReplayShortcutsModal from "./ReplayShortcutsModal";
import {
  ReplayKeyboardAction,
  ReplayKeyboardScope,
  getReplayKeyTargetKind,
  isCoalescingReplayAction,
  resolveReplayKeyboardAction,
} from "./ReplayKeyboardMap";
import {
  ReplayActivityBucket,
  ReplayTimelineMarker,
  ReplayTrackBand,
  findNextMarker,
  findPrevMarker,
  getErrorMarkers,
  getFrustrationMarkers,
  markerSeekTarget,
  nudgeOffset,
  percentToOffset,
} from "./ReplayTimelineMath";

/*
 * The composition of ReplayControls and ReplayTimeline over one engine
 * snapshot, plus the keyboard listener and the "?" sheet.
 *
 * This file keeps its name so existing imports survive the split: the
 * five-lane scrubber that lived here became ReplayControls (the row of
 * buttons) and ReplayTimeline (the track and lanes), both re-exported
 * below. What stays here is the glue that needs both: prev/next error
 * stepping (the button's enabled state and the key's behaviour are
 * computed by the same rule, so the button can never be lit for a jump
 * that would not move), the speed step for "<" and ">", and the single
 * window keydown listener.
 */

export {
  ReplayControls,
  ReplayTimeline,
  ReplayShortcutsModal,
  REPLAY_SPEEDS,
  REPLAY_TIMELINE_DEFAULT_WIDTH_PX,
  formatReplaySpeed,
  getReplaySpeedIndex,
  stepReplaySpeed,
};
export type { ReplayControlsProps, ReplayTimelineProps };

/* ---- Keyboard listener. ---- */

export interface ReplayKeyboardShortcutOptions {
  isEnabled: boolean;
  /* "rail" when the rail list has focus; j/k/Enter/Esc change meaning. */
  getScope?: (() => ReplayKeyboardScope) | undefined;
  onAction: (action: ReplayKeyboardAction) => void;
}

interface HeldSeekKey {
  key: string;
  pendingDeltaMs: number;
}

/*
 * ONE window listener for the component's lifetime, reading the latest
 * options through a ref. The old scrubber re-registered its handler on
 * every 200ms time tick because currentTimeMs was in the effect's
 * dependency list (finding 20); nothing here depends on render-time
 * values.
 *
 * Held keys: the first keydown seeks immediately, auto-repeats accumulate
 * into one pending delta, and keyup (or the window losing focus) commits
 * that delta as a single seek - mirroring the drag design, where every
 * seek can cost a Replayer rebuild and a chunk fetch (finding 10).
 */
export function useReplayKeyboardShortcuts(
  options: ReplayKeyboardShortcutOptions,
): void {
  const optionsRef: React.MutableRefObject<ReplayKeyboardShortcutOptions> =
    useRef<ReplayKeyboardShortcutOptions>(options);
  const heldRef: React.MutableRefObject<HeldSeekKey | null> =
    useRef<HeldSeekKey | null>(null);

  optionsRef.current = options;

  useEffect(() => {
    const flushHeld: () => void = (): void => {
      const held: HeldSeekKey | null = heldRef.current;
      heldRef.current = null;

      if (held && held.pendingDeltaMs !== 0) {
        optionsRef.current.onAction({
          type: "seek-relative",
          deltaMs: held.pendingDeltaMs,
        });
      }
    };

    const handleKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      const current: ReplayKeyboardShortcutOptions = optionsRef.current;

      if (!current.isEnabled) {
        return;
      }

      const action: ReplayKeyboardAction | null = resolveReplayKeyboardAction({
        key: event.key,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        repeat: event.repeat,
        targetKind: getReplayKeyTargetKind(event.target),
        scope: current.getScope ? current.getScope() : "player",
      });

      if (!action) {
        return;
      }

      event.preventDefault();

      if (isCoalescingReplayAction(action) && action.type === "seek-relative") {
        const held: HeldSeekKey | null = heldRef.current;

        if (event.repeat && held && held.key === event.key) {
          held.pendingDeltaMs += action.deltaMs;
          return;
        }

        /* A different key while one is held: commit the held one first. */
        if (held && held.key !== event.key) {
          flushHeld();
        }

        heldRef.current = { key: event.key, pendingDeltaMs: 0 };
        current.onAction(action);
        return;
      }

      current.onAction(action);
    };

    const handleKeyUp: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      const held: HeldSeekKey | null = heldRef.current;

      if (held && held.key === event.key) {
        flushHeld();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", flushHeld);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", flushHeld);
      heldRef.current = null;
    };
  }, []);
}

/* ---- Composition. ---- */

export interface ReplayScrubberProps {
  snapshot: ReplayEngineSnapshot;
  bands: Array<ReplayTrackBand>;
  activity?: Array<ReplayActivityBucket> | undefined;
  markers: Array<ReplayTimelineMarker>;
  /* For the hover preview card. */
  signals?: Array<ReplaySignal> | undefined;
  ghostMs?: number | null | undefined;
  selectedSignalId?: string | null | undefined;
  startTimeUnixMs?: number | null | undefined;
  /* Domain copy shown beside the controls when the phase is "error". */
  errorMessage?: string | null | undefined;
  /* Suppressed while a modal or drawer owns the keyboard. */
  areShortcutsEnabled?: boolean | undefined;
  /* Static or read per key; "rail" when the rail list has focus. */
  keyboardScope?: ReplayKeyboardScope | (() => ReplayKeyboardScope) | undefined;
  isFollowEnabled?: boolean | undefined;
  isMouseTrailEnabled?: boolean | undefined;

  onSeek: (offsetMs: number) => void;
  onPlayPause: () => void;
  onSpeedChange: (speed: number) => void;
  onSkipInactiveChange: (isEnabled: boolean) => void;
  /* "s": skip past the idle stretch the playhead is in, if any. */
  onSkipIdleJump?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onSelectSignal?: ((signalId: string) => void) | undefined;
  onHoverTimeline?: ((offsetMs: number | null) => void) | undefined;

  /* Shell-level shortcuts; a missing handler makes its key a no-op. */
  onNextSignal?: (() => void) | undefined;
  onPrevSignal?: (() => void) | undefined;
  onToggleTheater?: (() => void) | undefined;
  onToggleWide?: (() => void) | undefined;
  onFollowChange?: ((isEnabled: boolean) => void) | undefined;
  onMouseTrailChange?: ((isEnabled: boolean) => void) | undefined;
  onFocusRailSearch?: (() => void) | undefined;
  onCopyLink?: (() => void) | undefined;
  onToggleDetails?: (() => void) | undefined;
  onEscape?: (() => void) | undefined;
  onRailRowDown?: (() => void) | undefined;
  onRailRowUp?: (() => void) | undefined;
  onRailSeekSelected?: (() => void) | undefined;
  onRailClear?: (() => void) | undefined;
}

/* The slice of props the once-registered keyboard dispatcher reads. */
type ReplayScrubberLatest = Pick<
  ReplayScrubberProps,
  | "snapshot"
  | "markers"
  | "keyboardScope"
  | "isFollowEnabled"
  | "onSeek"
  | "onPlayPause"
  | "onSpeedChange"
  | "onSkipInactiveChange"
  | "onSkipIdleJump"
  | "onNextSignal"
  | "onPrevSignal"
  | "onToggleTheater"
  | "onToggleWide"
  | "onFollowChange"
  | "onFocusRailSearch"
  | "onCopyLink"
  | "onToggleDetails"
  | "onEscape"
  | "onRailRowDown"
  | "onRailRowUp"
  | "onRailSeekSelected"
  | "onRailClear"
>;

const ReplayScrubber: FunctionComponent<ReplayScrubberProps> = (
  props: ReplayScrubberProps,
): ReactElement => {
  const [isShortcutsOpen, setIsShortcutsOpen] = useState<boolean>(false);

  const { snapshot, markers, onSeek, onSelectSignal } = props;
  const { currentTimeMs, durationMs } = snapshot;

  /*
   * The keyboard dispatcher reads props and the snapshot through a ref
   * because the listener behind it is registered once. Each field is
   * copied explicitly rather than storing `props` whole, so the list of
   * what the keys can reach is visible here and to the lint rule.
   */
  const latestRef: React.MutableRefObject<ReplayScrubberLatest> =
    useRef<ReplayScrubberLatest>({} as ReplayScrubberLatest);
  const isShortcutsOpenRef: React.MutableRefObject<boolean> =
    useRef<boolean>(isShortcutsOpen);

  latestRef.current = {
    snapshot: props.snapshot,
    markers: props.markers,
    keyboardScope: props.keyboardScope,
    isFollowEnabled: props.isFollowEnabled,
    onSeek: props.onSeek,
    onPlayPause: props.onPlayPause,
    onSpeedChange: props.onSpeedChange,
    onSkipInactiveChange: props.onSkipInactiveChange,
    onSkipIdleJump: props.onSkipIdleJump,
    onNextSignal: props.onNextSignal,
    onPrevSignal: props.onPrevSignal,
    onToggleTheater: props.onToggleTheater,
    onToggleWide: props.onToggleWide,
    onFollowChange: props.onFollowChange,
    onFocusRailSearch: props.onFocusRailSearch,
    onCopyLink: props.onCopyLink,
    onToggleDetails: props.onToggleDetails,
    onEscape: props.onEscape,
    onRailRowDown: props.onRailRowDown,
    onRailRowUp: props.onRailRowUp,
    onRailSeekSelected: props.onRailSeekSelected,
    onRailClear: props.onRailClear,
  };
  isShortcutsOpenRef.current = isShortcutsOpen;

  const errorMarkers: Array<ReplayTimelineMarker> = useMemo(() => {
    return getErrorMarkers(markers);
  }, [markers]);

  const frustrationMarkers: Array<ReplayTimelineMarker> = useMemo(() => {
    return getFrustrationMarkers(markers);
  }, [markers]);

  /*
   * The button's enabled state and the jump use the SAME lookup, so the
   * button is lit exactly when a press would move the playhead. The old
   * scrubber enabled "Next error" with `atMs > currentTimeMs` and then
   * landed 10s before that marker, which is still < atMs: the button
   * stayed lit and the second press went nowhere (finding 2).
   */
  const nextError: ReplayTimelineMarker | null = useMemo(() => {
    return findNextMarker(errorMarkers, currentTimeMs);
  }, [errorMarkers, currentTimeMs]);

  const prevError: ReplayTimelineMarker | null = useMemo(() => {
    return findPrevMarker(errorMarkers, currentTimeMs);
  }, [errorMarkers, currentTimeMs]);

  const nextFrustration: ReplayTimelineMarker | null = useMemo(() => {
    return findNextMarker(frustrationMarkers, currentTimeMs);
  }, [frustrationMarkers, currentTimeMs]);

  const jumpToMarker: (marker: ReplayTimelineMarker | null) => void =
    useCallback(
      (marker: ReplayTimelineMarker | null): void => {
        if (!marker) {
          return;
        }

        onSeek(markerSeekTarget(marker));

        if (marker.signalId && onSelectSignal) {
          onSelectSignal(marker.signalId);
        }
      },
      [onSeek, onSelectSignal],
    );

  const handleNextError: () => void = useCallback((): void => {
    jumpToMarker(
      findNextMarker(
        getErrorMarkers(latestRef.current.markers),
        latestRef.current.snapshot.currentTimeMs,
      ),
    );
  }, [jumpToMarker]);

  const handlePrevError: () => void = useCallback((): void => {
    jumpToMarker(
      findPrevMarker(
        getErrorMarkers(latestRef.current.markers),
        latestRef.current.snapshot.currentTimeMs,
      ),
    );
  }, [jumpToMarker]);

  const handleNextFrustration: () => void = useCallback((): void => {
    jumpToMarker(
      findNextMarker(
        getFrustrationMarkers(latestRef.current.markers),
        latestRef.current.snapshot.currentTimeMs,
      ),
    );
  }, [jumpToMarker]);

  const handleSeekRelative: (deltaMs: number) => void = useCallback(
    (deltaMs: number): void => {
      const latest: ReplayEngineSnapshot = latestRef.current.snapshot;

      latestRef.current.onSeek(
        nudgeOffset(latest.currentTimeMs, deltaMs, latest.durationMs),
      );
    },
    [],
  );

  const openShortcuts: () => void = useCallback((): void => {
    setIsShortcutsOpen(true);
  }, []);

  const closeShortcuts: () => void = useCallback((): void => {
    setIsShortcutsOpen(false);
  }, []);

  const handleAction: (action: ReplayKeyboardAction) => void = useCallback(
    (action: ReplayKeyboardAction): void => {
      const current: ReplayScrubberLatest = latestRef.current;
      const latest: ReplayEngineSnapshot = current.snapshot;

      /* With the sheet open only "?" and Escape mean anything. */
      if (isShortcutsOpenRef.current) {
        if (action.type === "escape" || action.type === "show-shortcuts") {
          setIsShortcutsOpen(false);
        }

        return;
      }

      switch (action.type) {
        case "play-pause":
          current.onPlayPause();
          return;
        case "seek-relative":
          handleSeekRelative(action.deltaMs);
          return;
        case "seek-percent":
          current.onSeek(percentToOffset(action.percent, latest.durationMs));
          return;
        case "seek-start":
          current.onSeek(0);
          return;
        case "seek-end":
          current.onSeek(Math.max(0, latest.durationMs));
          return;
        case "speed-step":
          current.onSpeedChange(
            stepReplaySpeed(latest.speed, action.direction),
          );
          return;
        case "skip-idle-jump":
          current.onSkipIdleJump?.();
          return;
        case "toggle-skip-idle":
          current.onSkipInactiveChange(!latest.skipInactive);
          return;
        case "next-error":
          handleNextError();
          return;
        case "prev-error":
          handlePrevError();
          return;
        case "next-frustration":
          handleNextFrustration();
          return;
        case "next-signal":
          current.onNextSignal?.();
          return;
        case "prev-signal":
          current.onPrevSignal?.();
          return;
        case "toggle-theater":
          current.onToggleTheater?.();
          return;
        case "toggle-wide":
          current.onToggleWide?.();
          return;
        case "toggle-follow":
          current.onFollowChange?.(!current.isFollowEnabled);
          return;
        case "focus-rail-search":
          current.onFocusRailSearch?.();
          return;
        case "copy-link":
          current.onCopyLink?.();
          return;
        case "toggle-details":
          current.onToggleDetails?.();
          return;
        case "show-shortcuts":
          setIsShortcutsOpen(true);
          return;
        case "escape":
          current.onEscape?.();
          return;
        case "rail-row-down":
          current.onRailRowDown?.();
          return;
        case "rail-row-up":
          current.onRailRowUp?.();
          return;
        case "rail-seek-selected":
          current.onRailSeekSelected?.();
          return;
        case "rail-clear":
          current.onRailClear?.();
          return;
        default: {
          const unreachable: never = action;
          return unreachable;
        }
      }
    },
    [
      handleSeekRelative,
      handleNextError,
      handlePrevError,
      handleNextFrustration,
    ],
  );

  const getScope: () => ReplayKeyboardScope =
    useCallback((): ReplayKeyboardScope => {
      const scope:
        | ReplayKeyboardScope
        | (() => ReplayKeyboardScope)
        | undefined = latestRef.current.keyboardScope;

      if (typeof scope === "function") {
        return scope();
      }

      return scope || "player";
    }, []);

  useReplayKeyboardShortcuts({
    isEnabled: props.areShortcutsEnabled !== false || isShortcutsOpen,
    getScope: getScope,
    onAction: handleAction,
  });

  return (
    <div
      data-testid="replay-scrubber"
      className="rounded-lg border border-gray-200 bg-white p-3"
    >
      <ReplayControls
        phase={snapshot.phase}
        currentTimeMs={currentTimeMs}
        durationMs={durationMs}
        speed={snapshot.speed}
        isSkipInactiveEnabled={snapshot.skipInactive}
        pendingSeekMs={snapshot.pendingSeekMs}
        errorMessage={props.errorMessage ?? snapshot.error?.message ?? null}
        hasPrevError={prevError !== null}
        hasNextError={nextError !== null}
        hasNextFrustration={nextFrustration !== null}
        isFollowEnabled={props.isFollowEnabled}
        isMouseTrailEnabled={props.isMouseTrailEnabled}
        onPlayPause={props.onPlayPause}
        onSeekRelative={handleSeekRelative}
        onSpeedChange={props.onSpeedChange}
        onSkipInactiveChange={props.onSkipInactiveChange}
        onPrevError={handlePrevError}
        onNextError={handleNextError}
        onNextFrustration={handleNextFrustration}
        onShowShortcuts={openShortcuts}
        onRetry={props.onRetry}
        onFollowChange={props.onFollowChange}
        onMouseTrailChange={props.onMouseTrailChange}
      />

      <div className="mt-3">
        <ReplayTimeline
          durationMs={durationMs}
          currentTimeMs={currentTimeMs}
          bands={props.bands}
          activity={props.activity}
          markers={markers}
          signals={props.signals}
          ghostMs={props.ghostMs}
          selectedSignalId={props.selectedSignalId}
          startTimeUnixMs={props.startTimeUnixMs}
          onSeek={onSeek}
          onSelectSignal={onSelectSignal}
          onHover={props.onHoverTimeline}
        />
      </div>

      {isShortcutsOpen && <ReplayShortcutsModal onClose={closeShortcuts} />}
    </div>
  );
};

export default ReplayScrubber;
