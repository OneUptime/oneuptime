import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS FOR A USER A SCRUB RULE HID (#10435), where an event would name
 * its user: Principal User or Target User says "Hidden by a scrub rule"
 * (HiddenClientAddressCopy's words, shared with an address), and its filter
 * button shows every event whose user a rule hid. Each is an en.json key,
 * looked up where it is drawn.
 */

export { HIDDEN_BY_A_SCRUB_RULE } from "./HiddenClientAddressCopy";

// Principal User's and Target User's filter button, for a user a scrub rule hid.
export const FILTER_BY_HIDDEN_USER: string = translationKey(
  "Show events whose user a scrub rule hid",
);

/*
 * Under a user Security Events named behind a Hash rule's token (#10909):
 * the logs or traces hold only what the rule left ({{token}}), a link that
 * searches them for it.
 */
export const HASHED_IN_YOUR_LOGS: string = translationKey(
  "Hashed in your logs as {{token}}",
);
export const HASHED_IN_YOUR_TRACES: string = translationKey(
  "Hashed in your traces as {{token}}",
);
// The link's hover and spoken name.
export const SEARCH_YOUR_LOGS_FOR: string = translationKey(
  "Search your logs for {{token}}",
);
export const SEARCH_YOUR_TRACES_FOR: string = translationKey(
  "Search your traces for {{token}}",
);

/*
 * Under a user an erasure request took out of Security Events (#10908): the
 * event shows the token again, and this says why.
 */
export const ERASED_ON_REQUEST: string = translationKey("Erased on request");
export const ERASED_ON_REQUEST_DETAIL: string = translationKey(
  "An erasure request took this person out of Security Events, so the event shows their token.",
);
