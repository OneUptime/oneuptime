import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it } from "@jest/globals";
/*
 * The Dashboard resolves its own copy of react, which would give the component
 * a different hook dispatcher than the one react-dom renders with. Pinned in
 * Common's jest moduleNameMapper rather than mocked by absolute path here -
 * see ReplayStage.test.tsx for why the path-based version broke CI.
 */
import ReplayScrubber, {
  ReplayScrubberProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayScrubber";

/*
 * The scrubber's two expensive mistakes are both invisible in a screenshot:
 * seeking on every pointermove (each one re-instantiates the Replayer and
 * POSTs /chunks), and swallowing Space from focused buttons (which makes the
 * player unusable with a keyboard). Both are pinned here.
 */

const DURATION_MS: number = 600000;
const TRACK_WIDTH: number = 1000;

function makeProps(
  overrides?: Partial<ReplayScrubberProps>,
): ReplayScrubberProps {
  return {
    durationMs: DURATION_MS,
    currentTimeMs: 0,
    isPlaying: false,
    speed: 1,
    skipInactive: false,
    bands: [],
    frustrationMarkers: [],
    errorMarkers: [],
    networkMarkers: [],
    routeMarkers: [],
    onSeek: (): void => {
      // overridden per test
    },
    onPlayPauseToggle: (): void => {
      // overridden per test
    },
    onSpeedChange: (): void => {
      // not asserted here
    },
    onSkipInactiveChange: (): void => {
      // not asserted here
    },
    onJumpToNextError: (): void => {
      // not asserted here
    },
    ...overrides,
  };
}

/*
 * jsdom gives every element a zero-size rect, so the track has to be told how
 * wide it is before clientX can mean anything.
 */
function stubTrackRect(track: HTMLElement): void {
  track.getBoundingClientRect = (): DOMRect => {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: TRACK_WIDTH,
      bottom: 24,
      width: TRACK_WIDTH,
      height: 24,
      toJSON: (): unknown => {
        return {};
      },
    } as DOMRect;
  };
}

function getTrack(): HTMLElement {
  const track: HTMLElement = screen.getByRole("slider", {
    name: "Replay position",
  });

  stubTrackRect(track);

  // jsdom implements neither pointer capture nor PointerEvent.
  track.setPointerCapture = (): void => {
    // no-op
  };
  track.hasPointerCapture = (): boolean => {
    return false;
  };

  return track;
}

/*
 * fireEvent.pointerDown builds a bare Event in jsdom, which drops clientX and
 * makes every offset NaN. A MouseEvent carries the coordinates and React
 * dispatches purely on the type name.
 */
function firePointer(
  track: HTMLElement,
  type: "pointerdown" | "pointermove" | "pointerup",
  clientX: number,
): void {
  fireEvent(
    track,
    new MouseEvent(type, {
      clientX: clientX,
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe("ReplayScrubber dragging", () => {
  it("seeks exactly once per drag, on release, with the final position", () => {
    /*
     * Seeking per pointermove is what makes the stage strobe: every call
     * bumps the player's seek token, and any target across a snapshot anchor
     * destroys the Replayer, drops the decoded LRU and issues a fresh
     * authenticated POST to /chunks. One drag would be dozens of each.
     */
    const seeks: Array<number> = [];
    const props: ReplayScrubberProps = makeProps({
      onSeek: (offsetMs: number): void => {
        seeks.push(offsetMs);
      },
    });

    render(<ReplayScrubber {...props} />);

    const track: HTMLElement = getTrack();

    firePointer(track, "pointerdown", 100);
    firePointer(track, "pointermove", 200);
    firePointer(track, "pointermove", 400);
    firePointer(track, "pointermove", 750);

    // Nothing committed yet.
    expect(seeks).toEqual([]);

    firePointer(track, "pointerup", 750);

    expect(seeks).toEqual([0.75 * DURATION_MS]);
  });

  it("moves the playhead while dragging even though it has not seeked", () => {
    const props: ReplayScrubberProps = makeProps({ currentTimeMs: 0 });

    render(<ReplayScrubber {...props} />);

    const track: HTMLElement = getTrack();

    firePointer(track, "pointerdown", 500);
    firePointer(track, "pointermove", 500);

    expect(track.getAttribute("aria-valuenow")).toBe(String(0.5 * DURATION_MS));
  });

  it("still seeks on a plain click with no movement", () => {
    const seeks: Array<number> = [];
    const props: ReplayScrubberProps = makeProps({
      onSeek: (offsetMs: number): void => {
        seeks.push(offsetMs);
      },
    });

    render(<ReplayScrubber {...props} />);

    const track: HTMLElement = getTrack();

    firePointer(track, "pointerdown", 250);
    firePointer(track, "pointerup", 250);

    expect(seeks).toEqual([0.25 * DURATION_MS]);
  });
});

describe("ReplayScrubber keyboard shortcuts", () => {
  it("toggles play/pause on Space when nothing focusable owns the key", () => {
    let toggles: number = 0;
    const props: ReplayScrubberProps = makeProps({
      onPlayPauseToggle: (): void => {
        toggles++;
      },
    });

    render(<ReplayScrubber {...props} />);

    fireEvent.keyDown(document.body, { key: " " });

    expect(toggles).toBe(1);
  });

  it("leaves Space alone when a button has focus", () => {
    /*
     * The handler is bound to window for the scrubber's whole lifetime. If it
     * swallows Space from a focused control, a keyboard-only user cannot
     * press "Session details", a speed button, a tab or an error marker
     * anywhere on the player page.
     */
    let toggles: number = 0;
    const props: ReplayScrubberProps = makeProps({
      onPlayPauseToggle: (): void => {
        toggles++;
      },
    });

    render(<ReplayScrubber {...props} />);

    const speedButton: HTMLElement = screen.getByText("4x");
    fireEvent.keyDown(speedButton, { key: " " });

    expect(toggles).toBe(0);
  });

  it("still moves the playhead with the arrow keys", () => {
    const seeks: Array<number> = [];
    const props: ReplayScrubberProps = makeProps({
      currentTimeMs: 30000,
      onSeek: (offsetMs: number): void => {
        seeks.push(offsetMs);
      },
    });

    render(<ReplayScrubber {...props} />);

    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    fireEvent.keyDown(document.body, { key: "ArrowRight" });

    expect(seeks).toEqual([20000, 40000]);
  });
});
