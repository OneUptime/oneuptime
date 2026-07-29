import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  DEVICE_SUMMARY_FILTER_URL_PARAM,
  DeviceSummaryFilterKey,
} from "./DeviceSummaryFilter";
import Route from "Common/Types/API/Route";

/*
 * A link to the device list already drilled into one of its summary tiles.
 *
 * This is how a count shown somewhere else in the product reaches the rows
 * behind it: the Sites page's "Unassigned Devices" tile counts devices, and
 * devices are only listed on this page, so activating that tile navigates
 * here rather than filtering the sites table to nothing.
 *
 * Kept out of DeviceSummaryFilter.ts on purpose — RouteMap pulls in the app
 * config, which reads `window` at import time, and the filter/query mapping
 * has to stay importable without a browser.
 */
export function getDeviceListRouteForFilter(
  filterKey: DeviceSummaryFilterKey,
): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_DEVICES] as Route,
  ).addQueryParams({ [DEVICE_SUMMARY_FILTER_URL_PARAM]: filterKey });
}
