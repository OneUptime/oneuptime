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
