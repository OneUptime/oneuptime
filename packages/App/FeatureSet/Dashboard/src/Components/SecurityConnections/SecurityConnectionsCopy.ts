import {
  SecurityConnectionKind,
  SecurityConnectionReason,
} from "Common/Types/SecurityCase/SecurityConnection";
import IconProp from "Common/Types/Icon/IconProp";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of Security Events' connections to the rest of OneUptime: a
 * case's Connected Signals, an event's Connected tab and an entity's
 * Connected Signals card (what they name, the other way), and the Security
 * card on a host's, a cluster's, a service's, a device's, a user's and an
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

export const CONNECTED_EMPTY_TITLE: string = translationKey(
  "Nothing it names is in OneUptime.",
);

export const CONNECTED_EMPTY_DESCRIPTION: string = translationKey(
  "OneUptime looked for its hosts, addresses and users among your hosts, clusters, devices, services and users, and found none of them.",
);

export const CONNECTED_NOTHING_TO_LOOK_UP_TITLE: string = translationKey(
  "It names no host, address or user to look for.",
);

export const CONNECTED_NOTHING_TO_LOOK_UP_DESCRIPTION: string = translationKey(
  "Only hosts, addresses and users with an email can be found in OneUptime.",
);

export const CONNECTED_NOT_FOUND_TITLE: string =
  translationKey("Not in OneUptime");

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

export const CONNECTED_POSSIBLE_PILL: string =
  translationKey("Possible match");

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

export const SIGNAL_LINK_ICONS: Readonly<Record<string, IconProp>> = {
  logs: IconProp.Logs,
  traces: IconProp.Workflow,
  metrics: IconProp.ChartBar,
  exceptions: IconProp.Bug,
  events: IconProp.List,
  topology: IconProp.Graph,
  inventory: IconProp.Cube,
};

export const SIGNAL_LINKS_ARIA_LABEL: string = translationKey(
  "Signals of {{name}} in this window",
);

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
  [SecurityConnectionKind.Service]: translationKey("Service"),
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
  [SecurityConnectionKind.Service]: translationKey("Services"),
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
  [SecurityConnectionKind.Service]: IconProp.Cube,
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
};

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

export const RESOURCE_SECURITY_OPEN_CASES: string =
  translationKey("Open Cases");

export const RESOURCE_SECURITY_EVENTS: string = translationKey("Events");

export const RESOURCE_SECURITY_FINDINGS: string = translationKey("Findings");

export const RESOURCE_SECURITY_RISK: string = translationKey("Risk");

export const RESOURCE_SECURITY_LAST_SEEN: string = translationKey(
  "Last seen {{when}}",
);

export const RESOURCE_SECURITY_IN_WINDOW: string =
  translationKey("In the last 7 days");

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

export const INCIDENT_SECURITY_DECLARED_BY: string = translationKey(
  "Declared from",
);

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
  incidents: string;
  alerts: string;
  monitors: string;
  changes: string;
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
  incidentSecurity: string;
  incidentSecurityDeclared: string;
  incidentSecurityNaming: string;
} = {
  connectedSignals: "security-connected-signals",
  window: "security-connected-window",
  record: "security-connected-record",
  recordName: "security-connected-record-name",
  recordReason: "security-connected-record-reason",
  possiblePill: "security-connected-possible",
  signalLinks: "security-connected-signal-links",
  facts: "security-connected-facts",
  incidents: "security-connected-incidents",
  alerts: "security-connected-alerts",
  monitors: "security-connected-monitors",
  changes: "security-connected-changes",
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
  incidentSecurity: "incident-security-card",
  incidentSecurityDeclared: "incident-security-declared",
  incidentSecurityNaming: "incident-security-naming",
};
