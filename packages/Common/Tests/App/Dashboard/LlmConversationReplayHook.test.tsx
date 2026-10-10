import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  render,
  renderHook,
  RenderHookResult,
} from "@testing-library/react";
import * as React from "react";
import {
  LlmConversationReplayController,
  useLlmConversationReplay,
} from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/useLlmConversationReplay";
import { LlmReplayStepTime } from "../../../Utils/Telemetry/LlmConversationReplay";
import { T0 } from "./LlmConversationFixtures";

/*
 * The replay's clock. A conversation opens fully drawn (most people open
 * one to read it); Play starts it over from the first message and runs at
 * the chosen speed, long silences shortened while "Skip waiting" is on; the
 * transport moves message by message. Time is driven by hand here through a
 * stand-in requestAnimationFrame, so every assertion is about a known clock.
 *
 * The steps: a question, its answer 2 s later, a second question a minute
 * later (shortened to 1.2 s while skipping), and its answer 3 s after that.
 *
 *   skip waiting on:  points 0, 2000, 3200, 6200; ends at 7000
 *   skip waiting off: points 0, 2000, 60000, 63000; ends at 63800
 */

const STEPS: Array<LlmReplayStepTime> = [
  { atMs: T0 },
  { atMs: T0 + 2000 },
  { atMs: T0 + 60_000 },
  { atMs: T0 + 63_000 },
];

let frames: Array<FrameRequestCallback> = [];

function runFrame(now: number): void {
  const pending: Array<FrameRequestCallback> = frames;
  frames = [];

  act(() => {
    for (const callback of pending) {
      callback(now);
    }
  });
}

type Hook = RenderHookResult<
  LlmConversationReplayController,
  { steps: ReadonlyArray<LlmReplayStepTime>; initial: number | null }
>;

function useReplay(
  steps: ReadonlyArray<LlmReplayStepTime> = STEPS,
  initial: number | null = null,
): Hook {
  return renderHook(
    (props: {
      steps: ReadonlyArray<LlmReplayStepTime>;
      initial: number | null;
    }) => {
      return useLlmConversationReplay(props.steps, props.initial);
    },
    { initialProps: { steps: steps, initial: initial } },
  );
}

beforeEach(() => {
  frames = [];
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    writable: true,
    value: (callback: FrameRequestCallback): number => {
      frames.push(callback);
      return frames.length;
    },
  });
  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
    writable: true,
    value: (): void => {
      frames = [];
    },
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("opening a conversation", () => {
  test("opens fully drawn, at the end, not playing", () => {
    const { result } = useReplay();

    expect(result.current.clockMs).toBe(7000);
    expect(result.current.timeline.durationMs).toBe(7000);
    expect(result.current.isAtEnd).toBe(true);
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.visibleCount).toBe(4);
    expect(result.current.currentIndex).toBe(3);
    expect(result.current.skipWaiting).toBe(true);
    expect(result.current.speed).toBe(1);
  });

  test("a link to a step opens on that step", () => {
    const { result } = useReplay(STEPS, 1);

    expect(result.current.clockMs).toBe(2000);
    expect(result.current.visibleCount).toBe(2);
    expect(result.current.isAtEnd).toBe(false);
  });

  test("a link to a step that is not there opens at the end", () => {
    expect(useReplay(STEPS, 9).result.current.isAtEnd).toBe(true);
    expect(useReplay(STEPS, -1).result.current.isAtEnd).toBe(true);
  });

  test("a conversation with no steps has nothing to play", () => {
    const { result } = useReplay([]);

    expect(result.current.clockMs).toBe(0);
    expect(result.current.visibleCount).toBe(0);
    expect(result.current.currentIndex).toBe(-1);
    expect(result.current.isAtEnd).toBe(true);
  });
});

describe("playing", () => {
  test("Play at the end starts over from the first message", () => {
    const { result } = useReplay();

    act(() => {
      result.current.play();
    });

    expect(result.current.isPlaying).toBe(true);
    expect(result.current.clockMs).toBe(0);
    expect(result.current.visibleCount).toBe(1);
  });

  test("the clock runs with the frames, at the chosen speed", () => {
    const { result } = useReplay(STEPS, 0);

    act(() => {
      result.current.play();
    });

    runFrame(1000);
    runFrame(1500);

    expect(result.current.clockMs).toBe(500);

    act(() => {
      result.current.cycleSpeed();
    });

    expect(result.current.speed).toBe(2);

    runFrame(5000);
    runFrame(5600);

    // 600 ms of frames at 2x.
    expect(result.current.clockMs).toBe(1700);
  });

  test("messages appear as the clock passes them", () => {
    const { result } = useReplay(STEPS, 0);

    act(() => {
      result.current.play();
    });

    runFrame(0);
    runFrame(1999);
    expect(result.current.visibleCount).toBe(1);

    runFrame(2000);
    expect(result.current.visibleCount).toBe(2);
  });

  test("the replay stops at the end, everything on screen", () => {
    const { result } = useReplay(STEPS, 0);

    act(() => {
      result.current.play();
    });

    runFrame(0);
    runFrame(100_000);

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.clockMs).toBe(7000);
    expect(result.current.isAtEnd).toBe(true);
    expect(frames).toHaveLength(0);
  });

  test("Pause stops the clock where it is", () => {
    const { result } = useReplay(STEPS, 0);

    act(() => {
      result.current.play();
    });

    runFrame(0);
    runFrame(800);

    act(() => {
      result.current.pause();
    });

    runFrame(5000);

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.clockMs).toBe(800);
  });

  test("togglePlay plays and pauses", () => {
    const { result } = useReplay(STEPS, 0);

    act(() => {
      result.current.togglePlay();
    });

    expect(result.current.isPlaying).toBe(true);

    act(() => {
      result.current.togglePlay();
    });

    expect(result.current.isPlaying).toBe(false);
  });

  test("the speed cycles 1x, 2x, 4x, 8x and back", () => {
    const { result } = useReplay();
    const speeds: Array<number> = [];

    for (let index: number = 0; index < 5; index++) {
      act(() => {
        result.current.cycleSpeed();
      });
      speeds.push(result.current.speed);
    }

    expect(speeds).toEqual([2, 4, 8, 1, 2]);
  });
});

describe("moving through the messages", () => {
  test("Previous shows one message fewer; Next one more", () => {
    const { result } = useReplay();

    act(() => {
      result.current.previous();
    });

    expect(result.current.visibleCount).toBe(3);
    expect(result.current.clockMs).toBe(3200);

    act(() => {
      result.current.previous();
    });

    expect(result.current.visibleCount).toBe(2);

    act(() => {
      result.current.next();
    });

    expect(result.current.visibleCount).toBe(3);

    act(() => {
      result.current.next();
    });
    act(() => {
      result.current.next();
    });

    expect(result.current.isAtEnd).toBe(true);
  });

  test("Previous from the first message stays on it", () => {
    const { result } = useReplay(STEPS, 0);

    act(() => {
      result.current.previous();
    });

    expect(result.current.clockMs).toBe(0);
    expect(result.current.visibleCount).toBe(1);
  });

  test("restart, a step, a scrubber position and the end", () => {
    const { result } = useReplay();

    act(() => {
      result.current.restart();
    });
    expect(result.current.clockMs).toBe(0);

    act(() => {
      result.current.goToStep(2);
    });
    expect(result.current.clockMs).toBe(3200);
    expect(result.current.currentIndex).toBe(2);

    act(() => {
      result.current.seekToProgress(0.5);
    });
    expect(result.current.clockMs).toBe(3500);

    act(() => {
      result.current.seekToProgress(7);
    });
    expect(result.current.clockMs).toBe(7000);

    act(() => {
      result.current.restart();
    });
    act(() => {
      result.current.goToEnd();
    });
    expect(result.current.isAtEnd).toBe(true);
  });

  test("the end also stops a replay that is playing", () => {
    const { result } = useReplay(STEPS, 0);

    act(() => {
      result.current.play();
    });
    act(() => {
      result.current.goToEnd();
    });

    expect(result.current.isPlaying).toBe(false);
  });
});

describe("skip waiting", () => {
  test("switching it off keeps the same messages on screen", () => {
    const { result } = useReplay();

    act(() => {
      result.current.goToStep(2);
    });

    expect(result.current.visibleCount).toBe(3);

    act(() => {
      result.current.setSkipWaiting(false);
    });

    expect(result.current.skipWaiting).toBe(false);
    expect(result.current.timeline.durationMs).toBe(63_800);
    expect(result.current.clockMs).toBe(60_000);
    expect(result.current.visibleCount).toBe(3);
  });

  test("at the end, it stays at the end", () => {
    const { result } = useReplay();

    act(() => {
      result.current.setSkipWaiting(false);
    });

    expect(result.current.isAtEnd).toBe(true);
    expect(result.current.clockMs).toBe(63_800);
  });

  test("the real time counts up through a shortened silence", () => {
    const { result } = useReplay();

    act(() => {
      result.current.seekToProgress(2600 / 7000);
    });

    // Half-way through the shortened 1.2 s, half-way through the real minute.
    expect(result.current.realTimeMs).toBe(T0 + 2000 + 29_000);
  });
});

describe("a different conversation", () => {
  test("opens at its own end and stops the replay", () => {
    const hook: Hook = useReplay(STEPS, 0);

    act(() => {
      hook.result.current.play();
    });

    hook.rerender({
      steps: [{ atMs: T0 }, { atMs: T0 + 1000 }],
      initial: null,
    });

    expect(hook.result.current.isPlaying).toBe(false);
    expect(hook.result.current.clockMs).toBe(1000 + 800);
    expect(hook.result.current.isAtEnd).toBe(true);
  });

  test("a conversation that arrives after the page opened, on the step its link names", () => {
    const hook: Hook = useReplay([], null);

    hook.rerender({ steps: STEPS, initial: 1 });

    expect(hook.result.current.clockMs).toBe(2000);
    expect(hook.result.current.visibleCount).toBe(2);
  });

  test("the first frame that shows the steps already shows the right ones", () => {
    /*
     * The transcript arrives after the page opened with no steps. Were the
     * clock reset in an effect, one frame would be painted with the clock
     * still at 0 - the transcript cut at its first message - before the jump
     * to the end. Only committed renders are recorded here.
     */
    const committed: Array<number> = [];

    const Probe: React.FunctionComponent<{
      steps: ReadonlyArray<LlmReplayStepTime>;
    }> = (props: {
      steps: ReadonlyArray<LlmReplayStepTime>;
    }): React.ReactElement => {
      const replay: LlmConversationReplayController = useLlmConversationReplay(
        props.steps,
        null,
      );

      React.useLayoutEffect(() => {
        committed.push(replay.visibleCount);
      });

      return <></>;
    };

    const view: ReturnType<typeof render> = render(<Probe steps={[]} />);

    view.rerender(<Probe steps={STEPS} />);

    expect(committed).toEqual([0, 4]);
  });

  test("the same conversation re-rendered keeps its place", () => {
    const hook: Hook = useReplay(STEPS, 1);

    hook.rerender({ steps: STEPS, initial: 1 });

    expect(hook.result.current.clockMs).toBe(2000);
  });
});
