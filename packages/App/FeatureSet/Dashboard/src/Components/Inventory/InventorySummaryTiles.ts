import EntitySource from "Common/Types/Telemetry/EntitySource";
import { InventoryScope } from "./InventoryScope";
import {
  InventoryLiveness,
  getInventoryLiveness,
  isStaleLiveness,
} from "./InventoryLiveness";

/*
 * The strip of numbers at the top of the Inventory Overview, and the fold
 * that produces them.
 *
 * Every tile is a drill-down: its `scope` is exactly the narrowing that
 * produces the rows it counted, so the number on the tile and the list you
 * land on after clicking it can never describe different things. The tests
 * walk each tile's scope back through the same fold to prove that — a tile
 * whose scope did not match its count would be the quiet kind of wrong, where
 * everything renders and the numbers just lie.
 *
 * The fold is a client-side pass over the project's rows rather than five
 * server-side counts. That is a deliberate trade: staleness is derived from
 * `lastSeenAt` against a source-dependent rule (see InventoryLiveness), which
 * is not something the count endpoint can express, and doing it in two places
 * is how the tile and the badge drift apart. The list this reads is already
 * bounded by LIMIT_PER_PROJECT at the call site.
 */

export interface InventorySummaryCounts {
  total: number;
  discovered: number;
  mirrored: number;
  manual: number;
  stale: number;
}

export const EMPTY_INVENTORY_SUMMARY_COUNTS: InventorySummaryCounts = {
  total: 0,
  discovered: 0,
  mirrored: 0,
  manual: 0,
  stale: 0,
};

export interface InventorySummaryRow {
  source?: string | undefined;
  lastSeenAt?: Date | string | undefined | null;
}

export type SummarizeInventoryFunction = (
  rows: Array<InventorySummaryRow>,
  now: Date,
) => InventorySummaryCounts;

/**
 * Fold the project's rows into the five numbers the strip shows.
 *
 * `total` counts every row, including ones whose source this build does not
 * recognise — the total has to be the whole estate, or the tile understates
 * what the user owns. Such rows simply land in none of the three source
 * buckets, which is why the buckets are not asserted to sum to the total.
 */
export const summarizeInventory: SummarizeInventoryFunction = (
  rows: Array<InventorySummaryRow>,
  now: Date,
): InventorySummaryCounts => {
  const counts: InventorySummaryCounts = { ...EMPTY_INVENTORY_SUMMARY_COUNTS };

  for (const row of rows) {
    counts.total++;

    if (row.source === EntitySource.Discovered) {
      counts.discovered++;
    } else if (row.source === EntitySource.Inventory) {
      counts.mirrored++;
    } else if (row.source === EntitySource.Manual) {
      counts.manual++;
    }

    /*
     * Staleness is asked of the liveness rule, not of `lastSeenAt` directly,
     * so rows nothing bumps (mirrored, manual) can never be counted stale.
     */
    const liveness: InventoryLiveness = getInventoryLiveness({
      source: row.source,
      lastSeenAt: row.lastSeenAt,
      now,
    }).liveness;

    if (isStaleLiveness(liveness)) {
      counts.stale++;
    }
  }

  return counts;
};

export interface InventorySummaryTile {
  /** React key and the `data-testid` suffix. */
  key: string;
  label: string;
  countField: keyof InventorySummaryCounts;
  caption: string;
  /** Colour for a non-zero count. Zero always renders neutral. */
  attentionClassName: string;
  /** The narrowing that produces the rows this tile counted. */
  scope: InventoryScope;
}

export const INVENTORY_SUMMARY_TILES: Array<InventorySummaryTile> = [
  {
    key: "total",
    label: "Total Items",
    countField: "total",
    caption: "Everything OneUptime knows about your estate.",
    attentionClassName: "text-gray-900",
    scope: {},
  },
  {
    key: "discovered",
    label: "Discovered",
    countField: "discovered",
    caption: "Found automatically in your telemetry.",
    attentionClassName: "text-indigo-600",
    scope: { source: EntitySource.Discovered },
  },
  {
    key: "mirrored",
    label: "Mirrored",
    countField: "mirrored",
    caption: "Copied from elsewhere in OneUptime.",
    attentionClassName: "text-emerald-600",
    scope: { source: EntitySource.Inventory },
  },
  {
    key: "manual",
    label: "Added by You",
    countField: "manual",
    caption: "Registered by hand for things we cannot see.",
    attentionClassName: "text-amber-600",
    scope: { source: EntitySource.Manual },
  },
  {
    key: "stale",
    label: "Gone Quiet",
    countField: "stale",
    caption: "No telemetry for over a day.",
    attentionClassName: "text-red-600",
    scope: { source: EntitySource.Discovered, staleOnly: true },
  },
];

export type GetInventoryTileCountFunction = (
  tile: InventorySummaryTile,
  counts: InventorySummaryCounts | null,
) => number;

export const getInventoryTileCount: GetInventoryTileCountFunction = (
  tile: InventorySummaryTile,
  counts: InventorySummaryCounts | null,
): number => {
  return counts ? counts[tile.countField] : 0;
};

export type RowMatchesScopeFunction = (
  row: InventorySummaryRow,
  scope: InventoryScope,
  now: Date,
) => boolean;

/**
 * Whether a row is one of the ones a scope selects.
 *
 * The Items page does this narrowing server-side (it is a model query), so
 * this is not on the render path. It exists so the tests can check that each
 * tile's scope selects exactly the rows its count counted, using one shared
 * definition of what a scope means rather than a second copy written into the
 * test.
 */
export const rowMatchesScope: RowMatchesScopeFunction = (
  row: InventorySummaryRow,
  scope: InventoryScope,
  now: Date,
): boolean => {
  if (scope.source && row.source !== scope.source) {
    return false;
  }

  if (scope.staleOnly) {
    const liveness: InventoryLiveness = getInventoryLiveness({
      source: row.source,
      lastSeenAt: row.lastSeenAt,
      now,
    }).liveness;

    if (!isStaleLiveness(liveness)) {
      return false;
    }
  }

  return true;
};
