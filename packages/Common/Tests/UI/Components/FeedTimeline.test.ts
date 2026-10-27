import { describe, expect, test } from "@jest/globals";
import { FeedClock } from "../../../UI/Components/Feed/FeedTime";
import {
  FEED_BURST_WINDOW_IN_MINUTES,
  FEED_MIN_BURST_SIZE,
  FeedTimelineDay,
  FeedTimelineEntry,
  FeedTimelineItem,
  buildFeedTimeline,
  findFeedBursts,
  hasFeedEntryFromToday,
} from "../../../UI/Components/Feed/FeedTimeline";
import { FeedBurstKind } from "../../../UI/Components/Feed/FeedEntryKind";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * How a feed's entries become a timeline: a heading per day of the reader's
 * zone, the time of day shown once per minute, the zone named again when it
 * changes within a day, and bursts of one kind folded into their first
 * entry. The order the server sent is kept, whichever way the reader sorts.
 */

const NARROW_SPACES: RegExp = /[\u202f\u00a0]/g;

const plain: (text: string | undefined) => string = (
  text: string | undefined,
): string => {
  return (text || "").replace(NARROW_SPACES, " ");
};

// 3:40 PM on Tuesday, October 13, 2026, in Singapore.
const NOW: Date = new Date("2026-10-13T07:40:00.000Z");

const clock: (overrides?: Partial<FeedClock>) => FeedClock = (
  overrides?: Partial<FeedClock>,
): FeedClock => {
  return {
    timezone: "Asia/Singapore",
    language: "en",
    use12HourClock: true,
    now: NOW,
    ...overrides,
  };
};

let nextKey: number = 0;

const item: (
  iso: string,
  burstKind?: string | undefined,
) => FeedTimelineItem = (
  iso: string,
  burstKind?: string | undefined,
): FeedTimelineItem => {
  nextKey += 1;
  return {
    key: `entry-${nextKey}`,
    itemDateTime: new Date(iso),
    burstKind: burstKind,
  };
};

const keysOf: (day: FeedTimelineDay<FeedTimelineItem>) => Array<string> = (
  day: FeedTimelineDay<FeedTimelineItem>,
): Array<string> => {
  return day.entries.map((entry: FeedTimelineEntry<FeedTimelineItem>) => {
    return entry.item.key;
  });
};

const shownTimes: (
  day: FeedTimelineDay<FeedTimelineItem>,
) => Array<string | null> = (
  day: FeedTimelineDay<FeedTimelineItem>,
): Array<string | null> => {
  return day.entries.map((entry: FeedTimelineEntry<FeedTimelineItem>) => {
    return entry.time.isShown ? plain(entry.time.label) : null;
  });
};

describe("days", () => {
  test("entries are grouped under one heading per day, newest day first when the feed is newest first", () => {
    const items: Array<FeedTimelineItem> = [
      item("2026-10-13T07:25:00.000Z"),
      item("2026-10-13T01:00:00.000Z"),
      item("2026-10-12T09:00:00.000Z"),
      item("2026-10-09T03:00:00.000Z"),
    ];

    const days: Array<FeedTimelineDay<FeedTimelineItem>> = buildFeedTimeline({
      items,
      clock: clock(),
    });

    expect(
      days.map((day: FeedTimelineDay<FeedTimelineItem>) => {
        return [day.label, day.relativeLabel];
      }),
    ).toEqual([
      ["Tuesday, October 13, 2026", "Today"],
      ["Monday, October 12, 2026", "Yesterday"],
      ["Friday, October 9, 2026", undefined],
    ]);
    expect(days.map(keysOf)).toEqual([
      [items[0]!.key, items[1]!.key],
      [items[2]!.key],
      [items[3]!.key],
    ]);
  });

  test("an oldest-first feed keeps its order: the oldest day comes first", () => {
    const items: Array<FeedTimelineItem> = [
      item("2026-10-09T03:00:00.000Z"),
      item("2026-10-12T09:00:00.000Z"),
      item("2026-10-13T07:25:00.000Z"),
    ];

    const days: Array<FeedTimelineDay<FeedTimelineItem>> = buildFeedTimeline({
      items,
      clock: clock(),
    });

    expect(
      days.map((day: FeedTimelineDay<FeedTimelineItem>) => {
        return day.dayKey;
      }),
    ).toEqual(["2026-10-09", "2026-10-12", "2026-10-13"]);
  });

  test("days are days of the reader's zone: the same entries split differently in UTC", () => {
    const items: Array<FeedTimelineItem> = [
      item("2026-10-13T01:00:00.000Z"), // Oct 13 09:00 SGT, Oct 13 01:00 UTC
      item("2026-10-12T20:00:00.000Z"), // Oct 13 04:00 SGT, Oct 12 20:00 UTC
    ];

    expect(buildFeedTimeline({ items, clock: clock() })).toHaveLength(1);
    expect(
      buildFeedTimeline({ items, clock: clock({ timezone: "UTC" }) }),
    ).toHaveLength(2);
  });

  test("each day's heading names the zone its times are in", () => {
    const days: Array<FeedTimelineDay<FeedTimelineItem>> = buildFeedTimeline({
      items: [item("2026-10-13T07:25:00.000Z")],
      clock: clock({ timezone: "America/New_York" }),
    });

    expect(days[0]!.zoneName).toBe("EDT");
  });

  test("a feed with no entries has no days", () => {
    expect(buildFeedTimeline({ items: [], clock: clock() })).toEqual([]);
  });
});

describe("times", () => {
  test("entries of one minute share the first one's time", () => {
    const items: Array<FeedTimelineItem> = [
      item("2026-10-13T07:25:40.000Z"),
      item("2026-10-13T07:25:10.000Z"),
      item("2026-10-13T07:25:00.000Z"),
      item("2026-10-13T07:16:00.000Z"),
      item("2026-10-13T07:16:00.000Z"),
    ];

    const days: Array<FeedTimelineDay<FeedTimelineItem>> = buildFeedTimeline({
      items,
      clock: clock(),
    });

    expect(shownTimes(days[0]!)).toEqual([
      "3:25 PM",
      null,
      null,
      "3:16 PM",
      null,
    ]);
  });

  test("the first entry of every day shows its time, even when it reads the same as the last of the day before", () => {
    const items: Array<FeedTimelineItem> = [
      item("2026-10-13T07:25:00.000Z"),
      item("2026-10-12T07:25:00.000Z"),
    ];

    const days: Array<FeedTimelineDay<FeedTimelineItem>> = buildFeedTimeline({
      items,
      clock: clock(),
    });

    expect(shownTimes(days[0]!)).toEqual(["3:25 PM"]);
    expect(shownTimes(days[1]!)).toEqual(["3:25 PM"]);
  });

  test("the hour the clocks go back names its zone, so the two 1:30 AMs read apart", () => {
    // Newest first: 1:30 AM EST, then 1:30 AM EDT, an hour earlier.
    const items: Array<FeedTimelineItem> = [
      item("2026-11-01T06:30:00.000Z"),
      item("2026-11-01T05:30:00.000Z"),
    ];

    const days: Array<FeedTimelineDay<FeedTimelineItem>> = buildFeedTimeline({
      items,
      clock: clock({
        timezone: "America/New_York",
        now: new Date("2026-11-02T12:00:00.000Z"),
      }),
    });

    expect(days).toHaveLength(1);
    expect(days[0]!.zoneName).toBe("EST");
    // The same wall clock twice, both shown: the second in another zone.
    expect(shownTimes(days[0]!)).toEqual(["1:30 AM", "1:30 AM"]);
    expect(days[0]!.entries[0]!.time.zoneName).toBeUndefined();
    expect(days[0]!.entries[1]!.time.zoneName).toBe("EDT");
  });

  test("an entry from the last hour carries the hint, an older one does not", () => {
    const days: Array<FeedTimelineDay<FeedTimelineItem>> = buildFeedTimeline({
      items: [
        item("2026-10-13T07:28:00.000Z"),
        item("2026-10-13T05:00:00.000Z"),
      ],
      clock: clock(),
    });

    expect(plain(days[0]!.entries[0]!.time.relativeHint)).toBe("12 min. ago");
    expect(days[0]!.entries[1]!.time.relativeHint).toBeUndefined();
  });

  test("every entry carries its full time and ISO instant for the tooltip and <time>", () => {
    const entry: FeedTimelineEntry<FeedTimelineItem> = buildFeedTimeline({
      items: [item("2026-10-13T07:25:42.000Z")],
      clock: clock(),
    })[0]!.entries[0]!;

    expect(entry.time.isoString).toBe("2026-10-13T07:25:42.000Z");
    expect(plain(entry.time.fullLabel)).toBe(
      "Tuesday, October 13, 2026 at 3:25:42 PM GMT+08",
    );
  });

  test("an entry without a valid date still renders, under the earliest day, without crashing", () => {
    const days: Array<FeedTimelineDay<FeedTimelineItem>> = buildFeedTimeline({
      items: [{ key: "broken", itemDateTime: new Date("nope") }],
      clock: clock(),
    });

    expect(days).toHaveLength(1);
    expect(days[0]!.entries[0]!.item.key).toBe("broken");
    expect(days[0]!.entries[0]!.time.isoString).toBe("");
  });
});

describe("bursts", () => {
  test(`${FEED_MIN_BURST_SIZE} or more entries of one kind within ${FEED_BURST_WINDOW_IN_MINUTES} minutes fold into the first`, () => {
    const items: Array<FeedTimelineItem> = [
      item("2026-10-13T07:20:00.000Z", FeedBurstKind.OnCall),
      item("2026-10-13T07:19:00.000Z", FeedBurstKind.OnCall),
      item("2026-10-13T07:18:30.000Z", FeedBurstKind.OnCall),
      item("2026-10-13T07:16:00.000Z", FeedBurstKind.OnCall),
      item("2026-10-13T07:10:00.000Z"),
    ];

    const day: FeedTimelineDay<FeedTimelineItem> = buildFeedTimeline({
      items,
      clock: clock(),
    })[0]!;

    expect(keysOf(day)).toEqual([items[0]!.key, items[4]!.key]);
    expect(day.entries[0]!.burstToggle).toEqual({
      burstKey: items[0]!.key,
      burstKind: FeedBurstKind.OnCall,
      foldedCount: 3,
      isExpanded: false,
    });
    expect(day.entries[1]!.burstToggle).toBeUndefined();
  });

  test("two of a kind stand on their own: folding one entry saves nothing", () => {
    const items: Array<FeedTimelineItem> = [
      item("2026-10-13T07:20:00.000Z", FeedBurstKind.Rule),
      item("2026-10-13T07:20:00.000Z", FeedBurstKind.Rule),
    ];

    const day: FeedTimelineDay<FeedTimelineItem> = buildFeedTimeline({
      items,
      clock: clock(),
    })[0]!;

    expect(keysOf(day)).toHaveLength(2);
    expect(day.entries[0]!.burstToggle).toBeUndefined();
  });

  test("a burst stops at an entry of another kind", () => {
    const items: Array<FeedTimelineItem> = [
      item("2026-10-13T07:20:00.000Z", FeedBurstKind.OnCall),
      item("2026-10-13T07:20:00.000Z", FeedBurstKind.OnCall),
      item("2026-10-13T07:20:00.000Z", FeedBurstKind.OwnerNotification),
      item("2026-10-13T07:20:00.000Z", FeedBurstKind.OnCall),
    ];

    expect(findFeedBursts(items, "Asia/Singapore").size).toBe(0);
  });

  test("a burst ends where an entry falls outside the window of its first", () => {
    const items: Array<FeedTimelineItem> = [
      item("2026-10-13T07:20:00.000Z", FeedBurstKind.OnCall),
      item("2026-10-13T07:18:00.000Z", FeedBurstKind.OnCall),
      item("2026-10-13T07:16:00.000Z", FeedBurstKind.OnCall),
      // Six minutes after the first: not part of it.
      item("2026-10-13T07:14:00.000Z", FeedBurstKind.OnCall),
    ];

    const day: FeedTimelineDay<FeedTimelineItem> = buildFeedTimeline({
      items,
      clock: clock(),
    })[0]!;

    expect(keysOf(day)).toEqual([items[0]!.key, items[3]!.key]);
    expect(day.entries[0]!.burstToggle!.foldedCount).toBe(2);
  });

  test("a burst never crosses midnight in the reader's zone", () => {
    // 00:01, 23:59, 23:58 in Singapore.
    const items: Array<FeedTimelineItem> = [
      item("2026-10-13T16:01:00.000Z", FeedBurstKind.OnCall),
      item("2026-10-13T15:59:00.000Z", FeedBurstKind.OnCall),
      item("2026-10-13T15:58:00.000Z", FeedBurstKind.OnCall),
    ];

    expect(findFeedBursts(items, "Asia/Singapore").size).toBe(0);
    // The same three in UTC are one afternoon, and fold.
    expect(findFeedBursts(items, "UTC").size).toBe(1);
  });

  test("entries without a kind never fold", () => {
    const items: Array<FeedTimelineItem> = [
      item("2026-10-13T07:20:00.000Z"),
      item("2026-10-13T07:20:00.000Z"),
      item("2026-10-13T07:20:00.000Z"),
    ];

    expect(findFeedBursts(items, "Asia/Singapore").size).toBe(0);
  });

  test("an oldest-first feed folds into its first - the oldest - entry", () => {
    const items: Array<FeedTimelineItem> = [
      item("2026-10-13T07:16:00.000Z", FeedBurstKind.OnCall),
      item("2026-10-13T07:18:00.000Z", FeedBurstKind.OnCall),
      item("2026-10-13T07:20:00.000Z", FeedBurstKind.OnCall),
    ];

    const day: FeedTimelineDay<FeedTimelineItem> = buildFeedTimeline({
      items,
      clock: clock(),
    })[0]!;

    expect(keysOf(day)).toEqual([items[0]!.key]);
  });

  test("an unfolded burst shows every entry, in order, marked as in the burst", () => {
    const items: Array<FeedTimelineItem> = [
      item("2026-10-13T07:20:00.000Z", FeedBurstKind.OnCall),
      item("2026-10-13T07:19:00.000Z", FeedBurstKind.OnCall),
      item("2026-10-13T07:18:00.000Z", FeedBurstKind.OnCall),
    ];

    const day: FeedTimelineDay<FeedTimelineItem> = buildFeedTimeline({
      items,
      clock: clock(),
      expandedBurstKeys: new Set<string>([items[0]!.key]),
    })[0]!;

    expect(keysOf(day)).toEqual(
      items.map((entry: FeedTimelineItem) => {
        return entry.key;
      }),
    );
    expect(
      day.entries.map((entry: FeedTimelineEntry<FeedTimelineItem>) => {
        return entry.isInBurst;
      }),
    ).toEqual([false, true, true]);
    // Every entry of the group knows its burst, by its first entry's key.
    expect(
      day.entries.map((entry: FeedTimelineEntry<FeedTimelineItem>) => {
        return entry.burstKey;
      }),
    ).toEqual([items[0]!.key, items[0]!.key, items[0]!.key]);
    // Where focus goes when the reader unfolds it: the first entry it shows.
    expect(
      day.entries.map((entry: FeedTimelineEntry<FeedTimelineItem>) => {
        return entry.isFirstInFold === true;
      }),
    ).toEqual([false, true, false]);
  });

  test("folded, the button is under the burst's first entry; unfolded, it ends the group", () => {
    const items: Array<FeedTimelineItem> = [
      item("2026-10-13T07:20:00.000Z", FeedBurstKind.OnCall),
      item("2026-10-13T07:19:00.000Z", FeedBurstKind.OnCall),
      item("2026-10-13T07:18:00.000Z", FeedBurstKind.OnCall),
      item("2026-10-13T07:17:00.000Z", FeedBurstKind.OnCall),
      // Not in the burst: no button of its own.
      item("2026-10-13T07:05:00.000Z"),
    ];

    const togglesOf: (
      day: FeedTimelineDay<FeedTimelineItem>,
    ) => Array<string | null> = (
      day: FeedTimelineDay<FeedTimelineItem>,
    ): Array<string | null> => {
      return day.entries.map((entry: FeedTimelineEntry<FeedTimelineItem>) => {
        if (!entry.burstToggle) {
          return null;
        }

        return `${entry.burstToggle.burstKey}:${entry.burstToggle.foldedCount}:${
          entry.burstToggle.isExpanded ? "expanded" : "folded"
        }`;
      });
    };

    const folded: FeedTimelineDay<FeedTimelineItem> = buildFeedTimeline({
      items,
      clock: clock(),
    })[0]!;

    expect(togglesOf(folded)).toEqual([`${items[0]!.key}:3:folded`, null]);

    const unfolded: FeedTimelineDay<FeedTimelineItem> = buildFeedTimeline({
      items,
      clock: clock(),
      expandedBurstKeys: new Set<string>([items[0]!.key]),
    })[0]!;

    /*
     * "Show fewer" follows the group's last entry rather than splitting the
     * group after its first, and still folds the burst its first entry keys.
     */
    expect(togglesOf(unfolded)).toEqual([
      null,
      null,
      null,
      `${items[0]!.key}:3:expanded`,
      null,
    ]);
  });

  test("the entry after a folded burst shows its time, even when an entry inside the fold read the same", () => {
    const items: Array<FeedTimelineItem> = [
      item("2026-10-13T07:20:00.000Z", FeedBurstKind.OnCall),
      item("2026-10-13T07:19:30.000Z", FeedBurstKind.OnCall),
      item("2026-10-13T07:19:10.000Z", FeedBurstKind.OnCall),
      // 3:19 PM - the folded entries' time, not the visible first one's.
      item("2026-10-13T07:19:00.000Z"),
    ];

    const folded: FeedTimelineDay<FeedTimelineItem> = buildFeedTimeline({
      items,
      clock: clock(),
    })[0]!;

    expect(shownTimes(folded)).toEqual(["3:20 PM", "3:19 PM"]);

    const unfolded: FeedTimelineDay<FeedTimelineItem> = buildFeedTimeline({
      items,
      clock: clock(),
      expandedBurstKeys: new Set<string>([items[0]!.key]),
    })[0]!;

    expect(shownTimes(unfolded)).toEqual(["3:20 PM", "3:19 PM", null, null]);
  });

  test("a feed with hundreds of entries builds in a blink", () => {
    const items: Array<FeedTimelineItem> = [];

    for (let index: number = 0; index < 2000; index++) {
      items.push(
        item(
          new Date(NOW.getTime() - index * 20 * 1000).toISOString(),
          index % 7 === 0 ? undefined : FeedBurstKind.OnCall,
        ),
      );
    }

    const timed: FastestRun<Array<FeedTimelineDay<FeedTimelineItem>>> =
      fastestRun({
        run: (): Array<FeedTimelineDay<FeedTimelineItem>> => {
          return buildFeedTimeline({
            items,
            clock: clock(),
          });
        },
        limitInMs: 2000,
      });
    const days: Array<FeedTimelineDay<FeedTimelineItem>> = timed.result;

    expect(timed.inMs).toBeLessThan(2000);
    expect(days.length).toBeGreaterThan(0);
  });
});

describe("whether the feed keeps its clock running", () => {
  test("it does while an entry is from today", () => {
    expect(
      hasFeedEntryFromToday([item("2026-10-13T01:00:00.000Z")], clock()),
    ).toBe(true);
  });

  test("it does not for a feed of older entries", () => {
    expect(
      hasFeedEntryFromToday(
        [item("2026-10-12T01:00:00.000Z"), item("2026-10-01T01:00:00.000Z")],
        clock(),
      ),
    ).toBe(false);
  });

  test("an invalid date is never 'today'", () => {
    expect(
      hasFeedEntryFromToday(
        [{ key: "x", itemDateTime: new Date("nope") }],
        clock(),
      ),
    ).toBe(false);
  });
});
