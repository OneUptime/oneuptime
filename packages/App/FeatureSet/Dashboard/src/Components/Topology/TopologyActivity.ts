import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import {
  formatRelativeAmount,
  formatRelativeDate,
  getDateDisplayLanguage,
  isEnglishDateLanguage,
  RelativeDateUnit,
} from "Common/Types/DateLanguage";
import EntitySource from "Common/Types/Telemetry/EntitySource";

/*
 * "Is this resource part of the picture right now?"
 *
 * Inventory keeps a discovered resource for its whole type TTL after it stops
 * reporting — a host for 30 days — because Inventory is a catalog. A topology
 * is a picture of what is running, and drawing every pod a redeploy replaced
 * weeks ago turned a few dozen live pods into hundreds of boxes. So the maps
 * show a discovered resource only when it reported inside the selected time
 * range, and say how many they left out.
 *
 * Only discovered rows have a heartbeat. Manually created and
 * inventory-mirrored rows keep the `lastSeenAt` they were created with, so
 * for them an old timestamp means nothing and they always count as active.
 */

export interface ActivityFields {
  source?: string | undefined;
  lastSeenAt?: Date | undefined;
}

/*
 * The server mirrors this predicate in SQL (see TopologyQueries) so it can
 * pick each resource's active container; change them together.
 */
export function isEntityActive(
  entity: ActivityFields,
  rangeStart: Date,
): boolean {
  if (entity.source && entity.source !== EntitySource.Discovered) {
    return true;
  }
  if (!entity.lastSeenAt) {
    return true;
  }
  const lastSeen: number = new Date(entity.lastSeenAt).getTime();
  if (Number.isNaN(lastSeen)) {
    return true;
  }
  return lastSeen >= rangeStart.getTime();
}

export interface TopologyActivityPartition {
  active: Array<InventoryItem>;
  inactive: Array<InventoryItem>;
}

export function partitionByActivity(
  entities: Array<InventoryItem>,
  rangeStart: Date,
): TopologyActivityPartition {
  const active: Array<InventoryItem> = [];
  const inactive: Array<InventoryItem> = [];
  for (const entity of entities) {
    if (isEntityActive(entity, rangeStart)) {
      active.push(entity);
    } else {
      inactive.push(entity);
    }
  }
  return { active, inactive };
}

/*
 * How long ago a resource last reported, in the buckets "Last seen" reads:
 * under a minute, minutes under an hour, hours under two days, then days.
 * Null when there is no time, or it is not one.
 */
interface LastSeenAge {
  unit: RelativeDateUnit;
  // 0 for "just now".
  count: number;
}

function getLastSeenAge(
  lastSeenAt: Date | undefined,
  now: Date,
): LastSeenAge | null {
  if (!lastSeenAt) {
    return null;
  }
  const seconds: number = Math.max(
    0,
    Math.round((now.getTime() - new Date(lastSeenAt).getTime()) / 1000),
  );
  if (Number.isNaN(seconds)) {
    return null;
  }
  if (seconds < 60) {
    return { unit: "second", count: 0 };
  }
  const minutes: number = Math.round(seconds / 60);
  if (minutes < 60) {
    return { unit: "minute", count: minutes };
  }
  const hours: number = Math.round(minutes / 60);
  if (hours < 48) {
    return { unit: "hour", count: hours };
  }
  return { unit: "day", count: Math.round(hours / 24) };
}

/*
 * Whether there is a time to tell how long ago a resource last reported:
 * a manual or inventory row may have none, and Last seen then says only
 * whether it is active.
 */
export function isLastSeenKnown(
  lastSeenAt: Date | undefined,
  now: Date = new Date(),
): boolean {
  return getLastSeenAge(lastSeenAt, now) !== null;
}

/** "just now", "12 min ago", "5 h ago", "3 days ago". */
export function formatLastSeen(
  lastSeenAt: Date | undefined,
  now: Date = new Date(),
): string {
  const age: LastSeenAge | null = getLastSeenAge(lastSeenAt, now);
  if (!age) {
    return "—";
  }
  if (age.count === 0) {
    return "just now";
  }
  if (age.unit === "minute") {
    return `${age.count} min ago`;
  }
  if (age.unit === "hour") {
    return `${age.count} h ago`;
  }
  return `${age.count} days ago`;
}

/*
 * The same, in the reader's language - "vor 12 Minuten", "قبل 3 أيام",
 * "jetzt" - counted in the same buckets. English reads exactly as
 * formatLastSeen does; a browser with no Intl.RelativeTimeFormat falls back
 * to it too.
 */
export function formatLastSeenInLanguage(
  lastSeenAt: Date | undefined,
  now: Date = new Date(),
  language: string = getDateDisplayLanguage(),
): string {
  const english: string = formatLastSeen(lastSeenAt, now);
  const age: LastSeenAge | null = getLastSeenAge(lastSeenAt, now);

  if (!age || isEnglishDateLanguage(language)) {
    return english;
  }

  const worded: string | null =
    age.count === 0
      ? formatRelativeDate({ date: now, now: now, locale: language })
      : formatRelativeAmount({
          count: age.count,
          unit: age.unit,
          isFuture: false,
          locale: language,
        });

  return worded || english;
}
