import AIInsight from "Common/Models/DatabaseModels/AIInsight";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import Sort from "Common/Types/BaseDatabase/Sort";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * How the insights inbox can be ordered and narrowed in time, kept apart from
 * the page so the rules are testable without rendering it.
 *
 * Every live insight a scan re-detects is stamped with that scan's single
 * lastSeenAt, so in a busy project hundreds of rows share "last seen 12
 * minutes ago" and the default order says little about which findings are
 * new or which keep coming back. First-seen and detection-count orders answer
 * exactly those two questions.
 */

export enum InsightSortValue {
  LastSeenNewest = "lastSeen",
  LastSeenOldest = "lastSeenOldest",
  FirstSeenNewest = "firstSeen",
  MostDetections = "detections",
}

export const DEFAULT_INSIGHT_SORT: InsightSortValue =
  InsightSortValue.LastSeenNewest;

export interface InsightSortOption {
  // English, translated when drawn.
  label: string;
  value: InsightSortValue;
}

export const INSIGHT_SORT_OPTIONS: Array<InsightSortOption> = [
  {
    label: translationKey("Last seen: newest first"),
    value: InsightSortValue.LastSeenNewest,
  },
  {
    label: translationKey("Last seen: oldest first"),
    value: InsightSortValue.LastSeenOldest,
  },
  {
    label: translationKey("First seen: newest first"),
    value: InsightSortValue.FirstSeenNewest,
  },
  {
    label: translationKey("Most detections"),
    value: InsightSortValue.MostDetections,
  },
];

// A sort value from the URL, or the default when it is not one of ours.
export function parseInsightSort(
  value: string | null | undefined,
): InsightSortValue {
  return Object.values(InsightSortValue).includes(value as InsightSortValue)
    ? (value as InsightSortValue)
    : DEFAULT_INSIGHT_SORT;
}

/**
 * The list request's sort for one option. Always ends on the id: offset
 * pagination over a column tied across a page (one lastSeenAt per scan, the
 * same detection count on many rows) lets Postgres return the tied rows in a
 * different order per request, which silently skips rows between pages.
 */
export function getInsightSort(value: InsightSortValue): Sort<AIInsight> {
  switch (value) {
    case InsightSortValue.LastSeenOldest:
      return {
        lastSeenAt: SortOrder.Ascending,
        _id: SortOrder.Ascending,
      };
    case InsightSortValue.FirstSeenNewest:
      return {
        firstSeenAt: SortOrder.Descending,
        _id: SortOrder.Descending,
      };
    case InsightSortValue.MostDetections:
      return {
        occurrenceCount: SortOrder.Descending,
        lastSeenAt: SortOrder.Descending,
        _id: SortOrder.Descending,
      };
    case InsightSortValue.LastSeenNewest:
    default:
      return {
        lastSeenAt: SortOrder.Descending,
        _id: SortOrder.Descending,
      };
  }
}

export enum InsightSeenWithinValue {
  AnyTime = "All",
  LastHour = "1h",
  LastDay = "24h",
  LastWeek = "7d",
  LastMonth = "30d",
}

export interface InsightSeenWithinOption {
  // English, translated when drawn.
  label: string;
  value: InsightSeenWithinValue;
  // Undefined for "any time".
  minutes?: number | undefined;
}

export const INSIGHT_SEEN_WITHIN_OPTIONS: Array<InsightSeenWithinOption> = [
  {
    label: translationKey("Seen any time"),
    value: InsightSeenWithinValue.AnyTime,
  },
  {
    label: translationKey("Seen in the last hour"),
    value: InsightSeenWithinValue.LastHour,
    minutes: 60,
  },
  {
    label: translationKey("Seen in the last 24 hours"),
    value: InsightSeenWithinValue.LastDay,
    minutes: 24 * 60,
  },
  {
    label: translationKey("Seen in the last 7 days"),
    value: InsightSeenWithinValue.LastWeek,
    minutes: 7 * 24 * 60,
  },
  {
    label: translationKey("Seen in the last 30 days"),
    value: InsightSeenWithinValue.LastMonth,
    minutes: 30 * 24 * 60,
  },
];

// A time-range value from the URL, or "any time" when it is not one of ours.
export function parseInsightSeenWithin(
  value: string | null | undefined,
): InsightSeenWithinValue {
  return Object.values(InsightSeenWithinValue).includes(
    value as InsightSeenWithinValue,
  )
    ? (value as InsightSeenWithinValue)
    : InsightSeenWithinValue.AnyTime;
}

/**
 * The lastSeenAt filter for a time range — insights a scan has detected
 * within it — or null for "any time". Computed per request from `now`, so a
 * range picked an hour ago still means "the last 24 hours" on Load More.
 */
export function getInsightSeenWithinFilter(
  value: InsightSeenWithinValue,
  now: Date,
): GreaterThanOrEqual<Date> | null {
  const option: InsightSeenWithinOption | undefined =
    INSIGHT_SEEN_WITHIN_OPTIONS.find((candidate: InsightSeenWithinOption) => {
      return candidate.value === value;
    });

  if (!option?.minutes) {
    return null;
  }

  return new GreaterThanOrEqual<Date>(
    OneUptimeDate.addRemoveMinutes(now, -1 * option.minutes),
  );
}
