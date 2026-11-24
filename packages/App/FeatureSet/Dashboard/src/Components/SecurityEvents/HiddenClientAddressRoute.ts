import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { HIDDEN_ADDRESS_RULES_PAGES } from "./HiddenClientAddressModel";
import Route from "Common/Types/API/Route";
import { ScrubbedAddressSignal } from "Common/Utils/SecurityEvent/ScrubbedAddress";

/*
 * Where an address a scrub rule hid (#10397) links to: the logs' or the
 * traces' Scrub Rules, in the project being read. Null when the event does
 * not say which kind of record the rule hid it in.
 */
export function getHiddenAddressRulesRoute(
  signal: ScrubbedAddressSignal | null,
): Route | null {
  if (!signal) {
    return null;
  }

  return RouteUtil.populateRouteParams(
    RouteMap[HIDDEN_ADDRESS_RULES_PAGES[signal]] as Route,
  );
}
