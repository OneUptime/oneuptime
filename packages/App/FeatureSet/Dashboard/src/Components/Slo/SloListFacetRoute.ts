import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { FacetTileSelection } from "../ResourceOwners/FacetTileSelection";
import {
  getSlosAtRiskSelections,
  SLOS_TABLE_ID,
} from "./SloStatusSummaryTiles";
import Route from "Common/Types/API/Route";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";

/*
 * A link to the SLO list with some of its chips already set.
 *
 * Home counts the SLOs at risk, and SLOs are worked with on the SLO list -
 * its status tiles, bulk actions, every other chip - so its number and its
 * View all hand the user over to that list narrowed to the SLOs it counted,
 * rather than to every SLO, where the two that need someone are mixed in with
 * the healthy ones.
 *
 * The chips travel in the table's own facet URL namespace - the very
 * parameter the bar writes when a user sets a chip by hand - so the list
 * arrives with them visibly set, editable and clearable, as a summary tile
 * would have set them.
 *
 * Kept out of SloStatusSummaryTiles.ts on purpose: RouteMap and
 * TableFilterUrlState read `window` at import time, and the status vocabulary
 * has to stay importable without a browser.
 */

export type GetSloListQueryParamsFunction = (
  selections: Array<FacetTileSelection>,
) => Dictionary<string>;

export const getSloListQueryParams: GetSloListQueryParamsFunction = (
  selections: Array<FacetTileSelection>,
): Dictionary<string> => {
  const facetSelections: Dictionary<Array<string>> = {};
  const facetOperators: Dictionary<string> = {};

  for (const selection of selections) {
    if (!selection.facetKey) {
      continue;
    }

    facetSelections[selection.facetKey] = [...selection.values];
    facetOperators[selection.facetKey] = selection.operator;
  }

  if (Object.keys(facetSelections).length === 0) {
    return {};
  }

  /*
   * The same shape useResourceOwners reads back on mount. Only the two
   * fields a chip needs are written; parseFacetSelectionState supplies the
   * defaults for the rest, so the link stays short and stays valid as that
   * state grows.
   */
  const facetState: JSONObject = {
    facetSelections: facetSelections as unknown as JSONObject,
    facetOperators: facetOperators as unknown as JSONObject,
  };

  return TableFilterUrlState.getLinkQueryParams(SLOS_TABLE_ID, {
    facets: facetState,
  });
};

// The SLO list's own query parameters that show only the SLOs at risk.
export type GetSlosAtRiskQueryParamsFunction = () => Dictionary<string>;

export const getSlosAtRiskQueryParams: GetSlosAtRiskQueryParamsFunction =
  (): Dictionary<string> => {
    return getSloListQueryParams(getSlosAtRiskSelections());
  };

// The SLO list of the current project, showing only the SLOs at risk.
export type GetSlosAtRiskListRouteFunction = () => Route;

export const getSlosAtRiskListRoute: GetSlosAtRiskListRouteFunction =
  (): Route => {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.SLOS] as Route,
    ).addQueryParams(getSlosAtRiskQueryParams());
  };
