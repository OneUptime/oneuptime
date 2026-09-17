import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { NETWORK_DEVICES_TABLE_ID } from "./DeviceFacets";
import { FacetTileSelection } from "../ResourceOwners/FacetTileSelection";
import Route from "Common/Types/API/Route";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";

/*
 * A link to the device list with one of its facet chips already set.
 *
 * This is how a count shown somewhere else in the product reaches the rows
 * behind it: the Sites page's "Unassigned Devices" tile counts devices, and
 * devices are only listed on this page, so activating that tile navigates here
 * rather than filtering the sites table to nothing.
 *
 * The link carries the chip in the table's own facet URL namespace — the very
 * parameter the bar writes when a user sets a chip by hand — so the list arrives
 * with the chip visibly set, editable and clearable. There is nothing to keep in
 * sync between "arrived by link" and "clicked the chip".
 *
 * Kept out of DeviceFacets.ts on purpose: RouteMap pulls in the app config, which
 * reads `window` at import time, and the facet vocabulary has to stay importable
 * without a browser.
 */

export type GetDeviceListRouteForFacetFunction = (
  selection: FacetTileSelection,
) => Route;

export const getDeviceListRouteForFacet: GetDeviceListRouteForFacetFunction = (
  selection: FacetTileSelection,
): Route => {
  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_DEVICES] as Route,
  );

  if (!selection.facetKey) {
    return route;
  }

  /*
   * The same shape useResourceOwners reads back on mount. Only the two fields
   * this link needs are written; parseFacetSelectionState supplies the defaults
   * for the rest, so the link stays short and stays valid as that state grows.
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
    NETWORK_DEVICES_TABLE_ID,
    { facets: facetState },
  );

  return route.addQueryParams(params);
};
