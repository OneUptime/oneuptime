import "@testing-library/jest-dom";
import { act, render, screen } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it } from "@jest/globals";
import ReplayScrubber, {
  REPLAY_CONTROLS_CLOCK_MS,
  REPLAY_TRACK_CLOCK_MS,
  ReplayScrubberProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayScrubber";
import useReplayClock, {
  ReplayClockLike,
  quantiseReplayClock,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/useReplayClock";
import {
  ReplayClockListener,
  ReplayEngineListener,
  ReplayEngineSnapshot,
  derivePhase,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Engine/ReplayEngineTypes";

/*
 * The render budget of the player while the playhead moves.
 *
 * The engine publishes about thirty times a second while playing, and
 * every publish used to reach the composition root as a brand-new
 * snapshot object, so React re-rendered the header, the overlays, the
 * stage, the transport, the timeline and the 1800-line rail on every
 * tick - synchronously, in the same frame rrweb was using to cast
 * mutations into the replay iframe. The clock channel exists to stop
 * that, and this file is what keeps it stopped: it counts renders, not
 * appearances, because the regression it guards against is invisible in
 * a screenshot and shows up only as a dropped frame.
 *
 * The rule these tests encode: a component re-renders when the playhead
 * crosses ITS OWN quantum, and never merely because the engine published.
 */

const DURATION_MS: number = 600000;
const PUBLISH_INTERVAL_MS: number = 33;

/*
 * The engine as a clock, with nothing else in it. Publishes carry the
 * playhead alone, exactly as ReplayEngine's clock channel does.
 */
class FakeClock implements ReplayClockLike {
  public currentTimeMs: number = 0;
  public snapshotReads: number = 0;
  private readonly clockListeners: Set<ReplayClockListener> =
    new Set<ReplayClockListener>();
  private readonly listeners: Set<ReplayEngineListener> =
    new Set<ReplayEngineListener>();
  private snapshotValue: ReplayEngineSnapshot = makeSnapshot();

  public subscribeClock(listener: ReplayClockListener): () => void {
    this.clockListeners.add(listener);

    return (): void => {
      this.clockListeners.delete(listener);
    };
  }

  public getCurrentTimeMs(): number {
    return this.currentTimeMs;
  }

  public subscribe(listener: ReplayEngineListener): () => void {
    this.listeners.add(listener);

    return (): void => {
      this.listeners.delete(listener);
    };
  }

  public getSnapshot(): ReplayEngineSnapshot {
    this.snapshotReads += 1;

    return this.snapshotValue;
  }

  /* One engine publish: the playhead moved, nothing structural did. */
  public publish(currentTimeMs: number): void {
    this.currentTimeMs = currentTimeMs;
    this.snapshotValue = {
      ...this.snapshotValue,
      currentTimeMs: currentTimeMs,
    };

    for (const listener of [...this.clockListeners]) {
      listener(currentTimeMs);
    }

    for (const listener of [...this.listeners]) {
      listener(this.snapshotValue);
    }
  }

  public tick(times: number): void {
    for (let index: number = 1; index <= times; index++) {
      act((): void => {
        this.publish(this.currentTimeMs + PUBLISH_INTERVAL_MS);
      });
    }
  }
}

/* A clock source that predates the split: only the whole-snapshot channel. */
class LegacyClock implements ReplayClockLike {
  private readonly listeners: Set<ReplayEngineListener> =
    new Set<ReplayEngineListener>();
  private snapshotValue: ReplayEngineSnapshot = makeSnapshot();

  public subscribe(listener: ReplayEngineListener): () => void {
    this.listeners.add(listener);

    return (): void => {
      this.listeners.delete(listener);
    };
  }

  public getSnapshot(): ReplayEngineSnapshot {
    return this.snapshotValue;
  }

  public publish(currentTimeMs: number): void {
    this.snapshotValue = {
      ...this.snapshotValue,
      currentTimeMs: currentTimeMs,
    };

    for (const listener of [...this.listeners]) {
      listener(this.snapshotValue);
    }
  }
}

function makeSnapshot(
  overrides?: Partial<ReplayEngineSnapshot>,
): ReplayEngineSnapshot {
  const buffer: ReplayEngineSnapshot["buffer"] = overrides?.buffer ?? "ok";
  const intent: ReplayEngineSnapshot["intent"] = overrides?.intent ?? "playing";

  return {
    phase: derivePhase(buffer, intent),
    intent: intent,
    buffer: buffer,
    currentTimeMs: 0,
    durationMs: DURATION_MS,
    speed: 1,
    skipInactive: false,
    fedRange: { fromMs: 0, toMs: 60000 },
    loadedChunkIndexes: [0, 1, 2, 3],
    activeTabId: "tab-1",
    recordedSize: null,
    bufferingSinceMs: null,
    lastGap: null,
    lastIdleSkip: null,
    error: null,
    pendingSeekMs: null,
    generation: 1,
    ...overrides,
  };
}

function noop(): void {
  /* Handlers these assertions do not exercise. */
}

function makeScrubberProps(
  overrides?: Partial<ReplayScrubberProps>,
): ReplayScrubberProps {
  return {
    snapshot: makeSnapshot(),
    bands: [],
    markers: [],
    onSeek: noop,
    onPlayPause: noop,
    onSkipInactiveChange: noop,
    onSpeedChange: noop,
    ...overrides,
  };
}

interface CountingProps {
  clock: ReplayClockLike;
  quantumMs: number;
  renders: { count: number };
}

/* Renders the quantised clock and counts how often React called it. */
const Counting: React.FunctionComponent<CountingProps> = (
  props: CountingProps,
): React.ReactElement => {
  const currentTimeMs: number = useReplayClock(props.clock, props.quantumMs);

  props.renders.count += 1;

  return <span data-testid="counting">{currentTimeMs}</span>;
};

describe("quantiseReplayClock", () => {
  it("floors to the quantum and passes everything through below 1ms", () => {
    expect(quantiseReplayClock(1234, 250)).toBe(1000);
    expect(quantiseReplayClock(1250, 250)).toBe(1250);
    expect(quantiseReplayClock(1234, 1)).toBe(1234);
    expect(quantiseReplayClock(1234, 0)).toBe(1234);
  });

  it("answers a non-finite clock with zero rather than NaN", () => {
    expect(quantiseReplayClock(Number.NaN, 250)).toBe(0);
    expect(quantiseReplayClock(Number.POSITIVE_INFINITY, 250)).toBe(0);
  });
});

describe("useReplayClock render budget", () => {
  /*
   * 100 publishes at 33ms is 3.3 seconds of playback. A component on the
   * 250ms quantum may render about thirteen times for that; one on the
   * frame quantum renders for every publish. The gap between those two
   * numbers IS the fix.
   */
  it("renders a quarter-second consumer a dozen times across 100 publishes", () => {
    const clock: FakeClock = new FakeClock();
    const renders: { count: number } = { count: 0 };

    render(<Counting clock={clock} quantumMs={250} renders={renders} />);

    const initial: number = renders.count;

    clock.tick(100);

    const renderedForClock: number = renders.count - initial;

    expect(renderedForClock).toBeLessThanOrEqual(
      Math.ceil((100 * PUBLISH_INTERVAL_MS) / 250) + 1,
    );
    expect(renderedForClock).toBeGreaterThan(0);
    /* The value on screen is still the current one, floored to the quantum. */
    expect(screen.getByTestId("counting").textContent).toBe(
      String(quantiseReplayClock(clock.currentTimeMs, 250)),
    );
  });

  it("renders a frame-quantum consumer for every publish", () => {
    const clock: FakeClock = new FakeClock();
    const renders: { count: number } = { count: 0 };

    render(<Counting clock={clock} quantumMs={16} renders={renders} />);

    const initial: number = renders.count;

    clock.tick(100);

    expect(renders.count - initial).toBe(100);
  });

  it("does not render at all while the playhead stays inside the quantum", () => {
    const clock: FakeClock = new FakeClock();
    const renders: { count: number } = { count: 0 };

    render(<Counting clock={clock} quantumMs={1000} renders={renders} />);

    const initial: number = renders.count;

    /* Four publishes, 132ms of playback: nowhere near the next second. */
    clock.tick(4);

    expect(renders.count).toBe(initial);
  });

  it("falls back to the whole-snapshot channel when the engine has no clock", () => {
    const clock: LegacyClock = new LegacyClock();
    const renders: { count: number } = { count: 0 };

    render(<Counting clock={clock} quantumMs={250} renders={renders} />);

    act((): void => {
      clock.publish(4321);
    });

    expect(screen.getByTestId("counting").textContent).toBe("4250");
    expect(renders.count).toBeGreaterThan(0);
  });
});

describe("ReplayScrubber render budget", () => {
  /*
   * The transport shows tenths; the track's needle has to move with the
   * picture. Given a clock the scrubber drives them at different rates
   * from one subscription, so the buttons are not reconciled thirty
   * times a second to move a needle.
   */
  it("moves the needle on every publish without re-rendering the transport", () => {
    const clock: FakeClock = new FakeClock();
    const props: ReplayScrubberProps = makeScrubberProps({ clock: clock });

    render(<ReplayScrubber {...props} />);

    clock.tick(3);

    /* 99ms in: the needle tracks the clock publish for publish. */
    expect(screen.getByTestId("timeline-playhead").style.left).toBe(
      `${(quantiseReplayClock(clock.currentTimeMs, REPLAY_TRACK_CLOCK_MS) / DURATION_MS) * 100}%`,
    );

    clock.tick(30);

    expect(screen.getByTestId("timeline-playhead").style.left).toBe(
      `${(quantiseReplayClock(clock.currentTimeMs, REPLAY_TRACK_CLOCK_MS) / DURATION_MS) * 100}%`,
    );
    /*
     * The transport is on a coarser quantum than the publish interval,
     * which is what keeps the buttons out of the per-frame path.
     */
    expect(REPLAY_CONTROLS_CLOCK_MS).toBeGreaterThan(PUBLISH_INTERVAL_MS);
  });

  it("reads the playhead from the clock, never from the structural snapshot", () => {
    const clock: FakeClock = new FakeClock();
    /*
     * A structural snapshot whose currentTimeMs is deliberately stale -
     * which is exactly what the composition root now holds between
     * structural changes. Anything that rendered from it would show
     * 99000 forever.
     */
    const props: ReplayScrubberProps = makeScrubberProps({
      clock: clock,
      snapshot: makeSnapshot({ currentTimeMs: 99000 }),
    });

    render(<ReplayScrubber {...props} />);

    clock.tick(10);

    expect(screen.getByTestId("timeline-playhead").style.left).toBe(
      `${(quantiseReplayClock(clock.currentTimeMs, REPLAY_TRACK_CLOCK_MS) / DURATION_MS) * 100}%`,
    );
  });
});
