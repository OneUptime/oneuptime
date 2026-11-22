import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The words that say how far back security events go (#10432): the
 * project keeps them for its retention (15 days unless changed), and a
 * rule, Run on Past Events or a hunt that reads further back says so where
 * a person looks - the rule form and the Rule Library, the answer of Run on
 * Past Events, a hunt's time range, and Settings -> Telemetry. Each is an
 * en.json key, looked up where it is drawn; {{retention}}, {{lookback}},
 * {{kept}} and {{needed}} are spans of time, written in the sentence's
 * language.
 *
 * React-free, so a plain test pins every word beside the rules it reads.
 */

// Where the retention is changed: Project Settings > Telemetry & APM > Data Retention.
export const CHANGE_RETENTION: string = translationKey("Change Retention");

// ---------- A rule, as it is written or chosen from the Rule Library ----------

export const RULE_FIRST_SEEN_PAST_RETENTION: string = translationKey(
  "This rule looks back {{lookback}}, but security events are kept for {{retention}}, so a value last seen before then reads as new. Keep them for at least {{needed}}, or shorten the rule's timespan.",
);

// A count or a sequence whose window, with a counting step's, is longer than what is kept.
export const RULE_WINDOW_PAST_RETENTION: string = translationKey(
  "This rule's window is {{lookback}}, but security events are kept for {{retention}}, so it counts only those. Keep them for at least {{needed}}, or shorten the rule's timespan.",
);

// ---------- Run on Past Events ----------

// The period starts before the kept events do.
export const RETROHUNT_KEPT: string = translationKey(
  "Security events are kept for {{retention}}, so this looked back {{retention}}.",
);

// Nothing found in a period that starts before the kept events do: never "in this period".
export const RETROHUNT_NO_MATCHES_KEPT: string = translationKey(
  "No event matched the rule in the last {{retention}}.",
);

export const RETROHUNT_CORRELATION_FOUND_NOTHING_KEPT: string = translationKey(
  "No group matched the correlation in the last {{retention}}.",
);

// A First seen rule that could see part of the history before the period.
export const RETROHUNT_FIRST_SEEN_SHORT_HISTORY: string = translationKey(
  "To tell a value is new, this rule looks back {{lookback}} before the period, and could see {{kept}} of it: a value last seen before then reads as new.",
);

// A First seen rule that could see none of it.
export const RETROHUNT_FIRST_SEEN_NO_HISTORY: string = translationKey(
  "To tell a value is new, this rule looks back {{lookback}} before the period, and none of it is kept. Choose a shorter period.",
);

// The headline of a First seen rule that could see none of its history and found nothing.
export const RETROHUNT_COULD_NOT_TELL: string = translationKey(
  "Could not tell what is new",
);

// ---------- A hunt's time range ----------

export const HUNT_RANGE_PAST_RETENTION: string = translationKey(
  "Security events are kept for {{retention}}: this range finds nothing older.",
);

// ---------- Settings > Telemetry ----------

export const SETTINGS_RULES_PAST_RETENTION_TITLE: PluralTemplate = {
  one: "{{count}} enabled detection rule looks back further than security events are kept",
  other:
    "{{count}} enabled detection rules look back further than security events are kept",
};

export const SETTINGS_RULES_PAST_RETENTION_DESCRIPTION: string = translationKey(
  "Security events are kept for {{retention}}, so these rules see only that much, and a First seen rule takes a value last seen before then for new. Keep them for at least {{needed}} to cover every rule.",
);

// One rule of the list: its name, and how far back it reads.
export const SETTINGS_RULE_LOOKBACK: string = translationKey(
  "{{rule}}: looks back {{lookback}}",
);

export const SETTINGS_MORE_RULES: PluralTemplate = {
  one: "{{count}} more rule",
  other: "{{count}} more rules",
};

// The rules listed by name; the rest are counted in one line.
export const SETTINGS_LISTED_RULES: number = 5;

// ---------- Test ids ----------

export const SECURITY_EVENT_RETENTION_TEST_IDS: Readonly<{
  ruleWarning: string;
  changeRetention: string;
  huntRangeWarning: string;
  retrohuntKept: string;
  retrohuntFirstSeenHistory: string;
  settingsNotice: string;
  settingsRule: string;
  settingsMoreRules: string;
}> = {
  ruleWarning: "security-event-retention-rule-warning",
  changeRetention: "security-event-retention-change",
  huntRangeWarning: "security-event-retention-hunt-range",
  retrohuntKept: "detection-rule-retrohunt-kept",
  retrohuntFirstSeenHistory: "detection-rule-retrohunt-first-seen-history",
  settingsNotice: "security-event-retention-settings-notice",
  settingsRule: "security-event-retention-settings-rule",
  settingsMoreRules: "security-event-retention-settings-more-rules",
};
