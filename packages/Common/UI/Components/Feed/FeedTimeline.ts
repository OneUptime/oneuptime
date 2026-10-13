import {
  FeedClock,
  formatFeedDay,
  formatFeedFullTime,
  formatFeedTime,
  getFeedDayKey,
  getFeedRelativeDay,
  getFeedRelativeHint,
  getFeedZoneName,
} from "./FeedTime";

/*
 * How a feed's entries are laid out as a timeline, before React draws them:
 *
 *   Tuesday, October 13, 2026 · Today · GMT+8      one heading per day
 *   3:25 PM    entry                                the time of day
 *   12 min ago                                     (a hint, last hour only)
 *              entry                                same minute: no time
 *   3:16 PM    entry                                a burst's first entry,
 *              [Show 4 more on-call updates]        the rest folded under it
 *
 * The entries stay in the order the server sent them - newest or oldest
 * first, as the reader chose - and are only grouped, never reordered.
 *
 * React-free so the rules can be tested on their own.
 */
export interface FeedTimelineItem {
  key: string;
  itemDateTime: Date;
  /*
   * Entries of one kind that arrive together - the on-call pages of one
   * escalation, the owners told of one note - fold into the first of them
   * (FeedBurstKind). Unset, the entry always stands on its own.
   */
  burstKind?: string | undefined;
}

export interface FeedTimelineTime {
  // "3:25 PM", in the reader's zone and language.
  label: string;
  /*
   * False when the entry shown just before it, on the same day, reads the
   * same time: entries from one minute share the first one's time, so a
   * burst of activity reads as one moment.
   */
  isShown: boolean;
  /*
   * The zone's name when it is not the one the day's heading names - the
   * hour after the clocks change, "1:30 AM EST" after "1:30 AM EDT".
   */
  zoneName?: string | undefined;
  // "12 min. ago", for an entry from the last hour.
  relativeHint?: string | undefined;
  // Everything, for the tooltip: "Tuesday, October 13, 2026, 3:25:42 PM GMT+8".
  fullLabel: string;
  // The instant, for <time dateTime>.
  isoString: string;
}

export interface FeedTimelineBurstToggle {
  // The first entry's key: what the reader's choice to unfold is kept by.
  burstKey: string;
  burstKind: string;
  // How many entries fold under the first one.
  foldedCount: number;
  isExpanded: boolean;
}

export interface FeedTimelineEntry<TItem extends FeedTimelineItem> {
  item: TItem;
  time: FeedTimelineTime;
  // Set on the first entry of a burst: the button that unfolds the rest.
  burstToggle?: FeedTimelineBurstToggle | undefined;
  // True for an entry that unfolded out of a burst.
  isInBurst: boolean;
}

export interface FeedTimelineDay<TItem extends FeedTimelineItem> {
  // "2026-10-13", in the reader's zone.
  dayKey: string;
  // "Tuesday, October 13, 2026".
  label: string;
  // "Today" or "Yesterday", else undefined.
  relativeLabel?: string | undefined;
  // The zone the day's times are in, as at its first entry: "GMT+8".
  zoneName: string;
  entries: Array<FeedTimelineEntry<TItem>>;
}

// Entries of one kind this close to the first of them fold together.
export const FEED_BURST_WINDOW_IN_MINUTES: number = 5;

/*
 * The fewest entries that fold. Two are shown as they are: folding one
 * entry behind a button saves no space and hides it for nothing.
 */
export const FEED_MIN_BURST_SIZE: number = 3;

interface Burst {
  headIndex: number;
  // Exclusive.
  endIndex: number;
}

const isValidDate: (date: Date) => boolean = (date: Date): boolean => {
  return date instanceof Date && !Number.isNaN(date.getTime());
};

/*
 * Where the bursts are: runs of consecutive entries with the same burst
 * kind, on one day, each within FEED_BURST_WINDOW_IN_MINUTES of the run's
 * first entry, at least FEED_MIN_BURST_SIZE long. Keyed by the index of the
 * run's first entry.
 */
export const findFeedBursts: <TItem extends FeedTimelineItem>(
  items: Array<TItem>,
  timezone: string,
) => Map<number, Burst> = <TItem extends FeedTimelineItem>(
  items: Array<TItem>,
  timezone: string,
): Map<number, Burst> => {
  const bursts: Map<number, Burst> = new Map<number, Burst>();
  const windowInMs: number = FEED_BURST_WINDOW_IN_MINUTES * 60 * 1000;

  let index: number = 0;

  while (index < items.length) {
    const head: TItem = items[index]!;
    const kind: string | undefined = head.burstKind;

    if (!kind || !isValidDate(head.itemDateTime)) {
      index += 1;
      continue;
    }

    const headTime: number = head.itemDateTime.getTime();
    const headDay: string = getFeedDayKey(head.itemDateTime, timezone);
    let end: number = index + 1;

    while (end < items.length) {
      const next: TItem = items[end]!;

      if (
        next.burstKind !== kind ||
        !isValidDate(next.itemDateTime) ||
        Math.abs(next.itemDateTime.getTime() - headTime) > windowInMs ||
        getFeedDayKey(next.itemDateTime, timezone) !== headDay
      ) {
        break;
      }

      end += 1;
    }

    if (end - index >= FEED_MIN_BURST_SIZE) {
      bursts.set(index, { headIndex: index, endIndex: end });
      index = end;
    } else {
      index += 1;
    }
  }

  return bursts;
};

/*
 * The timeline as it should be drawn: the visible entries grouped by day,
 * each with its time label and whether to show it, and the bursts folded
 * unless the reader unfolded them (expandedBurstKeys).
 *
 * Which times are shown is worked out over the VISIBLE entries, so the entry
 * after a folded burst shows its time even when it shares it with an entry
 * inside the fold.
 */
export const buildFeedTimeline: <TItem extends FeedTimelineItem>(data: {
  items: Array<TItem>;
  clock: FeedClock;
  expandedBurstKeys?: ReadonlySet<string> | undefined;
}) => Array<FeedTimelineDay<TItem>> = <TItem extends FeedTimelineItem>(data: {
  items: Array<TItem>;
  clock: FeedClock;
  expandedBurstKeys?: ReadonlySet<string> | undefined;
}): Array<FeedTimelineDay<TItem>> => {
  const days: Array<FeedTimelineDay<TItem>> = [];
  const bursts: Map<number, Burst> = findFeedBursts(
    data.items,
    data.clock.timezone,
  );
  const expandedBurstKeys: ReadonlySet<string> =
    data.expandedBurstKeys || new Set<string>();

  let currentDay: FeedTimelineDay<TItem> | null = null;
  let previousShownLabel: string | null = null;
  let previousZoneName: string | null = null;

  const addEntry: (
    item: TItem,
    extra: {
      burstToggle?: FeedTimelineBurstToggle | undefined;
      isInBurst: boolean;
    },
  ) => void = (
    item: TItem,
    extra: {
      burstToggle?: FeedTimelineBurstToggle | undefined;
      isInBurst: boolean;
    },
  ): void => {
    const date: Date = isValidDate(item.itemDateTime)
      ? item.itemDateTime
      : new Date(0);
    const dayKey: string = getFeedDayKey(date, data.clock.timezone);
    const zoneName: string = getFeedZoneName(date, data.clock.timezone);

    if (!currentDay || currentDay.dayKey !== dayKey) {
      currentDay = {
        dayKey: dayKey,
        label: formatFeedDay(date, data.clock),
        relativeLabel: getFeedRelativeDay(date, data.clock),
        zoneName: zoneName,
        entries: [],
      };
      days.push(currentDay);
      previousShownLabel = null;
      previousZoneName = null;
    }

    const label: string = formatFeedTime(date, data.clock);
    const isShown: boolean =
      label !== previousShownLabel || zoneName !== previousZoneName;

    previousShownLabel = label;
    previousZoneName = zoneName;

    currentDay.entries.push({
      item: item,
      time: {
        label: label,
        isShown: isShown,
        zoneName: zoneName !== currentDay.zoneName ? zoneName : undefined,
        relativeHint: getFeedRelativeHint(date, data.clock),
        fullLabel: formatFeedFullTime(date, data.clock),
        isoString: isValidDate(item.itemDateTime)
          ? item.itemDateTime.toISOString()
          : "",
      },
      burstToggle: extra.burstToggle,
      isInBurst: extra.isInBurst,
    });
  };

  let index: number = 0;

  while (index < data.items.length) {
    const item: TItem = data.items[index]!;
    const burst: Burst | undefined = bursts.get(index);

    if (!burst) {
      addEntry(item, { isInBurst: false });
      index += 1;
      continue;
    }

    const isExpanded: boolean = expandedBurstKeys.has(item.key);

    addEntry(item, {
      isInBurst: false,
      burstToggle: {
        burstKey: item.key,
        burstKind: item.burstKind || "",
        foldedCount: burst.endIndex - burst.headIndex - 1,
        isExpanded: isExpanded,
      },
    });

    if (isExpanded) {
      for (
        let inner: number = burst.headIndex + 1;
        inner < burst.endIndex;
        inner++
      ) {
        addEntry(data.items[inner]!, { isInBurst: true });
      }
    }

    index = burst.endIndex;
  }

  return days;
};

/*
 * Whether anything in the feed is from today - while it is, the feed re-reads
 * the clock every minute so "12 min ago" moves on and, at midnight, "Today"
 * becomes "Yesterday". A feed of older entries needs no timer at all.
 */
export const hasFeedEntryFromToday: <TItem extends FeedTimelineItem>(
  items: Array<TItem>,
  clock: FeedClock,
) => boolean = <TItem extends FeedTimelineItem>(
  items: Array<TItem>,
  clock: FeedClock,
): boolean => {
  const todayKey: string = getFeedDayKey(clock.now, clock.timezone);

  return items.some((item: TItem) => {
    return (
      isValidDate(item.itemDateTime) &&
      getFeedDayKey(item.itemDateTime, clock.timezone) === todayKey
    );
  });
};
