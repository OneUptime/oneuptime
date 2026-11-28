import {
  AggregateColumn,
  AggregateOrder,
  AggregateRow,
} from "../../Types/Database/AggregateBy";
import AggregateResultUtil from "../../Types/Database/AggregateResultUtil";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  InventoryPlacementLevel,
  getInventoryPlacementSql,
} from "../../../Utils/Inventory/InventoryItemPlacement";

/*
 * WHAT THE CLUSTER, HOST AND DATACENTER CHIPS OFFER (#11470).
 *
 * Inventory's All Items list filters by where an item sits. Each chip
 * offers the places of its level the project's items are in - every
 * cluster, every host, every datacenter - with how many items are in each,
 * counted by Postgres over the whole list (archived or not, as the list
 * is), never over the rows a page loaded. A place is the same value the
 * filter matches, InventoryItem's placementCluster, placementHost or
 * placementDatacenter (getInventoryPlacementSql), so a choice holds exactly
 * the items its count says.
 *
 * In name order, a page at a time: what is typed in the chip's search
 * narrows them on the server, so a project with thousands of hosts finds
 * any of them.
 *
 * Kept apart from InventoryItemService so the Postgres test runs the same
 * columns without loading the service.
 */

export const INVENTORY_PLACEMENT_OPTIONS_DEFAULT_LIMIT: number = 50;
export const INVENTORY_PLACEMENT_OPTIONS_MAX_LIMIT: number = 100;
// Longer than any name a producer sends; a search past it finds nothing new.
export const INVENTORY_PLACEMENT_SEARCH_MAX_LENGTH: number = 200;

export const INVENTORY_PLACEMENT_OPTION_VALUE_ALIAS: string = "place";
export const INVENTORY_PLACEMENT_OPTION_COUNT_ALIAS: string = "itemCount";

export interface InventoryPlacementOption {
  // The place's name, as the list shows it and the filter matches it.
  value: string;
  // How many of the list's items are there.
  count: number;
}

export function getInventoryPlacementOptionsGroupBy(
  level: InventoryPlacementLevel,
): Array<AggregateColumn> {
  return [
    {
      expression: getInventoryPlacementSql(`"InventoryItem"`, level),
      alias: INVENTORY_PLACEMENT_OPTION_VALUE_ALIAS,
    },
  ];
}

export const INVENTORY_PLACEMENT_OPTIONS_SELECT: Array<AggregateColumn> = [
  { expression: `COUNT(*)`, alias: INVENTORY_PLACEMENT_OPTION_COUNT_ALIAS },
];

export const INVENTORY_PLACEMENT_OPTIONS_ORDER: Array<AggregateOrder> = [
  {
    expression: `"${INVENTORY_PLACEMENT_OPTION_VALUE_ALIAS}"`,
    sortOrder: SortOrder.Ascending,
  },
];

// A page size the server keeps: whole, at least 1, at most the maximum.
export function getInventoryPlacementOptionsLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return INVENTORY_PLACEMENT_OPTIONS_DEFAULT_LIMIT;
  }
  return Math.min(
    INVENTORY_PLACEMENT_OPTIONS_MAX_LIMIT,
    Math.max(1, Math.floor(value)),
  );
}

// What was typed in the chip's search, trimmed, or "" for none.
export function getInventoryPlacementSearch(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().substring(0, INVENTORY_PLACEMENT_SEARCH_MAX_LENGTH);
}

export function readInventoryPlacementOptions(
  rows: Array<AggregateRow>,
): Array<InventoryPlacementOption> {
  const options: Array<InventoryPlacementOption> = [];
  for (const row of rows) {
    const value: string | null = AggregateResultUtil.toStringOrNull(
      row,
      INVENTORY_PLACEMENT_OPTION_VALUE_ALIAS,
    );
    if (!value) {
      continue;
    }
    options.push({
      value: value,
      count: AggregateResultUtil.toNumber(
        row,
        INVENTORY_PLACEMENT_OPTION_COUNT_ALIAS,
      ),
    });
  }
  return options;
}
