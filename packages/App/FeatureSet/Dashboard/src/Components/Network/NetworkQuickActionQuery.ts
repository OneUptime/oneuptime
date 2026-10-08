/*
 * The query string half of the Network quick actions (NetworkQuickActions),
 * kept free of the routes and of the browser so it can be read and tested on
 * its own: which actions there are, the parameter that carries one, and
 * whether a query string asks for one.
 */

// "?open=add-device": the parameter a quick-action link carries.
export const NETWORK_QUICK_ACTION_QUERY_PARAM: string = "open";

export enum NetworkQuickAction {
  // The Devices list opens its Add Device form.
  AddDevice = "add-device",
  // The Discovery page opens its new-scan form.
  DiscoverDevices = "discover-devices",
}

/**
 * Whether `search` (a query string, with or without its "?") asks for
 * `action`. Only the exact value counts: an empty, unknown or differently
 * cased value opens nothing, so a stale or hand-edited link can never open
 * a form nobody asked for.
 */
export function isNetworkQuickActionInSearch(
  action: NetworkQuickAction,
  search: string | null | undefined,
): boolean {
  if (!search) {
    return false;
  }

  const params: URLSearchParams = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );

  return params.get(NETWORK_QUICK_ACTION_QUERY_PARAM) === action;
}
