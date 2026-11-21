import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of the notice on Detection Rules about security events that
 * arrived more than a day after they happened (#10491), which no rule's
 * run checks (Common/Types/SecurityEvent/SecurityEventLateArrival), and of
 * the Run on Past Events it opens over them. Each is an en.json key,
 * looked up where it is drawn.
 *
 * React-free, so a plain test pins every word beside the rules it reads.
 */

export const LATE_ARRIVALS_TITLE: PluralTemplate = {
  one: "Your rules did not check {{count}} event that arrived late",
  other: "Your rules did not check {{count}} events that arrived late",
};

// Why, and what checks them. The week is SECURITY_EVENT_LATE_ARRIVAL_NOTICE_DAYS.
export const LATE_ARRIVALS_DESCRIPTION: string = translationKey(
  "In the last 7 days, these arrived more than a day after they happened, and a rule's runs read only what arrives within a day of happening. Run on Past Events checks them.",
);

// One line a source: its name, how many, and when the earliest and the latest happened.
export const LATE_ARRIVALS_SOURCE: PluralTemplate = {
  one: "{{source}}: {{count}} event that happened from {{from}} to {{to}}",
  other: "{{source}}: {{count}} events that happened from {{from}} to {{to}}",
};

// The sources past the ones listed.
export const LATE_ARRIVALS_MORE_SOURCES: PluralTemplate = {
  one: "{{count}} more source",
  other: "{{count}} more sources",
};

// A source whose events named no product and no vendor.
export const LATE_ARRIVALS_UNNAMED_SOURCE: string =
  translationKey("Unnamed source");

// The dialog the notice opens: Run on Past Events, on a rule the person chooses.
export const LATE_ARRIVALS_RUN_DESCRIPTION: string = translationKey(
  "Choose a rule to see what it would have found, over a period that reaches back to when the late events happened. Nothing is opened or sent.",
);

export const LATE_ARRIVALS_RULE_LABEL: string = translationKey("Rule");

export const LATE_ARRIVALS_CHOOSE_RULE: string =
  translationKey("Choose a rule");

export const LATE_ARRIVALS_NO_RULES: string = translationKey(
  "There is no detection rule to run yet.",
);

// The sources listed by name; the rest are counted in one line.
export const LATE_ARRIVALS_LISTED_SOURCES: number = 5;

export const LATE_ARRIVALS_TEST_IDS: {
  notice: string;
  source: string;
  moreSources: string;
  run: string;
  modal: string;
  rule: string;
  noRules: string;
} = {
  notice: "late-arrivals-notice",
  source: "late-arrivals-source",
  moreSources: "late-arrivals-more-sources",
  run: "late-arrivals-run",
  modal: "late-arrivals-modal",
  rule: "late-arrivals-rule",
  noRules: "late-arrivals-no-rules",
};
