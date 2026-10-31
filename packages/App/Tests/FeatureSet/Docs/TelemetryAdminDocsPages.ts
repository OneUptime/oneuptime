/*
 * The four pages docs overhaul task 38 added to the Telemetry group -
 * Ingestion Keys, Topology, Drop Filters & Scrub Rules and Data Retention -
 * by the paths their suites name them with, where each sits in the nav, and
 * the words a translation keeps as written or words freely.
 *
 * TelemetryAdminDocsFacts holds the English pages to the Dashboard, the
 * models, the server and the ingest code; TelemetryAdminDocsTranslations
 * holds every translation to its English page. They read the lists from
 * here, never from each other: importing a .test.ts file runs its tests.
 */

export interface TelemetryAdminDocsPageEntry {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
  // The nav group it is listed in, and the links right before and after it.
  navGroup: string;
  after: string;
  before: string;
}

export const INGESTION_KEYS: string = "telemetry/ingestion-keys";
export const TOPOLOGY: string = "telemetry/topology";
export const DROP_FILTERS_AND_SCRUB_RULES: string =
  "telemetry/drop-filters-and-scrub-rules";
export const DATA_RETENTION: string = "telemetry/data-retention";

/*
 * Where a reader meets each page in the Telemetry group:
 *
 *   - Ingestion Keys right after OpenTelemetry, whose quickstart creates a
 *     key, and before the Service Catalog the key's data is filed in;
 *   - Topology after the explorers (Exception Tracking), as one more way of
 *     looking at the same telemetry, before the reference pages they share
 *     (Search Syntax);
 *   - Drop Filters & Scrub Rules after Log Pipelines, the other rules that
 *     act as telemetry arrives, then Data Retention: what happens to the
 *     telemetry that is kept.
 */
export const TELEMETRY_ADMIN_PAGES: ReadonlyArray<TelemetryAdminDocsPageEntry> =
  [
    {
      page: INGESTION_KEYS,
      navTitle: "Ingestion Keys",
      navGroup: "Telemetry",
      after: "OpenTelemetry",
      before: "Service Catalog",
    },
    {
      page: TOPOLOGY,
      navTitle: "Topology",
      navGroup: "Telemetry",
      after: "Exception Tracking",
      before: "Search Syntax",
    },
    {
      page: DROP_FILTERS_AND_SCRUB_RULES,
      navTitle: "Drop Filters & Scrub Rules",
      navGroup: "Telemetry",
      after: "Log Pipelines",
      before: "Data Retention",
    },
    {
      page: DATA_RETENTION,
      navTitle: "Data Retention",
      navGroup: "Telemetry",
      after: "Drop Filters & Scrub Rules",
      before: "Continuous Profiling",
    },
  ];

/*
 * Bold words every language writes as the English does, by page: labels
 * the Dashboard draws in English in every language, because no locale has
 * a wording for them (TelemetryAdminDocsFacts holds that they are still not
 * keys of the Dashboard's English locale, and that the Dashboard draws
 * them).
 */
export const KEPT_AS_WRITTEN: Readonly<Record<string, ReadonlyArray<string>>> =
  {
    // The Topology page's first tab, and the statuses the service map draws.
    [TOPOLOGY]: [
      "Service Map",
      "Some errors",
      "High error rate",
      "Entry point",
      "No calls observed",
    ],
    // The Enterprise Edition's retention-by-type form.
    [DATA_RETENTION]: [
      "Edit Overrides",
      "Logs default (days)",
      "Traces default (days)",
      "Metrics default (days)",
      "Profiles default (days)",
    ],
  };

/*
 * Bold labels of the Admin Dashboard, which has a locale of its own: a page
 * in each language names them as that language's Admin Dashboard draws them
 * (DocsAdminDashboard.adminDashboardLabel).
 */
export const ADMIN_DASHBOARD_LABELS: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  [DATA_RETENTION]: [
    "Monitor Log Retention (Days)",
    "Monitor Metric Retention (Days)",
  ],
};

/*
 * Bold words that are a list item's lead, not a label of the Dashboard: a
 * translation words them freely.
 */
export const PROSE: Readonly<Record<string, ReadonlyArray<string>>> = {
  [INGESTION_KEYS]: [
    "The key decides the project.",
    "Changes reach every server within a minute.",
    "A Server key is a password.",
    "A role that manages ingestion keys.",
    "On OneUptime Cloud, a payment method.",
  ],
  [TOPOLOGY]: [
    "Only what was active is drawn.",
    "Calls are counted over a recent window.",
    "The network view is live.",
    "Telemetry arriving.",
    "A role that reads telemetry.",
    "Browse it your way.",
    "Find a resource.",
    "Move between views.",
    // Open a resource's own map.
    "Read it as a tree.",
    "Find what needs attention.",
    "Look closer.",
    "Go both ways.",
  ],
  [DROP_FILTERS_AND_SCRUB_RULES]: [
    "They act on new records only.",
    "A dropped record is gone.",
    "Each list runs in order.",
    "Logs or spans arriving.",
    "A role that changes telemetry settings.",
    "Exceptions come from the scrubbed record.",
    "Session replays are scrubbed too.",
    "Rules run in the order of the list.",
    "A custom pattern takes time in line with the record.",
  ],
  [DATA_RETENTION]: [
    "Settings 1 to 5 are retention overrides.",
    "A change applies to new telemetry.",
    "Exceptions follow what they were found in.",
    "A role that changes the project.",
    "For overrides, the Enterprise Edition or the Scale plan.",
    "On a self-hosted installation",
    "On OneUptime Cloud",
    "When you self-host",
  ],
};

/*
 * The kind of diagram each page draws. The decision flows read top to
 * bottom, to fit the docs column; Topology's three short chains (where each
 * view's data comes from, and the view) read left to right, one under the
 * other.
 */
export const DIAGRAM_KINDS: Readonly<Record<string, string>> = {
  [INGESTION_KEYS]: "flowchart TB",
  [TOPOLOGY]: "flowchart LR",
  [DROP_FILTERS_AND_SCRUB_RULES]: "flowchart TB",
  [DATA_RETENTION]: "flowchart TB",
};

/*
 * Names a translation writes as the English does, in prose and tables too:
 * products, tools, protocols and formats. A line made of them alone is not
 * a line left untranslated.
 */
export const PRODUCT_NAMES: ReadonlyArray<string> = [
  "OneUptime Cloud",
  "OneUptime",
  "OpenTelemetry",
  "Admin Dashboard",
  "Enterprise Edition",
  "ClickHouse",
  "Fluent Bit",
  "Fluentd",
  "Kubernetes",
  "Docker Swarm",
  "Docker",
  "Podman",
  "Proxmox",
  "Ceph",
  "React Native",
  "Cisco",
  "OTLP/HTTP",
  "OTLP/gRPC",
  "gRPC",
  "MQTT",
  "LLDP",
  "CDP",
  "eBPF",
  "SHA-256",
  "IPv4",
  "RUM",
  "SSN",
  "JSON",
];

/*
 * The roles the Topology page's "A role that reads telemetry." names, in
 * the order the page lists them, before the permission a custom role needs.
 * TelemetryAdminDocsFacts holds them to the inventory's read permissions,
 * which the Topology API checks.
 */
export const TOPOLOGY_READ_ROLES: ReadonlyArray<string> = [
  "Project Owner",
  "Project Admin",
  "Project Member",
  "Viewer",
  "Telemetry Admin",
  "Telemetry Member",
  "Telemetry Viewer",
];
