import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT A SCRUB RULE THAT HIDES ADDRESSES FROM SECURITY EVENTS SAYS, AND
 * ITS BUTTON (#10396).
 *
 * Written once, React-free, for every place that says it: the scrub rule
 * lists of Logs and Traces, an issue's findings, Security Events' setup and
 * the rule form - and the words tests, which read them outside a browser.
 */

// On the rule itself: the list's row, the rule form.
export const HIDES_ADDRESSES_FROM_SECURITY_EVENTS: string = translationKey(
  "This rule also hides addresses from Security Events, so it can't tell you which address to block.",
);

// On a finding the rule covers, which names it.
export const RULE_HIDES_ADDRESSES_FROM_SECURITY_EVENTS: string = translationKey(
  "The scrub rule {{rule}} also hides addresses from Security Events, so it can't tell you which address to block.",
);

export const HASH_INSTEAD: string = translationKey("Hash Instead");

// The button's tooltip: what pressing it changes.
export const HASH_INSTEAD_TOOLTIP: string = translationKey(
  "People will see a token instead of the address. Security Events still sees the address, so it can tell you which one to block.",
);

// After the switch: the rule now hashes.
export const HASHED_INSTEAD: string = translationKey(
  "{{rule}} now hashes IP addresses. Security Events can tell you which address to block.",
);

// Shown in place of the button to a reader who may not edit the rule.
export const HASH_INSTEAD_NOT_ALLOWED: string = translationKey(
  "You need permission to edit scrub rules to switch this rule to Hash.",
);
