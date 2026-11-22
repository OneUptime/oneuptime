import {
  DropFilterImpactAction,
  DropFilterRecordCountState,
} from "Common/Types/Telemetry/DropFilterImpact";
import {
  TelemetryFieldReaderKind,
  TelemetryFieldSignal,
} from "Common/Types/Telemetry/TelemetryFieldReaders";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * EVERY SENTENCE THE DROP FILTER IMPACT SAYS, IN ONE PLACE (#10436).
 *
 * What a drop or sample filter would take, as its form, its Enable and its
 * page say it (DropFilterImpactSummary): one line for the most important
 * effect, and the details under it. Kept apart from the components so the
 * words tests read them outside a browser, and written per signal - a log
 * filter speaks of logs, a trace filter of spans - where a sentence names
 * the records. A sentence about what reads them is the same for both.
 */

// The line, when Security Events read some of what the filter takes.
export const SECURITY_EVENTS_HEADLINES: Readonly<
  Record<
    TelemetryFieldSignal,
    Readonly<Record<DropFilterImpactAction, PluralTemplate>>
  >
> = {
  log: {
    [DropFilterImpactAction.Drop]: {
      one: "Security Events read {{count}} log in the last day that this filter would drop.",
      other:
        "Security Events read {{count}} logs in the last day that this filter would drop.",
    },
    [DropFilterImpactAction.Sample]: {
      one: "Security Events read {{count}} log in the last day that this filter would sample.",
      other:
        "Security Events read {{count}} logs in the last day that this filter would sample.",
    },
  },
  trace: {
    [DropFilterImpactAction.Drop]: {
      one: "Security Events read {{count}} span in the last day that this filter would drop.",
      other:
        "Security Events read {{count}} spans in the last day that this filter would drop.",
    },
    [DropFilterImpactAction.Sample]: {
      one: "Security Events read {{count}} span in the last day that this filter would sample.",
      other:
        "Security Events read {{count}} spans in the last day that this filter would sample.",
    },
  },
};

/*
 * The line, when saved queries read what the filter takes: the most
 * important kind that does, counted. The details list every kind.
 */
export const READER_HEADLINES: Readonly<
  Record<
    DropFilterImpactAction,
    Readonly<Record<TelemetryFieldReaderKind, PluralTemplate>>
  >
> = {
  [DropFilterImpactAction.Drop]: {
    [TelemetryFieldReaderKind.Monitor]: {
      one: "{{count}} monitor reads what this filter would drop.",
      other: "{{count}} monitors read what this filter would drop.",
    },
    [TelemetryFieldReaderKind.ServiceLevelObjective]: {
      one: "{{count}} SLO reads what this filter would drop.",
      other: "{{count}} SLOs read what this filter would drop.",
    },
    [TelemetryFieldReaderKind.Dashboard]: {
      one: "{{count}} dashboard reads what this filter would drop.",
      other: "{{count}} dashboards read what this filter would drop.",
    },
    [TelemetryFieldReaderKind.RecordingRule]: {
      one: "{{count}} recording rule reads what this filter would drop.",
      other: "{{count}} recording rules read what this filter would drop.",
    },
    [TelemetryFieldReaderKind.SavedView]: {
      one: "{{count}} saved view reads what this filter would drop.",
      other: "{{count}} saved views read what this filter would drop.",
    },
  },
  [DropFilterImpactAction.Sample]: {
    [TelemetryFieldReaderKind.Monitor]: {
      one: "{{count}} monitor reads what this filter would sample.",
      other: "{{count}} monitors read what this filter would sample.",
    },
    [TelemetryFieldReaderKind.ServiceLevelObjective]: {
      one: "{{count}} SLO reads what this filter would sample.",
      other: "{{count}} SLOs read what this filter would sample.",
    },
    [TelemetryFieldReaderKind.Dashboard]: {
      one: "{{count}} dashboard reads what this filter would sample.",
      other: "{{count}} dashboards read what this filter would sample.",
    },
    [TelemetryFieldReaderKind.RecordingRule]: {
      one: "{{count}} recording rule reads what this filter would sample.",
      other: "{{count}} recording rules read what this filter would sample.",
    },
    [TelemetryFieldReaderKind.SavedView]: {
      one: "{{count}} saved view reads what this filter would sample.",
      other: "{{count}} saved views read what this filter would sample.",
    },
  },
};

// The line, when it matches records and nothing else reads them.
export const UNREAD_HEADLINES: Readonly<
  Record<TelemetryFieldSignal, PluralTemplate>
> = {
  log: {
    one: "{{count}} log matched this filter in the last day, and nothing else in this project reads it.",
    other:
      "{{count}} logs matched this filter in the last day, and nothing else in this project reads them.",
  },
  trace: {
    one: "{{count}} span matched this filter in the last day, and nothing else in this project reads it.",
    other:
      "{{count}} spans matched this filter in the last day, and nothing else in this project reads them.",
  },
};

// The line, when it matches records and not everything that could read them was checked.
export const MATCHED_ONLY_HEADLINES: Readonly<
  Record<TelemetryFieldSignal, PluralTemplate>
> = {
  log: {
    one: "{{count}} log matched this filter in the last day.",
    other: "{{count}} logs matched this filter in the last day.",
  },
  trace: {
    one: "{{count}} span matched this filter in the last day.",
    other: "{{count}} spans matched this filter in the last day.",
  },
};

// The details, when it matched no record of the last day.
export const NO_MATCH_LINES: Readonly<Record<TelemetryFieldSignal, string>> = {
  log: translationKey("No log stored in the last day matches this filter."),
  trace: translationKey("No span stored in the last day matches this filter."),
};

// Security Events reads the signal, and none of what the filter matched.
export const SECURITY_EVENTS_NONE_TAKEN: Readonly<
  Record<TelemetryFieldSignal, string>
> = {
  log: translationKey(
    "It reads this project's logs, and none of the ones this filter matched.",
  ),
  trace: translationKey(
    "It reads this project's spans, and none of the ones this filter matched.",
  ),
};

// The line, when it matched no record of the last day.
export const NO_MATCH_HEADLINES: Readonly<
  Record<TelemetryFieldSignal, string>
> = {
  log: translationKey(
    "No log matched this filter in the last day, and nothing else in this project reads what it would take.",
  ),
  trace: translationKey(
    "No span matched this filter in the last day, and nothing else in this project reads what it would take.",
  ),
};

// The line, when its query cannot be read.
export const UNREADABLE_HEADLINE: string = translationKey(
  "This query can't be read, so the filter would take nothing.",
);

// What the count says when it has no number, as a line and in the details.
export const UNCOUNTED_LINES: Readonly<
  Record<
    TelemetryFieldSignal,
    Readonly<
      Record<
        Exclude<DropFilterRecordCountState, DropFilterRecordCountState.Counted>,
        string
      >
    >
  >
> = {
  log: {
    [DropFilterRecordCountState.TimedOut]: translationKey(
      "Counting the logs this filter matches took longer than {{seconds}} seconds, so it was stopped.",
    ),
    [DropFilterRecordCountState.Failed]: translationKey(
      "The logs this filter matches could not be counted just now.",
    ),
    [DropFilterRecordCountState.NotPermitted]: translationKey(
      "You can't read this project's logs, so the ones this filter matches were not counted.",
    ),
  },
  trace: {
    [DropFilterRecordCountState.TimedOut]: translationKey(
      "Counting the spans this filter matches took longer than {{seconds}} seconds, so it was stopped.",
    ),
    [DropFilterRecordCountState.Failed]: translationKey(
      "The spans this filter matches could not be counted just now.",
    ),
    [DropFilterRecordCountState.NotPermitted]: translationKey(
      "You can't read this project's spans, so the ones this filter matches were not counted.",
    ),
  },
};

// The details' first line: how many it matched of the last day's records.
export const MATCHED_LINES: Readonly<
  Record<TelemetryFieldSignal, PluralTemplate>
> = {
  log: {
    one: "{{count}} of the {{total}} logs stored in the last day matches this filter ({{share}}).",
    other:
      "{{count}} of the {{total}} logs stored in the last day match this filter ({{share}}).",
  },
  trace: {
    one: "{{count}} of the {{total}} spans stored in the last day matches this filter ({{share}}).",
    other:
      "{{count}} of the {{total}} spans stored in the last day match this filter ({{share}}).",
  },
};

// Said under the count when it reads only the services the person may read.
export const SCOPED_LINES: Readonly<Record<TelemetryFieldSignal, string>> = {
  log: translationKey("Counted over the services whose logs you can read."),
  trace: translationKey("Counted over the services whose spans you can read."),
};

export const SECURITY_EVENTS_TITLE: string = translationKey("Security Events");

// What Security Events loses of the records it read, by signal and action.
export const SECURITY_EVENTS_LOSSES: Readonly<
  Record<TelemetryFieldSignal, Readonly<Record<DropFilterImpactAction, string>>>
> = {
  log: {
    [DropFilterImpactAction.Drop]: translationKey(
      "It finds sign-ins, attacks and firewall records in these logs. Dropped, they raise no events.",
    ),
    [DropFilterImpactAction.Sample]: translationKey(
      "It finds sign-ins, attacks and firewall records in these logs. Kept at {{percent}}%, it sees about {{percent}}% of them.",
    ),
  },
  trace: {
    [DropFilterImpactAction.Drop]: translationKey(
      "It finds attacks in the URLs of these requests. Dropped, they raise no events.",
    ),
    [DropFilterImpactAction.Sample]: translationKey(
      "It finds attacks in the URLs of these requests. Kept at {{percent}}%, it finds about {{percent}}% of them.",
    ),
  },
};

// A trace filter, where Your logs reads a request's span for its address.
export const SECURITY_EVENTS_FOLLOWS_SPANS: string = translationKey(
  "It also reads the span of the request a log line was written in, for the address the request came from: a line in a dropped request loses that address.",
);

// One of OneUptime's own OpenStack filters, as it made it.
export const SECURITY_EVENTS_KEPT_BY_DEFAULT: string = translationKey(
  "This is one of OneUptime's own OpenStack filters, which keep every line Security Events reads.",
);

export const SECURITY_EVENTS_UNCHECKED: string = translationKey(
  "Whether Security Events reads what this filter would take could not be checked.",
);

// A sample's effect on the rules that fire at a count.
export const THRESHOLD_RULES_TITLE: string = translationKey(
  "Rules That Fire at a Count",
);

export const THRESHOLD_RULES_INTRO: string = translationKey(
  "Each counts events in its window, and gets only about {{percent}}% of the events in what this filter samples, so it fires far less often, or never:",
);

export const THRESHOLD_RULE_LINE: PluralTemplate = {
  one: "Fires at {{threshold}} in {{count}} minute. Kept at {{percent}}%, it needs about {{needed}}.",
  other:
    "Fires at {{threshold}} in {{count}} minutes. Kept at {{percent}}%, it needs about {{needed}}.",
};

export const THRESHOLD_RULES_ONLY_HIDDEN: PluralTemplate = {
  one: "{{count}} rule you can't see fires at a count.",
  other: "{{count}} rules you can't see fire at a count.",
};

export const THRESHOLD_RULES_MORE_HIDDEN: PluralTemplate = {
  one: "and {{count}} more you can't see",
  other: "and {{count}} more you can't see",
};

export const THRESHOLD_RULES_UNCHECKED: string = translationKey(
  "Which rules fire at a count could not be checked.",
);

// The readers' list, in a filter's words.
export const READERS_HEADINGS: Readonly<
  Record<DropFilterImpactAction, string>
> = {
  [DropFilterImpactAction.Drop]: translationKey(
    "These read what this filter would drop:",
  ),
  [DropFilterImpactAction.Sample]: translationKey(
    "These read what this filter would sample:",
  ),
};

// What the filter does to each kind of reader, said plainly.
export const READER_CONSEQUENCES: Readonly<
  Record<
    DropFilterImpactAction,
    Readonly<Record<TelemetryFieldReaderKind, string>>
  >
> = {
  [DropFilterImpactAction.Drop]: {
    [TelemetryFieldReaderKind.Monitor]: translationKey(
      "They get none of what this filter drops: a monitor can go quiet and stay green.",
    ),
    [TelemetryFieldReaderKind.Dashboard]: translationKey(
      "The widgets named under each show none of what this filter drops.",
    ),
    [TelemetryFieldReaderKind.SavedView]: translationKey(
      "They find none of what this filter drops.",
    ),
    [TelemetryFieldReaderKind.RecordingRule]: translationKey(
      "They write no points for what this filter drops.",
    ),
    [TelemetryFieldReaderKind.ServiceLevelObjective]: translationKey(
      "They count none of the requests this filter drops.",
    ),
  },
  [DropFilterImpactAction.Sample]: {
    [TelemetryFieldReaderKind.Monitor]: translationKey(
      "They see only the {{percent}}% this filter keeps: a count reaches its threshold far less often.",
    ),
    [TelemetryFieldReaderKind.Dashboard]: translationKey(
      "The widgets named under each show only the {{percent}}% this filter keeps.",
    ),
    [TelemetryFieldReaderKind.SavedView]: translationKey(
      "They find only the {{percent}}% this filter keeps.",
    ),
    [TelemetryFieldReaderKind.RecordingRule]: translationKey(
      "Their points count only the {{percent}}% this filter keeps.",
    ),
    [TelemetryFieldReaderKind.ServiceLevelObjective]: translationKey(
      "They count only the {{percent}}% of requests this filter keeps.",
    ),
  },
};

export const READER_UNCHECKED: Readonly<
  Record<TelemetryFieldReaderKind, string>
> = {
  [TelemetryFieldReaderKind.Monitor]: translationKey(
    "Whether a monitor reads what this filter would take could not be checked.",
  ),
  [TelemetryFieldReaderKind.Dashboard]: translationKey(
    "Whether a dashboard reads what this filter would take could not be checked.",
  ),
  [TelemetryFieldReaderKind.SavedView]: translationKey(
    "Whether a saved view reads what this filter would take could not be checked.",
  ),
  [TelemetryFieldReaderKind.RecordingRule]: translationKey(
    "Whether a recording rule reads what this filter would take could not be checked.",
  ),
  [TelemetryFieldReaderKind.ServiceLevelObjective]: translationKey(
    "Whether an SLO reads what this filter would take could not be checked.",
  ),
};

// The fold under the line.
export const SHOW_DETAILS: string = translationKey("Show details");
export const HIDE_DETAILS: string = translationKey("Hide details");

// When the impact itself could not be asked for.
export const IMPACT_UNCHECKED: string = translationKey(
  "What this filter would take could not be checked.",
);

// The question before a filter that takes what others read is saved.
export const CONFIRM_CREATE_TITLE: string = translationKey(
  "Create This Filter?",
);
export const CONFIRM_CREATE_BUTTON: string = translationKey("Create Filter");
export const CONFIRM_SAVE_TITLE: string = translationKey("Save This Filter?");
export const CONFIRM_SAVE_BUTTON: string = translationKey("Save Filter");
export const CONFIRM_ENABLE_QUESTION: string = translationKey(
  "Are you sure you want to enable {{name}}?",
);
