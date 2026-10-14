/*
 * ---------------------------------------------------------------------------
 * The geometry of a status timeline, before React draws it
 * ---------------------------------------------------------------------------
 *
 * A status timeline shows the statuses (or states) a record has been in
 * along one axis of time: a band in which every status is a segment whose
 * place and length are when it began and how long it lasted, and under it
 * the same statuses as a list. This file decides everything about the band
 * that can be decided without a browser - which entry ends when, where each
 * segment sits, which ones are too short to see and are drawn wider, which
 * of those run together and are drawn as one, and what the band says about
 * the time nothing covers - so each rule is tested on its own.
 *
 * The band is drawn to scale. A month in which a monitor was Offline for 38
 * seconds really is all one colour but a sliver, and the proportions can be
 * trusted at a glance ("down for a tenth of a percent"). Three things keep a
 * to-scale band readable:
 *
 *   1. An entry too short to see is drawn MIN_MARK_PX wide, centred on when
 *      it happened, so a 38-second outage in a month stays visible - and is
 *      a target that can be pointed at, tapped and focused.
 *   2. Short entries whose marks would overlap are drawn as one mark (a
 *      cluster) in the colour of the most serious status among them. A
 *      cluster is not something to read, but somewhere to look closer:
 *      choosing it zooms the band to the time it covers.
 *   3. The list under the band is not to scale: every entry gets one row,
 *      however long it lasted, so a long quiet stretch takes no more room
 *      than a blip.
 *
 * React-free.
 */

import moment from "moment-timezone";

// One status (or state) the record was in.
export interface StatusTimelineEntry {
  // The row's id.
  id: string;
  /*
   * Which status this is, for the legend, where every entry of one status
   * is counted together: the status's id, or its name.
   */
  statusKey: string;
  // The status's name as the reader sees it.
  name: string;
  // The status's own colour, as CSS ("#16a34a").
  color: string;
  startsAt: Date;
  // Null while the record is still in this status.
  endsAt: Date | null;
  /*
   * How serious the status is, higher being worse - a monitor status's
   * priority. Decides the colour of a cluster of short entries: the most
   * serious status among them is the one to see. Optional: without it a
   * cluster takes the colour of the status it spent longest in.
   */
  rank?: number | undefined;
}

export interface StatusTimelineWindow {
  start: Date;
  end: Date;
}

/*
 * An entry with its end worked out: its own end, or - for an entry with no
 * end that a later entry took over from (an open row the server has not
 * closed yet) - the next entry's start, or now for the entry in effect.
 */
export interface ResolvedStatusTimelineEntry extends StatusTimelineEntry {
  /*
   * When it ended, for the list: its own end, else the next entry's start.
   * Null for the entry in effect now.
   */
  listEnd: Date | null;
  /*
   * When it ended, for the band: as listEnd, but never past the next
   * entry's start (two rows never draw over each other) and, for the entry
   * in effect, now.
   */
  bandEnd: Date;
  // The entry in effect now: the newest entry, with no end.
  isOngoing: boolean;
}

/*
 * How close to now a window's end may be and still count as ending now:
 * the clock is read at different moments by the different parts of a page.
 */
export const NOW_TOLERANCE_MS: number = 60 * 1000;

// The narrowest an entry is drawn, in CSS pixels: a blip stays visible.
export const MIN_MARK_PX: number = 4;

/*
 * The width the band is laid out for until it has been measured (the first
 * paint, a test without layout): about what it is on a laptop.
 */
export const DEFAULT_BAND_WIDTH_PX: number = 800;

/*
 * A stretch shorter than this, in milliseconds, that no entry covers is not
 * drawn as a gap: rows written a second apart are one timeline, not two with
 * a hole between them.
 */
export const MIN_GAP_MS: number = 1000;

const WHITESPACE: RegExp = /\s+/;

const time: (date: Date) => number = (date: Date): number => {
  return date.getTime();
};

/*
 * The entries oldest first, each with its end worked out. Entries without a
 * usable start are left out. Two entries that start together are kept in
 * the order of their ids, so the result never depends on the order the
 * server happened to send them in.
 */
export const resolveStatusTimelineEntries: (
  entries: Array<StatusTimelineEntry>,
  now: Date,
) => Array<ResolvedStatusTimelineEntry> = (
  entries: Array<StatusTimelineEntry>,
  now: Date,
): Array<ResolvedStatusTimelineEntry> => {
  const sorted: Array<StatusTimelineEntry> = entries
    .filter((entry: StatusTimelineEntry): boolean => {
      return entry.startsAt instanceof Date && !isNaN(time(entry.startsAt));
    })
    .sort((a: StatusTimelineEntry, b: StatusTimelineEntry): number => {
      const byStart: number = time(a.startsAt) - time(b.startsAt);

      if (byStart !== 0) {
        return byStart;
      }

      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  return sorted.map(
    (
      entry: StatusTimelineEntry,
      index: number,
    ): ResolvedStatusTimelineEntry => {
      const next: StatusTimelineEntry | undefined = sorted[index + 1];
      const ownEnd: Date | null =
        entry.endsAt instanceof Date && !isNaN(time(entry.endsAt))
          ? entry.endsAt
          : null;

      const listEnd: Date | null = ownEnd || (next ? next.startsAt : null);
      const isOngoing: boolean = !listEnd;

      let bandEnd: Date = listEnd || now;

      // Never draw over the entry after it.
      if (next && time(bandEnd) > time(next.startsAt)) {
        bandEnd = next.startsAt;
      }

      // Never end before it began (a clock ahead of this one, bad data).
      if (time(bandEnd) < time(entry.startsAt)) {
        bandEnd = entry.startsAt;
      }

      return {
        ...entry,
        listEnd: listEnd,
        bandEnd: bandEnd,
        isOngoing: isOngoing,
      };
    },
  );
};

// One thing drawn in the band: an entry, or several short ones as one.
export interface StatusTimelineBandMark {
  key: string;
  // The entries it stands for, oldest first.
  entryIds: Array<string>;
  // More than one entry: choosing it zooms in rather than picking one.
  isCluster: boolean;
  // The time it stands for, cut at the window's edges.
  start: Date;
  end: Date;
  // In percent of the band's width.
  left: number;
  width: number;
  color: string;
  // It holds the entry in effect now.
  isOngoing: boolean;
  // Drawn wider than the time it stands for, so it can be seen.
  isWidened: boolean;
  // The entry began before the window, or ends after it.
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export enum StatusTimelineGapKind {
  // Nothing was recorded then: before the first status, or a hole between rows.
  NoData = "no-data",
  // Rows exist then, but more of them than one view loads.
  NotLoaded = "not-loaded",
  // After now: a window that reaches into the future.
  Future = "future",
}

export interface StatusTimelineBandGap {
  key: string;
  kind: StatusTimelineGapKind;
  start: Date;
  end: Date;
  left: number;
  width: number;
}

export interface StatusTimelineBandLayout {
  // Left to right (see the sort at the end of layoutStatusTimelineBand).
  marks: Array<StatusTimelineBandMark>;
  gaps: Array<StatusTimelineBandGap>;
}

export interface StatusTimelineBandOptions {
  // Oldest first, as resolveStatusTimelineEntries returns them.
  entries: Array<ResolvedStatusTimelineEntry>;
  window: StatusTimelineWindow;
  now: Date;
  // The band's width in CSS pixels; unmeasured (0) is DEFAULT_BAND_WIDTH_PX.
  widthPx: number;
  minMarkPx?: number | undefined;
  /*
   * Where the loaded history begins, when the window holds more entries
   * than were loaded: the time before it that no loaded entry covers is
   * "not loaded", not "nothing recorded".
   */
  loadedFrom?: Date | null | undefined;
}

interface PlacedEntry {
  entry: ResolvedStatusTimelineEntry;
  start: number;
  end: number;
  x0: number;
  x1: number;
}

interface Cluster {
  placed: Array<PlacedEntry>;
  x0: number;
  x1: number;
}

/*
 * The colour of several short entries drawn as one: the most serious status
 * among them (highest rank); between equally serious ones, the status they
 * spent longest in; then the newest.
 */
export const getClusterColor: (
  entries: Array<{
    color: string;
    rank?: number | undefined;
    durationMs: number;
    startsAt: Date;
  }>,
) => string = (
  entries: Array<{
    color: string;
    rank?: number | undefined;
    durationMs: number;
    startsAt: Date;
  }>,
): string => {
  let best:
    | {
        color: string;
        rank?: number | undefined;
        durationMs: number;
        startsAt: Date;
      }
    | undefined = undefined;

  for (const entry of entries) {
    if (!best) {
      best = entry;
      continue;
    }

    const rank: number =
      typeof entry.rank === "number" ? entry.rank : Number.NEGATIVE_INFINITY;
    const bestRank: number =
      typeof best.rank === "number" ? best.rank : Number.NEGATIVE_INFINITY;

    if (rank !== bestRank) {
      if (rank > bestRank) {
        best = entry;
      }
      continue;
    }

    if (entry.durationMs !== best.durationMs) {
      if (entry.durationMs > best.durationMs) {
        best = entry;
      }
      continue;
    }

    if (time(entry.startsAt) >= time(best.startsAt)) {
      best = entry;
    }
  }

  return best ? best.color : "";
};

/*
 * Where every entry is drawn in the band, and what the band says about the
 * time no entry covers.
 */
export const layoutStatusTimelineBand: (
  options: StatusTimelineBandOptions,
) => StatusTimelineBandLayout = (
  options: StatusTimelineBandOptions,
): StatusTimelineBandLayout => {
  const windowStart: number = time(options.window.start);
  const windowEnd: number = time(options.window.end);
  const span: number = windowEnd - windowStart;

  if (!(span > 0)) {
    return { marks: [], gaps: [] };
  }

  const widthPx: number =
    options.widthPx > 0 ? options.widthPx : DEFAULT_BAND_WIDTH_PX;
  const minMarkPx: number = Math.min(
    Math.max(options.minMarkPx ?? MIN_MARK_PX, 1),
    widthPx,
  );

  const toPx: (instant: number) => number = (instant: number): number => {
    return ((instant - windowStart) / span) * widthPx;
  };

  const toPercent: (px: number) => number = (px: number): number => {
    return (px / widthPx) * 100;
  };

  /*
   * Whether an entry runs on past the window's end. The status in effect
   * ends at now, so a window that ends at now (to the minute: the band and
   * its caller read the clock at different moments) holds all of it.
   */
  const continuesPastWindow: (entry: ResolvedStatusTimelineEntry) => boolean = (
    entry: ResolvedStatusTimelineEntry,
  ): boolean => {
    if (entry.isOngoing) {
      return windowEnd < time(options.now) - NOW_TOLERANCE_MS;
    }

    return time(entry.bandEnd) > windowEnd;
  };

  const placed: Array<PlacedEntry> = [];

  for (const entry of options.entries) {
    const entryStart: number = time(entry.startsAt);
    const entryEnd: number = time(entry.bandEnd);

    /*
     * In the window: it overlaps it, or - an entry that lasted no time at
     * all - it happened inside it.
     */
    const overlaps: boolean = entryStart < windowEnd && entryEnd > windowStart;
    const isInstantInside: boolean =
      entryStart === entryEnd &&
      entryStart >= windowStart &&
      entryStart < windowEnd;

    if (!overlaps && !isInstantInside) {
      continue;
    }

    const start: number = Math.max(entryStart, windowStart);
    const end: number = Math.min(entryEnd, windowEnd);

    placed.push({
      entry: entry,
      start: start,
      end: end,
      x0: toPx(start),
      x1: toPx(end),
    });
  }

  const marks: Array<StatusTimelineBandMark> = [];
  const narrow: Array<PlacedEntry> = [];

  for (const item of placed) {
    if (item.x1 - item.x0 >= minMarkPx) {
      marks.push({
        key: item.entry.id,
        entryIds: [item.entry.id],
        isCluster: false,
        start: new Date(item.start),
        end: new Date(item.end),
        left: toPercent(item.x0),
        width: toPercent(item.x1 - item.x0),
        color: item.entry.color,
        isOngoing: item.entry.isOngoing,
        isWidened: false,
        continuesBefore: time(item.entry.startsAt) < windowStart,
        continuesAfter: continuesPastWindow(item.entry),
      });
    } else {
      narrow.push(item);
    }
  }

  /*
   * Each short entry gets a mark minMarkPx wide, centred on when it
   * happened and kept inside the band; marks that touch or overlap are one
   * cluster.
   */
  const clusters: Array<Cluster> = [];

  for (const item of narrow) {
    const centre: number = (item.x0 + item.x1) / 2;
    const x0: number = Math.min(
      Math.max(centre - minMarkPx / 2, 0),
      widthPx - minMarkPx,
    );
    const x1: number = x0 + minMarkPx;
    const last: Cluster | undefined = clusters[clusters.length - 1];

    if (last && x0 <= last.x1) {
      last.placed.push(item);
      last.x1 = Math.max(last.x1, x1);
      continue;
    }

    clusters.push({ placed: [item], x0: x0, x1: x1 });
  }

  for (const cluster of clusters) {
    const first: PlacedEntry = cluster.placed[0]!;
    const isCluster: boolean = cluster.placed.length > 1;

    marks.push({
      key: isCluster
        ? `cluster-${first.entry.id}-${cluster.placed.length}`
        : first.entry.id,
      entryIds: cluster.placed.map((item: PlacedEntry): string => {
        return item.entry.id;
      }),
      isCluster: isCluster,
      start: new Date(
        Math.min(
          ...cluster.placed.map((item: PlacedEntry): number => {
            return item.start;
          }),
        ),
      ),
      end: new Date(
        Math.max(
          ...cluster.placed.map((item: PlacedEntry): number => {
            return item.end;
          }),
        ),
      ),
      left: toPercent(cluster.x0),
      width: toPercent(cluster.x1 - cluster.x0),
      color: getClusterColor(
        cluster.placed.map((item: PlacedEntry) => {
          return {
            color: item.entry.color,
            rank: item.entry.rank,
            durationMs: item.end - item.start,
            startsAt: item.entry.startsAt,
          };
        }),
      ),
      isOngoing: cluster.placed.some((item: PlacedEntry): boolean => {
        return item.entry.isOngoing;
      }),
      isWidened: true,
      continuesBefore: cluster.placed.some((item: PlacedEntry): boolean => {
        return time(item.entry.startsAt) < windowStart;
      }),
      continuesAfter: cluster.placed.some((item: PlacedEntry): boolean => {
        return continuesPastWindow(item.entry);
      }),
    });
  }

  /*
   * Left to right, the order the arrow keys walk them in. A widened mark
   * that starts where a segment starts comes after it: it is drawn on top.
   */
  marks.sort((a: StatusTimelineBandMark, b: StatusTimelineBandMark): number => {
    if (a.left !== b.left) {
      return a.left - b.left;
    }

    return Number(a.isWidened) - Number(b.isWidened);
  });

  return {
    marks: marks,
    gaps: getBandGaps({
      placed: placed,
      windowStart: windowStart,
      windowEnd: windowEnd,
      now: time(options.now),
      loadedFrom: options.loadedFrom ? time(options.loadedFrom) : null,
      minimumGapMs: Math.max(MIN_GAP_MS, span / widthPx),
      toPercent: (instant: number): number => {
        return toPercent(toPx(instant));
      },
    }),
  };
};

// The stretches of the window no entry covers, and why.
const getBandGaps: (data: {
  placed: Array<PlacedEntry>;
  windowStart: number;
  windowEnd: number;
  now: number;
  loadedFrom: number | null;
  minimumGapMs: number;
  toPercent: (instant: number) => number;
}) => Array<StatusTimelineBandGap> = (data: {
  placed: Array<PlacedEntry>;
  windowStart: number;
  windowEnd: number;
  now: number;
  loadedFrom: number | null;
  minimumGapMs: number;
  toPercent: (instant: number) => number;
}): Array<StatusTimelineBandGap> => {
  const gaps: Array<StatusTimelineBandGap> = [];

  const push: (
    kind: StatusTimelineGapKind,
    from: number,
    to: number,
  ) => void = (kind: StatusTimelineGapKind, from: number, to: number): void => {
    if (to - from < data.minimumGapMs) {
      return;
    }

    const left: number = data.toPercent(from);

    gaps.push({
      key: `${kind}-${from}`,
      kind: kind,
      start: new Date(from),
      end: new Date(to),
      left: left,
      width: data.toPercent(to) - left,
    });
  };

  // Time that has happened: up to now, or the window's end if earlier.
  const pastEnd: number = Math.min(
    data.windowEnd,
    Math.max(data.now, data.windowStart),
  );

  const covered: Array<{ start: number; end: number }> = data.placed
    .map((item: PlacedEntry) => {
      return { start: item.start, end: item.end };
    })
    .sort((a: { start: number }, b: { start: number }): number => {
      return a.start - b.start;
    });

  const pushUncovered: (from: number, to: number) => void = (
    from: number,
    to: number,
  ): void => {
    if (to <= from) {
      return;
    }

    // Before the loaded history begins: there are rows, not loaded.
    if (data.loadedFrom !== null && from < data.loadedFrom) {
      const split: number = Math.min(to, data.loadedFrom);
      push(StatusTimelineGapKind.NotLoaded, from, split);
      push(StatusTimelineGapKind.NoData, split, to);
      return;
    }

    push(StatusTimelineGapKind.NoData, from, to);
  };

  let cursor: number = data.windowStart;

  for (const interval of covered) {
    if (interval.start >= pastEnd) {
      break;
    }

    if (interval.start > cursor) {
      pushUncovered(cursor, interval.start);
    }

    cursor = Math.max(cursor, interval.end);
  }

  pushUncovered(cursor, pastEnd);

  if (data.windowEnd > pastEnd) {
    push(StatusTimelineGapKind.Future, pastEnd, data.windowEnd);
  }

  return gaps;
};

// ---------------------------------------------------------------------------
// Time spent in each status
// ---------------------------------------------------------------------------

export interface StatusTimelineSummaryItem {
  statusKey: string;
  name: string;
  color: string;
  rank?: number | undefined;
  // Time spent in it inside the window, up to now.
  durationMs: number;
  // Its share of the time the window has a status for, from 0 to 1.
  share: number;
  // How many entries of it the window holds.
  count: number;
}

export interface StatusTimelineSummary {
  items: Array<StatusTimelineSummaryItem>;
  // The time inside the window, up to now, that has a status.
  measuredMs: number;
}

/*
 * How long the record spent in each status, for the legend: inside the
 * window (a monitor's last month), or - `isWholeHistory`, for a band fitted
 * to a record's whole life - each status's whole time, so an incident
 * resolved three weeks ago says Resolved for three weeks, not for the
 * stretch of it the band has room for.
 *
 * Statuses are listed best first when they have ranks (Operational, then
 * Degraded, then Offline), else in the order the record first entered them
 * (Created, Acknowledged, Resolved).
 */
export const summarizeStatusTimeline: (data: {
  entries: Array<ResolvedStatusTimelineEntry>;
  window: StatusTimelineWindow;
  now: Date;
  isWholeHistory?: boolean | undefined;
}) => StatusTimelineSummary = (data: {
  entries: Array<ResolvedStatusTimelineEntry>;
  window: StatusTimelineWindow;
  now: Date;
  isWholeHistory?: boolean | undefined;
}): StatusTimelineSummary => {
  const windowStart: number = data.isWholeHistory
    ? Number.NEGATIVE_INFINITY
    : time(data.window.start);
  const windowEnd: number = data.isWholeHistory
    ? time(data.now)
    : Math.min(time(data.window.end), time(data.now));
  const byStatus: Map<string, StatusTimelineSummaryItem> = new Map<
    string,
    StatusTimelineSummaryItem
  >();
  const order: Array<string> = [];
  let measuredMs: number = 0;

  for (const entry of data.entries) {
    const start: number = Math.max(time(entry.startsAt), windowStart);
    const end: number = Math.min(time(entry.bandEnd), windowEnd);
    const isInside: boolean =
      data.isWholeHistory ||
      end > start ||
      (time(entry.startsAt) >= windowStart &&
        time(entry.startsAt) < time(data.window.end));

    if (!isInside) {
      continue;
    }

    const durationMs: number = Math.max(0, end - start);
    measuredMs += durationMs;

    let item: StatusTimelineSummaryItem | undefined = byStatus.get(
      entry.statusKey,
    );

    if (!item) {
      item = {
        statusKey: entry.statusKey,
        name: entry.name,
        color: entry.color,
        rank: entry.rank,
        durationMs: 0,
        share: 0,
        count: 0,
      };
      byStatus.set(entry.statusKey, item);
      order.push(entry.statusKey);
    }

    item.durationMs += durationMs;
    item.count += 1;
  }

  const items: Array<StatusTimelineSummaryItem> = order.map(
    (key: string): StatusTimelineSummaryItem => {
      const item: StatusTimelineSummaryItem = byStatus.get(key)!;

      return {
        ...item,
        share: measuredMs > 0 ? item.durationMs / measuredMs : 0,
      };
    },
  );

  const hasRanks: boolean = items.some(
    (item: StatusTimelineSummaryItem): boolean => {
      return typeof item.rank === "number";
    },
  );

  /*
   * Without ranks the items stay in the order the record first entered
   * them (the entries are oldest first); with ranks, best first.
   */
  if (hasRanks) {
    items.sort(
      (a: StatusTimelineSummaryItem, b: StatusTimelineSummaryItem): number => {
        const rankA: number =
          typeof a.rank === "number" ? a.rank : Number.POSITIVE_INFINITY;
        const rankB: number =
          typeof b.rank === "number" ? b.rank : Number.POSITIVE_INFINITY;

        if (rankA !== rankB) {
          return rankA - rankB;
        }

        return b.durationMs - a.durationMs;
      },
    );
  }

  return { items: items, measuredMs: measuredMs };
};

/*
 * A share as the legend writes it: two decimals at most, trailing zeros
 * dropped, and never rounded to a claim it is not - a status held for all
 * but a second of the month is "99.99%", not "100%", and one held for a
 * second is "<0.01%", not "0%".
 */
export const formatStatusTimelineShare: (share: number) => string = (
  share: number,
): string => {
  if (!isFinite(share) || share <= 0) {
    return "0%";
  }

  if (share >= 1) {
    return "100%";
  }

  const percent: number = share * 100;

  if (percent < 0.01) {
    return "<0.01%";
  }

  // Down, not to nearest, near the top: 99.996 is not 100.
  const rounded: number =
    percent > 99.99
      ? Math.floor(percent * 100) / 100
      : Math.round(percent * 100) / 100;

  return `${Number(rounded.toFixed(2)).toString()}%`;
};

/*
 * A duration for the legend: the timelines' own wording ("2 days 3 hours 4
 * mins 5 secs"), kept to its two largest units - "29 days 23 hours".
 */
export const formatStatusTimelineCompactDuration: (
  fullDuration: string,
) => string = (fullDuration: string): string => {
  const words: Array<string> = fullDuration.trim().split(WHITESPACE);

  if (words.length <= 4) {
    return words.join(" ");
  }

  return words.slice(0, 4).join(" ");
};

// ---------------------------------------------------------------------------
// The window: moving through time
// ---------------------------------------------------------------------------

/*
 * The window as long as this one, just before it - or just after it, but
 * never past now: the later of the two ends at now at the latest.
 */
export const shiftStatusTimelineWindow: (data: {
  window: StatusTimelineWindow;
  direction: -1 | 1;
  now: Date;
}) => StatusTimelineWindow = (data: {
  window: StatusTimelineWindow;
  direction: -1 | 1;
  now: Date;
}): StatusTimelineWindow => {
  const length: number = time(data.window.end) - time(data.window.start);

  if (data.direction < 0) {
    return {
      start: new Date(time(data.window.start) - length),
      end: new Date(data.window.start),
    };
  }

  const end: number = Math.min(time(data.window.end) + length, time(data.now));

  return {
    start: new Date(end - length),
    end: new Date(end),
  };
};

// Whether the window ends at now (or after): there is nothing later to see.
export const isStatusTimelineWindowAtNow: (data: {
  window: StatusTimelineWindow;
  now: Date;
  toleranceMs?: number | undefined;
}) => boolean = (data: {
  window: StatusTimelineWindow;
  now: Date;
  toleranceMs?: number | undefined;
}): boolean => {
  return (
    time(data.window.end) >=
    time(data.now) - (data.toleranceMs ?? NOW_TOLERANCE_MS)
  );
};

/*
 * How a window that ended at now when it was read keeps up with the clock
 * while the page stays open: a period ("Past 1 Month") slides along, as
 * long as it was; a record's whole history grows to now.
 */
export enum StatusTimelineWindowFollow {
  Slide = "slide",
  Extend = "extend",
}

export const followStatusTimelineWindow: (data: {
  window: StatusTimelineWindow;
  now: Date;
  follow?: StatusTimelineWindowFollow | undefined;
}) => StatusTimelineWindow = (data: {
  window: StatusTimelineWindow;
  now: Date;
  follow?: StatusTimelineWindowFollow | undefined;
}): StatusTimelineWindow => {
  const end: number = time(data.window.end);
  const now: number = time(data.now);

  if (!data.follow || now <= end) {
    return data.window;
  }

  if (data.follow === StatusTimelineWindowFollow.Slide) {
    return {
      start: new Date(time(data.window.start) + (now - end)),
      end: new Date(now),
    };
  }

  return { start: data.window.start, end: new Date(now) };
};

// The shortest window the band zooms to: closer than this shows nothing more.
export const MIN_ZOOM_WINDOW_MS: number = 60 * 1000;

/*
 * The window to zoom to for a stretch of time: the stretch, with a little
 * room on each side so its first and last entries are not cut at the
 * edges, at least MIN_ZOOM_WINDOW_MS long, and never past now.
 */
export const getStatusTimelineZoomWindow: (data: {
  start: Date;
  end: Date;
  now: Date;
  paddingRatio?: number | undefined;
}) => StatusTimelineWindow = (data: {
  start: Date;
  end: Date;
  now: Date;
  paddingRatio?: number | undefined;
}): StatusTimelineWindow => {
  let start: number = Math.min(time(data.start), time(data.end));
  let end: number = Math.max(time(data.start), time(data.end));
  const padding: number = (end - start) * (data.paddingRatio ?? 0.1);

  start -= padding;
  end += padding;

  if (end - start < MIN_ZOOM_WINDOW_MS) {
    const middle: number = (start + end) / 2;
    start = middle - MIN_ZOOM_WINDOW_MS / 2;
    end = middle + MIN_ZOOM_WINDOW_MS / 2;
  }

  const latest: number = time(data.now);

  if (end > latest) {
    const length: number = end - start;
    end = Math.max(latest, time(data.end));
    start = end - length;
  }

  return { start: new Date(start), end: new Date(end) };
};

/*
 * A fitted band runs on to now while its last change is no older than this
 * many times the span between its first and last change.
 */
export const RECENT_CHANGE_SPAN_RATIO: number = 3;

/*
 * The window that shows a record's whole history: from its first entry to
 * a little after its last change, so the time between its changes fills
 * the band. The status it is in now, which runs on to now, is cut short
 * there rather than squeezing every change into a sliver - an incident
 * resolved three weeks ago after two hours would otherwise be a band of
 * Resolved with its whole story in the first pixel. A record that changed
 * recently ends at now.
 */
export const getStatusTimelineFitWindow: (data: {
  entries: Array<StatusTimelineEntry>;
  now: Date;
  trailingRatio?: number | undefined;
}) => StatusTimelineWindow | null = (data: {
  entries: Array<StatusTimelineEntry>;
  now: Date;
  trailingRatio?: number | undefined;
}): StatusTimelineWindow | null => {
  const starts: Array<number> = data.entries
    .map((entry: StatusTimelineEntry): number => {
      return time(entry.startsAt);
    })
    .filter((value: number): boolean => {
      return !isNaN(value);
    });

  if (starts.length === 0) {
    return null;
  }

  const first: number = Math.min(...starts);
  const lastChange: number = Math.max(...starts);
  const latest: number = Math.max(time(data.now), lastChange);
  const span: number = lastChange - first;

  /*
   * One status all along (or every entry starting together): its whole
   * life, up to now.
   */
  if (span === 0) {
    const end: number = Math.max(latest, first + MIN_ZOOM_WINDOW_MS);
    return { start: new Date(first), end: new Date(end) };
  }

  /*
   * Changed lately - no longer ago than a few times the span between its
   * first and last change (an incident being worked on): up to now, so the
   * band shows how long the current state has held. Long ago (an incident
   * resolved weeks ago): a little after the last change.
   */
  if (latest - lastChange <= span * RECENT_CHANGE_SPAN_RATIO) {
    return { start: new Date(first), end: new Date(latest) };
  }

  const trailing: number = Math.max(
    span * (data.trailingRatio ?? 0.25),
    MIN_ZOOM_WINDOW_MS,
  );
  const end: number = Math.min(latest, lastChange + trailing);
  const start: number = Math.min(first, end - MIN_ZOOM_WINDOW_MS);

  return { start: new Date(start), end: new Date(end) };
};

// ---------------------------------------------------------------------------
// The axis under the band
// ---------------------------------------------------------------------------

export enum StatusTimelineTickUnit {
  Minute = "minute",
  Hour = "hour",
  Day = "day",
  Week = "week",
  Month = "month",
  Year = "year",
}

interface TickStep {
  unit: StatusTimelineTickUnit;
  count: number;
  // Roughly, for choosing a step.
  approximateMs: number;
}

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;

const TICK_STEPS: Array<TickStep> = [
  { unit: StatusTimelineTickUnit.Minute, count: 1, approximateMs: MINUTE_MS },
  {
    unit: StatusTimelineTickUnit.Minute,
    count: 5,
    approximateMs: 5 * MINUTE_MS,
  },
  {
    unit: StatusTimelineTickUnit.Minute,
    count: 10,
    approximateMs: 10 * MINUTE_MS,
  },
  {
    unit: StatusTimelineTickUnit.Minute,
    count: 15,
    approximateMs: 15 * MINUTE_MS,
  },
  {
    unit: StatusTimelineTickUnit.Minute,
    count: 30,
    approximateMs: 30 * MINUTE_MS,
  },
  { unit: StatusTimelineTickUnit.Hour, count: 1, approximateMs: HOUR_MS },
  { unit: StatusTimelineTickUnit.Hour, count: 2, approximateMs: 2 * HOUR_MS },
  { unit: StatusTimelineTickUnit.Hour, count: 3, approximateMs: 3 * HOUR_MS },
  { unit: StatusTimelineTickUnit.Hour, count: 6, approximateMs: 6 * HOUR_MS },
  {
    unit: StatusTimelineTickUnit.Hour,
    count: 12,
    approximateMs: 12 * HOUR_MS,
  },
  { unit: StatusTimelineTickUnit.Day, count: 1, approximateMs: DAY_MS },
  { unit: StatusTimelineTickUnit.Day, count: 2, approximateMs: 2 * DAY_MS },
  { unit: StatusTimelineTickUnit.Week, count: 1, approximateMs: 7 * DAY_MS },
  { unit: StatusTimelineTickUnit.Week, count: 2, approximateMs: 14 * DAY_MS },
  { unit: StatusTimelineTickUnit.Month, count: 1, approximateMs: 30 * DAY_MS },
  {
    unit: StatusTimelineTickUnit.Month,
    count: 3,
    approximateMs: 91 * DAY_MS,
  },
  {
    unit: StatusTimelineTickUnit.Month,
    count: 6,
    approximateMs: 182 * DAY_MS,
  },
  { unit: StatusTimelineTickUnit.Year, count: 1, approximateMs: 365 * DAY_MS },
];

// The room a tick label needs, in CSS pixels.
export const TICK_SPACING_PX: number = 96;

export interface StatusTimelineTick {
  at: Date;
  // In percent of the band's width.
  left: number;
  unit: StatusTimelineTickUnit;
  /*
   * A tick at the start of a day (or a month, a year) under a finer step:
   * its label names the day rather than the hour.
   */
  isDayStart: boolean;
}

/*
 * The ticks under the band: as many as fit TICK_SPACING_PX apart, on round
 * times of the reader's zone - every 6 hours from midnight, every Monday,
 * the 1st of every month. A day is a calendar day of that zone, so a tick
 * at a clock change still sits on the wall clock's midnight.
 */
export const getStatusTimelineTicks: (data: {
  window: StatusTimelineWindow;
  widthPx: number;
  timezone: string;
}) => Array<StatusTimelineTick> = (data: {
  window: StatusTimelineWindow;
  widthPx: number;
  timezone: string;
}): Array<StatusTimelineTick> => {
  const windowStart: number = time(data.window.start);
  const windowEnd: number = time(data.window.end);
  const span: number = windowEnd - windowStart;

  if (!(span > 0)) {
    return [];
  }

  const widthPx: number =
    data.widthPx > 0 ? data.widthPx : DEFAULT_BAND_WIDTH_PX;
  const maxTicks: number = Math.max(1, Math.floor(widthPx / TICK_SPACING_PX));

  const step: TickStep =
    TICK_STEPS.find((candidate: TickStep): boolean => {
      return span / candidate.approximateMs <= maxTicks;
    }) || TICK_STEPS[TICK_STEPS.length - 1]!;

  const zone: string = moment.tz.zone(data.timezone) ? data.timezone : "UTC";

  const first: moment.Moment = getFirstTick(moment.tz(windowStart, zone), step);

  const ticks: Array<StatusTimelineTick> = [];
  const cursor: moment.Moment = first.clone();

  // Bounded: a step never yields more than a few dozen ticks in a window.
  for (let index: number = 0; index < 500; index++) {
    const at: number = cursor.valueOf();

    if (at > windowEnd) {
      break;
    }

    if (at >= windowStart) {
      ticks.push({
        at: new Date(at),
        left: ((at - windowStart) / span) * 100,
        unit: step.unit,
        isDayStart:
          (step.unit === StatusTimelineTickUnit.Minute ||
            step.unit === StatusTimelineTickUnit.Hour) &&
          cursor.hours() === 0 &&
          cursor.minutes() === 0,
      });
    }

    advanceTick(cursor, step);
  }

  return ticks;
};

const getFirstTick: (start: moment.Moment, step: TickStep) => moment.Moment = (
  start: moment.Moment,
  step: TickStep,
): moment.Moment => {
  const tick: moment.Moment = start.clone();

  switch (step.unit) {
    case StatusTimelineTickUnit.Minute: {
      tick.startOf("hour");
      break;
    }
    case StatusTimelineTickUnit.Hour:
    case StatusTimelineTickUnit.Day: {
      tick.startOf("day");
      break;
    }
    case StatusTimelineTickUnit.Week: {
      tick.startOf("isoWeek");
      break;
    }
    case StatusTimelineTickUnit.Month: {
      tick.startOf("year");
      break;
    }
    case StatusTimelineTickUnit.Year: {
      tick.startOf("year");
      break;
    }
  }

  // Walk up to the first tick at or after the start.
  for (let index: number = 0; index < 1000 && tick.isBefore(start); index++) {
    advanceTick(tick, step);
  }

  return tick;
};

const advanceTick: (tick: moment.Moment, step: TickStep) => void = (
  tick: moment.Moment,
  step: TickStep,
): void => {
  switch (step.unit) {
    case StatusTimelineTickUnit.Minute: {
      tick.add(step.count, "minutes");
      break;
    }
    case StatusTimelineTickUnit.Hour: {
      /*
       * Hours on the wall clock, so ticks every 6 hours stay at 00, 06, 12
       * and 18 across a clock change.
       */
      const nextHour: number = tick.hours() + step.count;

      if (nextHour >= 24) {
        tick.add(1, "day").startOf("day");
      } else {
        tick.hours(nextHour).minutes(0).seconds(0).milliseconds(0);
      }
      break;
    }
    case StatusTimelineTickUnit.Day: {
      tick.add(step.count, "days").startOf("day");
      break;
    }
    case StatusTimelineTickUnit.Week: {
      tick.add(step.count, "weeks").startOf("day");
      break;
    }
    case StatusTimelineTickUnit.Month: {
      tick.add(step.count, "months").startOf("month");
      break;
    }
    case StatusTimelineTickUnit.Year: {
      tick.add(step.count, "years").startOf("year");
      break;
    }
  }
};

// How far a status that continues past the band's edge fades out (px).
export const CONTINUATION_FADE_PX: number = 20;

/*
 * The CSS mask that fades a segment out at the edge it continues past, or
 * null: nothing continues, or the segment is too narrow to fade without
 * looking like a different colour.
 */
export const getStatusTimelineContinuationMask: (data: {
  continuesBefore: boolean;
  continuesAfter: boolean;
  widthPx: number;
}) => string | null = (data: {
  continuesBefore: boolean;
  continuesAfter: boolean;
  widthPx: number;
}): string | null => {
  if (
    (!data.continuesBefore && !data.continuesAfter) ||
    data.widthPx < CONTINUATION_FADE_PX * 3
  ) {
    return null;
  }

  const fade: string = `${CONTINUATION_FADE_PX}px`;

  if (data.continuesBefore && data.continuesAfter) {
    return `linear-gradient(to right, transparent, #000 ${fade}, #000 calc(100% - ${fade}), transparent)`;
  }

  if (data.continuesBefore) {
    return `linear-gradient(to right, transparent, #000 ${fade})`;
  }

  return `linear-gradient(to right, #000 calc(100% - ${fade}), transparent)`;
};

/*
 * About how wide a label of the axis is drawn, in CSS pixels: text-xs in
 * Inter averages under 6.6px a character, digits included. Only used to
 * keep labels apart, so a little over is better than a little under.
 */
export const AXIS_LABEL_CHARACTER_PX: number = 6.6;
export const AXIS_LABEL_GAP_PX: number = 16;

export const estimateStatusTimelineLabelWidthPx: (label: string) => number = (
  label: string,
): number => {
  return Math.ceil(label.length * AXIS_LABEL_CHARACTER_PX);
};

/*
 * Which of the axis's tick labels can be drawn without running into the
 * label at its start (where the band begins), the one at its end ("Now"),
 * or each other - centred on their ticks, on a band `widthPx` wide.
 * Returns the indexes of the ticks to draw.
 */
export const getVisibleStatusTimelineTickIndexes: (data: {
  ticks: Array<{ left: number; label: string }>;
  widthPx: number;
  startLabel: string;
  endLabel?: string | undefined;
}) => Array<number> = (data: {
  ticks: Array<{ left: number; label: string }>;
  widthPx: number;
  startLabel: string;
  endLabel?: string | undefined;
}): Array<number> => {
  const widthPx: number =
    data.widthPx > 0 ? data.widthPx : DEFAULT_BAND_WIDTH_PX;
  const leftLimit: number = data.startLabel
    ? estimateStatusTimelineLabelWidthPx(data.startLabel) + AXIS_LABEL_GAP_PX
    : 0;
  const rightLimit: number = data.endLabel
    ? widthPx -
      estimateStatusTimelineLabelWidthPx(data.endLabel) -
      AXIS_LABEL_GAP_PX
    : widthPx;

  const kept: Array<number> = [];
  let previousRight: number = Number.NEGATIVE_INFINITY;

  data.ticks.forEach(
    (tick: { left: number; label: string }, index: number): void => {
      const centre: number = (tick.left / 100) * widthPx;
      const half: number = estimateStatusTimelineLabelWidthPx(tick.label) / 2;
      const from: number = centre - half;
      const to: number = centre + half;

      if (from < leftLimit || to > rightLimit) {
        return;
      }

      if (from < previousRight + AXIS_LABEL_GAP_PX) {
        return;
      }

      kept.push(index);
      previousRight = to;
    },
  );

  return kept;
};

// ---------------------------------------------------------------------------
// Moving through the band with the keyboard
// ---------------------------------------------------------------------------

/*
 * The mark the arrow keys move to from `currentIndex`, or null for a key
 * that is not the band's (Tab, Enter and Space keep their meaning). Left and
 * right step one mark, Home and End go to the first and the last.
 */
export const getNextStatusTimelineMarkIndex: (data: {
  key: string;
  currentIndex: number;
  markCount: number;
}) => number | null = (data: {
  key: string;
  currentIndex: number;
  markCount: number;
}): number | null => {
  if (data.markCount <= 0) {
    return null;
  }

  const last: number = data.markCount - 1;
  const current: number = Math.min(Math.max(data.currentIndex, 0), last);

  switch (data.key) {
    case "ArrowRight":
    case "ArrowDown":
      return Math.min(current + 1, last);
    case "ArrowLeft":
    case "ArrowUp":
      return Math.max(current - 1, 0);
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
};
