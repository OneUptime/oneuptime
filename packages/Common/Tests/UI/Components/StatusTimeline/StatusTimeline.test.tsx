/** @timezone UTC */

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
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import StatusTimeline, {
  ComponentProps,
  STATUS_TIMELINE_INITIAL_VISIBLE_ENTRIES,
  StatusTimelineDisplayEntry,
} from "../../../../UI/Components/StatusTimeline/StatusTimeline";
import {
  StatusTimelineWindow,
  StatusTimelineWindowFollow,
} from "../../../../UI/Components/StatusTimeline/StatusTimelineLayout";
import OneUptimeDate from "../../../../Types/Date";
import Timezone from "../../../../Types/Timezone";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * The shared status timeline, drawn: the legend, the band (every status a
 * segment placed and sized by its time, blips widened, clusters that zoom),
 * the list under it grouped by day, and everything a keyboard or a screen
 * reader needs to use it - with a fixed clock and the reader's zone pinned
 * to UTC.
 */

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

const NOW: Date = new Date("2026-10-14T08:36:00.000Z");

const at: (offsetMs: number) => Date = (offsetMs: number): Date => {
  return new Date(NOW.getTime() + offsetMs);
};

const GREEN: string = "#10b981";
const RED: string = "#ef4444";

let counter: number = 0;

const entry: (data: {
  offline?: boolean;
  from: number;
  to: number | null;
  id?: string;
  changedBy?: string;
}) => StatusTimelineDisplayEntry = (data: {
  offline?: boolean;
  from: number;
  to: number | null;
  id?: string;
  changedBy?: string;
}): StatusTimelineDisplayEntry => {
  counter++;

  return {
    id: data.id || `entry-${counter}`,
    statusKey: data.offline ? "offline" : "operational",
    name: data.offline ? "Offline" : "Operational",
    color: data.offline ? RED : GREEN,
    startsAt: at(data.from),
    endsAt: data.to === null ? null : at(data.to),
    rank: data.offline ? 3 : 1,
    changedBy: data.changedBy,
  };
};

const PAST_MONTH: StatusTimelineWindow = {
  start: at(-30 * DAY),
  end: NOW,
};

// Ten days up, a 38-second outage, five days up since - the one in effect.
const HISTORY: Array<StatusTimelineDisplayEntry> = [
  entry({ from: -40 * DAY, to: -5 * DAY, id: "long-up" }),
  entry({
    offline: true,
    from: -5 * DAY,
    to: -5 * DAY + 38 * SECOND,
    id: "blip",
  }),
  entry({
    from: -5 * DAY + 38 * SECOND,
    to: null,
    id: "current",
    changedBy: "Ada Lovelace",
  }),
];

const renderTimeline: (
  overrides?: Partial<ComponentProps>,
) => ReturnType<typeof render> = (
  overrides?: Partial<ComponentProps>,
): ReturnType<typeof render> => {
  return render(
    <StatusTimeline
      entries={HISTORY}
      window={PAST_MONTH}
      emptyMessage="No status recorded for this monitor yet."
      ariaLabel="Status timeline of this monitor"
      showShare={true}
      now={NOW}
      {...(overrides || {})}
    />,
  );
};

const segmentFor: (entryId: string) => HTMLElement = (
  entryId: string,
): HTMLElement => {
  const segment: HTMLElement | undefined = [
    ...screen.queryAllByTestId("status-timeline-segment"),
    ...screen.queryAllByTestId("status-timeline-cluster"),
  ].find((element: HTMLElement): boolean => {
    return (element.getAttribute("data-entry-ids") || "")
      .split(",")
      .includes(entryId);
  });

  expect(segment).toBeDefined();

  return segment!;
};

const entryRow: (entryId: string) => HTMLElement = (
  entryId: string,
): HTMLElement => {
  const row: HTMLElement | undefined = screen
    .getAllByTestId("status-timeline-entry")
    .find((element: HTMLElement): boolean => {
      return element.getAttribute("data-entry-id") === entryId;
    });

  expect(row).toBeDefined();

  return row!;
};

const percentOf: (value: string) => number = (value: string): number => {
  return Number(value.replace("%", ""));
};

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  OneUptimeDate.setUserTimezone("UTC" as Timezone);
  // A reader on a 24-hour clock, whatever the machine running the suite is on.
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

describe("the legend", () => {
  test("names each status with its share of the period and its time", () => {
    renderTimeline();

    const items: Array<HTMLElement> = screen.getAllByTestId(
      "status-timeline-legend-item",
    );

    expect(
      items.map((item: HTMLElement): string | null => {
        return item.textContent;
      }),
    ).toEqual([
      // Never rounded up to a claim it is not.
      "Operational99.99% · 29 days 23 hours",
      "Offline<0.01% · 38 secs",
    ]);
  });

  test("leaves the share out where it means nothing (an incident's states)", () => {
    renderTimeline({ showShare: false });

    expect(
      screen.getAllByTestId("status-timeline-legend-item")[1],
    ).toHaveTextContent(/^Offline38 secs$/);
  });

  test("counts how many times a status came back, but not the one the record mostly sat in", () => {
    renderTimeline({
      entries: [
        entry({ from: -20 * DAY, to: -10 * DAY }),
        entry({ offline: true, from: -10 * DAY, to: -10 * DAY + HOUR }),
        entry({ from: -10 * DAY + HOUR, to: -2 * DAY }),
        entry({ offline: true, from: -2 * DAY, to: -2 * DAY + HOUR }),
        entry({ from: -2 * DAY + HOUR, to: null }),
      ],
    });

    const [up, down] = screen.getAllByTestId("status-timeline-legend-item");

    expect(up).not.toHaveTextContent("times");
    expect(down).toHaveTextContent("2 times");
  });

  test("says what it counts when older changes are not loaded", () => {
    renderTimeline({ loadedFrom: at(-5 * DAY), hiddenOlderCount: 120 });

    expect(screen.getByTestId("status-timeline-legend-note")).toHaveTextContent(
      "Since Oct 9, 08:36:",
    );
  });
});

describe("the band: every status placed and sized by its time", () => {
  test("a segment's place and width are when it began and how long it lasted", () => {
    renderTimeline({
      entries: [
        entry({ from: -30 * DAY, to: -15 * DAY, id: "first-half" }),
        entry({ offline: true, from: -15 * DAY, to: -6 * DAY, id: "outage" }),
        entry({ from: -6 * DAY, to: null, id: "now" }),
      ],
    });

    expect(percentOf(segmentFor("first-half").style.left)).toBeCloseTo(0, 3);
    expect(percentOf(segmentFor("first-half").style.width)).toBeCloseTo(50, 3);
    expect(percentOf(segmentFor("outage").style.left)).toBeCloseTo(50, 3);
    expect(percentOf(segmentFor("outage").style.width)).toBeCloseTo(30, 3);
    expect(percentOf(segmentFor("now").style.left)).toBeCloseTo(80, 3);
    expect(percentOf(segmentFor("now").style.width)).toBeCloseTo(20, 3);
  });

  test("each status is drawn in its own colour", () => {
    renderTimeline();

    expect(segmentFor("current").style.backgroundColor).toBe(
      "rgb(16, 185, 129)",
    );
    expect(segmentFor("blip").style.backgroundColor).toBe("rgb(239, 68, 68)");
  });

  test("the status in effect reads as ongoing up to now", () => {
    renderTimeline();

    const current: HTMLElement = segmentFor("current");

    expect(current).toHaveAttribute("data-ongoing", "true");
    expect(
      percentOf(current.style.left) + percentOf(current.style.width),
    ).toBeCloseTo(100, 3);
    expect(screen.getByTestId("status-timeline-now")).toHaveTextContent("Now");
    expect(current).toHaveAccessibleName(
      "Operational, since Oct 9, 08:36, 4 days 23 hours 59 mins 22 secs so far. Currently Active.",
    );
  });

  test("a 38-second outage in a month is widened so it can be seen and pressed", () => {
    renderTimeline();

    const blip: HTMLElement = segmentFor("blip");

    expect(blip).toHaveAttribute("data-widened", "true");
    // 4px of the 800px a band is laid out at before it is measured.
    expect(percentOf(blip.style.width)).toBeCloseTo(0.5, 3);
    expect(blip).toHaveAccessibleName("Offline, Oct 9, 08:36 – 08:36, 38 secs");
  });

  test("short changes that run together are one cluster, which zooms in to them with a margin", () => {
    const onZoom: MockFunction = getJestMockFunction();

    renderTimeline({
      onZoom: onZoom as unknown as ComponentProps["onZoom"],
      entries: [
        entry({ from: -30 * DAY, to: -10 * DAY }),
        entry({
          offline: true,
          from: -10 * DAY,
          to: -10 * DAY + MINUTE,
          id: "x",
        }),
        entry({
          from: -10 * DAY + MINUTE,
          to: -10 * DAY + 2 * MINUTE,
          id: "y",
        }),
        entry({
          offline: true,
          from: -10 * DAY + 2 * MINUTE,
          to: -10 * DAY + 3 * MINUTE,
          id: "z",
        }),
        entry({ from: -10 * DAY + 3 * MINUTE, to: null }),
      ],
    });

    const cluster: HTMLElement = screen.getByTestId("status-timeline-cluster");

    expect(cluster).toHaveAttribute("data-entry-ids", "x,y,z");
    expect(cluster).toHaveAccessibleName(
      "3 changes from Oct 4, 08:36 to Oct 4, 08:39. Zoom in to see them.",
    );

    fireEvent.click(cluster);

    // A twentieth of their three minutes on each side: none cut at an edge.
    expect(onZoom).toHaveBeenCalledWith({
      start: at(-10 * DAY - 9 * SECOND),
      end: at(-10 * DAY + 3 * MINUTE + 9 * SECOND),
    });
  });

  test("time before the first status says nothing was recorded", () => {
    renderTimeline({ entries: [entry({ from: -2 * DAY, to: null })] });

    const gap: HTMLElement = screen.getByTestId("status-timeline-gap");

    expect(gap).toHaveAttribute("data-kind", "no-data");
    expect(
      within(gap).getByTestId("status-timeline-gap-label"),
    ).toHaveTextContent("No status recorded");
  });

  test("older changes not loaded: the band says how many, and loads them", () => {
    const onLoadOlder: MockFunction = getJestMockFunction();

    renderTimeline({
      entries: [entry({ from: -5 * DAY, to: null })],
      loadedFrom: at(-5 * DAY),
      hiddenOlderCount: 200,
      onLoadOlder: onLoadOlder as unknown as () => void,
    });

    const gap: HTMLElement = screen.getByTestId("status-timeline-gap");

    expect(gap).toHaveAttribute("data-kind", "not-loaded");
    expect(gap).toHaveTextContent("200 older changes not loaded");

    fireEvent.click(screen.getByTestId("status-timeline-gap-load-older"));

    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  test("the band is named for a screen reader, with its period and how to use it", () => {
    renderTimeline();

    expect(screen.getByTestId("status-timeline-band")).toHaveAccessibleName(
      "Status timeline of this monitor, Sep 14, 08:36 to Oct 14, 08:36. Use the arrow keys to move between statuses.",
    );
  });

  test("its axis starts with where the band begins and ends at Now", () => {
    renderTimeline();

    expect(screen.getByTestId("status-timeline-start")).toHaveTextContent(
      "Sep 14",
    );
    expect(
      screen.getAllByTestId("status-timeline-tick").length,
    ).toBeGreaterThan(0);
    expect(screen.getByTestId("status-timeline-now")).toBeInTheDocument();
  });

  test("a period in the past has no Now", () => {
    renderTimeline({
      window: { start: at(-60 * DAY), end: at(-30 * DAY) },
      entries: [entry({ from: -90 * DAY, to: null })],
    });

    expect(screen.queryByTestId("status-timeline-now")).toBeNull();
  });
});

describe("the list: every status, newest first, under the day it began", () => {
  test("day headings in the reader's words, entries newest first", () => {
    renderTimeline();

    expect(
      screen
        .getAllByTestId("status-timeline-day-heading")
        .map((heading: HTMLElement): string | null => {
          return heading.textContent;
        }),
    ).toEqual(["Friday, October 9, 2026", "Friday, September 4, 2026"]);
    expect(
      screen
        .getAllByTestId("status-timeline-entry")
        .map((row: HTMLElement): string | null => {
          return row.getAttribute("data-entry-id");
        }),
    ).toEqual(["current", "blip", "long-up"]);
  });

  test("an entry says its status, when it began and ended, how long it lasted and who changed it", () => {
    renderTimeline();

    const blip: HTMLElement = entryRow("blip");

    expect(
      within(blip).getByTestId("status-timeline-entry-name"),
    ).toHaveTextContent("Offline");
    expect(
      within(blip).getByTestId("status-timeline-entry-range"),
    ).toHaveTextContent("08:36:00 – 08:36:38");
    expect(
      within(blip).getByTestId("state-timeline-duration"),
    ).toHaveTextContent("38 secs");

    const current: HTMLElement = entryRow("current");

    expect(
      within(current).getByTestId("status-timeline-entry-range"),
    ).toHaveTextContent("Since 08:36");
    expect(
      within(current).getByTestId("status-timeline-entry-changed-by"),
    ).toHaveTextContent("by Ada Lovelace");
  });

  test("only the status in effect is marked Currently Active, and its duration counts up", () => {
    renderTimeline();

    expect(
      within(entryRow("current")).getByTestId("currently-active-indicator"),
    ).toBeInTheDocument();
    expect(
      within(entryRow("blip")).queryByTestId("currently-active-indicator"),
    ).toBeNull();
    expect(
      within(entryRow("current")).getByTestId("state-timeline-duration"),
    ).toHaveAttribute("data-live", "true");
  });

  test("a status that lasted weeks ends with its date", () => {
    renderTimeline();

    expect(
      within(entryRow("long-up")).getByTestId("status-timeline-entry-range"),
    ).toHaveTextContent("08:36 – Oct 9, 08:36");
  });

  test("the page's own actions and details are drawn on each entry", () => {
    renderTimeline({
      renderEntryActions: (entryId: string): ReactElement => {
        return <button type="button">{`Menu of ${entryId}`}</button>;
      },
      renderEntryInlineAction: (entryId: string): ReactElement => {
        return <button type="button">{`Cause of ${entryId}`}</button>;
      },
      renderEntryDetails: (entryId: string): ReactElement => {
        return <p>{`Details of ${entryId}`}</p>;
      },
    });

    const blip: HTMLElement = entryRow("blip");

    expect(
      within(blip).getByRole("button", { name: "Menu of blip" }),
    ).toBeInTheDocument();
    expect(
      within(blip).getByRole("button", { name: "Cause of blip" }),
    ).toBeInTheDocument();
    expect(within(blip).getByText("Details of blip")).toBeInTheDocument();
  });

  test("many changes: the newest show, the rest a click away", () => {
    const many: Array<StatusTimelineDisplayEntry> = [];

    for (let index: number = 0; index < 40; index++) {
      many.push(
        entry({
          offline: index % 2 === 1,
          from: -(index + 1) * HOUR,
          to: index === 0 ? null : -index * HOUR,
          id: `many-${index}`,
        }),
      );
    }

    renderTimeline({ entries: many });

    expect(screen.getAllByTestId("status-timeline-entry")).toHaveLength(
      STATUS_TIMELINE_INITIAL_VISIBLE_ENTRIES,
    );
    // Every one of them is still on the band.
    expect(
      [
        ...screen.queryAllByTestId("status-timeline-segment"),
        ...screen.queryAllByTestId("status-timeline-cluster"),
      ].flatMap((element: HTMLElement) => {
        return (element.getAttribute("data-entry-ids") || "").split(",");
      }),
    ).toHaveLength(40);

    fireEvent.click(screen.getByTestId("status-timeline-show-more"));

    expect(screen.getAllByTestId("status-timeline-entry")).toHaveLength(40);
    expect(screen.queryByTestId("status-timeline-show-more")).toBeNull();
  });

  test("a period with nothing in it while later ones may have something says so", () => {
    renderTimeline({
      window: { start: at(-60 * DAY), end: at(-30 * DAY) },
      entries: [],
      isWindowed: true,
    });

    expect(
      screen.getByTestId("status-timeline-nothing-in-window"),
    ).toHaveTextContent("No status recorded in this period.");
    expect(screen.queryByTestId("status-timeline-empty")).toBeNull();
  });

  test("the period before is a click away under the list", () => {
    const onShowEarlier: MockFunction = getJestMockFunction();

    renderTimeline({ onShowEarlier: onShowEarlier as unknown as () => void });

    fireEvent.click(screen.getByTestId("status-timeline-show-earlier"));

    expect(onShowEarlier).toHaveBeenCalledTimes(1);
  });

  test("older changes not loaded: said under the list, with a button to load them", () => {
    const onLoadOlder: MockFunction = getJestMockFunction();

    renderTimeline({
      loadedFrom: at(-5 * DAY),
      hiddenOlderCount: 1,
      onLoadOlder: onLoadOlder as unknown as () => void,
    });

    expect(screen.getByTestId("status-timeline-not-loaded")).toHaveTextContent(
      "1 older change in this period is not loaded yet.",
    );

    fireEvent.click(screen.getByTestId("status-timeline-load-older"));

    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });
});

describe("states around the timeline", () => {
  test("nothing recorded at all: an empty state, with the page's action", () => {
    renderTimeline({
      entries: [],
      emptyAction: <button type="button">Create Monitor Status Event</button>,
    });

    const empty: HTMLElement = screen.getByTestId("status-timeline-empty");

    expect(empty).toHaveTextContent("No status recorded for this monitor yet.");
    expect(
      within(empty).getByRole("button", {
        name: "Create Monitor Status Event",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("status-timeline-band")).toBeNull();
  });

  test("loading: a skeleton a screen reader hears as loading", () => {
    renderTimeline({ isLoading: true });

    expect(
      screen.getByRole("status", { name: "Loading status timeline" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("status-timeline-band")).toBeNull();
  });

  test("a failed read says why, with a way to try again", () => {
    const onRetry: MockFunction = getJestMockFunction();

    renderTimeline({
      error: "Error connecting to server.",
      onRetry: onRetry as unknown as () => void,
    });

    expect(screen.getByText("Error connecting to server.")).toBeInTheDocument();
    expect(screen.queryByTestId("status-timeline-band")).toBeNull();
  });
});

describe("one view: the band and the list point at each other", () => {
  test("pointing at an entry in the list picks it out on the band", () => {
    renderTimeline();

    fireEvent.mouseEnter(entryRow("blip"));

    expect(segmentFor("blip").className).toContain("opacity-100");
    expect(segmentFor("current").className).toContain("opacity-40");

    fireEvent.mouseLeave(entryRow("blip"));

    expect(segmentFor("current").className).toContain("opacity-100");
  });

  test("choosing a segment shows its entry in the list, chosen", () => {
    renderTimeline();

    fireEvent.click(segmentFor("blip"), { detail: 1 });

    expect(segmentFor("blip")).toHaveAttribute("aria-pressed", "true");
    expect(entryRow("blip")).toHaveAttribute("data-selected", "true");
    expect(entryRow("blip")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("status-timeline-selection")).toBeInTheDocument();
    // A click does not take the focus out of the band.
    expect(document.activeElement).not.toBe(entryRow("blip"));

    // Choosing it again lets it go.
    fireEvent.click(segmentFor("blip"), { detail: 1 });

    expect(entryRow("blip")).toHaveAttribute("data-selected", "false");
  });

  test("choosing a folded entry unfolds the list to it", () => {
    const many: Array<StatusTimelineDisplayEntry> = [];

    for (let index: number = 0; index < 40; index++) {
      many.push(
        entry({
          offline: index % 2 === 1,
          from: (-(index + 1) * DAY) / 2,
          to: index === 0 ? null : (-index * DAY) / 2,
          id: `folded-${index}`,
        }),
      );
    }

    renderTimeline({ entries: many });

    expect(
      screen
        .getAllByTestId("status-timeline-entry")
        .some((row: HTMLElement): boolean => {
          return row.getAttribute("data-entry-id") === "folded-38";
        }),
    ).toBe(false);

    fireEvent.click(segmentFor("folded-38"), { detail: 1 });

    expect(entryRow("folded-38")).toHaveAttribute("data-selected", "true");
  });
});

describe("the band works from the keyboard", () => {
  test("it is one tab stop, on the newest status", () => {
    renderTimeline();

    const marks: Array<HTMLElement> = screen.getAllByTestId(
      "status-timeline-segment",
    );
    const tabbable: Array<HTMLElement> = marks.filter(
      (mark: HTMLElement): boolean => {
        return mark.tabIndex === 0;
      },
    );

    expect(tabbable).toEqual([segmentFor("current")]);
  });

  test("the arrow keys, Home and End move along it", () => {
    renderTimeline();

    act(() => {
      segmentFor("current").focus();
    });

    fireEvent.keyDown(segmentFor("current"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(segmentFor("blip"));

    fireEvent.keyDown(segmentFor("blip"), { key: "Home" });
    expect(document.activeElement).toBe(segmentFor("long-up"));

    fireEvent.keyDown(segmentFor("long-up"), { key: "End" });
    expect(document.activeElement).toBe(segmentFor("current"));

    // The tab stop follows the focus.
    fireEvent.keyDown(segmentFor("current"), { key: "ArrowLeft" });
    expect(segmentFor("blip").tabIndex).toBe(0);
    expect(segmentFor("current").tabIndex).toBe(-1);
  });

  test("Enter takes the keyboard to the status in the list, where its actions are", () => {
    renderTimeline({
      renderEntryActions: (entryId: string): ReactElement => {
        return <button type="button">{`Menu of ${entryId}`}</button>;
      },
    });

    // A click from Enter or Space is a click with no detail.
    fireEvent.click(segmentFor("blip"), { detail: 0 });

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(entryRow("blip")).toHaveAttribute("data-selected", "true");
    expect(document.activeElement).toBe(entryRow("blip"));
  });

  test("Escape lets the chosen status go", () => {
    renderTimeline();

    fireEvent.click(segmentFor("blip"), { detail: 1 });
    fireEvent.keyDown(segmentFor("blip"), { key: "Escape" });

    expect(entryRow("blip")).toHaveAttribute("data-selected", "false");
  });
});

describe("a period counted back from now keeps up with the clock", () => {
  test("Past 1 Month slides along: Now stays at the band's end", () => {
    const { rerender } = renderTimeline({
      followsNow: StatusTimelineWindowFollow.Slide,
    });

    rerender(
      <StatusTimeline
        entries={HISTORY}
        window={PAST_MONTH}
        emptyMessage="No status recorded for this monitor yet."
        ariaLabel="Status timeline of this monitor"
        showShare={true}
        now={at(10 * MINUTE)}
        followsNow={StatusTimelineWindowFollow.Slide}
      />,
    );

    expect(screen.getByTestId("status-timeline-now")).toBeInTheDocument();
    expect(segmentFor("current")).toHaveAttribute("data-ongoing", "true");
    expect(screen.getByTestId("status-timeline-band")).toHaveAccessibleName(
      /Sep 14, 08:46 to Oct 14, 08:46/,
    );
  });

  test("a fixed period does not move", () => {
    const { rerender } = renderTimeline();

    rerender(
      <StatusTimeline
        entries={HISTORY}
        window={PAST_MONTH}
        emptyMessage="No status recorded for this monitor yet."
        ariaLabel="Status timeline of this monitor"
        showShare={true}
        now={at(10 * MINUTE)}
      />,
    );

    expect(screen.queryByTestId("status-timeline-now")).toBeNull();
  });
});
