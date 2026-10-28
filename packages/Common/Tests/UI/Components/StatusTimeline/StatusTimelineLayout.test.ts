import { describe, expect, test } from "@jest/globals";
import {
  CONTINUATION_FADE_PX,
  DEFAULT_BAND_WIDTH_PX,
  estimateStatusTimelineLabelWidthPx,
  followStatusTimelineWindow,
  formatStatusTimelineCompactDuration,
  formatStatusTimelineShare,
  getClusterColor,
  getNextStatusTimelineMarkIndex,
  getStatusTimelineContinuationMask,
  getStatusTimelineFitWindow,
  getStatusTimelineTicks,
  getStatusTimelineZoomWindow,
  getVisibleStatusTimelineTickIndexes,
  isStatusTimelineWindowAtNow,
  layoutStatusTimelineBand,
  MIN_MARK_PX,
  MIN_ZOOM_WINDOW_MS,
  NOW_TOLERANCE_MS,
  RECENT_CHANGE_SPAN_RATIO,
  resolveStatusTimelineEntries,
  ResolvedStatusTimelineEntry,
  shiftStatusTimelineWindow,
  StatusTimelineBandGap,
  StatusTimelineBandLayout,
  StatusTimelineBandMark,
  StatusTimelineEntry,
  StatusTimelineGapKind,
  StatusTimelineSummary,
  StatusTimelineSummaryItem,
  StatusTimelineTick,
  StatusTimelineTickUnit,
  StatusTimelineWindow,
  StatusTimelineWindowFollow,
  summarizeStatusTimeline,
} from "../../../../UI/Components/StatusTimeline/StatusTimelineLayout";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

/*
 * The geometry of a status timeline: which entry ends when, where each
 * segment of the band sits and how wide it is, which short entries are
 * widened and which run together into one cluster, what the band says over
 * time no entry covers, the legend's figures, the axis, and how the reader
 * moves through time. Every rule with fixed instants, so nothing depends on
 * when the suite runs.
 */

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

const NOW: Date = new Date("2026-10-14T08:36:00.000Z");

const GREEN: string = "#10b981";
const RED: string = "#ef4444";
const AMBER: string = "#f59e0b";

const at: (offsetMs: number) => Date = (offsetMs: number): Date => {
  return new Date(NOW.getTime() + offsetMs);
};

let idCounter: number = 0;

const entry: (data: {
  status?: "operational" | "offline" | "degraded";
  from: number;
  to: number | null;
  id?: string;
  rank?: number | undefined;
}) => StatusTimelineEntry = (data: {
  status?: "operational" | "offline" | "degraded";
  from: number;
  to: number | null;
  id?: string;
  rank?: number | undefined;
}): StatusTimelineEntry => {
  idCounter++;
  const status: "operational" | "offline" | "degraded" =
    data.status || "operational";

  return {
    id: data.id || `entry-${String(idCounter).padStart(4, "0")}`,
    statusKey: status,
    name:
      status === "operational"
        ? "Operational"
        : status === "offline"
          ? "Offline"
          : "Degraded",
    color:
      status === "operational" ? GREEN : status === "offline" ? RED : AMBER,
    startsAt: at(data.from),
    endsAt: data.to === null ? null : at(data.to),
    rank:
      data.rank !== undefined
        ? data.rank
        : status === "operational"
          ? 1
          : status === "degraded"
            ? 2
            : 3,
  };
};

const windowOf: (fromMs: number, toMs: number) => StatusTimelineWindow = (
  fromMs: number,
  toMs: number,
): StatusTimelineWindow => {
  return { start: at(fromMs), end: at(toMs) };
};

const layout: (data: {
  entries: Array<StatusTimelineEntry>;
  window: StatusTimelineWindow;
  widthPx?: number;
  loadedFrom?: Date | null;
  now?: Date;
}) => StatusTimelineBandLayout = (data: {
  entries: Array<StatusTimelineEntry>;
  window: StatusTimelineWindow;
  widthPx?: number;
  loadedFrom?: Date | null;
  now?: Date;
}): StatusTimelineBandLayout => {
  const now: Date = data.now || NOW;

  return layoutStatusTimelineBand({
    entries: resolveStatusTimelineEntries(data.entries, now),
    window: data.window,
    now: now,
    widthPx: data.widthPx ?? 1000,
    loadedFrom: data.loadedFrom,
  });
};

const markFor: (
  bandLayout: StatusTimelineBandLayout,
  entryId: string,
) => StatusTimelineBandMark = (
  bandLayout: StatusTimelineBandLayout,
  entryId: string,
): StatusTimelineBandMark => {
  const found: StatusTimelineBandMark | undefined = bandLayout.marks.find(
    (mark: StatusTimelineBandMark): boolean => {
      return mark.entryIds.includes(entryId);
    },
  );

  expect(found).toBeDefined();

  return found!;
};

/*
 * The maintainer's screenshot, as offsets from now: 5 days Operational (in
 * effect), a 38 s Offline blip, 5 days Operational, a 49 s blip, then the
 * Oct 4 morning's four quick changes, and 18 days Operational before them.
 */
const screenshotEntries: () => Array<StatusTimelineEntry> =
  (): Array<StatusTimelineEntry> => {
    const lengths: Array<["operational" | "offline", number]> = [
      ["operational", 5 * DAY + HOUR + 9 * MINUTE + 21 * SECOND],
      ["offline", 38 * SECOND],
      ["operational", 5 * DAY + 54 * MINUTE + 12 * SECOND],
      ["offline", 49 * SECOND],
      ["operational", 3 * MINUTE + 51 * SECOND],
      ["offline", MINUTE + 43 * SECOND],
      ["operational", 55 * MINUTE + 29 * SECOND],
      ["offline", 12 * MINUTE + 2 * SECOND],
      ["operational", 18 * DAY + 12 * HOUR + 7 * MINUTE + 8 * SECOND],
      ["offline", 20 * SECOND],
    ];

    const result: Array<StatusTimelineEntry> = [];
    let end: number = 0;

    lengths.forEach(
      (
        [status, length]: ["operational" | "offline", number],
        index: number,
      ) => {
        const from: number = end - length;
        result.push(
          entry({
            status,
            from: from,
            to: index === 0 ? null : end,
            id: `screenshot-${index}`,
          }),
        );
        end = from;
      },
    );

    return result;
  };

describe("resolveStatusTimelineEntries", () => {
  test("orders entries oldest first, whatever order they came in", () => {
    const resolved: Array<ResolvedStatusTimelineEntry> =
      resolveStatusTimelineEntries(
        [
          entry({ from: -HOUR, to: null, id: "c" }),
          entry({ from: -3 * HOUR, to: -2 * HOUR, id: "a" }),
          entry({ from: -2 * HOUR, to: -HOUR, id: "b" }),
        ],
        NOW,
      );

    expect(
      resolved.map((item: ResolvedStatusTimelineEntry): string => {
        return item.id;
      }),
    ).toEqual(["a", "b", "c"]);
  });

  test("two entries that start together keep the order of their ids", () => {
    const resolved: Array<ResolvedStatusTimelineEntry> =
      resolveStatusTimelineEntries(
        [
          entry({ from: -HOUR, to: -HOUR, id: "zz" }),
          entry({ from: -HOUR, to: null, id: "aa" }),
        ],
        NOW,
      );

    expect(resolved[0]!.id).toBe("aa");
    expect(resolved[1]!.id).toBe("zz");
  });

  test("leaves out an entry with no usable start", () => {
    const broken: StatusTimelineEntry = {
      ...entry({ from: -HOUR, to: null }),
      startsAt: new Date("not a date"),
    };

    expect(resolveStatusTimelineEntries([broken], NOW)).toEqual([]);
  });

  test("the newest entry with no end is the one in effect: it runs to now", () => {
    const resolved: Array<ResolvedStatusTimelineEntry> =
      resolveStatusTimelineEntries(
        [
          entry({ from: -2 * HOUR, to: -HOUR, id: "old" }),
          entry({ from: -HOUR, to: null, id: "current" }),
        ],
        NOW,
      );

    expect(resolved[1]!.isOngoing).toBe(true);
    expect(resolved[1]!.listEnd).toBeNull();
    expect(resolved[1]!.bandEnd.getTime()).toBe(NOW.getTime());
    expect(resolved[0]!.isOngoing).toBe(false);
  });

  test("an older entry left open is capped at the next one's start, and is not in effect", () => {
    const resolved: Array<ResolvedStatusTimelineEntry> =
      resolveStatusTimelineEntries(
        [
          entry({ from: -3 * HOUR, to: null, id: "orphan" }),
          entry({ from: -HOUR, to: null, id: "current" }),
        ],
        NOW,
      );

    expect(resolved[0]!.isOngoing).toBe(false);
    expect(resolved[0]!.listEnd!.getTime()).toBe(at(-HOUR).getTime());
    expect(resolved[0]!.bandEnd.getTime()).toBe(at(-HOUR).getTime());
    expect(resolved[1]!.isOngoing).toBe(true);
  });

  test("an entry recorded as running past the next one is drawn up to it, and listed with its own end", () => {
    const resolved: Array<ResolvedStatusTimelineEntry> =
      resolveStatusTimelineEntries(
        [
          entry({ from: -3 * HOUR, to: -HOUR, id: "long" }),
          entry({ from: -2 * HOUR, to: null, id: "next" }),
        ],
        NOW,
      );

    expect(resolved[0]!.bandEnd.getTime()).toBe(at(-2 * HOUR).getTime());
    expect(resolved[0]!.listEnd!.getTime()).toBe(at(-HOUR).getTime());
  });

  test("an end before the start, or a start ahead of this clock, never draws backwards", () => {
    const resolved: Array<ResolvedStatusTimelineEntry> =
      resolveStatusTimelineEntries(
        [
          entry({ from: -2 * HOUR, to: -3 * HOUR, id: "backwards" }),
          entry({ from: 5 * MINUTE, to: null, id: "future" }),
        ],
        NOW,
      );

    expect(resolved[0]!.bandEnd.getTime()).toBe(at(-2 * HOUR).getTime());
    expect(resolved[1]!.bandEnd.getTime()).toBe(at(5 * MINUTE).getTime());
  });
});

describe("layoutStatusTimelineBand: where each status is drawn", () => {
  test("a segment's place and width are when it began and how long it lasted", () => {
    const bandLayout: StatusTimelineBandLayout = layout({
      entries: [
        entry({ from: -100 * HOUR, to: -75 * HOUR, id: "a" }),
        entry({ status: "offline", from: -75 * HOUR, to: -25 * HOUR, id: "b" }),
        entry({ from: -25 * HOUR, to: null, id: "c" }),
      ],
      window: windowOf(-100 * HOUR, 0),
    });

    expect(markFor(bandLayout, "a").left).toBeCloseTo(0, 6);
    expect(markFor(bandLayout, "a").width).toBeCloseTo(25, 6);
    expect(markFor(bandLayout, "b").left).toBeCloseTo(25, 6);
    expect(markFor(bandLayout, "b").width).toBeCloseTo(50, 6);
    expect(markFor(bandLayout, "c").left).toBeCloseTo(75, 6);
    expect(markFor(bandLayout, "c").width).toBeCloseTo(25, 6);
  });

  test("each segment takes its status's own colour", () => {
    const bandLayout: StatusTimelineBandLayout = layout({
      entries: [
        entry({ from: -10 * HOUR, to: -5 * HOUR, id: "up" }),
        entry({ status: "offline", from: -5 * HOUR, to: null, id: "down" }),
      ],
      window: windowOf(-10 * HOUR, 0),
    });

    expect(markFor(bandLayout, "up").color).toBe(GREEN);
    expect(markFor(bandLayout, "down").color).toBe(RED);
  });

  test("the status in effect runs to now, the band's right end", () => {
    const bandLayout: StatusTimelineBandLayout = layout({
      entries: [entry({ from: -HOUR, to: null, id: "current" })],
      window: windowOf(-4 * HOUR, 0),
    });
    const mark: StatusTimelineBandMark = markFor(bandLayout, "current");

    expect(mark.isOngoing).toBe(true);
    expect(mark.left + mark.width).toBeCloseTo(100, 6);
    expect(mark.continuesAfter).toBe(false);
  });

  test("a status that began before the window is cut at its left edge and says so", () => {
    const bandLayout: StatusTimelineBandLayout = layout({
      entries: [entry({ from: -10 * DAY, to: null, id: "long" })],
      window: windowOf(-DAY, 0),
    });
    const mark: StatusTimelineBandMark = markFor(bandLayout, "long");

    expect(mark.left).toBe(0);
    expect(mark.width).toBeCloseTo(100, 6);
    expect(mark.continuesBefore).toBe(true);
    expect(mark.start.getTime()).toBe(at(-DAY).getTime());
  });

  test("a status that runs on past a window in the past is cut at its right edge and says so", () => {
    const bandLayout: StatusTimelineBandLayout = layout({
      entries: [
        entry({ from: -10 * DAY, to: -DAY, id: "closed" }),
        entry({ from: -DAY, to: null, id: "current" }),
      ],
      window: windowOf(-10 * DAY, -5 * DAY),
    });
    const mark: StatusTimelineBandMark = markFor(bandLayout, "closed");

    expect(mark.continuesAfter).toBe(true);
    expect(mark.left + mark.width).toBeCloseTo(100, 6);
    expect(
      bandLayout.marks.some((item: StatusTimelineBandMark): boolean => {
        return item.entryIds.includes("current");
      }),
    ).toBe(false);
  });

  test("the status in effect does not continue past a window that ends at now, read a moment apart", () => {
    const bandLayout: StatusTimelineBandLayout = layout({
      entries: [entry({ from: -HOUR, to: null, id: "current" })],
      // The caller read the clock 20 seconds before the band did.
      window: windowOf(-4 * HOUR, -20 * SECOND),
    });

    expect(markFor(bandLayout, "current").continuesAfter).toBe(false);
  });

  test("the status in effect continues past a window that ended well before now", () => {
    const bandLayout: StatusTimelineBandLayout = layout({
      entries: [entry({ from: -HOUR, to: null, id: "current" })],
      window: windowOf(-4 * HOUR, -NOW_TOLERANCE_MS - 30 * MINUTE),
    });

    expect(markFor(bandLayout, "current").continuesAfter).toBe(true);
  });

  test("entries outside the window are not drawn", () => {
    const bandLayout: StatusTimelineBandLayout = layout({
      entries: [
        entry({ from: -10 * DAY, to: -9 * DAY, id: "before" }),
        entry({ from: -9 * DAY, to: null, id: "current" }),
      ],
      window: windowOf(-DAY, 0),
    });

    expect(
      bandLayout.marks.flatMap((mark: StatusTimelineBandMark) => {
        return mark.entryIds;
      }),
    ).toEqual(["current"]);
  });

  test("a window of no length draws nothing", () => {
    expect(
      layout({
        entries: [entry({ from: -HOUR, to: null })],
        window: windowOf(0, 0),
      }),
    ).toEqual({ marks: [], gaps: [] });
    expect(
      layout({
        entries: [entry({ from: -HOUR, to: null })],
        window: windowOf(0, -HOUR),
      }),
    ).toEqual({ marks: [], gaps: [] });
  });

  test("an unmeasured band is laid out at the default width", () => {
    const measured: StatusTimelineBandLayout = layout({
      entries: [
        entry({ from: -DAY, to: -DAY + 30 * SECOND, id: "blip" }),
        entry({ from: -DAY + 30 * SECOND, to: null }),
      ],
      window: windowOf(-30 * DAY, 0),
      widthPx: DEFAULT_BAND_WIDTH_PX,
    });
    const unmeasured: StatusTimelineBandLayout = layout({
      entries: [
        entry({ from: -DAY, to: -DAY + 30 * SECOND, id: "blip" }),
        entry({ from: -DAY + 30 * SECOND, to: null }),
      ],
      window: windowOf(-30 * DAY, 0),
      widthPx: 0,
    });

    expect(markFor(unmeasured, "blip").width).toBeCloseTo(
      markFor(measured, "blip").width,
      6,
    );
  });
});

describe("layoutStatusTimelineBand: short blips stay visible and clickable", () => {
  test("a 38-second outage in a month is drawn MIN_MARK_PX wide, centred on when it happened", () => {
    const blipStart: number = -10 * DAY;
    const bandLayout: StatusTimelineBandLayout = layout({
      entries: [
        entry({ from: -40 * DAY, to: blipStart, id: "before" }),
        entry({
          status: "offline",
          from: blipStart,
          to: blipStart + 38 * SECOND,
          id: "blip",
        }),
        entry({ from: blipStart + 38 * SECOND, to: null, id: "after" }),
      ],
      window: windowOf(-30 * DAY, 0),
      widthPx: 1000,
    });
    const blip: StatusTimelineBandMark = markFor(bandLayout, "blip");

    expect(blip.isWidened).toBe(true);
    expect(blip.isCluster).toBe(false);
    expect(blip.width).toBeCloseTo((MIN_MARK_PX / 1000) * 100, 6);
    expect(blip.color).toBe(RED);

    // Centred on the 38 seconds: 20 of the 30 days in, at 2/3 of the band.
    const centre: number = blip.left + blip.width / 2;
    const expected: number = ((20 * DAY + 19 * SECOND) / (30 * DAY)) * 100;
    expect(centre).toBeCloseTo(expected, 3);

    // Its own time, not the widened mark's.
    expect(blip.end.getTime() - blip.start.getTime()).toBe(38 * SECOND);
  });

  test("a blip is drawn on top of the segments around it", () => {
    const bandLayout: StatusTimelineBandLayout = layout({
      entries: screenshotEntries(),
      window: windowOf(-30 * DAY, 0),
    });
    const widened: Array<StatusTimelineBandMark> = bandLayout.marks.filter(
      (mark: StatusTimelineBandMark): boolean => {
        return mark.isWidened;
      },
    );

    expect(widened.length).toBeGreaterThan(0);

    for (const mark of widened) {
      expect(mark.width).toBeGreaterThanOrEqual(
        (MIN_MARK_PX / 1000) * 100 - 1e-9,
      );
    }
  });

  test("a blip at the very start or end stays inside the band", () => {
    const bandLayout: StatusTimelineBandLayout = layout({
      entries: [
        entry({
          status: "offline",
          from: -DAY,
          to: -DAY + SECOND,
          id: "first",
        }),
        entry({ from: -DAY + SECOND, to: -SECOND, id: "middle" }),
        entry({ status: "offline", from: -SECOND, to: null, id: "last" }),
      ],
      window: windowOf(-DAY, 0),
    });

    const first: StatusTimelineBandMark = markFor(bandLayout, "first");
    const last: StatusTimelineBandMark = markFor(bandLayout, "last");

    expect(first.left).toBeGreaterThanOrEqual(0);
    expect(last.left + last.width).toBeLessThanOrEqual(100 + 1e-9);
  });

  test("a status that lasted no time at all is still drawn where it happened", () => {
    const bandLayout: StatusTimelineBandLayout = layout({
      entries: [
        entry({ from: -2 * HOUR, to: -HOUR }),
        entry({ status: "offline", from: -HOUR, to: -HOUR, id: "instant" }),
        entry({ from: -HOUR, to: null }),
      ],
      window: windowOf(-2 * HOUR, 0),
    });

    expect(markFor(bandLayout, "instant").isWidened).toBe(true);
  });

  test("a segment exactly MIN_MARK_PX wide is drawn as it is", () => {
    const pxInMs: number = (2 * HOUR) / 1000;
    const bandLayout: StatusTimelineBandLayout = layout({
      entries: [
        entry({ from: -2 * HOUR, to: -HOUR }),
        entry({
          status: "offline",
          from: -HOUR,
          to: -HOUR + MIN_MARK_PX * pxInMs,
          id: "exact",
        }),
        entry({ from: -HOUR + MIN_MARK_PX * pxInMs, to: null }),
      ],
      window: windowOf(-2 * HOUR, 0),
    });

    expect(markFor(bandLayout, "exact").isWidened).toBe(false);
  });
});

describe("layoutStatusTimelineBand: blips that run together are one cluster", () => {
  test("the Oct 4 morning's quick changes are one cluster in a month, and separate segments once zoomed in", () => {
    const entries: Array<StatusTimelineEntry> = screenshotEntries();

    const month: StatusTimelineBandLayout = layout({
      entries: entries,
      window: windowOf(-30 * DAY, 0),
    });
    const clusters: Array<StatusTimelineBandMark> = month.marks.filter(
      (mark: StatusTimelineBandMark): boolean => {
        return mark.isCluster;
      },
    );

    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.entryIds).toEqual([
      "screenshot-7",
      "screenshot-6",
      "screenshot-5",
      "screenshot-4",
      "screenshot-3",
    ]);
    // The worst status among them shows.
    expect(clusters[0]!.color).toBe(RED);

    const zoomed: StatusTimelineBandLayout = layout({
      entries: entries,
      window: getStatusTimelineZoomWindow({
        start: clusters[0]!.start,
        end: clusters[0]!.end,
        now: NOW,
      }),
    });

    expect(
      zoomed.marks.some((mark: StatusTimelineBandMark): boolean => {
        return mark.isCluster;
      }),
    ).toBe(false);
    for (const id of ["screenshot-7", "screenshot-6", "screenshot-5"]) {
      expect(markFor(zoomed, id).isCluster).toBe(false);
    }
  });

  test("a cluster spans its first to its last entry and lists them oldest first", () => {
    const bandLayout: StatusTimelineBandLayout = layout({
      entries: [
        entry({ from: -30 * DAY, to: -10 * DAY }),
        entry({
          status: "offline",
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
          status: "offline",
          from: -10 * DAY + 2 * MINUTE,
          to: -10 * DAY + 3 * MINUTE,
          id: "z",
        }),
        entry({ from: -10 * DAY + 3 * MINUTE, to: null }),
      ],
      window: windowOf(-30 * DAY, 0),
    });
    const cluster: StatusTimelineBandMark = markFor(bandLayout, "y");

    expect(cluster.isCluster).toBe(true);
    expect(cluster.entryIds).toEqual(["x", "y", "z"]);
    expect(cluster.start.getTime()).toBe(at(-10 * DAY).getTime());
    expect(cluster.end.getTime()).toBe(at(-10 * DAY + 3 * MINUTE).getTime());
    expect(cluster.key).toContain("cluster-");
  });

  test("blips far enough apart stay separate", () => {
    const bandLayout: StatusTimelineBandLayout = layout({
      entries: [
        entry({ from: -30 * DAY, to: -20 * DAY }),
        entry({
          status: "offline",
          from: -20 * DAY,
          to: -20 * DAY + MINUTE,
          id: "first",
        }),
        entry({ from: -20 * DAY + MINUTE, to: -10 * DAY }),
        entry({
          status: "offline",
          from: -10 * DAY,
          to: -10 * DAY + MINUTE,
          id: "second",
        }),
        entry({ from: -10 * DAY + MINUTE, to: null }),
      ],
      window: windowOf(-30 * DAY, 0),
    });

    expect(markFor(bandLayout, "first").isCluster).toBe(false);
    expect(markFor(bandLayout, "second").isCluster).toBe(false);
  });

  test("a cluster holding the status in effect is ongoing", () => {
    const bandLayout: StatusTimelineBandLayout = layout({
      entries: [
        entry({ from: -30 * DAY, to: -MINUTE }),
        entry({ status: "offline", from: -MINUTE, to: -30 * SECOND, id: "a" }),
        entry({ from: -30 * SECOND, to: null, id: "b" }),
      ],
      window: windowOf(-30 * DAY, 0),
    });

    expect(markFor(bandLayout, "b").isCluster).toBe(true);
    expect(markFor(bandLayout, "b").isOngoing).toBe(true);
  });
});

describe("getClusterColor", () => {
  test("the most serious status wins", () => {
    expect(
      getClusterColor([
        { color: GREEN, rank: 1, durationMs: 50 * SECOND, startsAt: at(-3) },
        { color: RED, rank: 3, durationMs: SECOND, startsAt: at(-2) },
        { color: AMBER, rank: 2, durationMs: 9 * SECOND, startsAt: at(-1) },
      ]),
    ).toBe(RED);
  });

  test("between equally serious statuses, the longer one wins", () => {
    expect(
      getClusterColor([
        { color: GREEN, rank: 3, durationMs: 50 * SECOND, startsAt: at(-3) },
        { color: RED, rank: 3, durationMs: SECOND, startsAt: at(-2) },
      ]),
    ).toBe(GREEN);
  });

  test("with no ranks, the status it spent longest in wins; then the newest", () => {
    expect(
      getClusterColor([
        { color: GREEN, durationMs: 10 * SECOND, startsAt: at(-3) },
        { color: RED, durationMs: 20 * SECOND, startsAt: at(-2) },
      ]),
    ).toBe(RED);
    expect(
      getClusterColor([
        { color: GREEN, durationMs: 10 * SECOND, startsAt: at(-3) },
        { color: RED, durationMs: 10 * SECOND, startsAt: at(-2) },
      ]),
    ).toBe(RED);
  });

  test("a ranked status wins over an unranked one", () => {
    expect(
      getClusterColor([
        { color: GREEN, durationMs: 60 * SECOND, startsAt: at(-3) },
        { color: RED, rank: 0, durationMs: SECOND, startsAt: at(-2) },
      ]),
    ).toBe(RED);
  });

  test("nothing to colour is no colour", () => {
    expect(getClusterColor([])).toBe("");
  });
});

describe("layoutStatusTimelineBand: marks run left to right", () => {
  test("the arrow keys can walk them in time order", () => {
    const bandLayout: StatusTimelineBandLayout = layout({
      entries: screenshotEntries(),
      window: windowOf(-30 * DAY, 0),
    });
    const lefts: Array<number> = bandLayout.marks.map(
      (mark: StatusTimelineBandMark): number => {
        return mark.left;
      },
    );

    expect(lefts).toEqual(
      [...lefts].sort((a: number, b: number): number => {
        return a - b;
      }),
    );
  });

  test("a widened mark that starts where a segment starts comes after it", () => {
    // An instant and a status that both begin as the window does.
    const bandLayout: StatusTimelineBandLayout = layout({
      entries: [
        entry({ status: "offline", from: -DAY, to: -DAY, id: "a-instant" }),
        entry({ from: -DAY, to: null, id: "b-segment" }),
      ],
      window: windowOf(-DAY, 0),
    });

    expect(
      bandLayout.marks.map((mark: StatusTimelineBandMark) => {
        return { left: mark.left, isWidened: mark.isWidened };
      }),
    ).toEqual([
      { left: 0, isWidened: false },
      { left: 0, isWidened: true },
    ]);
  });
});

describe("layoutStatusTimelineBand: time no status covers", () => {
  const gapsOf: (
    bandLayout: StatusTimelineBandLayout,
  ) => Array<{ kind: StatusTimelineGapKind; left: number; width: number }> = (
    bandLayout: StatusTimelineBandLayout,
  ): Array<{ kind: StatusTimelineGapKind; left: number; width: number }> => {
    return bandLayout.gaps.map((gap: StatusTimelineBandGap) => {
      return {
        kind: gap.kind,
        left: Math.round(gap.left * 1000) / 1000,
        width: Math.round(gap.width * 1000) / 1000,
      };
    });
  };

  test("before a new monitor's first status: nothing recorded", () => {
    const bandLayout: StatusTimelineBandLayout = layout({
      entries: [entry({ from: -25 * HOUR, to: null })],
      window: windowOf(-100 * HOUR, 0),
    });

    expect(gapsOf(bandLayout)).toEqual([
      { kind: StatusTimelineGapKind.NoData, left: 0, width: 75 },
    ]);
  });

  test("a hole between two rows: nothing recorded there", () => {
    const bandLayout: StatusTimelineBandLayout = layout({
      entries: [
        entry({ from: -100 * HOUR, to: -60 * HOUR }),
        entry({ from: -50 * HOUR, to: null }),
      ],
      window: windowOf(-100 * HOUR, 0),
    });

    expect(gapsOf(bandLayout)).toEqual([
      { kind: StatusTimelineGapKind.NoData, left: 40, width: 10 },
    ]);
  });

  test("rows written a second apart are one timeline, not two with a hole", () => {
    const bandLayout: StatusTimelineBandLayout = layout({
      entries: [
        entry({ from: -100 * HOUR, to: -50 * HOUR }),
        entry({ from: -50 * HOUR + 900, to: null }),
      ],
      window: windowOf(-100 * HOUR, 0),
    });

    expect(bandLayout.gaps).toEqual([]);
  });

  test("a hole narrower than a pixel is not drawn", () => {
    // A pixel of a 100-hour band 1000px wide is 6 minutes.
    const bandLayout: StatusTimelineBandLayout = layout({
      entries: [
        entry({ from: -100 * HOUR, to: -50 * HOUR }),
        entry({ from: -50 * HOUR + 2 * MINUTE, to: null }),
      ],
      window: windowOf(-100 * HOUR, 0),
    });

    expect(bandLayout.gaps).toEqual([]);
  });

  test("older changes that were not loaded are not 'nothing recorded'", () => {
    const bandLayout: StatusTimelineBandLayout = layout({
      entries: [entry({ from: -40 * HOUR, to: null })],
      window: windowOf(-100 * HOUR, 0),
      loadedFrom: at(-40 * HOUR),
    });

    expect(gapsOf(bandLayout)).toEqual([
      { kind: StatusTimelineGapKind.NotLoaded, left: 0, width: 60 },
    ]);
  });

  test("a hole after the loaded history begins is still 'nothing recorded'", () => {
    const bandLayout: StatusTimelineBandLayout = layout({
      entries: [
        entry({ from: -80 * HOUR, to: -70 * HOUR }),
        entry({ from: -50 * HOUR, to: null }),
      ],
      window: windowOf(-100 * HOUR, 0),
      loadedFrom: at(-80 * HOUR),
    });

    expect(gapsOf(bandLayout)).toEqual([
      { kind: StatusTimelineGapKind.NotLoaded, left: 0, width: 20 },
      { kind: StatusTimelineGapKind.NoData, left: 30, width: 20 },
    ]);
  });

  test("a window reaching into the future: the time after now has not happened", () => {
    const bandLayout: StatusTimelineBandLayout = layout({
      entries: [entry({ from: -100 * HOUR, to: null })],
      window: windowOf(-75 * HOUR, 25 * HOUR),
    });

    expect(gapsOf(bandLayout)).toEqual([
      { kind: StatusTimelineGapKind.Future, left: 75, width: 25 },
    ]);
  });

  test("a window wholly before the first status is nothing recorded from end to end", () => {
    const bandLayout: StatusTimelineBandLayout = layout({
      entries: [entry({ from: -HOUR, to: null })],
      window: windowOf(-100 * HOUR, -50 * HOUR),
    });

    expect(bandLayout.marks).toEqual([]);
    expect(gapsOf(bandLayout)).toEqual([
      { kind: StatusTimelineGapKind.NoData, left: 0, width: 100 },
    ]);
  });
});

describe("layoutStatusTimelineBand: many entries", () => {
  test("a monitor flapping every few minutes for a day lays out quickly, every entry drawn once", () => {
    const entries: Array<StatusTimelineEntry> = [];
    let end: number = 0;

    for (let index: number = 0; index < 2000; index++) {
      const length: number = index % 2 === 0 ? 3 * MINUTE : 40 * SECOND;
      entries.push(
        entry({
          status: index % 2 === 0 ? "operational" : "offline",
          from: end - length,
          to: index === 0 ? null : end,
          id: `flap-${index}`,
        }),
      );
      end -= length;
    }

    const timed: FastestRun<StatusTimelineBandLayout> = fastestRun({
      run: (): StatusTimelineBandLayout => {
        return layout({
          entries: entries,
          window: windowOf(-30 * DAY, 0),
        });
      },
      limitInMs: 2000,
    });
    const bandLayout: StatusTimelineBandLayout = timed.result;

    const drawn: Array<string> = bandLayout.marks.flatMap(
      (mark: StatusTimelineBandMark) => {
        return mark.entryIds;
      },
    );

    expect(new Set<string>(drawn).size).toBe(drawn.length);
    expect(drawn).toHaveLength(2000);
    // Far fewer marks than entries: they run together into clusters.
    expect(bandLayout.marks.length).toBeLessThan(400);
    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("summarizeStatusTimeline: the legend", () => {
  test("time in each status inside the window, its share, and how many times", () => {
    const summary: StatusTimelineSummary = summarizeStatusTimeline({
      entries: resolveStatusTimelineEntries(
        [
          entry({ from: -200 * HOUR, to: -90 * HOUR }),
          entry({ status: "offline", from: -90 * HOUR, to: -80 * HOUR }),
          entry({ from: -80 * HOUR, to: -10 * HOUR }),
          entry({ status: "offline", from: -10 * HOUR, to: -5 * HOUR }),
          entry({ from: -5 * HOUR, to: null }),
        ],
        NOW,
      ),
      window: windowOf(-100 * HOUR, 0),
      now: NOW,
    });

    expect(summary.measuredMs).toBe(100 * HOUR);
    expect(
      summary.items.map((item: StatusTimelineSummaryItem) => {
        return {
          name: item.name,
          hours: item.durationMs / HOUR,
          share: item.share,
          count: item.count,
        };
      }),
    ).toEqual([
      { name: "Operational", hours: 85, share: 0.85, count: 3 },
      { name: "Offline", hours: 15, share: 0.15, count: 2 },
    ]);
  });

  test("statuses are listed best first by their rank", () => {
    const summary: StatusTimelineSummary = summarizeStatusTimeline({
      entries: resolveStatusTimelineEntries(
        [
          entry({ status: "offline", from: -3 * HOUR, to: -2 * HOUR }),
          entry({ status: "degraded", from: -2 * HOUR, to: -HOUR }),
          entry({ from: -HOUR, to: null }),
        ],
        NOW,
      ),
      window: windowOf(-3 * HOUR, 0),
      now: NOW,
    });

    expect(
      summary.items.map((item: StatusTimelineSummaryItem): string => {
        return item.name;
      }),
    ).toEqual(["Operational", "Degraded", "Offline"]);
  });

  test("without ranks, in the order the record first entered them", () => {
    const unranked: (data: {
      status: "operational" | "offline" | "degraded";
      from: number;
      to: number | null;
    }) => StatusTimelineEntry = (data: {
      status: "operational" | "offline" | "degraded";
      from: number;
      to: number | null;
    }): StatusTimelineEntry => {
      const item: StatusTimelineEntry = entry(data);
      delete item.rank;
      return item;
    };

    const summary: StatusTimelineSummary = summarizeStatusTimeline({
      entries: resolveStatusTimelineEntries(
        [
          unranked({ status: "offline", from: -3 * HOUR, to: -170 * MINUTE }),
          unranked({ status: "degraded", from: -170 * MINUTE, to: -HOUR }),
          unranked({ status: "operational", from: -HOUR, to: null }),
        ],
        NOW,
      ),
      window: windowOf(-3 * HOUR, 0),
      now: NOW,
    });

    expect(
      summary.items.map((item: StatusTimelineSummaryItem): string => {
        return item.name;
      }),
    ).toEqual(["Offline", "Degraded", "Operational"]);
  });

  test("over a whole history, each status's whole time - not the part the band has room for", () => {
    const entries: Array<ResolvedStatusTimelineEntry> =
      resolveStatusTimelineEntries(
        [
          entry({
            status: "offline",
            from: -21 * DAY - 2 * HOUR,
            to: -21 * DAY,
          }),
          entry({ from: -21 * DAY, to: null }),
        ],
        NOW,
      );
    const fitted: StatusTimelineWindow = getStatusTimelineFitWindow({
      entries: entries,
      now: NOW,
    })!;

    const clipped: StatusTimelineSummary = summarizeStatusTimeline({
      entries: entries,
      window: fitted,
      now: NOW,
    });
    const whole: StatusTimelineSummary = summarizeStatusTimeline({
      entries: entries,
      window: fitted,
      now: NOW,
      isWholeHistory: true,
    });

    const operational: (summary: StatusTimelineSummary) => number = (
      summary: StatusTimelineSummary,
    ): number => {
      return summary.items.find((item: StatusTimelineSummaryItem) => {
        return item.name === "Operational";
      })!.durationMs;
    };

    expect(operational(clipped)).toBe(30 * MINUTE);
    expect(operational(whole)).toBe(21 * DAY);
  });

  test("a status entered for no time at all is counted once, for no time", () => {
    const summary: StatusTimelineSummary = summarizeStatusTimeline({
      entries: resolveStatusTimelineEntries(
        [
          entry({ from: -2 * HOUR, to: -HOUR }),
          entry({ status: "offline", from: -HOUR, to: -HOUR }),
          entry({ from: -HOUR, to: null }),
        ],
        NOW,
      ),
      window: windowOf(-2 * HOUR, 0),
      now: NOW,
    });
    const offline: StatusTimelineSummaryItem = summary.items.find(
      (item: StatusTimelineSummaryItem): boolean => {
        return item.name === "Offline";
      },
    )!;

    expect(offline.count).toBe(1);
    expect(offline.durationMs).toBe(0);
  });

  test("nothing in the window: no items, and no share divided by zero", () => {
    const summary: StatusTimelineSummary = summarizeStatusTimeline({
      entries: [],
      window: windowOf(-HOUR, 0),
      now: NOW,
    });

    expect(summary).toEqual({ items: [], measuredMs: 0 });
  });
});

describe("formatStatusTimelineShare", () => {
  test.each([
    [0, "0%"],
    [-1, "0%"],
    [Number.NaN, "0%"],
    [1, "100%"],
    [1.2, "100%"],
    [0.5, "50%"],
    [0.1234, "12.34%"],
    [0.12345, "12.35%"],
    [0.9991, "99.91%"],
    [0.0009, "0.09%"],
    [0.00004, "<0.01%"],
    [0.99996, "99.99%"],
    [0.999999, "99.99%"],
  ])("%p reads %p", (share: number, text: string) => {
    expect(formatStatusTimelineShare(share)).toBe(text);
  });
});

describe("formatStatusTimelineCompactDuration", () => {
  test("keeps the two largest units of the timelines' wording", () => {
    expect(
      formatStatusTimelineCompactDuration("29 days 23 hours 52 mins 12 secs"),
    ).toBe("29 days 23 hours");
    expect(formatStatusTimelineCompactDuration("1 hour 2 mins 3 secs")).toBe(
      "1 hour 2 mins",
    );
  });

  test("a short duration reads whole", () => {
    expect(formatStatusTimelineCompactDuration("38 secs")).toBe("38 secs");
    expect(formatStatusTimelineCompactDuration(" 41 mins 1 sec ")).toBe(
      "41 mins 1 sec",
    );
  });
});

describe("moving through time", () => {
  test("the period before is as long, and ends where this one began", () => {
    expect(
      shiftStatusTimelineWindow({
        window: windowOf(-30 * DAY, 0),
        direction: -1,
        now: NOW,
      }),
    ).toEqual(windowOf(-60 * DAY, -30 * DAY));
  });

  test("the period after never runs past now", () => {
    expect(
      shiftStatusTimelineWindow({
        window: windowOf(-60 * DAY, -30 * DAY),
        direction: 1,
        now: NOW,
      }),
    ).toEqual(windowOf(-30 * DAY, 0));
    expect(
      shiftStatusTimelineWindow({
        window: windowOf(-40 * DAY, -10 * DAY),
        direction: 1,
        now: NOW,
      }),
    ).toEqual(windowOf(-30 * DAY, 0));
  });

  test("a window ends at now within a minute's tolerance", () => {
    expect(
      isStatusTimelineWindowAtNow({ window: windowOf(-DAY, 0), now: NOW }),
    ).toBe(true);
    expect(
      isStatusTimelineWindowAtNow({
        window: windowOf(-DAY, -30 * SECOND),
        now: NOW,
      }),
    ).toBe(true);
    expect(
      isStatusTimelineWindowAtNow({
        window: windowOf(-DAY, -2 * MINUTE),
        now: NOW,
      }),
    ).toBe(false);
    expect(
      isStatusTimelineWindowAtNow({
        window: windowOf(-DAY, -2 * MINUTE),
        now: NOW,
        toleranceMs: 5 * MINUTE,
      }),
    ).toBe(true);
  });

  test("zooming to a stretch leaves a little room either side", () => {
    expect(
      getStatusTimelineZoomWindow({
        start: at(-20 * HOUR),
        end: at(-10 * HOUR),
        now: NOW,
      }),
    ).toEqual(windowOf(-21 * HOUR, -9 * HOUR));
  });

  test("zooming never goes closer than a minute", () => {
    const zoom: StatusTimelineWindow = getStatusTimelineZoomWindow({
      start: at(-HOUR),
      end: at(-HOUR + SECOND),
      now: NOW,
    });

    expect(zoom.end.getTime() - zoom.start.getTime()).toBe(MIN_ZOOM_WINDOW_MS);
  });

  test("zooming to the latest changes never runs past now", () => {
    const zoom: StatusTimelineWindow = getStatusTimelineZoomWindow({
      start: at(-10 * MINUTE),
      end: NOW,
      now: NOW,
    });

    expect(zoom.end.getTime()).toBe(NOW.getTime());
    expect(zoom.end.getTime() - zoom.start.getTime()).toBe(12 * MINUTE);
  });

  test("a reversed stretch zooms the same", () => {
    expect(
      getStatusTimelineZoomWindow({
        start: at(-10 * HOUR),
        end: at(-20 * HOUR),
        now: NOW,
      }),
    ).toEqual(windowOf(-21 * HOUR, -9 * HOUR));
  });

  test("a period counted back from now slides along with the clock", () => {
    expect(
      followStatusTimelineWindow({
        window: windowOf(-30 * DAY, 0),
        now: at(10 * MINUTE),
        follow: StatusTimelineWindowFollow.Slide,
      }),
    ).toEqual(windowOf(-30 * DAY + 10 * MINUTE, 10 * MINUTE));
  });

  test("a whole history fitted up to now grows with it", () => {
    expect(
      followStatusTimelineWindow({
        window: windowOf(-2 * HOUR, 0),
        now: at(10 * MINUTE),
        follow: StatusTimelineWindowFollow.Extend,
      }),
    ).toEqual(windowOf(-2 * HOUR, 10 * MINUTE));
  });

  test("a window put somewhere stays there", () => {
    const fixed: StatusTimelineWindow = windowOf(-2 * HOUR, 0);

    expect(
      followStatusTimelineWindow({ window: fixed, now: at(10 * MINUTE) }),
    ).toBe(fixed);
    // Nothing to follow while now has not passed its end.
    expect(
      followStatusTimelineWindow({
        window: fixed,
        now: at(-MINUTE),
        follow: StatusTimelineWindowFollow.Slide,
      }),
    ).toBe(fixed);
  });
});

describe("getStatusTimelineFitWindow: a record's whole history on one band", () => {
  test("nothing recorded: no window", () => {
    expect(getStatusTimelineFitWindow({ entries: [], now: NOW })).toBeNull();
  });

  test("one status all along: its whole life, up to now", () => {
    expect(
      getStatusTimelineFitWindow({
        entries: [entry({ from: -20 * MINUTE, to: null })],
        now: NOW,
      }),
    ).toEqual(windowOf(-20 * MINUTE, 0));
  });

  test("one status that began a moment ago still gets a minute", () => {
    const fitted: StatusTimelineWindow = getStatusTimelineFitWindow({
      entries: [entry({ from: -5 * SECOND, to: null })],
      now: NOW,
    })!;

    expect(fitted.end.getTime() - fitted.start.getTime()).toBe(
      MIN_ZOOM_WINDOW_MS,
    );
  });

  test("a record being worked on: from its first change up to now", () => {
    expect(
      getStatusTimelineFitWindow({
        entries: [
          entry({ status: "offline", from: -95 * MINUTE, to: -88 * MINUTE }),
          entry({ status: "degraded", from: -88 * MINUTE, to: -40 * MINUTE }),
          entry({ from: -40 * MINUTE, to: null }),
        ],
        now: NOW,
      }),
    ).toEqual(windowOf(-95 * MINUTE, 0));
  });

  test("a record that changed last long ago: a quarter of its span after its last change", () => {
    expect(
      getStatusTimelineFitWindow({
        entries: [
          entry({
            status: "offline",
            from: -21 * DAY - 2 * HOUR,
            to: -21 * DAY - HOUR,
          }),
          entry({ status: "degraded", from: -21 * DAY - HOUR, to: -21 * DAY }),
          entry({ from: -21 * DAY, to: null }),
        ],
        now: NOW,
      }),
    ).toEqual(windowOf(-21 * DAY - 2 * HOUR, -21 * DAY + 30 * MINUTE));
  });

  test("a record still open: up to now, however long ago it last changed", () => {
    expect(
      getStatusTimelineFitWindow({
        entries: [
          entry({
            status: "offline",
            from: -3 * HOUR,
            to: -3 * HOUR + 12 * MINUTE,
          }),
          entry({
            status: "degraded",
            from: -3 * HOUR + 12 * MINUTE,
            to: null,
          }),
        ],
        now: NOW,
        isOpen: true,
      }),
    ).toEqual(windowOf(-3 * HOUR, 0));

    // The same history, done with: a quarter of its span after its last change.
    expect(
      getStatusTimelineFitWindow({
        entries: [
          entry({
            status: "offline",
            from: -3 * HOUR,
            to: -3 * HOUR + 12 * MINUTE,
          }),
          entry({
            status: "degraded",
            from: -3 * HOUR + 12 * MINUTE,
            to: null,
          }),
        ],
        now: NOW,
        isOpen: false,
      }),
    ).toEqual(windowOf(-3 * HOUR, -3 * HOUR + 15 * MINUTE));
  });

  test("the line between the two is a few times the span", () => {
    const span: number = HOUR;
    const entries: (lastChangeAgo: number) => Array<StatusTimelineEntry> = (
      lastChangeAgo: number,
    ): Array<StatusTimelineEntry> => {
      return [
        entry({
          status: "offline",
          from: -lastChangeAgo - span,
          to: -lastChangeAgo,
        }),
        entry({ from: -lastChangeAgo, to: null }),
      ];
    };

    expect(
      getStatusTimelineFitWindow({
        entries: entries(span * RECENT_CHANGE_SPAN_RATIO),
        now: NOW,
      })!.end.getTime(),
    ).toBe(NOW.getTime());
    expect(
      getStatusTimelineFitWindow({
        entries: entries(span * RECENT_CHANGE_SPAN_RATIO + MINUTE),
        now: NOW,
      })!.end.getTime(),
    ).toBeLessThan(NOW.getTime());
  });
});

describe("getStatusTimelineTicks: the axis", () => {
  const ticksOf: (data: {
    window: StatusTimelineWindow;
    widthPx?: number;
    timezone?: string;
  }) => Array<StatusTimelineTick> = (data: {
    window: StatusTimelineWindow;
    widthPx?: number;
    timezone?: string;
  }): Array<StatusTimelineTick> => {
    return getStatusTimelineTicks({
      window: data.window,
      widthPx: data.widthPx ?? 1000,
      timezone: data.timezone || "UTC",
    });
  };

  test("a month on a wide band: a tick every Monday at midnight", () => {
    const ticks: Array<StatusTimelineTick> = ticksOf({
      window: windowOf(-30 * DAY, 0),
      widthPx: 900,
    });

    expect(ticks.length).toBeGreaterThanOrEqual(4);
    expect(ticks.length).toBeLessThanOrEqual(9);

    for (const tick of ticks) {
      expect(tick.unit).toBe(StatusTimelineTickUnit.Week);
      expect(tick.at.getUTCDay()).toBe(1);
      expect(tick.at.getUTCHours()).toBe(0);
    }
  });

  test("ticks are never closer than their labels need", () => {
    for (const span of [HOUR, 6 * HOUR, DAY, 7 * DAY, 30 * DAY, 90 * DAY]) {
      for (const widthPx of [340, 800, 1600]) {
        const ticks: Array<StatusTimelineTick> = ticksOf({
          window: windowOf(-span, 0),
          widthPx,
        });

        expect(ticks.length).toBeLessThanOrEqual(
          Math.max(1, Math.floor(widthPx / 96)) + 1,
        );
      }
    }
  });

  test("a day: every few hours on the hour, midnight named by its date", () => {
    const ticks: Array<StatusTimelineTick> = ticksOf({
      window: {
        start: new Date("2026-10-13T08:00:00.000Z"),
        end: new Date("2026-10-14T08:00:00.000Z"),
      },
      widthPx: 800,
    });

    expect(ticks.length).toBeGreaterThan(2);

    for (const tick of ticks) {
      expect(tick.unit).toBe(StatusTimelineTickUnit.Hour);
      expect(tick.at.getUTCMinutes()).toBe(0);
    }

    const midnight: StatusTimelineTick | undefined = ticks.find(
      (tick: StatusTimelineTick): boolean => {
        return tick.at.toISOString() === "2026-10-14T00:00:00.000Z";
      },
    );

    expect(midnight?.isDayStart).toBe(true);
    expect(
      ticks
        .filter((tick: StatusTimelineTick): boolean => {
          return tick !== midnight;
        })
        .every((tick: StatusTimelineTick): boolean => {
          return !tick.isDayStart;
        }),
    ).toBe(true);
  });

  test("an hour: every few minutes", () => {
    const ticks: Array<StatusTimelineTick> = ticksOf({
      window: {
        start: new Date("2026-10-14T07:00:00.000Z"),
        end: new Date("2026-10-14T08:00:00.000Z"),
      },
      widthPx: 800,
    });

    for (const tick of ticks) {
      expect(tick.unit).toBe(StatusTimelineTickUnit.Minute);
      expect(tick.at.getUTCMinutes() % 10).toBe(0);
    }
  });

  test("a quarter: the start of every month", () => {
    const ticks: Array<StatusTimelineTick> = ticksOf({
      window: {
        start: new Date("2026-07-14T00:00:00.000Z"),
        end: new Date("2026-10-14T00:00:00.000Z"),
      },
      widthPx: 400,
    });

    expect(ticks.length).toBeGreaterThan(0);

    for (const tick of ticks) {
      expect(tick.unit).toBe(StatusTimelineTickUnit.Month);
      expect(tick.at.getUTCDate()).toBe(1);
    }
  });

  test("days are the reader's: midnight in Singapore, not in UTC", () => {
    const ticks: Array<StatusTimelineTick> = ticksOf({
      window: {
        start: new Date("2026-10-07T00:00:00.000Z"),
        end: new Date("2026-10-14T00:00:00.000Z"),
      },
      widthPx: 800,
      timezone: "Asia/Singapore",
    });

    expect(ticks.length).toBeGreaterThan(0);

    for (const tick of ticks) {
      // Singapore's midnight is 16:00 UTC the day before.
      expect(tick.at.getUTCHours()).toBe(16);
    }
  });

  test("across a clock change the ticks stay on the wall clock's hours", () => {
    // Europe/London leaves summer time at 02:00 on Sunday Oct 25 2026.
    const ticks: Array<StatusTimelineTick> = ticksOf({
      window: {
        start: new Date("2026-10-24T12:00:00.000Z"),
        end: new Date("2026-10-26T12:00:00.000Z"),
      },
      widthPx: 1600,
      timezone: "Europe/London",
    });
    const londonHours: Array<number> = ticks.map(
      (tick: StatusTimelineTick): number => {
        return Number(
          new Intl.DateTimeFormat("en-GB", {
            hour: "numeric",
            hourCycle: "h23",
            timeZone: "Europe/London",
          }).format(tick.at),
        );
      },
    );

    expect(ticks.length).toBeGreaterThan(4);
    // Every few hours (three, on a band this wide) on London's clock.
    expect(ticks[0]!.unit).toBe(StatusTimelineTickUnit.Hour);

    for (const hour of londonHours) {
      expect(hour % 3).toBe(0);
    }

    // 03:00 GMT, the first tick after the change, is on the wall clock too.
    expect(
      ticks.some((tick: StatusTimelineTick): boolean => {
        return tick.at.toISOString() === "2026-10-25T03:00:00.000Z";
      }),
    ).toBe(true);
  });

  test("a zone moment does not know falls back to UTC", () => {
    const ticks: Array<StatusTimelineTick> = ticksOf({
      window: windowOf(-30 * DAY, 0),
      timezone: "Not/AZone",
    });

    expect(ticks.length).toBeGreaterThan(0);
  });

  test("a tick's place is its time's share of the window", () => {
    const window: StatusTimelineWindow = {
      start: new Date("2026-10-14T00:00:00.000Z"),
      end: new Date("2026-10-14T10:00:00.000Z"),
    };
    const ticks: Array<StatusTimelineTick> = ticksOf({ window, widthPx: 800 });

    for (const tick of ticks) {
      expect(tick.left).toBeCloseTo(
        ((tick.at.getTime() - window.start.getTime()) / (10 * HOUR)) * 100,
        6,
      );
    }
  });

  test("no window, no ticks", () => {
    expect(ticksOf({ window: windowOf(0, 0) })).toEqual([]);
  });
});

describe("getVisibleStatusTimelineTickIndexes: labels never run into each other", () => {
  test("a tick too close to the start's label, or to Now, is left out", () => {
    const kept: Array<number> = getVisibleStatusTimelineTickIndexes({
      ticks: [
        { left: 2, label: "10:00 PM" },
        { left: 30, label: "11:00 PM" },
        { left: 60, label: "12:00 AM" },
        { left: 98, label: "1:00 AM" },
      ],
      widthPx: 1000,
      startLabel: "Oct 14, 9:40 PM",
      endLabel: "Now",
    });

    expect(kept).toEqual([1, 2]);
  });

  test("two labels that would overlap keep the first", () => {
    const kept: Array<number> = getVisibleStatusTimelineTickIndexes({
      ticks: [
        { left: 40, label: "Sep 21" },
        { left: 43, label: "Sep 22" },
        { left: 60, label: "Sep 28" },
      ],
      widthPx: 1000,
      startLabel: "",
    });

    expect(kept).toEqual([0, 2]);
  });

  test("on a phone the start's long label pushes the first tick out", () => {
    const kept: Array<number> = getVisibleStatusTimelineTickIndexes({
      ticks: [
        { left: 25, label: "10:00 PM" },
        { left: 75, label: "11:00 PM" },
        { left: 95, label: "11:30 PM" },
      ],
      widthPx: 320,
      startLabel: "Oct 14, 9:40 PM",
      endLabel: "Now",
    });

    expect(kept).toEqual([1]);
  });

  test("a label's width grows with its text", () => {
    expect(estimateStatusTimelineLabelWidthPx("Now")).toBeLessThan(
      estimateStatusTimelineLabelWidthPx("Oct 14, 9:40 PM"),
    );
    expect(estimateStatusTimelineLabelWidthPx("")).toBe(0);
  });
});

describe("getStatusTimelineContinuationMask", () => {
  test("a status that continues past an edge fades out there", () => {
    expect(
      getStatusTimelineContinuationMask({
        continuesBefore: false,
        continuesAfter: true,
        widthPx: 400,
      }),
    ).toBe(
      `linear-gradient(to right, #000 calc(100% - ${CONTINUATION_FADE_PX}px), transparent)`,
    );
    expect(
      getStatusTimelineContinuationMask({
        continuesBefore: true,
        continuesAfter: false,
        widthPx: 400,
      }),
    ).toBe(
      `linear-gradient(to right, transparent, #000 ${CONTINUATION_FADE_PX}px)`,
    );
    expect(
      getStatusTimelineContinuationMask({
        continuesBefore: true,
        continuesAfter: true,
        widthPx: 400,
      }),
    ).toContain("transparent, #000");
  });

  test("nothing continues, or too narrow to fade: no mask", () => {
    expect(
      getStatusTimelineContinuationMask({
        continuesBefore: false,
        continuesAfter: false,
        widthPx: 400,
      }),
    ).toBeNull();
    expect(
      getStatusTimelineContinuationMask({
        continuesBefore: true,
        continuesAfter: false,
        widthPx: CONTINUATION_FADE_PX * 3 - 1,
      }),
    ).toBeNull();
  });
});

describe("getNextStatusTimelineMarkIndex: the band's arrow keys", () => {
  test.each([
    ["ArrowLeft", 3, 2],
    ["ArrowUp", 3, 2],
    ["ArrowRight", 3, 4],
    ["ArrowDown", 3, 4],
    ["Home", 3, 0],
    ["End", 3, 9],
    ["ArrowLeft", 0, 0],
    ["ArrowRight", 9, 9],
  ])("%s from %p goes to %p", (key: string, from: number, to: number) => {
    expect(
      getNextStatusTimelineMarkIndex({
        key: key,
        currentIndex: from,
        markCount: 10,
      }),
    ).toBe(to);
  });

  test("keys that are not the band's keep their meaning", () => {
    for (const key of ["Tab", "Enter", " ", "a", "Escape"]) {
      expect(
        getNextStatusTimelineMarkIndex({
          key: key,
          currentIndex: 3,
          markCount: 10,
        }),
      ).toBeNull();
    }
  });

  test("an index that drifted out of range is brought back in first", () => {
    expect(
      getNextStatusTimelineMarkIndex({
        key: "ArrowLeft",
        currentIndex: 40,
        markCount: 10,
      }),
    ).toBe(8);
  });

  test("an empty band has nowhere to go", () => {
    expect(
      getNextStatusTimelineMarkIndex({
        key: "ArrowLeft",
        currentIndex: 0,
        markCount: 0,
      }),
    ).toBeNull();
  });
});
