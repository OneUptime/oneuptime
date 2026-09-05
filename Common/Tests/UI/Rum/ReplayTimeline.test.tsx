import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it } from "@jest/globals";
import ReplayTimeline, {
  ReplayTimelineProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTimeline";
import {
  ReplayTimelineMarker,
  ReplayTrackBand,
  buildExactMarkers,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTimelineMath";
import { ReplaySignal } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignalTypes";

/*
 * The track and its lanes, rendered. The Dashboard resolves its own copy
 * of react; Common's jest moduleNameMapper pins it (see
 * ReplayStage.test.tsx for why the path-based version broke CI).
 *
 * What is pinned: one seek per drag (each seek can rebuild the Replayer
 * and fetch chunks), marker clicks that land a second early and select
 * the row, clustering into count pills, labelled and focusable gap/idle
 * bands, the hover bubble and preview card at the cursor, the wheel
 * nudge, the ARIA slider values and keys, and the two pointer rules from
 * finding 19 (non-primary buttons ignored, pointercancel never seeks).
 */

const DURATION_MS: number = 600000;
const TRACK_WIDTH: number = 1000;

function signal(
  overrides: Partial<ReplaySignal> & { id: string },
): ReplaySignal {
  return {
    kind: "network",
    source: "recording",
    offsetMs: 0,
    severity: "info",
    title: overrides.id,
    links: {},
    detail: {},
    ...overrides,
  };
}

function makeProps(
  overrides?: Partial<ReplayTimelineProps>,
): ReplayTimelineProps {
  return {
    durationMs: DURATION_MS,
    currentTimeMs: 0,
    bands: [],
    markers: [],
    onSeek: (): void => {
      // overridden per test
    },
    ...overrides,
  };
}

/*
 * jsdom gives every element a zero-size rect, so the track has to be told
 * how wide it is before clientX can mean anything.
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
  const track: HTMLElement = screen.getByTestId("timeline-track");

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
 * fireEvent.pointerDown builds a bare Event in jsdom, which drops clientX
 * and makes every offset NaN. A MouseEvent carries the coordinates and
 * React dispatches purely on the type name; `button` defaults to 0.
 */
function firePointer(
  track: HTMLElement,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  clientX: number,
  init?: MouseEventInit,
): void {
  fireEvent(
    track,
    new MouseEvent(type, {
      clientX: clientX,
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  );
}

describe("ReplayTimeline dragging", () => {
  it("seeks exactly once per drag, on release, with the final position", () => {
    const seeks: Array<number> = [];

    render(
      <ReplayTimeline
        {...makeProps({
          onSeek: (offsetMs: number): void => {
            seeks.push(offsetMs);
          },
        })}
      />,
    );

    const track: HTMLElement = getTrack();

    firePointer(track, "pointerdown", 100);
    firePointer(track, "pointermove", 200);
    firePointer(track, "pointermove", 400);
    firePointer(track, "pointermove", 750);

    expect(seeks).toEqual([]);

    firePointer(track, "pointerup", 750);

    expect(seeks).toEqual([0.75 * DURATION_MS]);
  });

  it("moves the playhead while dragging even though it has not seeked", () => {
    render(<ReplayTimeline {...makeProps({ currentTimeMs: 0 })} />);

    const track: HTMLElement = getTrack();

    firePointer(track, "pointerdown", 500);
    firePointer(track, "pointermove", 500);

    expect(track.getAttribute("aria-valuenow")).toBe(String(0.5 * DURATION_MS));
  });

  it("still seeks on a plain click with no movement", () => {
    const seeks: Array<number> = [];

    render(
      <ReplayTimeline
        {...makeProps({
          onSeek: (offsetMs: number): void => {
            seeks.push(offsetMs);
          },
        })}
      />,
    );

    const track: HTMLElement = getTrack();

    firePointer(track, "pointerdown", 250);
    firePointer(track, "pointerup", 250);

    expect(seeks).toEqual([0.25 * DURATION_MS]);
  });

  it("ignores a right-click and never seeks on pointercancel", () => {
    const seeks: Array<number> = [];

    render(
      <ReplayTimeline
        {...makeProps({
          currentTimeMs: 120000,
          onSeek: (offsetMs: number): void => {
            seeks.push(offsetMs);
          },
        })}
      />,
    );

    const track: HTMLElement = getTrack();

    /* Right button: the context menu, not a scrub. */
    firePointer(track, "pointerdown", 250, { button: 2 });
    firePointer(track, "pointerup", 250, { button: 2 });

    expect(seeks).toEqual([]);

    /* A real drag the OS then cancels restores the old playhead. */
    firePointer(track, "pointerdown", 100);
    firePointer(track, "pointermove", 600);
    expect(track.getAttribute("aria-valuenow")).toBe(String(0.6 * DURATION_MS));

    firePointer(track, "pointercancel", 600);

    expect(seeks).toEqual([]);
    expect(track.getAttribute("aria-valuenow")).toBe("120000");
  });
});

describe("ReplayTimeline markers", () => {
  const exact: Array<ReplayTimelineMarker> = buildExactMarkers([
    signal({
      id: "rec:1:3",
      kind: "client-error",
      severity: "error",
      offsetMs: 30000,
      title: "TypeError: boom",
    }),
    signal({
      id: "rec:8:0",
      kind: "navigation",
      severity: "info",
      offsetMs: 400000,
      title: "/checkout",
    }),
  ]);

  it("seeks to marker minus one second and selects the signal on click", () => {
    const seeks: Array<number> = [];
    const selected: Array<string> = [];

    render(
      <ReplayTimeline
        {...makeProps({
          markers: exact,
          onSeek: (offsetMs: number): void => {
            seeks.push(offsetMs);
          },
          onSelectSignal: (signalId: string): void => {
            selected.push(signalId);
          },
        })}
      />,
    );

    const errorMarker: HTMLElement = screen.getByTitle("0:30 TypeError: boom");

    fireEvent.click(errorMarker);

    expect(seeks).toEqual([29000]);
    expect(selected).toEqual(["rec:1:3"]);
    expect(errorMarker.getAttribute("data-fidelity")).toBe("exact");
    expect(errorMarker.getAttribute("data-hollow")).toBe("false");
  });

  it("marks the selected signal's marker with aria-current", () => {
    render(
      <ReplayTimeline
        {...makeProps({ markers: exact, selectedSignalId: "rec:8:0" })}
      />,
    );

    const markers: Array<HTMLElement> =
      screen.getAllByTestId("timeline-marker");
    const current: Array<HTMLElement> = markers.filter(
      (marker: HTMLElement) => {
        return marker.getAttribute("aria-current") === "true";
      },
    );

    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute("data-signal-id")).toBe("rec:8:0");
  });

  it("draws coarse markers hollow with an 'approximate' title and no selection", () => {
    const coarse: ReplayTimelineMarker = {
      id: "coarse:errors:4",
      lane: "errors",
      offsetMs: 67500,
      kind: "client-error",
      severity: "error",
      title:
        "~1:07 2 errors in this 15s chunk (approximate, chunk not loaded yet)",
      tone: "rose",
      fidelity: "coarse",
      isHollow: true,
      chunkIndex: 4,
    };
    const seeks: Array<number> = [];
    let selections: number = 0;

    render(
      <ReplayTimeline
        {...makeProps({
          markers: [coarse],
          onSeek: (offsetMs: number): void => {
            seeks.push(offsetMs);
          },
          onSelectSignal: (): void => {
            selections++;
          },
        })}
      />,
    );

    const marker: HTMLElement = screen.getByTestId("timeline-marker");

    expect(marker.getAttribute("data-hollow")).toBe("true");
    expect(marker.getAttribute("title")).toContain(
      "approximate, chunk not loaded yet",
    );

    fireEvent.click(marker);

    expect(seeks).toEqual([66500]);
    expect(selections).toBe(0);
  });

  it("clusters overlapping ticks into one pill with the count and a five-line tooltip", () => {
    const signals: Array<ReplaySignal> = [];

    for (let index: number = 0; index < 7; index++) {
      signals.push(
        signal({
          id: `rec:0:${index}`,
          kind: "network",
          severity: "warn",
          offsetMs: 1000 + index * 500,
          title: `GET 404 /poll/${index}`,
          detail: { status: 404 },
        }),
      );
    }

    const seeks: Array<number> = [];
    const selected: Array<string> = [];

    render(
      <ReplayTimeline
        {...makeProps({
          markers: buildExactMarkers(signals),
          onSeek: (offsetMs: number): void => {
            seeks.push(offsetMs);
          },
          onSelectSignal: (signalId: string): void => {
            selected.push(signalId);
          },
        })}
      />,
    );

    expect(screen.queryAllByTestId("timeline-marker")).toHaveLength(0);

    const pill: HTMLElement = screen.getByTestId("timeline-marker-cluster");

    expect(pill).toHaveTextContent("7");
    expect(pill.getAttribute("data-count")).toBe("7");

    const tooltipLines: Array<string> = (
      pill.getAttribute("title") || ""
    ).split("\n");

    expect(tooltipLines).toHaveLength(6);
    expect(tooltipLines[5]).toBe("and 2 more");

    fireEvent.click(pill);

    expect(seeks).toEqual([0]);
    expect(selected).toEqual(["rec:0:0"]);
  });

  it("draws a notice marker on the track that seeks to its moment", () => {
    const seeks: Array<number> = [];

    render(
      <ReplayTimeline
        {...makeProps({
          markers: [
            {
              id: "notice:snapshot-too-large",
              lane: "track",
              offsetMs: 90000,
              kind: "notice",
              severity: "warn",
              title: "1:30 Snapshot too large - a stretch may be unplayable",
              tone: "gray",
              fidelity: "exact",
              isHollow: false,
            },
          ],
          onSeek: (offsetMs: number): void => {
            seeks.push(offsetMs);
          },
        })}
      />,
    );

    const notice: HTMLElement = screen.getByTestId("timeline-notice-marker");

    expect(notice.getAttribute("title")).toContain("Snapshot too large");

    fireEvent.click(notice);

    expect(seeks).toEqual([89000]);
  });
});

describe("ReplayTimeline bands", () => {
  const bands: Array<ReplayTrackBand> = [
    { kind: "loaded", startMs: 0, endMs: 60000, label: "1m loaded" },
    {
      kind: "available",
      startMs: 60000,
      endMs: 120000,
      label: "1m not yet loaded",
    },
    /* 10% of the track each: wide enough for the inline label. */
    { kind: "gap", startMs: 120000, endMs: 180000, label: "1m missing" },
    {
      kind: "idle",
      startMs: 200000,
      endMs: 260000,
      label: "1m idle",
      fidelity: "exact",
    },
    {
      kind: "background-tab",
      startMs: 300000,
      endMs: 420000,
      label: "tab in background 2m",
      fidelity: "coarse",
    },
  ];

  it("labels gap and idle bands, exposes them to assistive tech and makes them focusable", () => {
    render(<ReplayTimeline {...makeProps({ bands: bands })} />);

    const gap: HTMLElement = screen.getByTestId("timeline-gap-band");

    expect(gap).toHaveTextContent("1m missing");
    expect(gap.getAttribute("aria-label")).toBe("Recording gap: 1m missing");
    expect(gap.getAttribute("tabindex")).toBe("0");

    const idleBands: Array<HTMLElement> =
      screen.getAllByTestId("timeline-idle-band");

    expect(idleBands).toHaveLength(2);
    expect(idleBands[0]).toHaveTextContent("1m idle");
    expect(idleBands[0]?.getAttribute("aria-label")).toBe("Idle: 1m idle");
    expect(idleBands[1]?.getAttribute("data-kind")).toBe("background-tab");
    expect(idleBands[1]?.getAttribute("aria-label")).toBe(
      "Tab in background: tab in background 2m",
    );
    expect(idleBands[1]?.getAttribute("data-fidelity")).toBe("coarse");

    expect(screen.getByTestId("timeline-loaded-band")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-available-band")).toBeInTheDocument();
  });

  it("drops the inline label on a band too narrow to hold it but keeps the name", () => {
    render(
      <ReplayTimeline
        {...makeProps({
          bands: [
            { kind: "gap", startMs: 0, endMs: 3000, label: "3s missing" },
          ],
        })}
      />,
    );

    const gap: HTMLElement = screen.getByTestId("timeline-gap-band");

    expect(gap).toHaveTextContent("");
    expect(gap.getAttribute("title")).toBe("Recording gap: 3s missing");
  });
});

describe("ReplayTimeline hover", () => {
  it("shows a time bubble at the cursor and a preview of the route and nearby signals", () => {
    const signals: Array<ReplaySignal> = [
      signal({
        id: "nav",
        kind: "navigation",
        offsetMs: 100000,
        detail: { to: "/checkout" },
      }),
      signal({ id: "near", offsetMs: 301000, title: "POST 500 /api/pay" }),
      signal({ id: "far", offsetMs: 330000, title: "far away" }),
    ];

    render(<ReplayTimeline {...makeProps({ signals: signals })} />);

    const track: HTMLElement = getTrack();

    firePointer(track, "pointermove", 500);

    expect(screen.getByTestId("timeline-hover-time")).toHaveTextContent(
      "5:00.0",
    );

    const preview: HTMLElement = screen.getByTestId("timeline-hover-preview");

    expect(preview).toHaveTextContent("/checkout");
    expect(preview).toHaveTextContent("POST 500 /api/pay");
    expect(preview).not.toHaveTextContent("far away");
    expect(screen.getAllByTestId("timeline-hover-preview-signal")).toHaveLength(
      1,
    );

    fireEvent.pointerLeave(track);

    expect(screen.queryByTestId("timeline-hover-time")).toBeNull();
  });

  it("reports the hovered offset to the parent and null on leave", () => {
    const hovers: Array<number | null> = [];

    render(
      <ReplayTimeline
        {...makeProps({
          onHover: (offsetMs: number | null): void => {
            hovers.push(offsetMs);
          },
        })}
      />,
    );

    const track: HTMLElement = getTrack();

    firePointer(track, "pointermove", 100);
    fireEvent.pointerLeave(track);

    expect(hovers).toEqual([0.1 * DURATION_MS, null]);
  });

  it("draws a ghost playhead for a hovered rail row", () => {
    render(<ReplayTimeline {...makeProps({ ghostMs: 300000 })} />);

    expect(screen.getByTestId("timeline-ghost-playhead").style.left).toBe(
      "50%",
    );
  });
});

describe("ReplayTimeline wheel and slider keys", () => {
  it("nudges one second per wheel tick and does not scroll the page", () => {
    const seeks: Array<number> = [];

    render(
      <ReplayTimeline
        {...makeProps({
          currentTimeMs: 30000,
          onSeek: (offsetMs: number): void => {
            seeks.push(offsetMs);
          },
        })}
      />,
    );

    const track: HTMLElement = screen.getByTestId("timeline-track");
    const down: WheelEvent = new WheelEvent("wheel", {
      deltaY: 120,
      bubbles: true,
      cancelable: true,
    });
    const up: WheelEvent = new WheelEvent("wheel", {
      deltaY: -120,
      bubbles: true,
      cancelable: true,
    });

    fireEvent(track, down);
    fireEvent(track, up);

    expect(seeks).toEqual([31000, 29000]);
    expect(down.defaultPrevented).toBe(true);
  });

  it("exposes slider values and answers the WAI-ARIA slider keys itself", () => {
    const seeks: Array<number> = [];

    render(
      <ReplayTimeline
        {...makeProps({
          currentTimeMs: 65000,
          onSeek: (offsetMs: number): void => {
            seeks.push(offsetMs);
          },
        })}
      />,
    );

    const track: HTMLElement = screen.getByRole("slider", {
      name: "Replay position",
    });

    expect(track.getAttribute("aria-valuemin")).toBe("0");
    expect(track.getAttribute("aria-valuemax")).toBe(String(DURATION_MS));
    expect(track.getAttribute("aria-valuenow")).toBe("65000");
    expect(track.getAttribute("aria-valuetext")).toBe("1:05 of 10:00");

    fireEvent.keyDown(track, { key: "ArrowRight" });
    fireEvent.keyDown(track, { key: "ArrowLeft", shiftKey: true });
    fireEvent.keyDown(track, { key: "PageUp" });
    fireEvent.keyDown(track, { key: "Home" });
    fireEvent.keyDown(track, { key: "End" });

    expect(seeks).toEqual([70000, 35000, 125000, 0, DURATION_MS]);
  });

  it("does not bubble its own slider keys up to a page-level listener", () => {
    let windowKeys: number = 0;
    const listener: (event: KeyboardEvent) => void = (): void => {
      windowKeys++;
    };

    window.addEventListener("keydown", listener);

    try {
      render(<ReplayTimeline {...makeProps()} />);

      const track: HTMLElement = screen.getByTestId("timeline-track");

      fireEvent.keyDown(track, { key: "ArrowRight" });
      fireEvent.keyDown(track, { key: "k" });

      /* ArrowRight was consumed by the slider; "k" is not a slider key. */
      expect(windowKeys).toBe(1);
    } finally {
      window.removeEventListener("keydown", listener);
    }
  });
});

describe("ReplayTimeline activity lane", () => {
  it("omits the activity lane entirely when nothing was measured", () => {
    render(
      <ReplayTimeline
        {...makeProps({
          activity: [
            {
              chunkIndex: 0,
              startMs: 0,
              endMs: 15000,
              intensity: 0,
              isMeasured: false,
            },
          ],
        })}
      />,
    );

    expect(screen.queryByTestId("timeline-activity")).toBeNull();
  });

  it("draws one heat cell per chunk when counts exist", () => {
    render(
      <ReplayTimeline
        {...makeProps({
          activity: [
            {
              chunkIndex: 0,
              startMs: 0,
              endMs: 15000,
              intensity: 1,
              isMeasured: true,
            },
            {
              chunkIndex: 1,
              startMs: 15000,
              endMs: 30000,
              intensity: 0.25,
              isMeasured: true,
            },
          ],
        })}
      />,
    );

    expect(screen.getByTestId("timeline-activity").children).toHaveLength(2);
  });
});
