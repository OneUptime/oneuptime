import { SecurityCaseMatchBasis } from "Common/Types/SecurityCase/SecurityCaseMatches";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import {
  REQUESTS_ALL_TURNED_AWAY,
  REQUESTS_GOT_THROUGH,
} from "Common/Utils/SecurityCase/ResponsePlan/ResponsePlanWords";

/*
 * The words of a case's "Why This Case Was Opened" card: why the case was
 * opened (the detection, how its rule counts), what exactly matched (the
 * events, each with the request, log line and trace it came from) and where
 * to look next (#9556). Each is an en.json key, looked up where it is drawn.
 *
 * React-free, so the words and the test ids are pinned in a plain test,
 * beside the model that decides which of them is said
 * (SecurityCaseMatchesModel.ts).
 */

export const WHY_OPENED_TITLE: string = translationKey(
  "Why This Case Was Opened",
);

export const WHY_OPENED_DESCRIPTION: string = translationKey(
  "The detection that opened this case, how its rule counts, and the events it matched, each with where it came from.",
);

// Over a detection: whether it opened the case or joined it later.
export const OPENED_THE_CASE: string = translationKey("Opened the case");
export const JOINED_THE_CASE: string = translationKey("Joined the case");

// The facts of a detection, each a row of its own.
export const FACT_FIRES_WHEN: string = translationKey("Fires when");
/*
 * The events it matched, as a noun ("Matches", as Data Security counts
 * them) - not "Matched", which monitor criteria word as "fulfilled".
 */
export const FACT_MATCHED: string = translationKey("Matches");
export const FACT_LOOKS_FOR: string = translationKey("Looks for");
export const FACT_REQUESTS: string = translationKey("Requests");
export const FACT_READ_MORE: string = translationKey("Read more");

// A rule that fires on every match it makes, with no count to reach.
export const FIRES_ON_EACH_MATCH: string = translationKey(
  "Fires on each event it matches.",
);

/*
 * When a single rule fires, in the words a correlation's sentence uses for
 * the same count (DetectionRuleSummary), so a language words them once.
 */
export const FIRES_WHEN_EVENTS_FOR_SAME: string = translationKey(
  "Fires when {{count}} events happen for the same {{groupBy}} within {{timespan}}.",
);
export const FIRES_WHEN_EVENTS: string = translationKey(
  "Fires when {{count}} events happen within {{timespan}}.",
);
export const FIRES_WHEN_SAME_SHOWS_VALUES: string = translationKey(
  "Fires when the same {{groupBy}} shows {{count}} different {{fields}} values within {{timespan}}.",
);
export const FIRES_WHEN_VALUES: string = translationKey(
  "Fires when {{count}} different {{fields}} values show within {{timespan}}.",
);

// "Looks for ../../ or %2e%2e%2f in targetResource"
export const LOOKS_FOR_IN_FIELD: string = translationKey(
  "{{values}} in {{field}}",
);

// What a detection matched: how many events, about what, over when.
export const MATCHED_FROM_BETWEEN: PluralTemplate = {
  one: "{{count}} event from {{value}} between {{start}} and {{end}}",
  other: "{{count}} events from {{value}} between {{start}} and {{end}}",
};
export const MATCHED_NAMING_BETWEEN: PluralTemplate = {
  one: "{{count}} event naming {{value}} between {{start}} and {{end}}",
  other: "{{count}} events naming {{value}} between {{start}} and {{end}}",
};
export const MATCHED_BETWEEN: PluralTemplate = {
  one: "{{count}} event between {{start}} and {{end}}",
  other: "{{count}} events between {{start}} and {{end}}",
};

// How far the matched requests got, said in one sentence: the Response Plan's words too.
export { REQUESTS_ALL_TURNED_AWAY, REQUESTS_GOT_THROUGH };

// What the listed events are, when they are not exactly what the rule matched.
export const BASIS_NOTES: Record<SecurityCaseMatchBasis, string> = {
  [SecurityCaseMatchBasis.RuleCondition]: "",
  [SecurityCaseMatchBasis.CorrelationSteps]: translationKey(
    "The events of the rules it reads that name {{value}}.",
  ),
  [SecurityCaseMatchBasis.Indicator]: translationKey(
    "The events carrying {{value}}, which the threat intel feed lists.",
  ),
  [SecurityCaseMatchBasis.RecordedEvent]: translationKey(
    "The alert as the connected product sent it.",
  ),
  [SecurityCaseMatchBasis.NamedEntities]: translationKey(
    "The events naming {{value}} around when it fired.",
  ),
};

// The rule's own YAML, folded under its facts.
export const SHOW_RULE: string = translationKey("Show the rule");
export const HIDE_RULE: string = translationKey("Hide the rule");

// The list of events.
export const WHAT_MATCHED_HEADING: string = translationKey("What matched");
export const SHOW_ALL_EVENTS: PluralTemplate = {
  one: "Show {{count}} more event",
  other: "Show {{count}} more events",
};
export const SHOW_FEWER_EVENTS: string = translationKey("Show fewer");
export const FIRST_EVENTS_OF: string = translationKey(
  "These are the first {{shown}} of {{count}}.",
);
export const OPEN_IN_EVENTS: string = translationKey("Open in Events");

// Under an event: where it came from.
export const EVENT_FROM_LOG_LINE_OF: string = translationKey(
  "Log line from {{service}}",
);
export const EVENT_FROM_LOG_LINE: string = translationKey("Log line");
export const EVENT_FROM_PRODUCT: string = translationKey("From {{product}}");

// What an event opens.
export const EVENT_LINK_TRACE: string = translationKey("Trace");
export const EVENT_LINK_LOGS: string = translationKey("Logs");
export const EVENT_LINK_EXCEPTION: string = translationKey("Exception");
export const EVENT_OPEN_DETAILS: string = translationKey(
  "Show everything about this event",
);
export const EVENT_LINKS_ARIA_LABEL: string = translationKey(
  "What this event opens",
);
// Over the event's panel: why it is shown.
export const EVENT_PANEL_NOTE: string = translationKey(
  "Matched by {{detection}}.",
);

/*
 * The events a detection kept when it fired (#9619), past the events
 * table's retention: shown as they were kept.
 */
export const KEPT_PAST_RETENTION: PluralTemplate = {
  one: "{{count}} event here is past its retention, and is shown as kept when the detection fired.",
  other:
    "{{count}} events here are past their retention, and are shown as kept when the detection fired.",
};

// The events it kept of sources the reader's role cannot read.
export const HIDDEN_EVENTS: PluralTemplate = {
  one: "Your role cannot read {{count}} more event this detection matched.",
  other: "Your role cannot read {{count}} more events this detection matched.",
};

// Keeping a matched event on the case as evidence (#9622).
export const KEEP_ON_CASE: string = translationKey("Keep on This Case");
export const KEPT_ON_CASE: string = translationKey("Kept on this case");
export const KEPT_ON_CASE_TITLE: string = translationKey(
  "Open it on the case's Evidence page",
);
export const KEPT_ON_CASE_DONE: string = translationKey(
  "The event is kept on this case's Evidence page.",
);

// When a detection has no events to show.
export const NO_EVENTS_LEFT: string = translationKey(
  "No events are left to show. They may be past the project's retention for security events, or in sources your role cannot read.",
);
export const NO_EVENTS_TO_LOOK_UP: string = translationKey(
  "This detection names nothing to look its events up by.",
);
export const EVENTS_UNREADABLE: string = translationKey(
  "Your role cannot read the events this detection matched.",
);
export const EVENTS_FAILED: string = translationKey(
  "The events could not be read just now.",
);
/*
 * When the case's detections could not be read: never "Opened by hand",
 * which would say no detection opened it.
 */
export const DETECTIONS_UNREADABLE: string = translationKey(
  "Your role cannot read this case's detections, so why it was opened is not shown.",
);
export const DETECTIONS_FAILED: string = translationKey(
  "The case's detections could not be read just now.",
);
export const RULES_UNREADABLE: string = translationKey(
  "Your role cannot read detection rules, so how the rule counts is not shown.",
);
export const TRY_AGAIN: string = translationKey("Try again");

// The other detections on the case.
export const OTHER_DETECTIONS_HEADING: string =
  translationKey("Also on this case");
export const SHOW_WHAT_IT_MATCHED: string = translationKey(
  "Show what it matched",
);
export const HIDE_WHAT_IT_MATCHED: string = translationKey(
  "Hide what it matched",
);
export const MORE_DETECTIONS: PluralTemplate = {
  one: "{{count}} more detection is on the Detections page.",
  other: "{{count}} more detections are on the Detections page.",
};
export const OPEN_DETECTIONS: string = translationKey("Open Detections");
export const FIRED: PluralTemplate = {
  one: "Fired once",
  other: "Fired {{count}} times",
};

// A case nobody's detection opened.
export const OPENED_BY_HAND_TITLE: string = translationKey("Opened by hand");
export const OPENED_BY_HAND_DESCRIPTION: string = translationKey(
  "No detection opened this case. Keep what shows what happened on its Evidence page.",
);
export const OPEN_EVIDENCE: string = translationKey("Open Evidence");

// Where to look next.
export const LOOK_NEXT_HEADING: string = translationKey("Look next");
export const LOOK_NEXT_ENTITY: string = translationKey(
  "Everything about {{value}}",
);
export const LOOK_NEXT_EVENTS_NAMING: string = translationKey(
  "Events naming {{value}}",
);
export const LOOK_NEXT_LOG_LINES_NAMING: string = translationKey(
  "Log lines naming {{value}}",
);
export const LOOK_NEXT_SERVICE_LOGS: string = translationKey(
  "Logs from {{service}} around then",
);
export const LOOK_NEXT_TRACES: PluralTemplate = {
  one: "The trace of this request",
  other: "The traces of these {{count}} requests",
};
export const LOOK_NEXT_STORY: string = translationKey("The case's story");
export const LOOK_NEXT_CONNECTED: string = translationKey("Connected signals");

export const SECURITY_CASE_MATCHES_TEST_IDS: {
  card: string;
  detection: string;
  detectionTitle: string;
  facts: string;
  firesWhen: string;
  matched: string;
  lookFor: string;
  requests: string;
  references: string;
  events: string;
  event: string;
  eventText: string;
  eventMark: string;
  eventLinks: string;
  showAll: string;
  noEvents: string;
  basisNote: string;
  others: string;
  moreDetections: string;
  lookNext: string;
  openedByHand: string;
  detectionsUnread: string;
  error: string;
  keptNote: string;
  hiddenNote: string;
  keep: string;
  kept: string;
} = {
  card: "security-case-why-opened",
  detection: "security-case-why-opened-detection",
  detectionTitle: "security-case-why-opened-detection-title",
  facts: "security-case-why-opened-facts",
  firesWhen: "security-case-why-opened-fires-when",
  matched: "security-case-why-opened-matched",
  lookFor: "security-case-why-opened-look-for",
  requests: "security-case-why-opened-requests",
  references: "security-case-why-opened-references",
  events: "security-case-why-opened-events",
  event: "security-case-why-opened-event",
  eventText: "security-case-why-opened-event-text",
  eventMark: "security-case-why-opened-event-mark",
  eventLinks: "security-case-why-opened-event-links",
  showAll: "security-case-why-opened-show-all",
  noEvents: "security-case-why-opened-no-events",
  basisNote: "security-case-why-opened-basis-note",
  others: "security-case-why-opened-others",
  moreDetections: "security-case-why-opened-more-detections",
  lookNext: "security-case-why-opened-look-next",
  openedByHand: "security-case-why-opened-by-hand",
  detectionsUnread: "security-case-why-opened-detections-unread",
  error: "security-case-why-opened-error",
  keptNote: "security-case-why-opened-kept-note",
  hiddenNote: "security-case-why-opened-hidden-note",
  keep: "security-case-why-opened-keep",
  kept: "security-case-why-opened-kept",
};
