import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import {
  AddDevicePrefill,
  NETWORK_QUICK_ACTION_ADDRESS_PARAM,
  NETWORK_QUICK_ACTION_PROBE_PARAM,
  NETWORK_QUICK_ACTION_QUERY_PARAM,
  NetworkQuickAction,
  isNetworkQuickActionInSearch,
  readAddDevicePrefill,
} from "./NetworkQuickActionQuery";

export {
  NETWORK_QUICK_ACTION_QUERY_PARAM,
  NetworkQuickAction,
} from "./NetworkQuickActionQuery";
export type { AddDevicePrefill } from "./NetworkQuickActionQuery";

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
export function getNetworkQuickActionRoute(
  action: NetworkQuickAction,
  prefill?: AddDevicePrefill | undefined,
): Route {
  const params: { [key: string]: string } = {
    [NETWORK_QUICK_ACTION_QUERY_PARAM]: action,
  };

  if (action === NetworkQuickAction.AddDevice && prefill?.address) {
    params[NETWORK_QUICK_ACTION_ADDRESS_PARAM] = prefill.address;
  }

  if (action === NetworkQuickAction.AddDevice && prefill?.probeId) {
    params[NETWORK_QUICK_ACTION_PROBE_PARAM] = prefill.probeId;
  }

  return RouteUtil.populateRouteParams(
    RouteMap[ACTION_PAGES[action]] as Route,
  ).addQueryParams(params);
}

/**
 * What the Add Device link this page was opened by fills in (the address
 * and probe of an exporter that is not a device yet). Read once, at mount.
 */
export function getRequestedAddDevicePrefill(): AddDevicePrefill {
  return readAddDevicePrefill(Navigation.getQueryString());
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
  Navigation.setQueryString({
    [NETWORK_QUICK_ACTION_QUERY_PARAM]: null,
    [NETWORK_QUICK_ACTION_ADDRESS_PARAM]: null,
    [NETWORK_QUICK_ACTION_PROBE_PARAM]: null,
  });
}
