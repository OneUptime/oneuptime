import PageMap from "../../Utils/PageMap";
import { ScrubbedAddressSignal } from "Common/Utils/SecurityEvent/ScrubbedAddress";

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
 * matched. Read in Common, beside the events' own, so a case's Response
 * Plan - built in Common for the server and the browser (#10340) - says it
 * wherever it is built.
 */
export { getCaseHiddenClientAddress } from "Common/Utils/SecurityEvent/ScrubbedAddress";
