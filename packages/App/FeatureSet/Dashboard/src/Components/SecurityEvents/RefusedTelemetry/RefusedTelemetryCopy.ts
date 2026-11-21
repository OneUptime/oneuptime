import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS FOR TELEMETRY AN INGESTION BUDGET OR RATE REFUSED (#10431),
 * wherever Security Events would otherwise look quiet for it: the
 * Overview's card and its Top Detections, the Your logs and Traces
 * sources, a retrohunt, a hunt's runs and a case. Each is an en.json key,
 * looked up where it is drawn.
 *
 * A line says whose budget or rate refused what, and when: the project's
 * (yours), an ingestion key's, a team's or a label's, each of the logs or
 * the traces - a sentence of its own for each, since the noun the sentence
 * agrees with changes with it in most languages. One that goes on says
 * since when, one that ended from when to when. Under it, how much was not
 * stored.
 *
 * React-free, so a plain test pins the words beside the rules that choose
 * them.
 */

// What each source is called above its lines, as its card and its row call it.
export const YOUR_LOGS_SOURCE: string = translationKey("Your logs");
export const TRACES_SOURCE: string = translationKey("Traces");

// The logs: a daily budget used up.
export const LOGS_BUDGET_USED_UP_SINCE: string = translationKey(
  "Your daily logs budget was used up at {{time}}. Logs since then were refused and not scanned.",
);
export const LOGS_BUDGET_USED_UP_BETWEEN: string = translationKey(
  "Your daily logs budget was used up from {{from}} to {{to}}. Logs in that time were refused and not scanned.",
);
export const LOGS_KEY_BUDGET_USED_UP_SINCE: string = translationKey(
  "The ingestion key {{name}} used up its own daily logs budget at {{time}}. Logs sent with it since then were refused and not scanned.",
);
export const LOGS_KEY_BUDGET_USED_UP_BETWEEN: string = translationKey(
  "The ingestion key {{name}} used up its own daily logs budget from {{from}} to {{to}}. Logs sent with it in that time were refused and not scanned.",
);
export const LOGS_TEAM_BUDGET_USED_UP_SINCE: string = translationKey(
  "The team {{name}} used up its own daily logs budget at {{time}}. Logs from its services since then were dropped and not scanned.",
);
export const LOGS_TEAM_BUDGET_USED_UP_BETWEEN: string = translationKey(
  "The team {{name}} used up its own daily logs budget from {{from}} to {{to}}. Logs from its services in that time were dropped and not scanned.",
);
export const LOGS_LABEL_BUDGET_USED_UP_SINCE: string = translationKey(
  "The label {{name}} used up its own daily logs budget at {{time}}. Logs from the services with it since then were dropped and not scanned.",
);
export const LOGS_LABEL_BUDGET_USED_UP_BETWEEN: string = translationKey(
  "The label {{name}} used up its own daily logs budget from {{from}} to {{to}}. Logs from the services with it in that time were dropped and not scanned.",
);

// The logs: a rate that throttled them.
export const LOGS_RATE_LIMITED_SINCE: string = translationKey(
  "Your logs have come in faster than your ingestion rate since {{time}}. Requests over it were throttled, and their senders retry, so some logs may arrive late or not at all.",
);
export const LOGS_RATE_LIMITED_BETWEEN: string = translationKey(
  "Your logs came in faster than your ingestion rate from {{from}} to {{to}}. Requests over it were throttled, and their senders retry, so some logs may have arrived late or not at all.",
);
export const LOGS_KEY_RATE_LIMITED_SINCE: string = translationKey(
  "Logs sent with the ingestion key {{name}} have come in faster than its own rate since {{time}}. Requests over it were throttled, and their senders retry, so some logs may arrive late or not at all.",
);
export const LOGS_KEY_RATE_LIMITED_BETWEEN: string = translationKey(
  "Logs sent with the ingestion key {{name}} came in faster than its own rate from {{from}} to {{to}}. Requests over it were throttled, and their senders retry, so some logs may have arrived late or not at all.",
);

// The traces: a daily budget used up.
export const TRACES_BUDGET_USED_UP_SINCE: string = translationKey(
  "Your daily traces budget was used up at {{time}}. Traces since then were refused and not scanned.",
);
export const TRACES_BUDGET_USED_UP_BETWEEN: string = translationKey(
  "Your daily traces budget was used up from {{from}} to {{to}}. Traces in that time were refused and not scanned.",
);
export const TRACES_KEY_BUDGET_USED_UP_SINCE: string = translationKey(
  "The ingestion key {{name}} used up its own daily traces budget at {{time}}. Traces sent with it since then were refused and not scanned.",
);
export const TRACES_KEY_BUDGET_USED_UP_BETWEEN: string = translationKey(
  "The ingestion key {{name}} used up its own daily traces budget from {{from}} to {{to}}. Traces sent with it in that time were refused and not scanned.",
);
export const TRACES_TEAM_BUDGET_USED_UP_SINCE: string = translationKey(
  "The team {{name}} used up its own daily traces budget at {{time}}. Traces from its services since then were dropped and not scanned.",
);
export const TRACES_TEAM_BUDGET_USED_UP_BETWEEN: string = translationKey(
  "The team {{name}} used up its own daily traces budget from {{from}} to {{to}}. Traces from its services in that time were dropped and not scanned.",
);
export const TRACES_LABEL_BUDGET_USED_UP_SINCE: string = translationKey(
  "The label {{name}} used up its own daily traces budget at {{time}}. Traces from the services with it since then were dropped and not scanned.",
);
export const TRACES_LABEL_BUDGET_USED_UP_BETWEEN: string = translationKey(
  "The label {{name}} used up its own daily traces budget from {{from}} to {{to}}. Traces from the services with it in that time were dropped and not scanned.",
);

// The traces: a rate that throttled them.
export const TRACES_RATE_LIMITED_SINCE: string = translationKey(
  "Your traces have come in faster than your ingestion rate since {{time}}. Requests over it were throttled, and their senders retry, so some traces may arrive late or not at all.",
);
export const TRACES_RATE_LIMITED_BETWEEN: string = translationKey(
  "Your traces came in faster than your ingestion rate from {{from}} to {{to}}. Requests over it were throttled, and their senders retry, so some traces may have arrived late or not at all.",
);
export const TRACES_KEY_RATE_LIMITED_SINCE: string = translationKey(
  "Traces sent with the ingestion key {{name}} have come in faster than its own rate since {{time}}. Requests over it were throttled, and their senders retry, so some traces may arrive late or not at all.",
);
export const TRACES_KEY_RATE_LIMITED_BETWEEN: string = translationKey(
  "Traces sent with the ingestion key {{name}} came in faster than its own rate from {{from}} to {{to}}. Requests over it were throttled, and their senders retry, so some traces may have arrived late or not at all.",
);

/*
 * How much, under the line: what a used-up budget refused (or a team's or
 * a label's dropped), by its size when the gate sized it, and what a rate
 * throttled.
 */
export const NOT_STORED_SIZE: PluralTemplate = {
  one: "{{size}} in {{count}} request was not stored.",
  other: "{{size}} in {{count}} requests was not stored.",
};

export const NOT_STORED_REQUESTS: PluralTemplate = {
  one: "{{count}} request was not stored.",
  other: "{{count}} requests were not stored.",
};

export const THROTTLED_REQUESTS: PluralTemplate = {
  one: "{{count}} request was throttled.",
  other: "{{count}} requests were throttled.",
};

// The button beside the lines: the project's budgets, where they are changed.
export const OPEN_BUDGETS: string = translationKey("Open Budgets");

/*
 * The Overview's band, in place of "All quiet" while something was refused
 * in the last day: nothing open is not the same as nothing happened.
 */
export const MISSING_TELEMETRY_TITLE: string = translationKey(
  "Some of your telemetry was not scanned",
);
export const MISSING_TELEMETRY_SUMMARY: string = translationKey(
  "No open case and nothing waiting for an approval, but an ingestion budget or rate refused some of the logs or traces Security Events reads. An attack in them would not have been found.",
);

// The Overview's Sources cell, under its figure: never a green tick over it.
export const SOURCES_TELEMETRY_REFUSED: string = translationKey(
  "Some telemetry was refused",
);

// The Overview's Top Detections, empty over 14 days in which something was refused.
export const NOTHING_DETECTED_BUT_REFUSED: string = translationKey(
  "Nothing was detected in the last 14 days, but some of your telemetry was refused in that time and never scanned.",
);

// Above a retrohunt's lines.
export const RETROHUNT_REFUSED: string = translationKey(
  "Some of your logs or traces in this period were refused before they were stored, so this rule could not have matched what they held.",
);

// Under a hunt's run whose window overlaps what was refused.
export const HUNT_RUN_REFUSED: string = translationKey(
  "Some of your logs or traces in this window were refused and never scanned.",
);

// Under the events list's "No security events", over a time range something was refused in.
export const NO_EVENTS_BUT_REFUSED: string = translationKey(
  "Some of your logs or traces in this time range were refused and never scanned, so events from them are missing.",
);

// Above a case's lines.
export const CASE_REFUSED: string = translationKey(
  "Some of your logs or traces were refused while this case was open, so detections from that time may be missing.",
);
