/*
 * The integration pages docs overhaul tasks 28a, 28b and 28c rewrote, by
 * the paths their suites name them with, and the words they keep as the
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

// Task 28c: the other four Security Events connections.
export const SPLUNK: string = "integrations/splunk";
export const ELASTIC: string = "integrations/elastic-security";
export const AWS_SECURITY_HUB: string = "integrations/aws-security-hub";
export const OKTA: string = "integrations/okta";

// The identity connections that followed: Entra ID and Google Workspace.
export const ENTRA_ID: string = "integrations/microsoft-entra-id";
export const GOOGLE_WORKSPACE: string = "integrations/google-workspace";

// Task 28c: issues opened in GitHub and GitLab, and the chat steps.
export const GITHUB: string = "integrations/github";
export const GITLAB: string = "integrations/gitlab";
export const DISCORD: string = "integrations/discord";
export const TELEGRAM: string = "integrations/telegram";

/*
 * The IRC page, which has suites of its own (IrcIntegrationDocs): named
 * here for the checks that read every integrations page, and for the tab
 * labels the Discord and Telegram pages word as it does.
 */
export const IRC: string = "integrations/irc";

/*
 * The pages these tasks rewrote, in nav order: task 28a's are the first
 * seven links of the Integrations group, and task 28b's follow, with
 * Huntress, which has suites of its own, between Datadog and Google SecOps.
 * Task 28c's come after CrowdStrike Falcon, and IRC, which has suites of
 * its own too, is the group's last link.
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
  { page: SPLUNK, navTitle: "Splunk Enterprise Security" },
  { page: ELASTIC, navTitle: "Elastic Security" },
  { page: AWS_SECURITY_HUB, navTitle: "AWS Security Hub" },
  { page: OKTA, navTitle: "Okta System Log" },
  { page: ENTRA_ID, navTitle: "Microsoft Entra ID" },
  { page: GOOGLE_WORKSPACE, navTitle: "Google Workspace" },
  { page: GITHUB, navTitle: "GitHub" },
  { page: GITLAB, navTitle: "GitLab" },
  { page: DISCORD, navTitle: "Discord" },
  { page: TELEGRAM, navTitle: "Telegram" },
];

// How many of the Integrations nav group's first links are task 28a's pages.
export const FIRST_TASK_PAGE_COUNT: number = 7;

// The alerting tools' pages: an Incoming Request monitor, or a workflow.
export const ALERTING_PAGES: ReadonlyArray<string> = [
  ALERTMANAGER,
  GRAFANA,
  DATADOG,
];

// The Security Events connections' pages: one for every connector.
export const SECURITY_CONNECTION_PAGES: ReadonlyArray<string> = [
  GOOGLE_SECOPS,
  SENTINEL,
  DEFENDER,
  CROWDSTRIKE,
  SPLUNK,
  ELASTIC,
  AWS_SECURITY_HUB,
  OKTA,
  ENTRA_ID,
  GOOGLE_WORKSPACE,
];

// The pages of a workflow that opens an issue for every incident.
export const ISSUE_PAGES: ReadonlyArray<string> = [GITHUB, GITLAB];

// The pages of a chat step, built from a template or from scratch.
export const CHAT_STEP_PAGES: ReadonlyArray<string> = [DISCORD, TELEGRAM];

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

/*
 * The steps of the workflow the GitHub and GitLab pages build: an On Create
 * Incident trigger and an API Post (JSON) block, and the If / Else block and
 * the API block's outputs their tips and troubleshooting name.
 */
const ISSUE_WORKFLOW_STEPS: ReadonlyArray<string> = [
  "On Create Incident",
  "Fields to pass on",
  "API Post (JSON)",
  "Success",
  "URL",
  "Request Headers",
  "Request Body",
  "If / Else",
  "Yes",
  "Error",
  "Response Status",
  "Response Body",
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
    "Page an On-Call Policy",
    "Webhook",
    "Switch / Case",
    "Log",
    "Compare with",
    "If / Else",
    "Request Body",
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
  [GITHUB]: ISSUE_WORKFLOW_STEPS,
  [GITLAB]: ISSUE_WORKFLOW_STEPS,
  [DISCORD]: [
    "Send Message to Discord",
    "Message Text",
    "Success",
    "Error",
    "Log",
    "On Create Incident",
    "Fields to pass on",
    "Discord Incoming Webhook URL",
    "On Update Incident",
    "On Create Alert",
    "If / Else",
  ],
  [TELEGRAM]: [
    "Send Message to Telegram",
    "Message Text",
    "Success",
    "Error",
    "Log",
    "Telegram Bot Token",
    "On Create Alert",
    "Fields to pass on",
    "Chat ID",
    "On Create Incident",
    "On Update Incident",
    "If / Else",
  ],
};

/*
 * The names of the Jira, Dynamics 365, Discord and Telegram templates, the
 * names of the workflows they create, and the settings their create wizard
 * asks for, as the picker and the wizard show them. The Dashboard shows
 * them in English in every language, so the pages keep them as written.
 * The facts suites hold each to the templates.
 */
export const TEMPLATE_NAMES: Readonly<Record<string, ReadonlyArray<string>>> = {
  [ZABBIX]: [
    "Declare an incident for each Zabbix problem",
    "Create an alert for each Zabbix problem",
    "Zabbix URL",
    "Zabbix API Token",
    "Acknowledge or close the Zabbix problem with the incident",
    "Copy incident private notes to the Zabbix problem",
  ],
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
  [DISCORD]: [
    "Tell Discord when an incident opens",
    "Notify Discord on new incident",
    "Discord Webhook URL",
  ],
  [TELEGRAM]: [
    "Tell Telegram when an alert fires",
    "Notify Telegram on new alert",
    "Telegram Chat ID",
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
    // The user role, the user group and the API token the templates that call Zabbix act with.
    "Users → User roles",
    "Access to API",
    "Acknowledge problems",
    "Add problem comments",
    "Close problems",
    "Users → User groups",
    "Read",
    "Read-write",
    "Users → API tokens",
    "Create API token",
    "Set expiration date and time",
    "Auth token",
    "Allow manual close",
    "Problem update",
    "Update operations",
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
    // The role a key that sends events to Google SecOps needs.
    "Chronicle API Editor",
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
    // Where a destination's table, rule and role are made.
    "Tables → Create → New custom log (DCR-based)",
    "Monitoring Metrics Publisher",
    "JSON View",
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
  // Splunk Web's token settings.
  [SPLUNK]: [
    "Settings → Tokens",
    "Enable Token Authentication",
    "New Token",
    "User",
    "Audience",
    "Expiration",
    "Create",
    // Where a destination's HTTP Event Collector token is made.
    "Settings → Data inputs → HTTP Event Collector",
    "Global Settings",
  ],
  // Kibana.
  [ELASTIC]: [
    "Stack Management → API keys",
    "Create API key",
    "Base64",
    // The key a destination writes with, as Kibana shows it.
    "Encoded",
  ],
  // The AWS console: Security Hub and IAM.
  [AWS_SECURITY_HUB]: [
    "Security Hub → Settings → Regions",
    "Policies → Create policy",
    "JSON",
    "Users → Create user",
    "Security credentials → Access keys → Create access key",
    "Third-party service",
  ],
  // The Okta Admin Console.
  [OKTA]: [
    "Admin Console",
    "Security → API",
    "Tokens",
    "Create token",
    "Any IP",
    "Token Value",
  ],
  // The Microsoft Entra admin center, and Audit in the Microsoft Purview portal.
  [ENTRA_ID]: [
    "Audit",
    "Start recording user and admin activity",
    "App registrations",
    "New registration",
    "Supported account types",
    "Accounts in this organizational directory only",
    "Register",
    "Overview",
    "API permissions → Add a permission → Microsoft Graph → Application permissions",
    "Add permissions",
    "Add a permission → Office 365 Management APIs → Application permissions",
    "Grant admin consent for",
    "Granted",
    "Certificates & secrets → Client secrets → New client secret",
    "Add",
    "Value",
    "Secret ID",
  ],
  // The Google Cloud console and the Google Admin console.
  [GOOGLE_WORKSPACE]: [
    "APIs & Services → Library",
    "Admin SDK API",
    "Enable",
    "IAM & Admin → Service accounts → Create service account",
    "Done",
    "Unique ID",
    "Keys",
    "Add key → Create new key → JSON",
    "Security → Access and data control → API controls → Manage domain-wide delegation",
    "Add new",
    "Client ID",
    "OAuth scope",
    "Authorize",
    "Manage domain-wide delegation",
    "Account → Admin roles",
  ],
  // A fine-grained token's permission, as GitHub's settings name it.
  [GITHUB]: ["Issues", "Read and write"],
  // A GitLab project's overview and settings.
  [GITLAB]: ["Copy project ID", "Settings → Access tokens"],
  // A Discord channel's settings and permissions.
  [DISCORD]: [
    "Manage Webhooks",
    "Edit Channel",
    "Integrations → Webhooks",
    "New Webhook",
    "Copy Webhook URL",
  ],
};

/*
 * Bold names no Dashboard locale has as a label, kept as written in every
 * language: the ⋯ menu, a symbol everywhere; what the OAuth 2.0 variable's
 * card says once a token is fetched, drawn in English; and a custom
 * field's name, which is code. (The grant type, Client Credentials, is a
 * label of the SMTP form's OAuth answers now, and reads the same in every
 * language: i18n/SameAsEnglish.json.)
 */
export const KEPT_AS_WRITTEN: Readonly<Record<string, ReadonlyArray<string>>> =
  {
    [DYNAMICS]: ["⋯", "Access Token Fetched", "`customFields.dynamicsCaseId`."],
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
     * in English. A version is a version. (Instance resource name and
     * Service account JSON are labels now: the Send to your SIEM form draws
     * them through the locales. So are Directory (tenant) ID, Application
     * (client) ID, Subscription ID, the two Azure clouds, Access key ID and
     * Secret access key, which the AI connections' form words in every
     * language: the form draws a setting's title and options through the
     * locales, so the Security Events form names them the same way. And
     * Waiting for first poll is one too: a threat intel feed's Status words
     * it in every language, and the Health pill looks its text up. So is
     * Okta System Log, since the Rule Library's Data filter names the
     * events a rule reads (#5233): it reads the same in every language, and
     * the page names it as drawn.)
     */
    [GOOGLE_SECOPS]: [
      "Data to import",
      "Last poll succeeded",
      "Polling, no events imported yet",
      "No records returned",
      "Partial import",
      "Catching up",
      "Last poll failed",
      "Poll overdue",
      "Schedule paused",
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
      "Resource group",
      "Microsoft Sentinel",
      "Workspace name",
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
      "Microsoft Defender XDR",
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
    /*
     * The connection form's switch to remove a stored secret is drawn from
     * the setting's title, in English like the setting itself.
     */
    [SPLUNK]: [
      "Splunk Enterprise Security",
      "Authentication token",
      "Splunk management URL",
      "Remove the stored Authentication token",
      "Remove the stored Password",
      "Catching up",
      "Preview notable events",
      "Authenticate with Splunk",
      "Run the search on Splunk",
      "Notable events available to import",
      "Background workers",
      "Poll scheduler",
      "Security event storage",
    ],
    [ELASTIC]: [
      "Elastic Security",
      "Kibana URL",
      "Kibana space",
      "Catching up",
      "Preview alerts",
      "Authenticate with Kibana",
      "Read detection alerts",
      "Alerts available to import",
      "Background workers",
      "Poll scheduler",
      "Security event storage",
    ],
    [AWS_SECURITY_HUB]: [
      "AWS Security Hub",
      "Session token",
      "Remove the stored Session token",
      "Catching up",
      "Preview findings",
      "Authenticate with AWS",
      "Read findings",
      "Findings available to import",
      "Background workers",
      "Poll scheduler",
      "Security event storage",
    ],
    [OKTA]: [
      "API token",
      "Okta organization URL",
      "Event filter",
      "Catching up",
      "Preview log events",
      "Authenticate with Okta",
      "Read System Log events",
      "Events available to import",
      "Background workers",
      "Poll scheduler",
      "Security event storage",
    ],
    [ENTRA_ID]: [
      "Preview records",
      "Authenticate with Microsoft Entra",
      "Read sign-ins",
      "Read directory changes",
      "Read the Microsoft 365 audit log",
      "Records available to import",
      "Background workers",
      "Poll scheduler",
      "Security event storage",
    ],
    [GOOGLE_WORKSPACE]: [
      "Administrator email",
      "Preview audit events",
      "Authenticate with Google",
      "Read the audit logs",
      "Read Drive activity",
      "Activities available to import",
      "Background workers",
      "Poll scheduler",
      "Security event storage",
    ],
    // The button that inserts a value into a step's setting: a symbol.
    [DISCORD]: ["{ }"],
    [TELEGRAM]: ["{ }"],
  };

// The plans the pages name: the Dashboard shows a plan's name as written.
export const PLAN_NAMES: Readonly<Record<string, ReadonlyArray<string>>> = {
  [ZABBIX]: ["Growth"],
  [PAGERDUTY]: ["Growth"],
  [OPSGENIE]: ["Growth"],
  [SERVICENOW]: ["Growth"],
  [JIRA]: ["Growth"],
  [DYNAMICS]: ["Growth"],
  [GITHUB]: ["Growth"],
  [GITLAB]: ["Growth"],
  [DISCORD]: ["Growth"],
  [TELEGRAM]: ["Growth"],
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
    "With the templates",
    "With the monitor",
    "Treat the URL like a password.",
    "Links go to your Zabbix.",
    "Keep the API token to what the workflow does.",
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
  [SPLUNK]: [
    "Creation time is the cursor.",
    "The first poll looks back 24 hours",
    "Every later poll starts 1 minute before the saved cursor",
    "A poll reads at most 24 hours past the cursor.",
    "Duplicates are dropped by `event_id`",
    "Narrow.",
    "Grow back.",
    "Move past a single minute.",
    "Search.",
    "Correlation.",
    "Detection rules.",
    "Monitors.",
  ],
  [ELASTIC]: [
    "Creation time is the cursor.",
    "The first poll looks back 24 hours",
    "Every later poll starts 1 minute before the saved cursor",
    "A poll reads at most 24 hours past the cursor.",
    "Duplicates are dropped by the alert's `_id`",
    "Narrow.",
    "Grow back.",
    "Move past a single minute.",
    "Search.",
    "Correlation.",
    "Detection rules.",
    "Monitors.",
  ],
  [AWS_SECURITY_HUB]: [
    "Creation time is the cursor.",
    "The first poll looks back 24 hours",
    "Every later poll starts 30 minutes before the saved cursor.",
    "A poll reads at most 24 hours past the cursor.",
    "Duplicates are dropped by the finding's `Id`",
    "Narrow.",
    "Grow back.",
    "Move past a single minute.",
    "Search.",
    "Correlation.",
    "Detection rules.",
    "Monitors.",
  ],
  [OKTA]: [
    "Publish time is the cursor.",
    "The first poll looks back 24 hours",
    "Every later poll starts 15 minutes before the saved cursor.",
    "A poll reads at most 24 hours past the cursor.",
    "Duplicates are dropped by `uuid`",
    "Narrow.",
    "Grow back.",
    "Move past a single minute.",
    "Search.",
    "Correlation.",
    "Detection rules.",
    "Monitors.",
  ],
  [ENTRA_ID]: [
    "Records are read by when Entra ID recorded them",
    "The first poll looks back 24 hours",
    "Every later poll starts 30 minutes before the saved cursor.",
    "A poll reads at most 24 hours past the cursor.",
    "A tenant without Microsoft Entra ID P1 or P2",
    "A failed run changes nothing.",
    "Narrow.",
    "Grow back.",
    "Move past a single minute.",
  ],
  [GOOGLE_WORKSPACE]: [
    "Activities are read by when they happened.",
    "The first poll looks back 24 hours",
    "Every later poll starts 120 minutes before the saved cursor",
    "A poll reads at most 24 hours past the cursor.",
    "Drive is read one event at a time",
    "A failed run changes nothing.",
    "Narrow.",
    "Grow back.",
    "Move past a single minute.",
  ],
  [GITHUB]: ["GitHub Enterprise Server.", "Assign it.", "Only some incidents."],
  [GITLAB]: [
    "A GitLab of your own.",
    "The project's path for its ID.",
    "Assign it.",
    "Only some incidents.",
  ],
  [DISCORD]: [
    "outbound",
    "Format with Discord's Markdown.",
    "Mind the 2,000-character limit.",
    "Post more than new incidents.",
    "Only Discord's own addresses.",
  ],
  [TELEGRAM]: [
    "outbound",
    "Plain text.",
    "Mind the 4,096-character limit.",
    "Incidents too.",
    "The token's shape is checked.",
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
