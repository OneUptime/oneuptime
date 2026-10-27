import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of Run on Past Events - a detection rule run over past events
 * to see what it would have found (Common/Types/SecurityEvent/
 * DetectionRetrohunt) - under the Detection Rules form's YAML and in a
 * rule's row. Each is an en.json key, looked up where it is drawn.
 *
 * React-free, so a plain test pins every word beside the rules it reads.
 */

export const RUN_ON_PAST_EVENTS: string = translationKey("Run on Past Events");

export const RUN_ON_PAST_EVENTS_DESCRIPTION: string = translationKey(
  "What this rule would have found in your events, with its exceptions. Nothing is opened or sent.",
);

// The form's x beside the panel's title.
export const CLOSE_RUN_ON_PAST_EVENTS: string = translationKey(
  "Close Run on Past Events",
);

// The period choice's name, for a screen reader.
export const PERIOD_LABEL: string = translationKey("Period");

export const PERIOD_LAST_DAY: string = translationKey("Last 24 hours");
export const PERIOD_LAST_WEEK: string = translationKey("Last 7 days");
export const PERIOD_LAST_MONTH: string = translationKey("Last 30 days");

export const RUN_AGAIN: string = translationKey("Run again");

export const RUNNING: string = translationKey("Reading your events…");

// The form's rule changed after the run: its answer is about the rule as it was.
export const RULE_CHANGED: string = translationKey(
  "The rule changed after this run.",
);

// The form holds no YAML yet: nothing to run.
export const NEEDS_RULE: string = translationKey(
  "Write or draft the rule first.",
);

// ---------- What it would have found ----------

export const WOULD_HAVE_FIRED: PluralTemplate = {
  one: "Would have fired {{count}} time",
  other: "Would have fired {{count}} times",
};

export const WOULD_NOT_HAVE_FIRED: string = translationKey(
  "Would not have fired",
);

// The facts under it, joined with " · ".
export const FIRINGS_A_DAY: string = translationKey("{{count}} a day");

export const FOR_USERS: PluralTemplate = {
  one: "for {{count}} user",
  other: "for {{count}} users",
};

export const FOR_HOSTS: PluralTemplate = {
  one: "for {{count}} host",
  other: "for {{count}} hosts",
};

export const FOR_ADDRESSES: PluralTemplate = {
  one: "for {{count}} address",
  other: "for {{count}} addresses",
};

export const FOR_GROUPS: PluralTemplate = {
  one: "for {{count}} group",
  other: "for {{count}} groups",
};

export const MATCHING_EVENTS: PluralTemplate = {
  one: "{{count}} matching event",
  other: "{{count}} matching events",
};

// A rule that would not have fired: how close it came.
export const NEAR_MISS: PluralTemplate = {
  one: "{{count}} matching event, but no group reached the Match Count Threshold of {{threshold}} within one run.",
  other:
    "{{count}} matching events, but no group reached the Match Count Threshold of {{threshold}} within one run.",
};

export const NO_MATCHES: string = translationKey(
  "No event matched the rule in this period.",
);

export const CORRELATION_FOUND_NOTHING: string = translationKey(
  "No group matched the correlation in this period.",
);

// More firings a day than a person can look at.
export const NOISY: string = translationKey(
  "That is more than {{count}} a day, more than a person can look at. Raise the Match Count Threshold, group by another field, or add exceptions for what you expect.",
);

// What the rule's exceptions did (a saved rule's, a single rule's).
export const EXCEPTIONS_SKIPPED: PluralTemplate = {
  one: "Its exceptions skipped {{count}} matching event.",
  other: "Its exceptions skipped {{count}} matching events.",
};

export const EXCEPTIONS_PREVENTED: PluralTemplate = {
  one: "Without them, it would have fired {{count}} more time.",
  other: "Without them, it would have fired {{count}} more times.",
};

export const EXCEPTIONS_SKIPPED_NOTHING: PluralTemplate = {
  one: "Its {{count}} exception skipped nothing in this period.",
  other: "Its {{count}} exceptions skipped nothing in this period.",
};

// ---------- What it fired for ----------

export const FIRED_FOR_COLUMN: string = translationKey("Fired for");
export const TIMES_COLUMN: string = translationKey("Times");
export const EVENTS_COLUMN: string = translationKey("Events");
export const LAST_FIRED_COLUMN: string = translationKey("Last fired");

// The one group of a rule with no Group By Field.
export const EVERY_MATCH: string = translationKey("Every match");

export const SHOW_ALL: string = translationKey("Show all {{count}}");

export const ONLY_TOP_LISTED: string = translationKey(
  "Only the {{count}} that fired most are listed.",
);

// A correlation with more groups to check than it may (DetectionRetrohuntResult.candidateLimit).
export const CANDIDATE_LIMIT: string = translationKey(
  "It checked the {{count}} most recently active groups. Others may have matched too.",
);

// ---------- Test ids ----------

export const RETROHUNT_TEST_IDS: Readonly<{
  panel: string;
  open: string;
  close: string;
  period: string;
  runAgain: string;
  running: string;
  summary: string;
  facts: string;
  noisy: string;
  exceptions: string;
  notice: string;
  changed: string;
  groups: string;
  group: string;
  showAll: string;
  error: string;
  modal: string;
}> = {
  panel: "detection-rule-retrohunt",
  open: "detection-rule-retrohunt-open",
  close: "detection-rule-retrohunt-close",
  period: "detection-rule-retrohunt-period",
  runAgain: "detection-rule-retrohunt-run-again",
  running: "detection-rule-retrohunt-running",
  summary: "detection-rule-retrohunt-summary",
  facts: "detection-rule-retrohunt-facts",
  noisy: "detection-rule-retrohunt-noisy",
  exceptions: "detection-rule-retrohunt-exceptions",
  notice: "detection-rule-retrohunt-notice",
  changed: "detection-rule-retrohunt-changed",
  groups: "detection-rule-retrohunt-groups",
  group: "detection-rule-retrohunt-group",
  showAll: "detection-rule-retrohunt-show-all",
  error: "detection-rule-retrohunt-error",
  modal: "detection-rule-retrohunt-modal",
};
