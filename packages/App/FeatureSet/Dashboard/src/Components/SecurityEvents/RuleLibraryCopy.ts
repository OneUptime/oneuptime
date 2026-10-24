import PageMap from "../../Utils/PageMap";
import {
  LibraryDataFilter,
  LibraryRuleDataStatus,
  LibraryStatusFilter,
} from "./RuleLibraryUtil";
import { DetectionRuleDataKind } from "Common/Types/SecurityEvent/DetectionRuleDataKind";
import {
  DetectionRuleLibraryCategory,
  DetectionRuleLibraryEntry,
} from "Common/Types/SecurityEvent/DetectionRuleLibrary";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The Rule Library's words, as English keys the extractor reads (the
 * catalogs they belong to live in Common, which it does not scan), looked
 * up where they are drawn. React-free, so the model's tests read them too.
 */

// The page's card.
export const RULE_LIBRARY_TITLE: string = translationKey("Rule Library");
export const RULE_LIBRARY_DESCRIPTION: string = translationKey(
  "Ready-made detections for the events you send. Adding one creates a detection rule you can change or turn off under Detection Rules.",
);

// The categories, as the Category select and a rule's details name them.
export const RULE_LIBRARY_CATEGORY_TITLES: Record<
  DetectionRuleLibraryCategory,
  string
> = {
  [DetectionRuleLibraryCategory.Identity]: translationKey("Identity"),
  [DetectionRuleLibraryCategory.Endpoint]: translationKey("Endpoint"),
  [DetectionRuleLibraryCategory.Cloud]: translationKey("Cloud"),
  [DetectionRuleLibraryCategory.Network]: translationKey("Network"),
  [DetectionRuleLibraryCategory.Web]: translationKey("Web"),
  [DetectionRuleLibraryCategory.Kubernetes]: translationKey("Kubernetes"),
};

// What each kind of event is called, in the Data column and a rule's details.
export const DATA_KIND_TITLES: Record<DetectionRuleDataKind, string> = {
  [DetectionRuleDataKind.SignIns]: translationKey("Sign-in events"),
  [DetectionRuleDataKind.AccountChanges]: translationKey("Account changes"),
  [DetectionRuleDataKind.OktaSystemLog]: translationKey("Okta System Log"),
  [DetectionRuleDataKind.ProcessEvents]: translationKey("Process events"),
  [DetectionRuleDataKind.SudoLogs]: translationKey("sudo logs"),
  [DetectionRuleDataKind.AwsCloudTrail]: translationKey("AWS CloudTrail"),
  [DetectionRuleDataKind.NetworkActivity]: translationKey("Network activity"),
  [DetectionRuleDataKind.WebRequests]: translationKey("Web requests"),
  [DetectionRuleDataKind.KubernetesAuditLogs]: translationKey(
    "Kubernetes audit logs",
  ),
};

/*
 * How to start sending a kind of event, for a rule whose events do not
 * arrive yet, and where that is done: Connections - a product to connect,
 * or "Your logs" on it - or, for network events, which come from a
 * firewall or a SIEM, the Setup Guide.
 */
export const DATA_KIND_HOW_TO_SEND: Record<DetectionRuleDataKind, string> = {
  [DetectionRuleDataKind.SignIns]: translationKey(
    "Connect Okta, Microsoft Sentinel, Google SecOps or another source, or find SSH sign-ins in the logs you send.",
  ),
  [DetectionRuleDataKind.AccountChanges]: translationKey(
    "Connect Okta, or another source that sends account changes.",
  ),
  [DetectionRuleDataKind.OktaSystemLog]: translationKey(
    "Connect Okta to read its System Log.",
  ),
  [DetectionRuleDataKind.ProcessEvents]: translationKey(
    "Connect an EDR such as CrowdStrike Falcon or Microsoft Defender XDR. On Linux, the commands run with sudo count too: find security events in your logs.",
  ),
  [DetectionRuleDataKind.SudoLogs]: translationKey(
    "Send your servers' auth logs to OneUptime and find security events in your logs.",
  ),
  [DetectionRuleDataKind.AwsCloudTrail]: translationKey(
    "Send CloudTrail to OneUptime as logs and find security events in your logs.",
  ),
  [DetectionRuleDataKind.NetworkActivity]: translationKey(
    "Send firewall, flow log or IDS events to OneUptime, or connect a SIEM that has them.",
  ),
  [DetectionRuleDataKind.WebRequests]: translationKey(
    "Send your web servers' access logs to OneUptime and find security events in your logs.",
  ),
  [DetectionRuleDataKind.KubernetesAuditLogs]: translationKey(
    "Send your clusters' audit logs to OneUptime and find security events in your logs.",
  ),
};

/*
 * What a rule's own words add to its kind of event: "Process events from an
 * EDR, Sysmon or Windows" says which ones; "AWS CloudTrail events" says
 * nothing "AWS CloudTrail" did not, and is not drawn under it.
 */
export function getDataSourceDetail(
  entry: Pick<DetectionRuleLibraryEntry, "dataKind" | "dataSource">,
): string | null {
  const said: string = entry.dataSource.trim().toLowerCase();
  const title: string = DATA_KIND_TITLES[entry.dataKind].trim().toLowerCase();

  if (!said || said === title || said === `${title} events`) {
    return null;
  }

  return entry.dataSource.trim();
}

export const DATA_KIND_SEND_PAGE: Record<DetectionRuleDataKind, PageMap> = {
  [DetectionRuleDataKind.SignIns]: PageMap.SECURITY_EVENTS_CONNECTIONS,
  [DetectionRuleDataKind.AccountChanges]: PageMap.SECURITY_EVENTS_CONNECTIONS,
  [DetectionRuleDataKind.OktaSystemLog]: PageMap.SECURITY_EVENTS_CONNECTIONS,
  [DetectionRuleDataKind.ProcessEvents]: PageMap.SECURITY_EVENTS_CONNECTIONS,
  [DetectionRuleDataKind.SudoLogs]: PageMap.SECURITY_EVENTS_CONNECTIONS,
  [DetectionRuleDataKind.AwsCloudTrail]: PageMap.SECURITY_EVENTS_CONNECTIONS,
  [DetectionRuleDataKind.NetworkActivity]:
    PageMap.SECURITY_EVENTS_DOCUMENTATION,
  [DetectionRuleDataKind.WebRequests]: PageMap.SECURITY_EVENTS_CONNECTIONS,
  [DetectionRuleDataKind.KubernetesAuditLogs]:
    PageMap.SECURITY_EVENTS_CONNECTIONS,
};

export const GO_TO_CONNECTIONS: string = translationKey("Go to Connections");
export const OPEN_SETUP_GUIDE: string = translationKey("Open the Setup Guide");

// The link under a rule whose events do not arrive yet.
export function getDataKindSendLinkText(kind: DetectionRuleDataKind): string {
  return DATA_KIND_SEND_PAGE[kind] === PageMap.SECURITY_EVENTS_DOCUMENTATION
    ? OPEN_SETUP_GUIDE
    : GO_TO_CONNECTIONS;
}

// Whether the project sends what a rule reads, in a word, and in a sentence.
export const DATA_STATUS_WORDS: Record<
  Exclude<LibraryRuleDataStatus, LibraryRuleDataStatus.Unknown>,
  string
> = {
  [LibraryRuleDataStatus.Received]: translationKey("Receiving"),
  [LibraryRuleDataStatus.NotReceived]: translationKey("Not receiving"),
};

export const DATA_STATUS_SENTENCES: Record<
  Exclude<LibraryRuleDataStatus, LibraryRuleDataStatus.Unknown>,
  string
> = {
  [LibraryRuleDataStatus.Received]: translationKey(
    "Events of this kind arrived in the last 7 days.",
  ),
  [LibraryRuleDataStatus.NotReceived]: translationKey(
    "No events of this kind arrived in the last 7 days. The rule runs, but finds nothing until they do.",
  ),
};

export const DATA_STATUS_UNKNOWN: string = translationKey(
  "Could not check which events this project sends.",
);

// The filters.
export const CATEGORY_FILTER_LABEL: string = translationKey("Rule categories");
export const ALL_CATEGORIES: string = translationKey("All categories");
export const RECOMMENDED: string = translationKey("Recommended");

export const DATA_FILTER_LABEL: string = translationKey("Data the rules read");
export const DATA_FILTER_OPTIONS: Record<LibraryDataFilter, string> = {
  [LibraryDataFilter.Any]: translationKey("Any data"),
  [LibraryDataFilter.Received]: translationKey("Data you send"),
  [LibraryDataFilter.NotReceived]: translationKey("Data you don't send yet"),
};

export const STATUS_FILTER_LABEL: string = translationKey("Rule status");
export const STATUS_FILTER_OPTIONS: Record<LibraryStatusFilter, string> = {
  [LibraryStatusFilter.Any]: translationKey("Any status"),
  [LibraryStatusFilter.NotAdded]: translationKey("Not added"),
  [LibraryStatusFilter.Added]: translationKey("Added"),
};

export const RULE_COUNT: PluralTemplate = {
  one: "{{count}} rule",
  other: "{{count}} rules",
};

export const NO_MATCHING_RULE: string = translationKey(
  "No rule matches your search or filters.",
);

// The table.
export const RULE_COLUMN: string = translationKey("Rule");
export const DATA_COLUMN: string = translationKey("Data");
export const SEVERITY_COLUMN: string = translationKey("Severity");
export const ADD: string = translationKey("Add");
export const ADDED: string = translationKey("Added");
export const TURNED_OFF: string = translationKey("Off");

// The header's buttons.
export const ADD_RECOMMENDED_RULES: PluralTemplate = {
  one: "Add {{count}} Recommended Rule",
  other: "Add {{count}} Recommended Rules",
};
export const ADD_ALL_RULES: PluralTemplate = {
  one: "Add {{count}} Rule",
  other: "Add All {{count}} Rules",
};
export const ADD_MATCHING_RULES: PluralTemplate = {
  one: "Add {{count}} Matching Rule",
  other: "Add {{count}} Matching Rules",
};

// The confirmation of an add of more than one rule at a time.
export const ADD_RECOMMENDED_TITLE: PluralTemplate = {
  one: "Add {{count}} recommended rule?",
  other: "Add {{count}} recommended rules?",
};
export const ADD_RULES_TITLE: PluralTemplate = {
  one: "Add {{count}} rule?",
  other: "Add {{count}} rules?",
};
export const ADD_RULES_DESCRIPTION: PluralTemplate = {
  one: "It starts on and opens a security case when it matches. You can change it or turn it off under Detection Rules.",
  other:
    "They start on and open a security case when they match. You can change them or turn them off under Detection Rules.",
};
export const ADD_RULES_WITHOUT_DATA: PluralTemplate = {
  one: "{{count}} of these reads events this project does not send yet, so it finds nothing until they arrive.",
  other:
    "{{count}} of these read events this project does not send yet, so they find nothing until those arrive.",
};

// A rule's details.
export const WHAT_IT_READS: string = translationKey("What it reads");
export const HOW_IT_RUNS: string = translationKey("How it runs");
export const SIGMA_RULE: string = translationKey("Sigma Rule");
export const MITRE_ATTACK: string = translationKey("MITRE ATT&CK");
export const ADDED_AS: string = translationKey("Added as {{name}}");
export const TURNED_OFF_NOTE: string = translationKey(
  "Turned off. Turn it on under Detection Rules.",
);
export const GO_TO_DETECTION_RULES: string = translationKey(
  "Go to Detection Rules",
);
