import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { ALL_MONITORS_TABLE_ID } from "./MonitorFacets";
import { FacetTileSelection } from "../ResourceOwners/FacetTileSelection";
import Route from "Common/Types/API/Route";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";

/*
 * A link to the monitor list with one of its facet chips already set.
 *
 * This is how "which monitors use this template?" gets answered from the
 * template page: the count on its Linked Monitors card is about monitors, and
 * the monitor list is where monitors are worked with — bulk actions, saved
 * views, every other chip — so the link hands the user over to that list
 * already narrowed, rather than reimplementing it on the settings page.
 *
 * The chip travels in the table's own facet URL namespace — the very parameter
 * the bar writes when a user sets a chip by hand — so the list arrives with the
 * chip visibly set, editable and clearable. There is nothing to keep in sync
 * between "arrived by link" and "clicked the chip".
 *
 * Kept out of MonitorFacets.ts on purpose: RouteMap pulls in the app config,
 * which reads `window` at import time, and the facet vocabulary has to stay
 * importable without a browser.
 */

export type GetMonitorListRouteForFacetFunction = (
  selection: FacetTileSelection,
) => Route;

export const getMonitorListRouteForFacet: GetMonitorListRouteForFacetFunction =
  (selection: FacetTileSelection): Route => {
    const route: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.MONITORS] as Route,
    );

    if (!selection.facetKey) {
      return route;
    }

    /*
     * The same shape useResourceOwners reads back on mount. Only the two fields
     * this link needs are written; parseFacetSelectionState supplies the
     * defaults for the rest, so the link stays short and stays valid as that
     * state grows.
     */
    const facetState: JSONObject = {
      facetSelections: {
        [selection.facetKey]: selection.values,
      } as unknown as JSONObject,
      facetOperators: {
        [selection.facetKey]: selection.operator,
      } as unknown as JSONObject,
    };

    const params: Dictionary<string> = TableFilterUrlState.getLinkQueryParams(
      ALL_MONITORS_TABLE_ID,
      { facets: facetState },
    );

    return route.addQueryParams(params);
  };
