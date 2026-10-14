/*
 * The integration pages docs overhaul tasks 28a and 28b rewrote, by the
 * paths their suites name them with, and the words they keep as the
 * products write them.
 *
 * IntegrationsDocsFacts holds the English pages to the product, and
 * IntegrationsDocsTranslations holds every translation to its English page.
 * They read the page list and the kept words from here, never from each
 * other: importing a .test.ts file runs its tests.
 */

export interface IntegrationsDocsPageEntry {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
}

export const OVERVIEW: string = "integrations/index";
export const ZABBIX: string = "integrations/zabbix";
export const JIRA: string = "integrations/jira";
export const PAGERDUTY: string = "integrations/pagerduty";
export const OPSGENIE: string = "integrations/opsgenie";
export const SERVICENOW: string = "integrations/servicenow";
export const DYNAMICS: string = "integrations/microsoft-dynamics-365";

// Task 28b: the alerting tools that send OneUptime a webhook.
export const ALERTMANAGER: string = "integrations/prometheus-alertmanager";
export const GRAFANA: string = "integrations/grafana";
export const DATADOG: string = "integrations/datadog";

// Task 28b: the Security Events connections.
export const GOOGLE_SECOPS: string = "integrations/google-secops";
export const SENTINEL: string = "integrations/microsoft-sentinel";
export const DEFENDER: string = "integrations/microsoft-defender-xdr";
export const CROWDSTRIKE: string = "integrations/crowdstrike-falcon";

/*
 * The pages these tasks rewrote, in nav order: task 28a's are the first
 * seven links of the Integrations group, and task 28b's follow, with
 * Huntress, which has suites of its own, between Datadog and Google SecOps.
 */
export const INTEGRATIONS_PAGES: ReadonlyArray<IntegrationsDocsPageEntry> = [
  { page: OVERVIEW, navTitle: "Integrations Overview" },
  { page: ZABBIX, navTitle: "Zabbix" },
  { page: JIRA, navTitle: "Jira" },
  { page: PAGERDUTY, navTitle: "PagerDuty" },
  { page: OPSGENIE, navTitle: "Opsgenie" },
  { page: SERVICENOW, navTitle: "ServiceNow" },
  { page: DYNAMICS, navTitle: "Microsoft Dynamics 365" },
  { page: ALERTMANAGER, navTitle: "Prometheus Alertmanager" },
  { page: GRAFANA, navTitle: "Grafana" },
  { page: DATADOG, navTitle: "Datadog" },
  { page: GOOGLE_SECOPS, navTitle: "Google SecOps" },
  { page: SENTINEL, navTitle: "Microsoft Sentinel" },
  { page: DEFENDER, navTitle: "Microsoft Defender XDR" },
  { page: CROWDSTRIKE, navTitle: "CrowdStrike Falcon" },
];

// How many of the Integrations nav group's first links are task 28a's pages.
export const FIRST_TASK_PAGE_COUNT: number = 7;

// The alerting tools' pages: an Incoming Request monitor, or a workflow.
export const ALERTING_PAGES: ReadonlyArray<string> = [
  ALERTMANAGER,
  GRAFANA,
  DATADOG,
];

// The Security Events connections' pages.
export const SECURITY_CONNECTION_PAGES: ReadonlyArray<string> = [
  GOOGLE_SECOPS,
  SENTINEL,
  DEFENDER,
  CROWDSTRIKE,
];

/*
 * What a workflow step defines itself, named on the page: a step's title,
 * its settings, its outputs and the values it returns, and the comparisons
 * an If / Else block offers. The canvas draws them as the step names them,
 * and the workflow pages keep them in English in every language
 * (WorkflowDocsTranslations), so these pages do too. The facts suite holds
 * each to the step catalog.
 */
const OUTBOUND_STEPS: ReadonlyArray<string> = [
  "On Create Incident",
  "Fields to pass on",
  "API Post (JSON)",
  "Success",
  "URL",
  "Request Body",
  "On Update Incident",
  "Fields to watch",
  "If / Else",
  "Value to check",
  "Comparison",
  "is true",
  "Yes",
];

/*
 * The steps of the workflow an alerting tool's page builds: a Webhook
 * trigger, an If / Else block and a Create One Incident block.
 */
const INBOUND_WORKFLOW_STEPS: ReadonlyArray<string> = [
  "Webhook",
  "Out",
  "If / Else",
  "Value to check",
  "Comparison",
  "is equal to",
  "Compare with",
  "Create One Incident",
  "Yes",
  "Incident Template",
  "JSON Object",
  "No",
];

export const STEP_NAMES: Readonly<Record<string, ReadonlyArray<string>>> = {
  [OVERVIEW]: [
    "Webhook",
    "If / Else",
    "Create One Incident",
    "On Create Incident",
    "Fields to pass on",
    "API Post (JSON)",
    "Success",
    "URL",
    "Request Headers",
    "Request Body",
  ],
  [ZABBIX]: [
    "Webhook",
    "Out",
    "If / Else",
    "Value to check",
    "Comparison",
    "is equal to",
    "Compare with",
    "Create One Incident",
    "Yes",
    "Incident Template",
    "JSON Object",
    "No",
  ],
  [PAGERDUTY]: [
    ...OUTBOUND_STEPS,
    "Run Custom JavaScript",
    "Arguments",
    "JavaScript Code",
    "No",
  ],
  [OPSGENIE]: [
    ...OUTBOUND_STEPS,
    "Request Headers",
    "Run Custom JavaScript",
    "Arguments",
    "JavaScript Code",
    "No",
  ],
  [SERVICENOW]: [
    ...OUTBOUND_STEPS,
    "Request Headers",
    "API Get (JSON)",
    "API Patch (JSON)",
  ],
  [JIRA]: [
    "If / Else",
    "Value to check",
    "Comparison",
    "is equal to",
    "Compare with",
    "Success",
    "Yes",
    "No",
    "Webhook",
    "Log",
    "JavaScript Code",
    "Run Custom JavaScript",
    "Request Body",
    "On Create Incident",
    "Fields to pass on",
    "API Post (JSON)",
    "URL",
    "Request Headers",
    "On Update Incident",
    "Fields to watch",
    "API Get (JSON)",
    "Update One Incident",
    "Query",
    "Data (JSON Object)",
    "Find One Incident State",
    "On Create Alert",
    "On Update Alert",
    "On Create Incident Internal Note",
    "On Create Alert Internal Note",
    "On Create Incident Public Note",
    "Find One Alert State",
    "Update One Alert",
    "Manual",
    "Execute Workflow",
    "Sleep",
  ],
  [DYNAMICS]: [
    "If / Else",
    "Yes",
    "JavaScript Code",
    "Run Custom JavaScript",
    "Webhook",
    "Log",
    "On Create Incident",
    "Fields to pass on",
    "API Post (JSON)",
    "Success",
    "URL",
    "Request Headers",
    "Request Body",
    "On Update Incident",
    "Fields to watch",
    "Value to check",
    "Comparison",
    "is true",
    "API Get (JSON)",
    "API Patch (JSON)",
    "is equal to",
    "Compare with",
    "Update One Incident",
    "Query",
    "Data (JSON Object)",
    "Find One Incident State",
    "On Create Alert",
    "On Update Alert",
    "Find One Alert State",
    "Update One Alert",
    "Manual",
    "Execute Workflow",
    "Sleep",
  ],
  [ALERTMANAGER]: INBOUND_WORKFLOW_STEPS,
  [GRAFANA]: INBOUND_WORKFLOW_STEPS,
  [DATADOG]: INBOUND_WORKFLOW_STEPS,
};

/*
 * The names of the Jira and Dynamics 365 templates, and the settings their
 * create wizard asks for, as the picker and the wizard show them. The
 * Dashboard shows them in English in every language, so the pages keep
 * them as written. The facts suite holds each to the templates.
 */
export const TEMPLATE_NAMES: Readonly<Record<string, ReadonlyArray<string>>> = {
  [JIRA]: [
    "Create an alert when a Jira issue is created",
    "Create a Jira issue when an alert is created",
    "Jira Site URL",
    "Jira API URL",
    "Jira API Token (base64 of email:token)",
    "Jira Project Key",
    "Jira Issue Type",
    "OneUptime URL",
    "Create a Jira issue when an incident is declared",
    "Declare an incident when a Jira issue is created",
    "Move the Jira issue when the incident is acknowledged or resolved",
  ],
  [DYNAMICS]: [
    "Create an alert when a Dynamics 365 case is created",
    "Create a Dynamics 365 case when an alert is created",
    "Dynamics 365 Environment URL",
    "Directory (Tenant) ID",
    "Application (Client) ID",
    "Client Secret Value",
    "Case Link Column",
    "Customer for New Cases",
    "OneUptime URL",
    "Create a Dynamics 365 case when an incident is declared",
    "Declare an incident when a Dynamics 365 case is created",
  ],
};

/*
 * What another product draws, named on the page: the screens, buttons,
 * fields and events of Zabbix, Jira, PagerDuty, Opsgenie, ServiceNow,
 * Microsoft Entra ID, the Power Platform, Power Automate and the Plug-in
 * Registration Tool. Every language keeps them as written: those products
 * draw them in English for most readers, and a reader looks for them as
 * written. Some are a Dashboard label too ("Add", "Settings → Integrations"),
 * which is why they are listed rather than drawn.
 */
export const OTHER_NAMES: Readonly<Record<string, ReadonlyArray<string>>> = {
  [ZABBIX]: [
    "OneUptime",
    "Alerts → Media types",
    "Administration → Media types",
    "Create media type",
    "Name",
    "Type",
    "Parameters",
    "Script",
    "Message templates",
    "Problem",
    "Problem recovery",
    "Add",
    "Users → Users",
    "Administration → Users",
    "Create user",
    "User role",
    "Media",
    "Send to",
    "When active",
    "Alerts → Actions → Trigger actions",
    "Configuration → Actions",
    "Create action",
    "Conditions",
    "Trigger severity is greater than or equals Warning",
    "Operations",
    "Recovery operations",
    "Test",
    "Reports → Action log",
  ],
  [PAGERDUTY]: [
    "Integrations",
    "Add an integration",
    "Events API V2",
    "Integration Key",
  ],
  [OPSGENIE]: ["API", "API Key", "Settings → Integrations", "Integrations"],
  [SERVICENOW]: ["System Definition → Tables"],
  [JIRA]: [
    "Browse Projects",
    "Create Issues",
    "Edit Issues",
    "Add Comments",
    "Transition Issues",
    "Issue created",
    "Issue updated",
    "Comment created",
    "Create API token",
    "Create API token with scopes",
    "Directory → Service accounts",
    "Settings → System → WebHooks",
    "Advanced",
    "Create a WebHook",
    "Issue related events",
    "Exclude body",
    "Comment updated",
    "Space settings → Automation",
    "Project settings → Automation",
    "Settings → System → Global automation",
    "Work item transitioned",
    "Issue transitioned",
    "Done",
    "Work item updated",
    "Send web request",
    "Web request URL",
    "HTTP method",
    "Custom data",
    "Hide",
    "Profile → Personal access tokens → Create token",
    "Send outgoing web request",
    "Administration → System → General configuration",
  ],
  [DYNAMICS]: [
    "Case",
    "Microsoft Entra ID",
    "App registrations → New registration",
    "Supported account types",
    "Accounts in this organizational directory only",
    "Register",
    "Overview",
    "Application (client) ID",
    "Directory (tenant) ID",
    "Certificates & secrets → Client secrets → New client secret",
    "Value",
    "Manage → Environments",
    "Settings → Users + permissions → Application users",
    "+ New app user",
    "+ Add an app",
    "Add",
    "Business unit",
    "Security roles",
    "Note",
    "Activity",
    "Account",
    "Contact",
    "Save",
    "Create",
    "Tables → Case → Columns",
    "New column",
    "Data type",
    "Single line of text",
    "Logical name",
    "Problem Solved",
    "Environments",
    "Environment URL",
    "Certificates & secrets",
    "Secret ID",
    "Automated cloud flow",
    "Microsoft Dataverse",
    "When a row is added, modified or deleted",
    "Scope",
    "Organization",
    "HTTP",
    "Method",
    "URI",
    "Filter rows",
    "Register New WebHook",
    "HttpHeader",
    "Event Pipeline Stage of Execution",
    "PostOperation",
    "Execution Mode",
    "Asynchronous",
    "Close",
    "Update",
    "Change type",
    "Table name",
    "Select columns",
    "Get a row by ID",
    "Filtering Attributes",
  ],
  // Grafana's screens and fields: its contact point and notification policies.
  [GRAFANA]: [
    "Alerting → Contact points",
    "+ Add contact point",
    "Alerting",
    "Alerts & IRM",
    "Contact points",
    "Notification configuration",
    "Integration",
    "URL",
    "HTTP Method",
    "Save contact point",
    "Alerting → Notification policies",
    "Max Alerts",
    "Test",
  ],
  // Datadog's monitor states, and the fields of its Webhooks integration.
  [DATADOG]: [
    "Warn",
    "No Data",
    "Name",
    "URL",
    "Payload",
    "Test Notifications",
    "Alert",
  ],
  // A SOAR playbook's HTTP request action, Google Cloud and SecOps.
  [GOOGLE_SECOPS]: [
    "HTTP request",
    "Method",
    "URL",
    "Body",
    "Chronicle API Viewer",
    "Keys",
    "JSON",
    "SIEM Settings → Profile",
  ],
  // The Azure portal and Microsoft Entra ID.
  [SENTINEL]: [
    "Microsoft Entra ID",
    "App registrations → New registration",
    "Supported account types",
    "Accounts in this organizational directory only",
    "Register",
    "Overview",
    "Certificates & secrets → Client secrets → New client secret",
    "Add",
    "Value",
    "Secret ID",
    "Access control (IAM) → Add → Add role assignment",
    "Role",
    "Microsoft Sentinel Reader",
    "Members",
    "User, group, or service principal",
    "Select members",
    "Review + assign",
  ],
  [DEFENDER]: [
    "Microsoft Entra ID",
    "App registrations → New registration",
    "Supported account types",
    "Accounts in this organizational directory only",
    "Register",
    "Overview",
    "API permissions → Add a permission → Microsoft Graph → Application permissions",
    "Add permissions",
    "Grant admin consent for",
    "Granted",
    "Certificates & secrets → Client secrets → New client secret",
    "Add",
    "Value",
    "Secret ID",
    "Certificates & secrets",
  ],
  // The Falcon console.
  [CROWDSTRIKE]: [
    "Support and resources → API clients and keys",
    "Create API client",
    "API scopes",
    "Alerts → Read",
    "API clients and keys",
    "Endpoint security → Endpoint detections",
    "Next-Gen SIEM → Alerts",
  ],
};

/*
 * Bold names no Dashboard locale has as a label, kept as written in every
 * language: the ⋯ menu, a symbol everywhere; what the OAuth 2.0 variable's
 * card says once a token is fetched, and its grant type, both drawn in
 * English; and a custom field's name, which is code.
 */
export const KEPT_AS_WRITTEN: Readonly<Record<string, ReadonlyArray<string>>> =
  {
    [DYNAMICS]: [
      "⋯",
      "Access Token Fetched",
      "Client Credentials",
      "`customFields.dynamicsCaseId`.",
    ],
    /*
     * The criteria filter's conditions, drawn from the filter type's own
     * text, misspelling included.
     */
    [ALERTMANAGER]: ["Not Recieved In Minutes", "Recieved In Minutes"],
    /*
     * What the Security Events connection pages name that no Dashboard
     * locale words: the providers' titles, the connection form's settings
     * and options from the connector catalog, the Health states, the checks
     * a test reports, the counts of a run and a preview's button, all drawn
     * in English. A version is a version.
     */
    [GOOGLE_SECOPS]: [
      "Instance resource name",
      "Service account JSON",
      "Data to import",
      "Last poll succeeded",
      "Polling, no events imported yet",
      "No records returned",
      "Partial import",
      "Catching up",
      "Last poll failed",
      "Poll overdue",
      "Schedule paused",
      "Waiting for first poll",
      "Read late alerts by detection time",
      "Already imported",
      "Authenticate with Google",
      "Read rule detections",
      "Read curated rule detections",
      "Read the alerts view",
      "Detections available to import",
      "Background workers",
      "Poll scheduler",
      "Security event storage",
      "Preview detections",
      "Returned by Google SecOps",
      "Imported into OneUptime",
      "Time basis read",
      "Returned by each pass",
      "Creation lag",
      "13.0.0",
    ],
    [SENTINEL]: [
      "Application (client) ID",
      "Directory (tenant) ID",
      "Subscription ID",
      "Resource group",
      "Microsoft Sentinel",
      "Workspace name",
      "Azure public cloud",
      "Azure Government (US)",
      "Catching up",
      "Preview incidents",
      "Authenticate with Microsoft Entra",
      "Read incidents",
      "Incidents available to import",
      "Background workers",
      "Poll scheduler",
      "Security event storage",
    ],
    [DEFENDER]: [
      "Application (client) ID",
      "Directory (tenant) ID",
      "Microsoft Defender XDR",
      "Azure public cloud",
      "Azure Government (US)",
      "Preview alerts",
      "Authenticate with Microsoft Entra",
      "Read alerts from Microsoft Graph",
      "Alerts available to import",
      "Background workers",
      "Poll scheduler",
      "Security event storage",
    ],
    [CROWDSTRIKE]: [
      "Falcon cloud",
      "CrowdStrike Falcon",
      "US-1 (api.crowdstrike.com)",
      "US-2 (api.us-2.crowdstrike.com)",
      "EU-1 (api.eu-1.crowdstrike.com)",
      "US-GOV-1 (api.laggar.gcw.crowdstrike.com)",
      "Preview alerts",
      "Authenticate with CrowdStrike Falcon",
      "Read alerts from the Falcon Alerts API",
      "Alerts available to import",
      "Background workers",
      "Poll scheduler",
      "Security event storage",
    ],
  };

// The plans the pages name: the Dashboard shows a plan's name as written.
export const PLAN_NAMES: Readonly<Record<string, ReadonlyArray<string>>> = {
  [PAGERDUTY]: ["Growth"],
  [OPSGENIE]: ["Growth"],
  [SERVICENOW]: ["Growth"],
  [JIRA]: ["Growth"],
  [DYNAMICS]: ["Growth"],
};

/*
 * Bold words that are emphasis or a list item's lead, not a label of any
 * product: a translation words them freely. "OneUptime → Jira" heads a
 * group of templates in a table, which the picker does not draw.
 */
export const PROSE: Readonly<Record<string, ReadonlyArray<string>>> = {
  [OVERVIEW]: [
    "Inbound",
    "Outbound",
    "Outbound:",
    "Inbound:",
    "Built-in integrations",
  ],
  [ZABBIX]: [
    "With the monitor",
    "With the workflow",
    "Treat the URL like a password.",
    "Send only what needs an incident.",
    "Self-hosted?",
  ],
  [JIRA]: [
    "project",
    "space",
    "issue",
    "work item",
    "Jira Cloud",
    "OneUptime → Jira",
    "Jira → OneUptime",
    "No public notes.",
    "No status page.",
    "Two severities, so Medium becomes Low.",
    "Root cause edits are not watched.",
    "Alert links and labels.",
    "Numbers say what they number.",
    "Private alerts.",
    "Monitors raise alerts on their own, and can raise a lot of them.",
    "service account",
    "turn it on first",
    "Using both templates that create a record?",
    "Jira only calls HTTPS, on its allowed ports.",
    "Anyone who has the URL can trigger the workflow.",
    "Every event is a run.",
    "An issue is linked to an incident or to an alert, never both.",
    "A record has one issue.",
    "Markers in the text.",
    "Labels on new issues.",
    "States only move forward, on both sides.",
    "Only forward.",
    "The usual names first.",
    "Never a guess that drops the work.",
    "Two ways to the same status.",
    "Jira Cloud only.",
    "Incidents declared from Jira are quiet.",
    "Private incidents and alerts stay in OneUptime.",
    "Nothing moves backwards.",
    "Every alert gets an issue.",
    "The first few seconds can miss the issue.",
    "Private and public mean different things in Jira.",
    "Edit comments follow saves, not changes.",
    "Formatting does not cross over.",
    "Workflows created before the Jira Site URL link the issue at the site the event names.",
    "A bad or expired token rarely says so.",
    "The same event can arrive twice.",
    "Atlassian Document Format",
    "Priority",
    "Assignee",
    "Labels",
    "Components",
    "Custom fields",
    "Comment",
    "Transition",
    "The Jira Site URL is your base URL",
    "Personal access tokens",
    "Automation is built in",
    "Webhook delivery is asynchronous",
  ],
  [DYNAMICS]: [
    "OneUptime → Dynamics 365",
    "Dynamics 365 → OneUptime",
    "Monitors raise alerts on their own, and can raise a lot of them.",
    "How the templates sign in.",
    "turn it on first",
    "Anyone who has the URL can trigger the workflow.",
    "Every event is a run",
    "Using both create-from-case templates?",
    "A case is linked to an incident or to an alert, never both.",
    "A record has one case.",
    "Markers in the text.",
    "The link from the first save.",
    "States only move forward, on both sides.",
    "Microsoft's commercial cloud.",
    "Dynamics 365 can refuse to resolve a case.",
    "Records and cases never move backwards.",
    "Notes and descriptions are plain text.",
    "Edited notes are not copied",
    "Private incidents and alerts stay in OneUptime",
    "Every case gets a record.",
    "The same event can arrive twice.",
  ],
  [ALERTMANAGER]: ["Treat the URL like a password.", "Self-hosted?"],
  [GRAFANA]: ["Treat the URL like a password.", "Self-hosted?"],
  [DATADOG]: ["Treat the URL like a password.", "Self-hosted?"],
  [GOOGLE_SECOPS]: [
    "Rule detections by created time.",
    "Curated rule detections by created time.",
    "The alerts view by detection time.",
    "sweeps the alerts view over the 24 hours before its window",
    "created time",
    "24 hours",
    "1 minute",
    "20",
    "200",
    "16",
    "4 minutes",
    "Narrow.",
    "Grow back.",
    "Move past a single minute.",
    "Data to import.",
    "Rule run frequency and detection latency.",
    "Read the last run's counts.",
    "Is anything polling at all?",
    "Look in the right place.",
    "Google's own severity",
    "The alert's severity",
    "The rule's `meta` severity.",
    "The rule's `$risk_score` outcome",
    "Health is Partial import",
    "running app and worker image versions",
    "Connections move automatically.",
    "Recent run history comes along.",
    "The earlier rows are disabled, not deleted.",
    "A connection that cannot be moved stays where it was.",
    "The API routes changed.",
    "Events carry a new connection attribute.",
    "Search.",
    "Correlation.",
    "Detection rules.",
    "Monitors.",
    "Dashboards and AI.",
  ],
  [SENTINEL]: [
    "Creation time is the cursor.",
    "The first poll looks back 24 hours",
    "Every later poll starts 1 minute before the saved cursor",
    "A poll reads at most 24 hours past the cursor.",
    "Duplicates are dropped by the incident's GUID",
    "Narrow.",
    "Grow back.",
    "Move past a single minute.",
    "Search.",
    "Correlation.",
    "Detection rules.",
    "Monitors.",
  ],
  [DEFENDER]: [
    "Creation time is the cursor.",
    "The first poll looks back 24 hours",
    "Every later poll starts 1 minute before the saved cursor",
    "A poll reads at most 24 hours past the cursor.",
    "Duplicates are dropped by the alert's `id`",
    "A failed run changes nothing.",
    "Narrow.",
    "Grow back.",
    "Move past a single minute.",
    "Search.",
    "Correlation.",
    "Detection rules.",
    "Monitors.",
  ],
  [CROWDSTRIKE]: [
    "Creation time is the cursor.",
    "The first poll looks back 24 hours",
    "Every later poll starts 1 minute before the saved cursor",
    "A poll reads at most 24 hours past the cursor.",
    "Duplicates are dropped by `composite_id`",
    "Each window costs",
    "Narrow.",
    "Grow back.",
    "Move past a single minute.",
    "Search.",
    "Correlation.",
    "Detection rules.",
    "Monitors.",
  ],
};

/*
 * The variables an Incoming Request monitor's grouping adds to its incident
 * templates, named after the last segment of the grouping path, which an
 * alerting tool's page uses in a title or names. The facts suites hold each
 * to the grouping the page sets.
 */
export const GROUPING_VARIABLES: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  [ALERTMANAGER]: ["fingerprint"],
  [GRAFANA]: ["fingerprint"],
};

/*
 * Names a translation writes as the English does, in prose and tables too:
 * products, tools, protocols and the like. A line made of them alone is not
 * a line left untranslated.
 */
export const PRODUCT_NAMES: ReadonlyArray<string> = [
  "OneUptime Cloud",
  "OneUptime",
  "Zabbix",
  "Jira Service Management",
  "Jira Data Center",
  "Jira Cloud",
  "Jira Server",
  "Jira",
  "Atlassian",
  "PagerDuty",
  "Opsgenie",
  "ServiceNow",
  "Microsoft Dynamics 365",
  "Dynamics 365 Customer Service",
  "Dynamics 365",
  "Dynamics",
  "Dataverse",
  "Power Automate",
  "Power Platform",
  "Microsoft Entra ID",
  "Entra ID",
  "Microsoft",
  "Azure",
  "Prometheus Alertmanager",
  "Alertmanager",
  "Grafana OnCall",
  "Grafana",
  "Datadog",
  "Huntress",
  "Google SecOps",
  "Microsoft Sentinel",
  "Microsoft Defender XDR",
  "CrowdStrike Falcon",
  "Splunk Enterprise Security",
  "Splunk On-Call",
  "Splunk",
  "Elastic Security",
  "AWS Security Hub",
  "Okta System Log",
  "Okta",
  "incident.io",
  "UptimeRobot",
  "Atlassian Statuspage",
  "Better Stack",
  "Pingdom",
  "StatusCake",
  "Uptime Kuma",
  "Zendesk",
  "New Relic",
  "GitHub",
  "GitLab",
  "Slack",
  "Microsoft Teams",
  "Mattermost",
  "Discord",
  "Telegram",
  "Twilio",
  "SendGrid Inbound Email",
  "SendGrid",
  "IRC",
  "AWS",
  "SNS",
  "REST",
  "JSON",
  "JQL",
  "HTTPS",
  "HTTP",
  "OAuth",
  "API",
  "URL",
  "Linux",
  "macOS",
];
