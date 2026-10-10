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

/*
 * "&address=10.9.9.9&probe=<id>": what an Add Device link can fill in - the
 * Traffic page's "Add as device" for an address that is sending flows.
 */
export const NETWORK_QUICK_ACTION_ADDRESS_PARAM: string = "address";
export const NETWORK_QUICK_ACTION_PROBE_PARAM: string = "probe";

export interface AddDevicePrefill {
  address?: string | undefined;
  probeId?: string | undefined;
}

// An address is an IP or a hostname: letters, digits, dots, dashes, colons.
const ADDRESS_PATTERN: RegExp = /^[A-Za-z0-9.:-]{1,253}$/;
const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What an Add Device link in `search` fills in. The query string is
 * untrusted: a value that is not an address, or not an ID, is left out.
 */
export function readAddDevicePrefill(
  search: string | null | undefined,
): AddDevicePrefill {
  if (!search) {
    return {};
  }

  const params: URLSearchParams = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );

  const prefill: AddDevicePrefill = {};
  const address: string | null = params.get(NETWORK_QUICK_ACTION_ADDRESS_PARAM);
  const probeId: string | null = params.get(NETWORK_QUICK_ACTION_PROBE_PARAM);

  if (address && ADDRESS_PATTERN.test(address)) {
    prefill.address = address;
  }

  if (probeId && UUID_PATTERN.test(probeId)) {
    prefill.probeId = probeId.toLowerCase();
  }

  return prefill;
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
