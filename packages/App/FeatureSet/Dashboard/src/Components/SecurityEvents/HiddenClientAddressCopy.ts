import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS FOR AN ADDRESS A SCRUB RULE HID (#10397), wherever Security
 * Events would name the address an attack came from: an event's Principal
 * IP, its What happened next, a campaign's row, a case's Response Plan, and
 * the setup item that says which rule does it. Each is an en.json key,
 * looked up where it is drawn.
 *
 * React-free, so a plain test pins the words beside the rules that choose
 * them.
 */

// Where an address would be: a field's value, a campaign's address.
export const HIDDEN_BY_A_SCRUB_RULE: string = translationKey(
  "Hidden by a scrub rule",
);

// The same, with the rule's name ({{rule}}) a link to the list it is in.
export const HIDDEN_BY_THE_SCRUB_RULE: string = translationKey(
  "Hidden by the scrub rule {{rule}}",
);

// Principal IP's filter button, for an address a scrub rule hid.
export const FILTER_BY_HIDDEN_ADDRESS: string = translationKey(
  "Show events whose address a scrub rule hid",
);

// Target IP's, for a destination a scrub rule hid (#10419).
export const FILTER_BY_HIDDEN_TARGET_ADDRESS: string = translationKey(
  "Show events whose target address a scrub rule hid",
);

// Who sent the request, in What happened next, where "From 203.0.113.7" would be.
export const FROM_A_HIDDEN_ADDRESS: string = translationKey(
  "From an address a scrub rule hid",
);

// The setup item: a rule redacts or masks the addresses Security Events reads.
export const LOG_ADDRESSES_SCRUBBED: string = translationKey(
  "IP addresses are scrubbed from your logs, so Security Events can't tell you which address to block.",
);

export const TRACE_ADDRESSES_SCRUBBED: string = translationKey(
  "IP addresses are scrubbed from your traces, so Security Events can't tell you which address to block.",
);

// Under it: which rule, its name ({{rule}}) as it was saved.
export const SCRUB_RULE_REDACTS_THEM: string = translationKey(
  "The scrub rule {{rule}} redacts them.",
);

export const SCRUB_RULE_MASKS_THEM: string = translationKey(
  "The scrub rule {{rule}} masks them.",
);

/*
 * What the setup item's and the Response Plan's buttons open (the logs' or
 * the traces' Scrub Rules), and the Response Plan's step where it would say
 * to block the address: every event of the case had its address hidden, so
 * there is none to block. The step says what to do instead, and the line
 * under it why. The plan is built in Common for the server and the browser
 * (#10340), so its words live there, and these are the same words.
 */
export {
  ACTION_OPEN_SCRUB_RULES as OPEN_SCRUB_RULES,
  ADDRESS_HIDDEN_FROM_CASE,
  ADDRESS_HIDDEN_FROM_CASE_BY_RULE,
  STEP_FIND_HIDDEN_ADDRESS,
} from "Common/Utils/SecurityCase/ResponsePlan/ResponsePlanWords";
