import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
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

/** "just now", "12 min ago", "5 h ago", "3 days ago". */
export function formatLastSeen(
  lastSeenAt: Date | undefined,
  now: Date = new Date(),
): string {
  if (!lastSeenAt) {
    return "—";
  }
  const seconds: number = Math.max(
    0,
    Math.round((now.getTime() - new Date(lastSeenAt).getTime()) / 1000),
  );
  if (Number.isNaN(seconds)) {
    return "—";
  }
  if (seconds < 60) {
    return "just now";
  }
  const minutes: number = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours: number = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours} h ago`;
  }
  const days: number = Math.round(hours / 24);
  return `${days} days ago`;
}
