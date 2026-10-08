import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import {
  NETWORK_QUICK_ACTION_QUERY_PARAM,
  NetworkQuickAction,
  isNetworkQuickActionInSearch,
} from "./NetworkQuickActionQuery";

export {
  NETWORK_QUICK_ACTION_QUERY_PARAM,
  NetworkQuickAction,
} from "./NetworkQuickActionQuery";

/*
 * The two ways a device gets into Network - add one by its address, or scan
 * a range and pick what answers - are one click from anywhere that offers
 * them: the Overview's header and its first-run choices, the Devices list's
 * empty state. A link that only took people to a list, where they then had
 * to find the right button, was a step that taught them nothing.
 *
 * The link carries the action in the address (?open=add-device), the page it
 * lands on opens its form, and then takes the action back out of the address
 * so a refresh, a bookmark or the back button does not open it again.
 */

// The page each action's form lives on.
const ACTION_PAGES: Record<NetworkQuickAction, PageMap> = {
  [NetworkQuickAction.AddDevice]: PageMap.NETWORK_DEVICES,
  [NetworkQuickAction.DiscoverDevices]: PageMap.NETWORK_DEVICE_DISCOVERY,
};

/**
 * Where to send someone to do `action`: the page its form is on, with the
 * action in the query string.
 */
export function getNetworkQuickActionRoute(action: NetworkQuickAction): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[ACTION_PAGES[action]] as Route,
  ).addQueryParams({ [NETWORK_QUICK_ACTION_QUERY_PARAM]: action });
}

/**
 * Whether the page was opened to do `action`. Read once, when the page
 * mounts: the form it opens is the page's own from then on.
 */
export function isNetworkQuickActionRequested(
  action: NetworkQuickAction,
): boolean {
  return isNetworkQuickActionInSearch(action, Navigation.getQueryString());
}

/**
 * Takes the action back out of the address, in place, once the form it
 * asked for is open - so a refresh does not open it a second time.
 */
export function clearNetworkQuickAction(): void {
  Navigation.setQueryString({ [NETWORK_QUICK_ACTION_QUERY_PARAM]: null });
}
