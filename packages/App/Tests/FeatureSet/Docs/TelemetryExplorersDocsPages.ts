/*
 * The five pages docs overhaul task 37 added to the Telemetry group - the
 * Service Catalog and the Logs, Traces, Metrics and Exceptions explorers -
 * by the paths their suites name them with, where each sits in the nav, and
 * the words a translation keeps as written or words freely.
 *
 * TelemetryExplorersDocsFacts holds the English pages to the Dashboard, the
 * models, the server and the ingest code; TelemetryExplorersDocsTranslations
 * holds every translation to its English page. They read the lists from
 * here, never from each other: importing a .test.ts file runs its tests.
 */

export interface TelemetryExplorersDocsPageEntry {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
  // The nav group it is listed in, and the link right before it there.
  navGroup: string;
  after: string;
}

export const SERVICES: string = "telemetry/services";
export const LOGS_EXPLORER: string = "telemetry/logs-explorer";
export const TRACES_EXPLORER: string = "telemetry/traces-explorer";
export const METRICS_EXPLORER: string = "telemetry/metrics-explorer";
export const EXCEPTIONS: string = "telemetry/exceptions";

/*
 * The pages in the order a reader meets them, right after OpenTelemetry and
 * the Ingestion Keys page its quickstart sends readers to: the services
 * telemetry is filed under, then the four explorers, then Topology (docs
 * task 38: TelemetryAdminDocsPages), and only then the reference pages they
 * share (Search Syntax, then Zooming Into a Time Range, which
 * ChartTimeRangeZoomDocs keeps right after it).
 */
export const TELEMETRY_EXPLORERS_PAGES: ReadonlyArray<TelemetryExplorersDocsPageEntry> =
  [
    {
      page: SERVICES,
      navTitle: "Service Catalog",
      navGroup: "Telemetry",
      after: "Ingestion Keys",
    },
    {
      page: LOGS_EXPLORER,
      navTitle: "Logs Explorer",
      navGroup: "Telemetry",
      after: "Service Catalog",
    },
    {
      page: TRACES_EXPLORER,
      navTitle: "Traces Explorer",
      navGroup: "Telemetry",
      after: "Logs Explorer",
    },
    {
      page: METRICS_EXPLORER,
      navTitle: "Metrics Explorer",
      navGroup: "Telemetry",
      after: "Traces Explorer",
    },
    {
      page: EXCEPTIONS,
      navTitle: "Exception Tracking",
      navGroup: "Telemetry",
      after: "Metrics Explorer",
    },
  ];

/*
 * The page right after the last explorer in the Telemetry group: Topology,
 * one more way of looking at the same telemetry (docs task 38).
 */
export const FIRST_PAGE_AFTER_THE_EXPLORERS: string = "Topology";

// The reference pages the explorers share start right after it.
export const FIRST_REFERENCE_PAGE: string = "Search Syntax";

/*
 * Bold words every language writes as the English does, by page: buttons
 * and filter values the Dashboard draws in English in every language,
 * because no locale has a wording for them (TelemetryExplorersDocsFacts
 * holds that they are still not keys of the Dashboard's English locale).
 * The trace page's Critical path and Errors only left this list when the
 * trace view started drawing them in the reader's language: every
 * translation names them as its Dashboard draws them.
 */
export const KEPT_AS_WRITTEN: Readonly<Record<string, ReadonlyArray<string>>> =
  {
    [TRACES_EXPLORER]: [
      "Entry spans",
      "Root spans",
      "All spans",
      "See full trace",
    ],
  };

/*
 * Bold words that are a list item's lead, not a label of the Dashboard: a
 * translation words them freely.
 */
export const PROSE: Readonly<Record<string, ReadonlyArray<string>>> = {
  [SERVICES]: [
    "The name is the service's identity.",
    "Containers name themselves.",
    "An ingestion key can name the service.",
    "Browsers and phones are not services.",
    "Labels can come with the telemetry.",
    "Telemetry arriving",
    "A role that reads services.",
  ],
  [LOGS_EXPLORER]: ["Logs arriving.", "A role that reads telemetry."],
  [TRACES_EXPLORER]: ["Traces arriving.", "A role that reads telemetry."],
  [METRICS_EXPLORER]: ["Metrics arriving.", "A role that reads telemetry."],
  [EXCEPTIONS]: [
    "One exception per service and error.",
    "A new occurrence reopens a resolved exception.",
    "An archived exception stays archived.",
    "Spans or logs arriving.",
    "A role that reads telemetry.",
  ],
};

// Every diagram on these pages reads top to bottom, to fit the docs column.
export const DIAGRAM_KINDS: Readonly<Record<string, string>> = {
  [SERVICES]: "flowchart TB",
  [LOGS_EXPLORER]: "flowchart TB",
  [TRACES_EXPLORER]: "flowchart TB",
  [METRICS_EXPLORER]: "flowchart TB",
  [EXCEPTIONS]: "flowchart TB",
};

/*
 * Names a translation writes as the English does, in prose and tables too:
 * products, tools, formats and services. A line made of them alone is not
 * a line left untranslated.
 */
export const PRODUCT_NAMES: ReadonlyArray<string> = [
  "OneUptime Cloud",
  "OneUptime AI",
  "OneUptime",
  "OpenTelemetry",
  "Fluent Bit",
  "Fluentd",
  "Syslog",
  "GitHub App",
  "GitHub",
  "Enterprise Edition",
  "Docker",
  "Podman",
  "Kubernetes",
  "JSON",
  "CSV",
  "LLM",
  "Ctrl",
  "Enter",
  "Esc",
];

/*
 * The roles every explorer's "A role that reads telemetry." names, in the
 * order the pages list them; each page adds its signal's own permission.
 * TelemetryExplorersDocsFacts holds them to the models' read permissions.
 */
export const TELEMETRY_READ_ROLES: ReadonlyArray<string> = [
  "Project Owner",
  "Project Admin",
  "Project Member",
  "Viewer",
  "Telemetry Admin",
  "Telemetry Member",
  "Telemetry Viewer",
];

/*
 * The rule types of Metrics → Settings → Pipeline Rules, in the order the
 * Metrics Explorer page's table lists them: the titles of the create form's
 * rule type cards. TelemetryExplorersDocsFacts holds them to the page's
 * source; every translation names them as its Dashboard draws them.
 */
export const METRIC_PIPELINE_RULE_TYPES: ReadonlyArray<string> = [
  "Filter (allowlist)",
  "Drop",
  "Rename Metric",
  "Rename Attribute",
  "Add Attribute",
  "Remove Attribute",
  "Redact Attribute",
  "Sample",
];

// The read permission each explorer page names, by page.
export const SIGNAL_READ_PERMISSION_TITLES: Readonly<Record<string, string>> = {
  [LOGS_EXPLORER]: "Read Telemetry Service Log",
  [TRACES_EXPLORER]: "Read Telemetry Service Traces",
  [METRICS_EXPLORER]: "Read Telemetry Service Metrics",
  [EXCEPTIONS]: "Read Telemetry Service Exception",
};
