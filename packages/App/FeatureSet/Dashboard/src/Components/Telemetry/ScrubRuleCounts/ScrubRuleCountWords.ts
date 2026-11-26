import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT A SCRUB RULE LIST SAYS OF THE VALUES EACH RULE CHANGED, AND OF A
 * RULE PROVEN ON ITS RECORDS (#10366).
 *
 * Written once, React-free, for the log and the trace scrub rule lists -
 * and the words tests, which read them outside a browser.
 */

// The column, and what it counts.
export const VALUES_CHANGED_TITLE: string = translationKey("Values Changed");
export const VALUES_CHANGED_DESCRIPTION: string = translationKey(
  "How many values the rule hid in the last 7 days.",
);

// A rule that hid nothing in the days counted.
export const NO_VALUES_CHANGED: string = translationKey("None in 7 days");

// The counts could not be read just now: nothing is said of any rule.
export const VALUES_NOT_COUNTED: string = translationKey("Not counted");

// Opens which services and versions the values came from.
export const BY_SERVICE: string = translationKey("By Service");

export const BY_SERVICE_TITLE: string = translationKey(
  "Values {{rule}} Changed",
);
export const BY_SERVICE_DESCRIPTION: string = translationKey(
  "In the last 7 days, by the service and version that sent them. A version that no longer sends what the rule hides changes nothing more.",
);

export const SERVICE_HEADING: string = translationKey("Service");
export const VERSION_HEADING: string = translationKey("Version");
export const COUNT_HEADING: string = translationKey("Values");
export const LAST_CHANGED_HEADING: string = translationKey("Last Changed");

// A service the reader may not read, or records sent under none.
export const SERVICE_NOT_NAMED: string = translationKey(
  "A service you cannot see",
);
export const NO_SERVICE: string = translationKey("No service");
export const NO_VERSION: string = translationKey("No version");

// A rule that carries a proof of itself as it is now.
export const PROVEN: string = translationKey("Proven");
export const PROVEN_TOOLTIP: string = translationKey(
  "OneUptime ran this rule on the records the data was seen in, through the code ingest runs: it hid the data in every value that held it. Change the rule and it is no longer the rule that was proven.",
);
