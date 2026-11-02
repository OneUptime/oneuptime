import {
  SecurityConnectionKind,
  SecurityConnectionReason,
  SecurityTelemetrySignal,
} from "Common/Types/SecurityCase/SecurityConnection";
import IconProp from "Common/Types/Icon/IconProp";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of Security Events' connections to the rest of OneUptime: a
 * case's Connected Signals, an event's Connected tab and an entity's
 * Connected Signals card (what they name, the other way, and where it
 * appears in the logs and traces themselves), and the Security
 * card on a host's, a cluster's, a device's, a cloud resource's, a
 * serverless function's, a service's, a monitor's, a user's and an
 * incident's page (the way back). Each is an en.json key, looked up where
 * it is drawn.
 *
 * React-free, so the words and the test ids are pinned in a plain test,
 * beside the rules they talk about (Common/Utils/SecurityCase/
 * SecurityConnectionMatch).
 */

// ---------- Connected Signals ----------

export const CONNECTED_SIGNALS_TITLE: string =
  translationKey("Connected Signals");

export const CONNECTED_SIGNALS_CASE_DESCRIPTION: string = translationKey(
  "The hosts, clusters, services and people this case names, as OneUptime knows them, and what was happening on each around its detections.",
);

export const CONNECTED_SIGNALS_EVENT_DESCRIPTION: string = translationKey(
  "The hosts, clusters, services and people this event names, as OneUptime knows them, and what was happening on each in the hour around it.",
);

export const CONNECTED_SIGNALS_ENTITY_DESCRIPTION: string = translationKey(
  "Where OneUptime knows it, and what was happening there around its last security event.",
);

// The event panel's tab.
export const CONNECTED_TAB_LABEL: string = translationKey("Connected");

// "Signals from Oct 14, 10:02 to 11:40"
export const CONNECTED_WINDOW: string = translationKey(
  "Signals from {{start}} to {{end}}",
);

/*
 * Said of the records alone: what it names may still be in the logs and
 * traces, which "In your logs and traces" says below.
 */
export const CONNECTED_EMPTY_TITLE: string = translationKey(
  "No record matches what it names.",
);

export const CONNECTED_EMPTY_DESCRIPTION: string = translationKey(
  "OneUptime looked for its hosts, addresses and users among your hosts, clusters, devices, services and users, and found none of them.",
);

/*
 * No record found, and a kind of record the reader's role cannot see, or one
 * that could not be read just now, may still hold what it names: nothing is
 * said to be missing from OneUptime.
 */
export const CONNECTED_PARTIAL_EMPTY_TITLE: string = translationKey(
  "No matching record was found.",
);

export const CONNECTED_PARTIAL_EMPTY_DESCRIPTION: string = translationKey(
  "Some kinds of record could not be read, so one may still match.",
);

export const CONNECTED_NOTHING_TO_LOOK_UP_TITLE: string = translationKey(
  "It names no host, address or user to look for.",
);

export const CONNECTED_NOTHING_TO_LOOK_UP_DESCRIPTION: string = translationKey(
  "Only hosts, addresses and users with an email can be found in OneUptime.",
);

// The values looked for that no record matches.
export const CONNECTED_NOT_FOUND_TITLE: string =
  translationKey("No matching record");

export const CONNECTED_MORE_RECORDS: string = translationKey(
  "It names more records than are shown here.",
);

export const CONNECTED_UNREADABLE: string = translationKey(
  "Your role cannot see {{kinds}}, so none is shown.",
);

export const CONNECTED_FAILED: string = translationKey(
  "{{kinds}} could not be read just now.",
);

export const CONNECTED_TRY_AGAIN: string = translationKey("Try again");

export const CONNECTED_POSSIBLE_PILL: string = translationKey("Possible match");

// The heading over the possible matches, after the exact ones, and what it means.
export const CONNECTED_POSSIBLE_GROUP_TITLE: string =
  translationKey("Possible matches");

export const CONNECTED_POSSIBLE_GROUP_DESCRIPTION: string = translationKey(
  "OneUptime cannot be sure these are the same records, so they are not counted on their pages or linked to incidents.",
);

export const CONNECTED_POSSIBLE_TOOLTIP: string = translationKey(
  "Probably the same thing, but OneUptime cannot be sure. It is not counted on its page or linked to incidents.",
);

// What is happening on a record.
export const CONNECTED_ACTIVE_INCIDENTS: PluralTemplate = {
  one: "{{count}} active incident",
  other: "{{count}} active incidents",
};

export const CONNECTED_ACTIVE_ALERTS: PluralTemplate = {
  one: "{{count}} active alert",
  other: "{{count}} active alerts",
};

export const CONNECTED_MONITORS: PluralTemplate = {
  one: "Watched by {{count}} monitor",
  other: "Watched by {{count}} monitors",
};

export const CONNECTED_CHANGES_TITLE: string = translationKey(
  "Changed in this window",
);

export const CONNECTED_NOTHING_ACTIVE: string = translationKey(
  "No active incidents or alerts.",
);

// A member's: the on-call schedules they are on, and the teams they are in.
export const CONNECTED_ON_CALL_SCHEDULES: PluralTemplate = {
  one: "On {{count}} on-call schedule",
  other: "On {{count}} on-call schedules",
};

// Beside a schedule the member is the one on call for now.
export const CONNECTED_ON_CALL_NOW: string = translationKey("On call now");

export const CONNECTED_TEAMS: PluralTemplate = {
  one: "In {{count}} team",
  other: "In {{count}} teams",
};

// "+2 more" after the listed incidents, alerts or monitors.
export const CONNECTED_MORE: PluralTemplate = {
  one: "+{{count}} more",
  other: "+{{count}} more",
};

// The signal links under a record, each opening its explorer on it and the window.
export const SIGNAL_LINK_LABELS: Readonly<Record<string, string>> = {
  logs: translationKey("Logs"),
  traces: translationKey("Traces"),
  metrics: translationKey("Metrics"),
  exceptions: translationKey("Exceptions"),
  events: translationKey("Kubernetes Events"),
  topology: translationKey("Topology"),
  inventory: translationKey("Inventory"),
};

// Each signal's icon, as the record's own side menu draws its page.
export const SIGNAL_LINK_ICONS: Readonly<Record<string, IconProp>> = {
  logs: IconProp.Logs,
  traces: IconProp.Workflow,
  metrics: IconProp.ChartBar,
  exceptions: IconProp.Error,
  events: IconProp.Bolt,
  topology: IconProp.FlowDiagram,
  inventory: IconProp.Cube,
};

export const SIGNAL_LINKS_ARIA_LABEL: string = translationKey(
  "Signals of {{name}} in this window",
);

// ---------- In your logs and traces ----------

export const TELEMETRY_MENTIONS_TITLE: string = translationKey(
  "In your logs and traces",
);

// "Where what it names appears in your logs and traces from Oct 14, 10:02 to 11:40."
export const TELEMETRY_MENTIONS_DESCRIPTION: string = translationKey(
  "Where what it names appears in your logs and traces from {{start}} to {{end}}.",
);

// A value's rows: how many log lines, and how many spans, named it.
export const TELEMETRY_LOG_LINES: PluralTemplate = {
  one: "In {{count}} log line",
  other: "In {{count}} log lines",
};

export const TELEMETRY_SPANS: PluralTemplate = {
  one: "In {{count}} span",
  other: "In {{count}} spans",
};

/*
 * Where in them it was: a log line's message, or an attribute - shown by
 * its key, as the telemetry writes it.
 */
export const TELEMETRY_PLACE_MESSAGE: string = translationKey("In the message");

// What a place's link opens, as its tooltip.
export const TELEMETRY_OPEN_IN_LOGS: string = translationKey("Open in Logs");

export const TELEMETRY_OPEN_IN_TRACES: string =
  translationKey("Open in Traces");

// The values searched for in every signal and named by none.
export const TELEMETRY_NOT_FOUND_TITLE: string = translationKey(
  "Not in your logs or traces",
);

export const TELEMETRY_UNREADABLE: string = translationKey(
  "Your role cannot read {{signals}}, so they were not searched.",
);

export const TELEMETRY_FAILED: string = translationKey(
  "{{signals}} could not be searched just now.",
);

export const TELEMETRY_MORE_VALUES: string = translationKey(
  "It names more values than were searched for.",
);

// The signals, as the notes name them.
export const TELEMETRY_SIGNAL_LABELS: Readonly<
  Record<SecurityTelemetrySignal, string>
> = {
  [SecurityTelemetrySignal.Logs]: translationKey("Logs"),
  [SecurityTelemetrySignal.Traces]: translationKey("Traces"),
};

// ---------- The kinds of record ----------

export const CONNECTION_KIND_LABELS: Readonly<
  Record<SecurityConnectionKind, string>
> = {
  [SecurityConnectionKind.Host]: translationKey("Host"),
  [SecurityConnectionKind.DockerHost]: translationKey("Docker Host"),
  [SecurityConnectionKind.PodmanHost]: translationKey("Podman Host"),
  [SecurityConnectionKind.KubernetesCluster]:
    translationKey("Kubernetes Cluster"),
  [SecurityConnectionKind.NetworkDevice]: translationKey("Network Device"),
  [SecurityConnectionKind.CloudResource]: translationKey("Cloud Resource"),
  [SecurityConnectionKind.ServerlessFunction]: translationKey(
    "Serverless Function",
  ),
  [SecurityConnectionKind.Service]: translationKey("Service"),
  [SecurityConnectionKind.Monitor]: translationKey("Monitor"),
  [SecurityConnectionKind.User]: translationKey("User"),
  [SecurityConnectionKind.InventoryItem]: translationKey("Inventory Item"),
};

// The plural, for "Your role cannot see hosts and services".
export const CONNECTION_KIND_PLURALS: Readonly<
  Record<SecurityConnectionKind, string>
> = {
  [SecurityConnectionKind.Host]: translationKey("Hosts"),
  [SecurityConnectionKind.DockerHost]: translationKey("Docker Hosts"),
  [SecurityConnectionKind.PodmanHost]: translationKey("Podman Hosts"),
  [SecurityConnectionKind.KubernetesCluster]: translationKey(
    "Kubernetes Clusters",
  ),
  [SecurityConnectionKind.NetworkDevice]: translationKey("Network Devices"),
  [SecurityConnectionKind.CloudResource]: translationKey("Cloud Resources"),
  [SecurityConnectionKind.ServerlessFunction]: translationKey(
    "Serverless Functions",
  ),
  [SecurityConnectionKind.Service]: translationKey("Services"),
  [SecurityConnectionKind.Monitor]: translationKey("Monitors"),
  [SecurityConnectionKind.User]: translationKey("Users"),
  [SecurityConnectionKind.InventoryItem]: translationKey("Inventory Items"),
};

export const CONNECTION_KIND_ICONS: Readonly<
  Record<SecurityConnectionKind, IconProp>
> = {
  [SecurityConnectionKind.Host]: IconProp.Server,
  [SecurityConnectionKind.DockerHost]: IconProp.Docker,
  [SecurityConnectionKind.PodmanHost]: IconProp.Podman,
  [SecurityConnectionKind.KubernetesCluster]: IconProp.Kubernetes,
  [SecurityConnectionKind.NetworkDevice]: IconProp.Signal,
  // As the explorers' resource facets draw them (ResourceFacetCatalog).
  [SecurityConnectionKind.CloudResource]: IconProp.Cloud,
  [SecurityConnectionKind.ServerlessFunction]: IconProp.Bolt,
  [SecurityConnectionKind.Service]: IconProp.Cube,
  // As the product switcher draws Monitors.
  [SecurityConnectionKind.Monitor]: IconProp.AltGlobe,
  [SecurityConnectionKind.User]: IconProp.User,
  [SecurityConnectionKind.InventoryItem]: IconProp.Cube,
};

/*
 * Why a value is (or may be) a record, under its name: {{value}} is what
 * the case or event named, {{matched}} what the record holds.
 */
export const CONNECTION_REASON_TEXT: Readonly<
  Record<SecurityConnectionReason, string>
> = {
  [SecurityConnectionReason.LogSource]: translationKey("Read from its logs."),
  [SecurityConnectionReason.HostName]: translationKey(
    "Named {{value}}, the name it reports.",
  ),
  [SecurityConnectionReason.ShortHostName]: translationKey(
    "Named {{value}}, a short or full form of its name {{matched}}. Another machine may share it.",
  ),
  [SecurityConnectionReason.UntypedValue]: translationKey(
    "Named {{value}} without saying it is a host. Something else may have that name.",
  ),
  [SecurityConnectionReason.ClusterName]: translationKey(
    "Named {{value}}, its cluster name.",
  ),
  [SecurityConnectionReason.DeviceName]: translationKey(
    "Named {{value}}, the device's name.",
  ),
  [SecurityConnectionReason.Address]: translationKey(
    "Named by {{value}}, a public address only it holds.",
  ),
  [SecurityConnectionReason.PrivateAddress]: translationKey(
    "Named by {{value}}, a private address it holds. Another network can give it to another machine.",
  ),
  [SecurityConnectionReason.SharedAddress]: translationKey(
    "Named by {{value}}, an address more than one of your records holds.",
  ),
  [SecurityConnectionReason.Email]: translationKey(
    "Named by {{value}}, their email.",
  ),
  [SecurityConnectionReason.ResourceId]: translationKey(
    "Named {{value}}, its cloud resource ID.",
  ),
  [SecurityConnectionReason.CloudEndpoint]: translationKey(
    "Named {{value}}, a name it answers on.",
  ),
  [SecurityConnectionReason.MonitorTarget]: translationKey(
    "Named {{value}}, the address it checks.",
  ),
};

/*
 * What a monitor is connected by, in a monitor's own words: it checks an
 * address rather than holding a name of its own. {{matched}} is the
 * address it checks.
 */
export const MONITOR_REASON_TEXT: Readonly<
  Partial<Record<SecurityConnectionReason, string>>
> = {
  [SecurityConnectionReason.ShortHostName]: translationKey(
    "Named {{value}}, a short or full form of {{matched}}, which it checks. Another machine may share it.",
  ),
  [SecurityConnectionReason.PrivateAddress]: translationKey(
    "Named by {{value}}, a private address it checks. Another network can give it to another machine.",
  ),
};

// A URL a monitor checks the host of: "Named https://shop.example/login, on shop.example, ...".
export const MONITOR_URL_REASON_TEXT: string = translationKey(
  "Named {{value}}, on {{matched}}, the address it checks.",
);

// ---------- The Security card on a record's page ----------

export const RESOURCE_SECURITY_TITLE: string = translationKey("Security");

export const RESOURCE_SECURITY_DESCRIPTION: string = translationKey(
  "What Security Events found about it in the last 7 days.",
);

export const RESOURCE_SECURITY_SERVICE_DESCRIPTION: string = translationKey(
  "What Security Events found in its logs in the last 7 days.",
);

export const RESOURCE_SECURITY_QUIET: string = translationKey(
  "No security event named it in the last 7 days.",
);

export const RESOURCE_SECURITY_SERVICE_QUIET: string = translationKey(
  "No security event was read from its logs in the last 7 days.",
);

// A monitor's: about what it checks, not about itself.
export const RESOURCE_SECURITY_MONITOR_DESCRIPTION: string = translationKey(
  "What Security Events found about what it checks in the last 7 days.",
);

export const RESOURCE_SECURITY_MONITOR_QUIET: string = translationKey(
  "No security event named what it checks in the last 7 days.",
);

export const RESOURCE_SECURITY_OPEN_CASES: string =
  translationKey("Open Cases");

export const RESOURCE_SECURITY_EVENTS: string = translationKey("Events");

export const RESOURCE_SECURITY_FINDINGS: string = translationKey("Findings");

export const RESOURCE_SECURITY_RISK: string = translationKey("Risk");

export const RESOURCE_SECURITY_LAST_SEEN: string =
  translationKey("Last seen {{when}}");

// Beside a record's findings, the worst of them: "4 [High]".
export const RESOURCE_SECURITY_HIGHEST_SEVERITY: string =
  translationKey("Highest severity");

export const RESOURCE_SECURITY_OPEN_IN_SECURITY: string = translationKey(
  "Open in Security Events",
);

export const RESOURCE_SECURITY_SEARCH_EVENTS: string =
  translationKey("Search Its Events");

export const RESOURCE_SECURITY_MORE_CASES: PluralTemplate = {
  one: "{{count}} more open case",
  other: "{{count}} more open cases",
};

// ---------- An incident's Security card ----------

export const INCIDENT_SECURITY_TITLE: string = translationKey("Security");

export const INCIDENT_SECURITY_DESCRIPTION: string = translationKey(
  "The security case behind this incident, and the open cases naming what it affects.",
);

export const INCIDENT_SECURITY_DECLARED_BY: string =
  translationKey("Declared from");

export const INCIDENT_SECURITY_NAMING: string = translationKey(
  "Open cases naming what it affects",
);

// "Names web-1 and prod-eu"
export const INCIDENT_SECURITY_NAMES: string = translationKey(
  "Names {{resources}}",
);

// ---------- Test ids ----------

export const SECURITY_CONNECTIONS_TEST_IDS: {
  connectedSignals: string;
  window: string;
  record: string;
  recordName: string;
  recordReason: string;
  possiblePill: string;
  signalLinks: string;
  facts: string;
  factLabel: string;
  factItem: string;
  possibleGroup: string;
  partialEmpty: string;
  incidents: string;
  alerts: string;
  monitors: string;
  changes: string;
  schedules: string;
  teams: string;
  onCallNow: string;
  monitorStatus: string;
  nothingActive: string;
  notFound: string;
  moreRecords: string;
  unreadable: string;
  failed: string;
  empty: string;
  nothingToLookUp: string;
  error: string;
  resourceSecurity: string;
  resourceSecurityQuiet: string;
  resourceSecurityCases: string;
  resourceSecurityCase: string;
  resourceSecurityOpen: string;
  resourceSecurityOpenLink: string;
  incidentSecurity: string;
  incidentSecurityDeclared: string;
  incidentSecurityNaming: string;
  telemetry: string;
  telemetryValue: string;
  telemetryValueName: string;
  telemetryLogs: string;
  telemetrySpans: string;
  telemetryPlace: string;
  telemetrySource: string;
  telemetryNotFound: string;
  telemetryUnreadable: string;
  telemetryFailed: string;
  telemetryMoreValues: string;
  telemetryError: string;
} = {
  connectedSignals: "security-connected-signals",
  window: "security-connected-window",
  record: "security-connected-record",
  recordName: "security-connected-record-name",
  recordReason: "security-connected-record-reason",
  possiblePill: "security-connected-possible",
  signalLinks: "security-connected-signal-links",
  facts: "security-connected-facts",
  factLabel: "security-connected-fact-label",
  factItem: "security-connected-fact-item",
  possibleGroup: "security-connected-possible-group",
  partialEmpty: "security-connected-partial-empty",
  incidents: "security-connected-incidents",
  alerts: "security-connected-alerts",
  monitors: "security-connected-monitors",
  changes: "security-connected-changes",
  schedules: "security-connected-schedules",
  teams: "security-connected-teams",
  onCallNow: "security-connected-on-call-now",
  monitorStatus: "security-connected-monitor-status",
  nothingActive: "security-connected-nothing-active",
  notFound: "security-connected-not-found",
  moreRecords: "security-connected-more-records",
  unreadable: "security-connected-unreadable",
  failed: "security-connected-failed",
  empty: "security-connected-empty",
  nothingToLookUp: "security-connected-nothing-to-look-up",
  error: "security-connected-error",
  resourceSecurity: "resource-security-card",
  resourceSecurityQuiet: "resource-security-quiet",
  resourceSecurityCases: "resource-security-cases",
  resourceSecurityCase: "resource-security-case",
  resourceSecurityOpen: "resource-security-open",
  resourceSecurityOpenLink: "resource-security-open-in-security-events",
  incidentSecurity: "incident-security-card",
  incidentSecurityDeclared: "incident-security-declared",
  incidentSecurityNaming: "incident-security-naming",
  telemetry: "security-telemetry-mentions",
  telemetryValue: "security-telemetry-value",
  telemetryValueName: "security-telemetry-value-name",
  telemetryLogs: "security-telemetry-logs",
  telemetrySpans: "security-telemetry-spans",
  telemetryPlace: "security-telemetry-place",
  telemetrySource: "security-telemetry-source",
  telemetryNotFound: "security-telemetry-not-found",
  telemetryUnreadable: "security-telemetry-unreadable",
  telemetryFailed: "security-telemetry-failed",
  telemetryMoreValues: "security-telemetry-more-values",
  telemetryError: "security-telemetry-error",
};
