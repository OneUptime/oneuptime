import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LlmConversationReplay, {
  LlmReplayStepTime,
  LlmReplayTimeline,
} from "Common/Utils/Telemetry/LlmConversationReplay";

/*
 * The replay's state: a clock that runs at the chosen speed while playing,
 * over a timeline whose long silences are shortened while "Skip waiting" is
 * on. Every rule about where the clock goes lives in LlmConversationReplay;
 * this hook owns only time passing (requestAnimationFrame) and the state.
 *
 * A conversation opens fully drawn - the clock at the end - because most
 * people open one to read it. Pressing play starts it over from the first
 * message. A link to a step (?step=4) opens with the clock on that step.
 */

export interface LlmConversationReplayController {
  timeline: LlmReplayTimeline;
  clockMs: number;
  isPlaying: boolean;
  speed: number;
  skipWaiting: boolean;
  // How many steps are on screen.
  visibleCount: number;
  // The newest visible step, -1 when none.
  currentIndex: number;
  // Whether the clock is at the end (everything visible, nothing to play).
  isAtEnd: boolean;
  // The real time the clock stands at (epoch ms).
  realTimeMs: number;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  next: () => void;
  previous: () => void;
  restart: () => void;
  goToEnd: () => void;
  goToStep: (index: number) => void;
  seekToProgress: (progress: number) => void;
  cycleSpeed: () => void;
  setSkipWaiting: (skipWaiting: boolean) => void;
}

export function useLlmConversationReplay(
  steps: ReadonlyArray<LlmReplayStepTime>,
  initialStepIndex: number | null,
): LlmConversationReplayController {
  const [skipWaiting, setSkipWaitingState] = useState<boolean>(true);
  const [speed, setSpeed] = useState<number>(1);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  const timeline: LlmReplayTimeline = useMemo(() => {
    return LlmConversationReplay.buildTimeline(steps, {
      skipWaiting: skipWaiting,
    });
  }, [steps, skipWaiting]);

  const [clockMs, setClockMs] = useState<number>(() => {
    const initial: LlmReplayTimeline = LlmConversationReplay.buildTimeline(
      steps,
      { skipWaiting: true },
    );

    return initialStepIndex !== null &&
      initialStepIndex >= 0 &&
      initialStepIndex < steps.length
      ? LlmConversationReplay.timeOfStep(initial, initialStepIndex)
      : initial.durationMs;
  });

  // A new conversation (a different steps array) opens at its end.
  const stepsRef: React.MutableRefObject<ReadonlyArray<LlmReplayStepTime>> =
    useRef<ReadonlyArray<LlmReplayStepTime>>(steps);

  useEffect(() => {
    if (stepsRef.current === steps) {
      return;
    }

    stepsRef.current = steps;
    setIsPlaying(false);
    setClockMs(
      LlmConversationReplay.buildTimeline(steps, { skipWaiting: skipWaiting })
        .durationMs,
    );
  }, [steps]);

  // Time passing while playing.
  const timelineRef: React.MutableRefObject<LlmReplayTimeline> =
    useRef<LlmReplayTimeline>(timeline);
  timelineRef.current = timeline;

  const clockRef: React.MutableRefObject<number> = useRef<number>(clockMs);
  clockRef.current = clockMs;

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    let frame: number = 0;
    let last: number | null = null;

    const tick: (now: number) => void = (now: number): void => {
      if (last !== null) {
        const elapsed: number = Math.max(0, now - last) * speed;
        const next: number = clockRef.current + elapsed;
        const duration: number = timelineRef.current.durationMs;

        if (next >= duration) {
          clockRef.current = duration;
          setClockMs(duration);
          setIsPlaying(false);
          return;
        }

        clockRef.current = next;
        setClockMs(next);
      }

      last = now;
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [isPlaying, speed]);

  const play: () => void = useCallback((): void => {
    setClockMs((current: number): number => {
      return LlmConversationReplay.playFrom(timelineRef.current, current);
    });
    setIsPlaying(true);
  }, []);

  const pause: () => void = useCallback((): void => {
    setIsPlaying(false);
  }, []);

  const togglePlay: () => void = useCallback((): void => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, play, pause]);

  const next: () => void = useCallback((): void => {
    setClockMs((current: number): number => {
      return LlmConversationReplay.nextStepTime(timelineRef.current, current);
    });
  }, []);

  const previous: () => void = useCallback((): void => {
    setClockMs((current: number): number => {
      return LlmConversationReplay.previousStepTime(
        timelineRef.current,
        current,
      );
    });
  }, []);

  const restart: () => void = useCallback((): void => {
    setClockMs(0);
  }, []);

  const goToEnd: () => void = useCallback((): void => {
    setIsPlaying(false);
    setClockMs(timelineRef.current.durationMs);
  }, []);

  const goToStep: (index: number) => void = useCallback(
    (index: number): void => {
      setClockMs(LlmConversationReplay.timeOfStep(timelineRef.current, index));
    },
    [],
  );

  const seekToProgress: (progress: number) => void = useCallback(
    (progress: number): void => {
      setClockMs(
        LlmConversationReplay.clockAtProgress(timelineRef.current, progress),
      );
    },
    [],
  );

  const cycleSpeed: () => void = useCallback((): void => {
    setSpeed((current: number): number => {
      return LlmConversationReplay.nextSpeed(current);
    });
  }, []);

  const setSkipWaiting: (value: boolean) => void = useCallback(
    (value: boolean): void => {
      const from: LlmReplayTimeline = timelineRef.current;
      const to: LlmReplayTimeline = LlmConversationReplay.buildTimeline(
        stepsRef.current,
        { skipWaiting: value },
      );

      setClockMs((current: number): number => {
        return LlmConversationReplay.carryOver({
          from: from,
          to: to,
          clockMs: current,
        });
      });
      setSkipWaitingState(value);
    },
    [],
  );

  const visibleCount: number = LlmConversationReplay.visibleCount(
    timeline,
    clockMs,
  );

  return {
    timeline: timeline,
    clockMs: clockMs,
    isPlaying: isPlaying,
    speed: speed,
    skipWaiting: skipWaiting,
    visibleCount: visibleCount,
    currentIndex: visibleCount - 1,
    isAtEnd: clockMs >= timeline.durationMs,
    realTimeMs: LlmConversationReplay.realTimeAt(timeline, clockMs),
    play: play,
    pause: pause,
    togglePlay: togglePlay,
    next: next,
    previous: previous,
    restart: restart,
    goToEnd: goToEnd,
    goToStep: goToStep,
    seekToProgress: seekToProgress,
    cycleSpeed: cycleSpeed,
    setSkipWaiting: setSkipWaiting,
  };
}
