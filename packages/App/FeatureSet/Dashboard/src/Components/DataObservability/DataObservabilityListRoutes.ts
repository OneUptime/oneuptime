import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { FilterOperator } from "../ResourceOwners/FilterChipDropdownTypes";
import { ResourceFacet } from "../ResourceOwners/ResourceFacet";
import Route from "Common/Types/API/Route";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import LessThanOrEqual from "Common/Types/BaseDatabase/LessThanOrEqual";
import { DataCheckHealth } from "Common/Types/DataObservability/DataObservabilityAttention";
import Dictionary from "Common/Types/Dictionary";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";

/*
 * THE LISTS A COUNT OPENS, ALREADY FILTERED (#6550, #6554).
 *
 * The Overview's Late Tables and Failing Checks, and a database's own Late
 * Tables, each count rows of a list: each opens that list showing exactly
 * them, the filter visibly set, editable and clearable, in the list's own
 * URL namespace (TableFilterUrlState) - the chip or filter its own controls
 * write. Kept free of React, so the addresses and the queries they make can
 * be pinned in plain tests.
 */

// The lists' URL namespaces: each list's persistKey or userPreferencesKey.
export const TABLES_LIST_ID: string = "data-observability-tables";
export const STORE_TABLES_LIST_ID: string = "data-observability-store-tables";
export const CHECKS_LIST_ID: string = "data-observability-checks";

// The Freshness chip on Tables: whether a table is late now, by when it is late (DataAsset.lateAt).
export const FRESHNESS_FACET_KEY: string = "freshness";

export enum TableFreshnessFilter {
  Late = "late",
  Fresh = "fresh",
}

/*
 * "Now" to the minute: a list's query is compared by value on every draw,
 * and one that held the millisecond would ask the server again at each.
 */
export function getFreshnessNow(now: Date = new Date()): Date {
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000);
}

/*
 * What the Freshness chip asks of a table's lateAt: late once it has
 * passed, fresh while it is still to come. A view, and a table whose rhythm
 * is not known yet, have none, so they are neither.
 */
export function getFreshnessQueryValue(
  values: Array<string>,
  operator: FilterOperator,
  now: Date,
): unknown {
  if (operator !== "is" || values.length !== 1) {
    return undefined;
  }

  if (values[0] === TableFreshnessFilter.Late) {
    return new LessThanOrEqual<Date>(now);
  }

  if (values[0] === TableFreshnessFilter.Fresh) {
    return new GreaterThan<Date>(now);
  }

  return undefined;
}

// The chip itself, for Tables and a database's Tables tab.
export function getTableFreshnessFacet(
  getNow: () => Date = (): Date => {
    return getFreshnessNow();
  },
): ResourceFacet {
  return {
    key: FRESHNESS_FACET_KEY,
    label: "Freshness",
    icon: IconProp.Clock,
    queryField: "lateAt",
    options: [
      { value: TableFreshnessFilter.Late, label: "Late" },
      { value: TableFreshnessFilter.Fresh, label: "Fresh" },
    ],
    supportedOperators: ["is"],
    toQueryValue: (values: Array<string>, operator: FilterOperator) => {
      return getFreshnessQueryValue(values, operator, getNow());
    },
  };
}

// The late tables: of the project, or of one database on its own Tables tab.
export function getLateTablesRoute(dataStoreId?: ObjectID | string): Route {
  const route: Route = dataStoreId
    ? RouteUtil.populateRouteParams(
        RouteMap[PageMap.DATA_OBSERVABILITY_STORE_VIEW_TABLES] as Route,
        { modelId: new ObjectID(dataStoreId.toString()) },
      )
    : RouteUtil.populateRouteParams(
        RouteMap[PageMap.DATA_OBSERVABILITY_TABLES] as Route,
      );
  const facets: JSONObject = {
    facetSelections: {
      [FRESHNESS_FACET_KEY]: [TableFreshnessFilter.Late],
    },
    facetOperators: { [FRESHNESS_FACET_KEY]: "is" },
  };
  const params: Dictionary<string> = TableFilterUrlState.getLinkQueryParams(
    dataStoreId ? STORE_TABLES_LIST_ID : TABLES_LIST_ID,
    { facets },
  );

  return route.addQueryParams(params);
}

// The checks of a health - Failing for the Overview's Failing Checks.
export function getChecksOfHealthRoute(
  health: DataCheckHealth = DataCheckHealth.Failing,
): Route {
  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.DATA_OBSERVABILITY_CHECKS] as Route,
  );
  const params: Dictionary<string> = TableFilterUrlState.getLinkQueryParams(
    CHECKS_LIST_ID,
    { filter: { health } },
  );

  return route.addQueryParams(params);
}
