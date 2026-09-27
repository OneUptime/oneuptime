import EntitySource from "Common/Types/Telemetry/EntitySource";
import { InventoryScope } from "./InventoryScope";

/*
 * The strip of numbers at the top of the Inventory Overview.
 *
 * Every tile is a drill-down: its `scope` is exactly the narrowing that
 * produces the rows it counted, so the number on the tile and the list you
 * land on after clicking it can never describe different things. A tile
 * whose scope did not match its count would be the quiet kind of wrong,
 * where everything renders and the numbers just lie.
 *
 * The counts themselves are made in Postgres over the whole estate (see
 * InventoryItemService.getOverviewCounts), with the same filters the Items
 * list applies for each scope — the Stale one included, since the count and
 * the status facet share getInventoryLivenessSql. InventoryOverviewPostgres
 * checks every tile's count against the rows its drill-down lists.
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
