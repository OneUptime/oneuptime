import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
/*
 * The Dashboard has its own copy of react, so a component imported from there
 * would otherwise call hooks on a DIFFERENT React instance than the one
 * react-dom renders with. Common's jest moduleNameMapper pins react,
 * react-dom and react-router-dom to this project's single copy for every
 * importer; see the note at the top of ReplayStage.test.tsx.
 */
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, jest } from "@jest/globals";
import { ReplayTimelineEvent } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ChunkLoader";
import ReplayDevtoolsPanel, {
  getActiveRowIndex,
  matchesReplayEventSearch,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayDevtoolsPanel";

/*
 * The events rail beside the picture.
 *
 * Two things are being pinned here, and both were reported as bugs rather
 * than as missing features:
 *
 *  1. THE RAIL IS VISIBLE WITHOUT BEING ASKED FOR. It used to be a collapsed
 *     accordion below the scrubber, which meant the correlated console,
 *     network and route data - the half of a session replay that answers
 *     "what was the app doing when that happened" - was something you had to
 *     go looking for, and clicking one of its rows was the thing people
 *     discovered by accident when playback would not start.
 *
 *  2. IT IS SYNCED TO THE PLAYHEAD. The active row, the merged chronological
 *     stream, and the dimming of events the playhead has not reached are the
 *     whole claim of the panel, so they are asserted directly rather than
 *     through the rendering.
 */

const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";

function networkEvent(
  offsetMs: number,
  overrides?: Partial<ReplayTimelineEvent>,
): ReplayTimelineEvent {
  return {
    kind: "network",
    chunkIndex: Math.floor(offsetMs / 15000),
    offsetMs: offsetMs,
    method: "POST",
    url: "https://api.example.com/orders",
    status: 500,
    durationMs: 220,
    responseBytes: 512,
    ...overrides,
  };
}

function consoleEvent(
  offsetMs: number,
  message: string,
  level: string = "error",
): ReplayTimelineEvent {
  return {
    kind: "console",
    chunkIndex: Math.floor(offsetMs / 15000),
    offsetMs: offsetMs,
    level: level,
    message: message,
  };
}

function routeEvent(offsetMs: number, to: string): ReplayTimelineEvent {
  return {
    kind: "route",
    chunkIndex: Math.floor(offsetMs / 15000),
    offsetMs: offsetMs,
    from: "/cart",
    to: to,
  };
}

function renderPanel(options?: {
  events?: Array<ReplayTimelineEvent>;
  currentTimeMs?: number;
  isTruncated?: boolean;
  onSeek?: (offsetMs: number) => void;
}): { seeks: Array<number> } {
  const seeks: Array<number> = [];

  render(
    <MemoryRouter>
      <ReplayDevtoolsPanel
        events={
          options?.events ?? [
            networkEvent(2000),
            consoleEvent(2500, "order save failed"),
            routeEvent(4000, "/checkout"),
          ]
        }
        isTruncated={options?.isTruncated ?? false}
        currentTimeMs={options?.currentTimeMs ?? 0}
        isPlaying={false}
        onSeek={
          options?.onSeek ??
          ((offsetMs: number): void => {
            seeks.push(offsetMs);
          })
        }
      />
    </MemoryRouter>,
  );

  return { seeks: seeks };
}

function rowButtons(): Array<HTMLElement> {
  return screen
    .getAllByTitle("Jump to this moment")
    .filter((element: HTMLElement): boolean => {
      return element.tagName.toLowerCase() === "button";
    });
}

describe("ReplayDevtoolsPanel visibility", () => {
  it("shows the events without anyone having to open a disclosure first", () => {
    renderPanel();

    /*
     * No "Show"/"Hide" toggle, and rows present on the first render. The
     * old accordion rendered neither until it was clicked.
     */
    expect(screen.queryByText("Show")).not.toBeInTheDocument();
    expect(rowButtons()).toHaveLength(3);
  });

  it("offers a merged stream as the default tab, in chronological order", () => {
    /*
     * Deliberately handed in out of order: chunks are admitted in whatever
     * order the seek pattern asked for, so extraction order is not
     * chronological and a stream that trusted it would put minute nine
     * above minute two.
     */
    renderPanel({
      events: [
        routeEvent(9000, "/thanks"),
        networkEvent(2000),
        consoleEvent(5000, "retrying"),
      ],
    });

    const rows: Array<HTMLElement> = rowButtons();

    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain("0:02");
    expect(rows[1]!.textContent).toContain("0:05");
    expect(rows[2]!.textContent).toContain("0:09");
  });

  it("counts each kind on its own tab and filters to it when picked", () => {
    renderPanel({
      events: [
        networkEvent(1000),
        networkEvent(3000, { status: 200 }),
        consoleEvent(2000, "boom"),
        routeEvent(4000, "/checkout"),
      ],
    });

    expect(screen.getByText("All (4)")).toBeInTheDocument();
    expect(screen.getByText("Network (2)")).toBeInTheDocument();
    expect(screen.getByText("Console (1)")).toBeInTheDocument();
    expect(screen.getByText("Routes (1)")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Network (2)"));

    expect(rowButtons()).toHaveLength(2);
  });

  it("says the list was cut short rather than quietly showing less", () => {
    renderPanel({ isTruncated: true });

    expect(screen.getByText(/Event list truncated/)).toBeInTheDocument();
  });
});

describe("ReplayDevtoolsPanel playhead sync", () => {
  it("marks the row the playhead has most recently passed", () => {
    renderPanel({
      events: [
        networkEvent(1000),
        consoleEvent(5000, "boom"),
        routeEvent(9000, "/checkout"),
      ],
      currentTimeMs: 6000,
    });

    const rows: Array<HTMLElement> = rowButtons();

    /* The console entry at 5s is the last one before the 6s playhead. */
    expect(rows[1]!.parentElement?.className).toContain("bg-indigo-50");
    expect(rows[0]!.parentElement?.className).not.toContain("bg-indigo-50");
    expect(rows[2]!.parentElement?.className).not.toContain("bg-indigo-50");
  });

  it("dims what has not happened yet instead of hiding it", () => {
    /*
     * Hiding future rows would make the list jump on every event as
     * playback advanced. Dimming keeps "what has happened so far" readable
     * while leaving what is coming in place.
     */
    renderPanel({
      events: [networkEvent(1000), routeEvent(9000, "/checkout")],
      currentTimeMs: 2000,
    });

    const rows: Array<HTMLElement> = rowButtons();

    expect(rows[0]!.className).not.toContain("text-gray-400");
    expect(rows[1]!.className).toContain("text-gray-400");
  });

  describe("getActiveRowIndex", () => {
    const events: Array<ReplayTimelineEvent> = [
      networkEvent(1000),
      consoleEvent(5000, "boom"),
      routeEvent(9000, "/checkout"),
    ];

    it("is -1 before the first event, so nothing is falsely highlighted", () => {
      expect(getActiveRowIndex(events, 0)).toBe(-1);
      expect(getActiveRowIndex(events, 999)).toBe(-1);
    });

    it("includes an event landing exactly on the playhead", () => {
      expect(getActiveRowIndex(events, 1000)).toBe(0);
      expect(getActiveRowIndex(events, 5000)).toBe(1);
    });

    it("stays on the last event once the playhead is past everything", () => {
      expect(getActiveRowIndex(events, 60000)).toBe(2);
    });

    it("is -1 for an empty list", () => {
      expect(getActiveRowIndex([], 5000)).toBe(-1);
    });
  });
});

describe("ReplayDevtoolsPanel seeking", () => {
  it("lands a second before the row's moment, so the cause is on screen", () => {
    const onSeek: (offsetMs: number) => void = jest.fn() as (
      offsetMs: number,
    ) => void;

    renderPanel({
      events: [networkEvent(8000)],
      onSeek: onSeek,
    });

    fireEvent.click(rowButtons()[0]!);

    expect(onSeek).toHaveBeenCalledWith(7000);
  });

  it("never seeks before the start of the recording", () => {
    const onSeek: (offsetMs: number) => void = jest.fn() as (
      offsetMs: number,
    ) => void;

    renderPanel({ events: [networkEvent(200)], onSeek: onSeek });

    fireEvent.click(rowButtons()[0]!);

    expect(onSeek).toHaveBeenCalledWith(0);
  });
});

describe("ReplayDevtoolsPanel trace correlation", () => {
  it("links a request that carried a trace id to that trace", () => {
    renderPanel({ events: [networkEvent(2000, { traceId: TRACE_ID })] });

    const link: HTMLElement = screen.getByText("trace");

    expect(link.closest("a")).toHaveAttribute(
      "href",
      expect.stringContaining(TRACE_ID) as unknown as string,
    );
  });

  it("renders no link for a request with no trace id", () => {
    renderPanel({ events: [networkEvent(2000)] });

    expect(screen.queryByText("trace")).not.toBeInTheDocument();
  });

  it("keeps the link out of the seek button, which would be invalid html", () => {
    /*
     * An <a> nested inside a <button> is invalid, and browsers resolve it
     * by hoisting the anchor out - which breaks the row layout and makes
     * the click target unpredictable. The link is a sibling of the seek
     * button, inside the row.
     */
    renderPanel({ events: [networkEvent(2000, { traceId: TRACE_ID })] });

    const row: HTMLElement = rowButtons()[0]!.parentElement as HTMLElement;

    expect(within(row).getByText("trace")).toBeInTheDocument();
    expect(within(rowButtons()[0]!).queryByText("trace")).toBeNull();
  });
});

describe("ReplayDevtoolsPanel filtering", () => {
  it("filters the visible rows as you type", () => {
    renderPanel({
      events: [
        networkEvent(1000, { url: "https://api.example.com/orders" }),
        networkEvent(2000, { url: "https://api.example.com/cart" }),
        consoleEvent(3000, "order save failed"),
      ],
    });

    fireEvent.change(screen.getByLabelText("Filter events"), {
      target: { value: "cart" },
    });

    const rows: Array<HTMLElement> = rowButtons();

    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("/cart");
  });

  it("says so when a filter matches nothing", () => {
    renderPanel();

    fireEvent.change(screen.getByLabelText("Filter events"), {
      target: { value: "nothing-matches-this" },
    });

    expect(
      screen.getByText("Nothing matches that filter."),
    ).toBeInTheDocument();
  });

  describe("matchesReplayEventSearch", () => {
    it("matches everything on an empty or whitespace query", () => {
      expect(matchesReplayEventSearch(networkEvent(0), "")).toBe(true);
      expect(matchesReplayEventSearch(networkEvent(0), "   ")).toBe(true);
    });

    it("matches a status code typed as a number", () => {
      expect(
        matchesReplayEventSearch(networkEvent(0, { status: 503 }), "503"),
      ).toBe(true);
      expect(
        matchesReplayEventSearch(networkEvent(0, { status: 200 }), "503"),
      ).toBe(false);
    });

    it("is case insensitive across every field a person would type", () => {
      expect(matchesReplayEventSearch(networkEvent(0), "ORDERS")).toBe(true);
      expect(
        matchesReplayEventSearch(consoleEvent(0, "Order Save Failed"), "save"),
      ).toBe(true);
      expect(
        matchesReplayEventSearch(routeEvent(0, "/checkout"), "CHECK"),
      ).toBe(true);
      expect(
        matchesReplayEventSearch(
          networkEvent(0, { traceId: TRACE_ID }),
          TRACE_ID,
        ),
      ).toBe(true);
    });

    it("does not match a status of 0 against the digit zero", () => {
      /*
       * status 0 is "the request never completed", rendered as an em dash
       * rather than a number. Treating it as the text "0" would make a
       * search for "0" - or for "200" - surface every aborted request.
       */
      expect(
        matchesReplayEventSearch(networkEvent(0, { status: 0 }), "0"),
      ).toBe(false);
    });
  });
});
