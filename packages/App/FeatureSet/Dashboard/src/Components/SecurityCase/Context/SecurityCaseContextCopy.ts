import IconProp from "Common/Types/Icon/IconProp";
import {
  SecurityCaseExposureEvidenceKind,
  SecurityCaseImpactSource,
  SecurityCaseStoryFilter,
  SecurityCaseStoryItemKind,
  SecurityCaseStoryMilestone,
  SecurityCaseStorySource,
} from "Common/Types/SecurityCase/SecurityCaseContext";
import SecurityEventRequestOutcome from "Common/Types/SecurityEvent/SecurityEventRequestOutcome";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of a security case's Story (its page) and Impact (its card on
 * the Overview). Each is an en.json key, looked up where it is drawn.
 *
 * React-free, so the words and the test ids are pinned in a plain test,
 * beside the model that decides which of them is said
 * (SecurityCaseContextModel.ts).
 */

// ---------- Story ----------

export const STORY_DESCRIPTION: string = translationKey(
  "What happened, in order, across OneUptime: each detection and the requests behind it, what they threw, what changed around them, what they set off, and what was done about it.",
);

export const STORY_FILTER_LABELS: Record<SecurityCaseStoryFilter, string> = {
  [SecurityCaseStoryFilter.All]: translationKey("All"),
  [SecurityCaseStoryFilter.Attack]: translationKey("Attack"),
  [SecurityCaseStoryFilter.Changes]: translationKey("Changes"),
  [SecurityCaseStoryFilter.IncidentsAndAlerts]: translationKey(
    "Incidents & alerts",
  ),
  [SecurityCaseStoryFilter.Response]: translationKey("Response"),
};

export const STORY_FILTERS_ARIA_LABEL: string = translationKey(
  "Show part of the story",
);

// What each item is, said small above its title.
export const STORY_KIND_LABELS: Record<SecurityCaseStoryItemKind, string> = {
  [SecurityCaseStoryItemKind.CaseOpened]: translationKey("Case"),
  [SecurityCaseStoryItemKind.Detection]: translationKey("Detection"),
  [SecurityCaseStoryItemKind.Events]: translationKey("Security events"),
  [SecurityCaseStoryItemKind.Exception]: translationKey("Exception"),
  [SecurityCaseStoryItemKind.Change]: translationKey("Change"),
  [SecurityCaseStoryItemKind.Incident]: translationKey("Incident"),
  [SecurityCaseStoryItemKind.Alert]: translationKey("Alert"),
  [SecurityCaseStoryItemKind.PlaybookRun]: translationKey("Playbook"),
  [SecurityCaseStoryItemKind.Note]: translationKey("Note"),
  [SecurityCaseStoryItemKind.Milestone]: translationKey("Case"),
};

export const STORY_KIND_ICONS: Record<SecurityCaseStoryItemKind, IconProp> = {
  [SecurityCaseStoryItemKind.CaseOpened]: IconProp.ShieldCheck,
  [SecurityCaseStoryItemKind.Detection]: IconProp.Bolt,
  [SecurityCaseStoryItemKind.Events]: IconProp.Globe,
  [SecurityCaseStoryItemKind.Exception]: IconProp.Bug,
  [SecurityCaseStoryItemKind.Change]: IconProp.RocketLaunch,
  [SecurityCaseStoryItemKind.Incident]: IconProp.Alert,
  [SecurityCaseStoryItemKind.Alert]: IconProp.BellRinging,
  [SecurityCaseStoryItemKind.PlaybookRun]: IconProp.Play,
  [SecurityCaseStoryItemKind.Note]: IconProp.Lock,
  [SecurityCaseStoryItemKind.Milestone]: IconProp.CheckCircle,
};

export const STORY_CASE_OPENED: string = translationKey("Case opened");

export const STORY_MILESTONE_TITLES: Record<SecurityCaseStoryMilestone, string> =
  {
    [SecurityCaseStoryMilestone.Acknowledged]:
      translationKey("Case acknowledged"),
    [SecurityCaseStoryMilestone.Contained]: translationKey("Case contained"),
    [SecurityCaseStoryMilestone.Closed]: translationKey("Case closed"),
  };

// A run of alike events, under the message of the one that tells it best.
export const STORY_EVENTS_IN_RUN: PluralTemplate = {
  one: "{{count}} event like this",
  other: "{{count}} events like this",
};

export const STORY_UNTIL: string = translationKey("until {{time}}");

// A detection that fired again.
export const STORY_FIRED: PluralTemplate = {
  one: "Fired once",
  other: "Fired {{count}} times",
};

// The events whose requests threw an exception.
export const STORY_THROWN_BY: PluralTemplate = {
  one: "Thrown by {{count}} request",
  other: "Thrown by {{count}} requests",
};

export const STORY_ON_RECORD: string = translationKey("on {{name}}");
export const STORY_STARTED_BY: string = translationKey("Started by {{name}}");
export const STORY_WRITTEN_BY: string = translationKey("Written by {{name}}");

// How far the requests got, as the story says it.
export const STORY_OUTCOME_LABELS: Record<SecurityEventRequestOutcome, string> =
  {
    [SecurityEventRequestOutcome.Rejected]: translationKey("Rejected"),
    [SecurityEventRequestOutcome.ReachedApp]: translationKey("Reached the app"),
    [SecurityEventRequestOutcome.Errored]: translationKey("Errored"),
    [SecurityEventRequestOutcome.ReachedDatabase]: translationKey(
      "Reached the database",
    ),
  };

export const STORY_OUTCOME_TALLY: string = translationKey(
  "{{label}}: {{count}}",
);

// The links an item opens.
export const STORY_LINK_TRACE: string = translationKey("Trace");
export const STORY_LINK_EXCEPTION: string = translationKey("Exception");
export const STORY_LINK_EVENTS: string = translationKey("Events");
export const STORY_LINK_DETECTIONS: string = translationKey("Detections");
export const STORY_LINK_PLAYBOOKS: string = translationKey("Playbooks");
export const STORY_LINKS_ARIA_LABEL: string = translationKey(
  "What {{title}} opens",
);

export const STORY_WINDOW: string = translationKey(
  "Around the case's detections: {{start}} to {{end}}",
);

export const STORY_DAY_HEADING_ARIA_LABEL: string =
  translationKey("Events of {{day}}");

export const STORY_EMPTY_TITLE: string = translationKey("Nothing to tell yet");
export const STORY_EMPTY_DESCRIPTION: string = translationKey(
  "When detections join this case, what happened around them shows here.",
);
export const STORY_FILTER_EMPTY: string = translationKey(
  "Nothing in this part of the story.",
);

// What a source is called when a note says something about it.
export const STORY_SOURCE_NAMES: Record<SecurityCaseStorySource, string> = {
  [SecurityCaseStorySource.Detections]: translationKey("detections"),
  [SecurityCaseStorySource.Events]: translationKey("security events"),
  [SecurityCaseStorySource.Exceptions]: translationKey("exceptions"),
  [SecurityCaseStorySource.Changes]: translationKey("changes"),
  [SecurityCaseStorySource.Incidents]: translationKey("incidents"),
  [SecurityCaseStorySource.Alerts]: translationKey("alerts"),
  [SecurityCaseStorySource.PlaybookRuns]: translationKey("playbook runs"),
  [SecurityCaseStorySource.Notes]: translationKey("notes"),
};

export const STORY_TRUNCATED: string = translationKey(
  "The story leaves some {{sources}} out: there were more than it shows.",
);
export const STORY_UNREADABLE: string = translationKey(
  "Your role can't read {{sources}}, so they aren't in the story.",
);
export const STORY_EXCEPTIONS_UNREADABLE: string = translationKey(
  "Your role can't read exceptions, so the ones here can't be opened.",
);
export const STORY_FAILED: string = translationKey(
  "The {{sources}} couldn't be read this time.",
);
export const STORY_TRY_AGAIN: string = translationKey("Try again");

// ---------- Impact ----------

export const IMPACT_TITLE: string = translationKey("Impact");
export const IMPACT_DESCRIPTION: string = translationKey(
  "What this case puts at risk, as the rest of OneUptime knows it.",
);

export const IMPACT_RECORDS: PluralTemplate = {
  one: "Names {{count}} record",
  other: "Names {{count}} records",
};
export const IMPACT_DOWNSTREAM: PluralTemplate = {
  one: "Calls {{count}} other",
  other: "Calls {{count}} others",
};
export const IMPACT_UPSTREAM: PluralTemplate = {
  one: "Called by {{count}}",
  other: "Called by {{count}}",
};
export const IMPACT_MONITORS: PluralTemplate = {
  one: "{{count}} monitor",
  other: "{{count}} monitors",
};
export const IMPACT_STATUS_PAGES: PluralTemplate = {
  one: "{{count}} status page",
  other: "{{count}} status pages",
};

export const IMPACT_INTERNET: string = translationKey("Internet");
export const IMPACT_INTERNET_YES: string = translationKey(
  "Reachable from the internet",
);
export const IMPACT_INTERNET_UNKNOWN: string = translationKey(
  "Not known to be reachable from the internet",
);
export const IMPACT_INTERNET_UNKNOWN_DETAIL: string = translationKey(
  "Nothing OneUptime holds shows it is: no request from a public address reached the app, and no record reports a public address.",
);
export const IMPACT_EVIDENCE: Record<SecurityCaseExposureEvidenceKind, string> =
  {
    [SecurityCaseExposureEvidenceKind.PublicRequestReachedApp]: translationKey(
      "A request from {{address}} got through ({{outcome}}), {{time}}.",
    ),
    [SecurityCaseExposureEvidenceKind.PublicAddress]: translationKey(
      "{{name}} has a public address, {{address}}.",
    ),
  };

export const IMPACT_EXPOSURE_HEADING: string = translationKey("Exposure");
export const IMPACT_AT_RISK_HEADING: string = translationKey("At risk");
export const IMPACT_TALKED_TO_HEADING: string = translationKey(
  "Network peers",
);

export const IMPACT_OWNERS: string = translationKey("Owners");
export const IMPACT_NO_OWNERS: string = translationKey("No owner set");
export const IMPACT_LAST_CHANGE: string = translationKey("Last change");
export const IMPACT_CHANGE_BEFORE: string = translationKey(
  "{{title}} on {{name}}, {{time}}: before the first detection",
);
export const IMPACT_CHANGE_AFTER: string = translationKey(
  "{{title}} on {{name}}, {{time}}: after the first detection",
);
export const IMPACT_NO_CHANGE: string = translationKey(
  "Nothing changed on these records in the week before the case.",
);
export const IMPACT_VERSION: string = translationKey("Version {{version}}");

export const IMPACT_CALLS: string = translationKey("Calls");
export const IMPACT_CALLED_BY: string = translationKey("Called by");
export const IMPACT_RUNS_ON: string = translationKey("Runs on");
export const IMPACT_WATCHED_BY: string = translationKey("Watched by");
export const IMPACT_SHOWN_ON: string = translationKey("Status pages");
export const IMPACT_NOT_ON_MAP: string = translationKey(
  "Not on the service map",
);
export const IMPACT_NOTHING: string = translationKey("Nothing");
export const IMPACT_MORE: PluralTemplate = {
  one: "+{{count}} more",
  other: "+{{count}} more",
};

export const IMPACT_FLOW_SENT: string = translationKey(
  "{{address}} sent {{bytes}} to {{peer}}",
);
export const IMPACT_FLOW_RECEIVED: string = translationKey(
  "{{address}} received {{bytes}} from {{peer}}",
);

export const IMPACT_SHOW_DETAILS: string = translationKey(
  "Show what is at risk",
);
export const IMPACT_HIDE_DETAILS: string = translationKey("Hide details");

export const IMPACT_EMPTY_TITLE: string = translationKey(
  "Nothing OneUptime knows is named",
);
export const IMPACT_EMPTY_DESCRIPTION: string = translationKey(
  "This case names no host, cluster, service or member OneUptime knows, so it can't say what is at risk.",
);
export const IMPACT_MORE_RECORDS: string = translationKey(
  "The case names more records than are shown here.",
);

export const IMPACT_SOURCE_NAMES: Record<SecurityCaseImpactSource, string> = {
  [SecurityCaseImpactSource.Records]: translationKey("records"),
  [SecurityCaseImpactSource.Dependencies]: translationKey("service map"),
  [SecurityCaseImpactSource.Monitors]: translationKey("monitors"),
  [SecurityCaseImpactSource.StatusPages]: translationKey("status pages"),
  [SecurityCaseImpactSource.Owners]: translationKey("owners"),
  [SecurityCaseImpactSource.Changes]: translationKey("changes"),
  [SecurityCaseImpactSource.NetworkFlows]: translationKey("network flows"),
  [SecurityCaseImpactSource.Events]: translationKey("security events"),
};

export const IMPACT_UNREADABLE: string = translationKey(
  "Your role can't read the {{sources}}, so the impact leaves them out.",
);
export const IMPACT_FAILED: string = translationKey(
  "The {{sources}} couldn't be read this time.",
);

// ---------- Test ids ----------

export const SECURITY_CASE_CONTEXT_TEST_IDS: {
  story: string;
  storyFilters: string;
  storyItem: string;
  storyDay: string;
  storyLinks: string;
  storyEmpty: string;
  storyFilterEmpty: string;
  storyNotes: string;
  impact: string;
  impactSummary: string;
  impactInternet: string;
  impactOwners: string;
  impactLastChange: string;
  impactDetails: string;
  impactToggle: string;
  impactRecord: string;
  impactFlows: string;
  impactEmpty: string;
  impactNotes: string;
  error: string;
} = {
  story: "security-case-story",
  storyFilters: "security-case-story-filters",
  storyItem: "security-case-story-item",
  storyDay: "security-case-story-day",
  storyLinks: "security-case-story-links",
  storyEmpty: "security-case-story-empty",
  storyFilterEmpty: "security-case-story-filter-empty",
  storyNotes: "security-case-story-notes",
  impact: "security-case-impact",
  impactSummary: "security-case-impact-summary",
  impactInternet: "security-case-impact-internet",
  impactOwners: "security-case-impact-owners",
  impactLastChange: "security-case-impact-last-change",
  impactDetails: "security-case-impact-details",
  impactToggle: "security-case-impact-toggle",
  impactRecord: "security-case-impact-record",
  impactFlows: "security-case-impact-flows",
  impactEmpty: "security-case-impact-empty",
  impactNotes: "security-case-impact-notes",
  error: "security-case-context-error",
};
