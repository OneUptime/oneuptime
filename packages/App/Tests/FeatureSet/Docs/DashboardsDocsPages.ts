/*
 * The Dashboards pages of the docs, by the paths their suites name them
 * with, and the words they keep as the product writes them.
 *
 * Docs overhaul task 26a rewrote these pages and added External Data
 * Sources: DashboardsDocsFacts holds the English pages to the product, and
 * DashboardsDocsTranslations holds every translation to its English page.
 * Both read the page list and the kept words from here, never from each
 * other: importing a .test.ts file runs its tests.
 */

export interface DashboardsDocsPageEntry {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
}

export const DASHBOARDS_INDEX: string = "dashboards/index";
export const AUTHORING: string = "dashboards/authoring";
export const WIDGETS: string = "dashboards/widgets";
export const VARIABLES: string = "dashboards/variables";
export const DATA_SOURCES: string = "dashboards/data-sources";
export const SHARING: string = "dashboards/sharing";
export const CONFIGURATION: string = "dashboards/configuration";

// The Dashboards nav group, in nav order.
export const DASHBOARDS_PAGES: ReadonlyArray<DashboardsDocsPageEntry> = [
  { page: DASHBOARDS_INDEX, navTitle: "Dashboards Overview" },
  { page: AUTHORING, navTitle: "Authoring a Dashboard" },
  { page: WIDGETS, navTitle: "Dashboard Widgets" },
  { page: VARIABLES, navTitle: "Dashboard Variables & Filters" },
  { page: DATA_SOURCES, navTitle: "External Data Sources" },
  { page: SHARING, navTitle: "Sharing & Public Dashboards" },
  { page: CONFIGURATION, navTitle: "Dashboard Configuration & Permissions" },
];

/*
 * A table's create button, drawn as translateCreateAction draws it
 * (drawnCreateButton): the Dashboards list's, the Data Sources table's and
 * the Custom Domains table's. The create dialog's submit button reads the
 * same.
 */
export const CREATE_BUTTONS: Readonly<Record<string, ReadonlyArray<string>>> = {
  [DASHBOARDS_INDEX]: ["Create Dashboard"],
  [AUTHORING]: ["Create Dashboard"],
  [DATA_SOURCES]: ["Create Data Source"],
  [SHARING]: ["Create Dashboard Domain"],
};

/*
 * Labels drawn by a menu item, which looks its whole text up and draws what
 * the locale holds (translateString in MoreMenuItem): the dashboard's ⋯ menu
 * item Edit Dashboard and the Dashboards list's Export JSON bulk action.
 * Where a locale still holds the English, the screen reads the English; no
 * "Edit {{itemName}}" template is filled in, as it is for the Settings
 * page's Duplicate Dashboard and Export Dashboard cards (translateNamedAction).
 */
export const MENU_ITEM_LABELS: ReadonlyArray<string> = [
  "Edit Dashboard",
  "Export JSON",
];

/*
 * The categories of Create a dashboard's template picker, in its category
 * select's order: the authoring page's table files the templates under them.
 * The old Create from Template dialog drew them as headings with no
 * translation lookup, so in English everywhere; the category select looks
 * them up, so every language names them as its Dashboard draws them. (Its
 * Get Started group held only Blank Dashboard, which is now the picker's
 * Start from scratch, a label of its own.)
 */
export const TEMPLATE_CATEGORIES: ReadonlyArray<string> = [
  "Monitoring & APM",
  "Incident Response",
  "Infrastructure",
];

/*
 * A permission's name, as the team and API key permission pickers list it
 * (Permission.ts's title, which no locale translates), so every page keeps
 * it as written although it reads like a button.
 */
export const PERMISSION_NAMES: Readonly<Record<string, ReadonlyArray<string>>> =
  {
    [SHARING]: ["Edit Dashboard Domain", "Read Dashboard Domain"],
  };

/*
 * Bold names every language's Dashboard draws in English, so every page
 * keeps them as written:
 *
 *   - the toolbar's ⋯ menu, a symbol in every language;
 *   - widget settings and options with no locale key, which the settings
 *     form and its dropdowns draw as the widget's code writes them;
 *   - the public dashboard's Access Denied page, an app with no locale.
 */
export const KEPT_AS_WRITTEN: Readonly<Record<string, ReadonlyArray<string>>> =
  {
    [DASHBOARDS_INDEX]: ["⋯"],
    [AUTHORING]: ["⋯"],
    [WIDGETS]: [
      "Chart Type",
      "Additional Queries",
      "Trend Direction",
      "Metrics & Columns",
      "Reduce across time",
      "Run JavaScript",
      "Open links in a new tab",
      "Allow forms to submit",
      "Tile",
    ],
    [VARIABLES]: [],
    [DATA_SOURCES]: ["Reduce"],
    [SHARING]: ["Access Denied"],
  };

/*
 * Bold words that are emphasis or a lead-in, not a Dashboard label: a
 * translation words them freely, even where the Dashboard happens to have
 * the same English word as a label ("Create", "Save", "Investigating").
 */
export const PROSE: Readonly<Record<string, ReadonlyArray<string>>> = {
  [DASHBOARDS_INDEX]: [
    'An "is everything OK?" page',
    "Seeing connections",
    "Investigating",
    "Sharing outside the team",
    "Create",
    "Add widgets",
    "Add variables, if you need them",
    "Save",
    "(Optional) Share publicly",
    "Monitors and telemetry",
    "Incidents and alerts",
    "Status pages",
    "Workflows",
  ],
  [AUTHORING]: [
    "whole dashboard",
    "Double-click any chart",
    "One topic per dashboard.",
    "Put the most important widget at the top.",
    "Name the sections with Text widgets.",
    "Use variables instead of copies.",
    "Copy before a big change.",
  ],
  [VARIABLES]: ["Any variable"],
  [DATA_SOURCES]: [
    "A plan that includes it.",
    "A permission to add them.",
    "A read-only account.",
    "A way in.",
    "Charts, values and gauges need time series.",
    "Tables show rows",
    "SQL stays read-only.",
    "Credentials are write-only.",
    "Addresses are checked.",
    "Public dashboards never run them.",
  ],
  [SHARING]: [
    "Add the domain",
    "Add its CNAME record",
    "The free SSL certificate is issued automatically",
    "The record is not found yet.",
    "The record is found.",
  ],
  [CONFIGURATION]: ["owners", "By team", "By environment", "By purpose"],
};

/*
 * Tab labels that are a system's name, kept as written so a reader's pick
 * follows them from page to page.
 */
export const NAME_TABS: ReadonlyArray<string> = [
  "Prometheus",
  "SQL",
  "Loki",
  "Elasticsearch",
  "REST API",
];

/*
 * Names a translation writes as the English does, in prose and tables too:
 * products, systems, the templates (catalog content, written in English in
 * every language's picker), and the query languages. A line made of them
 * alone is not a line left untranslated.
 */
export const PRODUCT_NAMES: ReadonlyArray<string> = [
  "OneUptime",
  "OpenTelemetry",
  "Prometheus",
  "Thanos",
  "Cortex",
  "Mimir",
  "VictoriaMetrics",
  "PostgreSQL",
  "TimescaleDB",
  "CockroachDB",
  "MySQL",
  "MariaDB",
  "Microsoft SQL Server",
  "SQL Server",
  "Azure SQL",
  "ClickHouse",
  "Grafana Loki",
  "Loki",
  "Elasticsearch",
  "OpenSearch",
  "Kubernetes",
  "Docker Swarm",
  "Docker",
  "Podman",
  "Proxmox",
  "VMware",
  "Ceph",
  "Query DSL",
  "PromQL",
  "LogQL",
  "T-SQL",
  "Let's Encrypt",
  "Monitor Dashboard",
  "Metrics Dashboard",
  "Real User Monitoring Dashboard",
  "SLO Dashboard",
  "Incident Dashboard",
  "Alert Dashboard",
  "Kubernetes Cost Dashboard",
  "Kubernetes Dashboard",
  "Hosts Dashboard",
  "Proxmox Dashboard",
  "VMware Dashboard",
  "Ceph Dashboard",
  "Storage Array Dashboard",
  "Docker Swarm Dashboard",
  "Network Dashboard",
];
