import {
  AggregateColumn,
  AggregateRow,
} from "../../Types/Database/AggregateBy";
import AggregateResultUtil from "../../Types/Database/AggregateResultUtil";
import Dictionary from "../../../Types/Dictionary";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import {
  InventoryLiveness,
  getInventoryLivenessSql,
} from "../../../Types/Telemetry/InventoryLiveness";

/*
 * The Inventory Overview's numbers: the five summary tiles and the per-type
 * breakdown.
 *
 * These used to be folded in the browser from one list read capped at
 * LIMIT_PER_PROJECT, so a project past ten thousand items saw tiles and a
 * breakdown describing whichever ten thousand had been seen most recently,
 * with nothing on the page saying so. They are counted in Postgres instead,
 * in ONE grouped statement: the tiles are sums over the same per-type groups
 * the breakdown lists, so the two are views of one snapshot and cannot
 * disagree.
 *
 * Every tile drills into the Items list, and each filter below is the exact
 * narrowing that tile's list applies — the source facet, or the source facet
 * plus the Stale status facet, whose SQL is the same getInventoryLivenessSql
 * the `inventoryStatus` virtual column is built from.
 *
 * Kept apart from InventoryItemService so the dashboard's tile tests and the
 * Postgres test can use the same columns without loading the service.
 */
export const INVENTORY_OVERVIEW_GROUP_BY: Array<AggregateColumn> = [
  { expression: `"InventoryItem"."entityType"`, alias: "entityType" },
];

export const INVENTORY_OVERVIEW_SELECT: Array<AggregateColumn> = [
  { expression: `COUNT(*)`, alias: "itemCount" },
  {
    expression: `COUNT(*) FILTER (WHERE "InventoryItem"."source" = '${EntitySource.Discovered}')`,
    alias: "discoveredCount",
  },
  {
    expression: `COUNT(*) FILTER (WHERE "InventoryItem"."source" = '${EntitySource.Inventory}')`,
    alias: "mirroredCount",
  },
  {
    expression: `COUNT(*) FILTER (WHERE "InventoryItem"."source" = '${EntitySource.Manual}')`,
    alias: "manualCount",
  },
  {
    // Only discovered rows can be stale; the shared rule says NotTracked for the rest.
    expression: `COUNT(*) FILTER (WHERE (${getInventoryLivenessSql(`"InventoryItem"`)}) = '${InventoryLiveness.Stale}')`,
    alias: "staleCount",
  },
];

export interface InventoryOverviewCounts {
  total: number;
  discovered: number;
  mirrored: number;
  manual: number;
  stale: number;
  // Items per entity type, for the category breakdown. Types that counted zero are absent.
  countsByType: Dictionary<number>;
}

/**
 * Sum the per-type groups into the tile counts, and key the groups by type
 * for the breakdown.
 *
 * `total` counts every row, including rows whose source this build does not
 * recognise — they land in none of the three source buckets, which is why
 * those are not expected to sum to the total. A group with no type still
 * counts towards every tile; it is only left out of the breakdown, which has
 * no row to put it in.
 */
export function readInventoryOverviewGroups(
  rows: Array<AggregateRow>,
): InventoryOverviewCounts {
  const counts: InventoryOverviewCounts = {
    total: 0,
    discovered: 0,
    mirrored: 0,
    manual: 0,
    stale: 0,
    countsByType: {},
  };

  for (const row of rows) {
    const itemCount: number = AggregateResultUtil.toNumber(row, "itemCount");

    counts.total += itemCount;
    counts.discovered += AggregateResultUtil.toNumber(row, "discoveredCount");
    counts.mirrored += AggregateResultUtil.toNumber(row, "mirroredCount");
    counts.manual += AggregateResultUtil.toNumber(row, "manualCount");
    counts.stale += AggregateResultUtil.toNumber(row, "staleCount");

    const entityType: string | null = AggregateResultUtil.toStringOrNull(
      row,
      "entityType",
    );

    if (entityType && itemCount > 0) {
      counts.countsByType[entityType] =
        (counts.countsByType[entityType] || 0) + itemCount;
    }
  }

  return counts;
}
