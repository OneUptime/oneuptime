import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * What Add recommended rules says on the SLO list, in English: the keys the
 * Dashboard's locales translate (useSloRecommendedRulesBulkAction draws
 * them). The docs quote the action's name, and SloDocsFacts holds the two
 * together.
 */

// The Bulk Actions item, and the confirmation's button: the Burn Rate Rules page's words.
export const SLO_ADD_RECOMMENDED_RULES_ACTION_TITLE: string = translationKey(
  "Add recommended rules",
);

// It sits in a run of its own in Bulk Actions (ActionMenuGroup).
export const SLO_RECOMMENDED_RULES_MENU_GROUP: string = "recommended-rules";

export const SLO_BULK_RECOMMENDED_RULES_TITLE: PluralTemplate = {
  one: "Add recommended rules to {{count}} SLO",
  other: "Add recommended rules to {{count}} SLOs",
};

export const SLO_BULK_RECOMMENDED_RULES_QUESTION: string = translationKey(
  "Each SLO gets only the recommended burn rate rules it does not have yet, scaled to its compliance window. Edit or delete them afterwards like any other rule.",
);

// While the confirmation asks the server what each SLO is missing.
export const SLO_BULK_RECOMMENDED_RULES_CHECKING: string = translationKey(
  "Checking which recommended rules each SLO is missing…",
);

export const SLO_BULK_RECOMMENDED_RULES_HEADLINE: PluralTemplate = {
  one: "{{count}} SLO gets the recommended rules it is missing:",
  other: "{{count}} SLOs get the recommended rules they are missing:",
};

// How many SLOs get a rule, or one shape of it.
export const SLO_BULK_RECOMMENDED_RULES_SLO_COUNT: PluralTemplate = {
  one: "{{count}} SLO",
  other: "{{count}} SLOs",
};

// The rest of a shape's SLOs, after the names: "Checkout, Search and 7 more".
export const SLO_BULK_RECOMMENDED_RULES_MORE_SLOS: PluralTemplate = {
  one: "{{count}} more",
  other: "{{count}} more",
};

// How many of a shape's SLOs are named before the rest are counted.
export const SLO_BULK_RECOMMENDED_RULES_NAMES_SHOWN: number = 3;

export const SLO_BULK_RECOMMENDED_RULES_NOTHING_TO_ADD: string = translationKey(
  "There is nothing to add.",
);

export const SLO_BULK_RECOMMENDED_RULES_COMPLETE: PluralTemplate = {
  one: "{{count}} SLO already has every recommended rule and is left as it is.",
  other:
    "{{count}} SLOs already have every recommended rule and are left as they are.",
};

export const SLO_BULK_RECOMMENDED_RULES_REFUSED: PluralTemplate = {
  one: "{{count}} SLO could not be read, so nothing is added to it.",
  other: "{{count}} SLOs could not be read, so nothing is added to them.",
};

export const SLO_BULK_RECOMMENDED_RULES_CHECK_FAILED: string = translationKey(
  "Could not check which recommended rules these SLOs are missing, so nothing can be added yet.",
);

// The result's counts.
export const SLO_BULK_RECOMMENDED_RULES_RESULT_LABELS: {
  succeeded: PluralTemplate;
  failed: PluralTemplate;
  unchanged: PluralTemplate;
} = {
  succeeded: {
    one: "Rules added to {{count}} SLO",
    other: "Rules added to {{count}} SLOs",
  },
  failed: {
    one: "Rules not added to {{count}} SLO",
    other: "Rules not added to {{count}} SLOs",
  },
  unchanged: {
    one: "{{count}} SLO already had every recommended rule",
    other: "{{count}} SLOs already had every recommended rule",
  },
};

// Why an SLO that had every rule was left alone.
export const SLO_BULK_RECOMMENDED_RULES_ALREADY_THERE: string = translationKey(
  "Already has every recommended rule.",
);

// The result's last lines: what was added, rule by rule.
export const SLO_BULK_RECOMMENDED_RULES_ADDED_RULE: PluralTemplate = {
  one: "{{rule}}: added to {{count}} SLO",
  other: "{{rule}}: added to {{count}} SLOs",
};

// An SLO the server's answer left out: nothing says it was added to.
export const SLO_BULK_RECOMMENDED_RULES_NO_ANSWER: string = translationKey(
  "The server did not say what happened to this SLO. Its Burn Rate Rules page shows what it is missing.",
);

/*
 * The server's reasons, as keys the Dashboard translates where the result
 * lists them (BulkUpdateForm translates a reason it has words for). A test
 * pins them to the server's own sentences.
 */
export const SLO_BULK_RECOMMENDED_RULES_SERVER_REASON_KEYS: Array<string> = [
  translationKey("Service Level Objective not found."),
  translationKey(
    "The recommended rules could not all be added to this SLO. Adding them again adds only what is still missing.",
  ),
  translationKey(
    "Adding the recommended burn rate rules takes a role that can create SLO burn rate rules.",
  ),
  translationKey(
    "Seeing which recommended burn rate rules an SLO is missing takes a role that can read SLO burn rate rules.",
  ),
];
