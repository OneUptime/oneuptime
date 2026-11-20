import PageMap from "../../Utils/PageMap";
import { SecurityCaseMatchesJson } from "Common/Types/SecurityCase/SecurityCaseMatches";
import {
  HiddenClientAddress,
  ScrubbedAddressSignal,
  readHiddenClientAddress,
} from "Common/Utils/SecurityEvent/ScrubbedAddress";

/*
 * AN ADDRESS A SCRUB RULE HID, AS THE DASHBOARD READS IT (#10397): which
 * Scrub Rules page says why, and whether a case's events all had theirs
 * hidden. React-free and free of the routes, so the Overview's setup model
 * reads it as plainly as a test does (HiddenClientAddressRoute turns a page
 * into its address); the events themselves say it through
 * Common/Utils/SecurityEvent/ScrubbedAddress.
 */

/*
 * The Scrub Rules each kind of record's rules are listed on: the same
 * pages Data Security's Scrub It opens (TelemetryScrubIt's
 * RULES_PAGE_OF_SIGNAL), where a rule is changed.
 */
export const HIDDEN_ADDRESS_RULES_PAGES: Readonly<
  Record<ScrubbedAddressSignal, PageMap>
> = {
  log: PageMap.LOGS_SETTINGS_SCRUB_RULES,
  trace: PageMap.TRACES_SETTINGS_SCRUB_RULES,
};

/*
 * The client address a scrub rule hid from every event a case's detections
 * matched: the first one that names its rule, else the first. Null when
 * there is no event to read, or one of them names its address or says
 * nothing of one - a case with an address to block names it, and one about
 * events that never had an address is not about a hidden one.
 */
export function getCaseHiddenClientAddress(
  matches: SecurityCaseMatchesJson | null,
): HiddenClientAddress | null {
  if (!matches) {
    return null;
  }

  let found: HiddenClientAddress | null = null;

  for (const detection of matches.detections) {
    for (const event of detection.events) {
      const hidden: HiddenClientAddress | null = readHiddenClientAddress(event);

      if (!hidden) {
        return null;
      }

      if (!found || (!found.ruleName && hidden.ruleName)) {
        found = hidden;
      }
    }
  }

  return found;
}
