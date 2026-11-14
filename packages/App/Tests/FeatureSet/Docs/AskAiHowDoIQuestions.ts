/*
 * "HOW DO I...?" - THE QUESTIONS ASK AI MUST ANSWER FROM THE DOCS (issue
 * #6828).
 *
 * Real questions: the ones the issue names, the Quickstart's steps, and
 * the ones customers filed as feature requests for something OneUptime
 * already did. Each names the docs page that answers it and, for a "how do
 * I", the Dashboard page where it is done, by the name Search gives it.
 *
 * AskAiHowDoIRetrieval.test.ts holds the docs search and the page finder
 * to them offline. The same list is what to run against a model (the
 * whole conversation, with a provider) to check the answers themselves:
 * a citation of `docsPage`, and a button for `dashboardPage`.
 */

export interface AskAiHowDoIQuestion {
  question: string;
  // The page under /docs/<lang>/ that answers it.
  docsPage: string;
  // Other pages that answer it as well.
  alsoAnswers?: Array<string> | undefined;
  /*
   * The words the model searches with, where the question's own are not
   * the docs' words ("a text" for an SMS): the model rephrases, the
   * search does not.
   */
  searchWords?: string | undefined;
  // The Dashboard page or setting where it is done, as Search names it.
  dashboardPage?: string | undefined;
  // Its route, as find_dashboard_page's citation carries it.
  dashboardPath?: string | undefined;
}

export const ASK_AI_HOW_DO_I_QUESTIONS: ReadonlyArray<AskAiHowDoIQuestion> = [
  {
    question: "How do I get a text when my site is down?",
    searchWords: "SMS notification when a monitor is down",
    docsPage: "notifications/notification-methods",
    // The guide (#6821) walks it from nothing to a tested page.
    alsoAnswers: ["guides/paging"],
    dashboardPage: "Phone Numbers for SMS Notifications",
    dashboardPath: "/dashboard/:projectId/user-settings/notification-methods",
  },
  {
    question: "How do I get paged on my phone when something breaks?",
    docsPage: "guides/paging",
    alsoAnswers: ["on-call/index", "notifications/notification-methods"],
    dashboardPage: "Page the right person when something breaks",
    dashboardPath: "/dashboard/:projectId/on-call-duty/setup",
  },
  {
    question: "What is an episode?",
    docsPage: "incidents/episodes",
  },
  {
    question: "Where do I add a second phone number?",
    docsPage: "notifications/notification-methods",
    dashboardPage: "Notification Methods",
    dashboardPath: "/dashboard/:projectId/user-settings/notification-methods",
  },
  {
    question: "How do I monitor my website?",
    docsPage: "monitor/website-monitor",
    dashboardPage: "Create Monitor",
    dashboardPath: "/dashboard/:projectId/monitors/create",
  },
  {
    question: "How do I create a monitor?",
    docsPage: "monitor/create-monitor",
    dashboardPage: "Create Monitor",
    dashboardPath: "/dashboard/:projectId/monitors/create",
  },
  {
    question: "How do I set up an on-call schedule?",
    docsPage: "on-call/schedules",
    dashboardPage: "On-Call Schedules",
    dashboardPath: "/dashboard/:projectId/on-call-duty/schedules",
  },
  {
    question: "How do I create an on-call policy?",
    docsPage: "on-call/policies",
    dashboardPage: "On-Call Policies",
    dashboardPath: "/dashboard/:projectId/on-call-duty/policies",
  },
  {
    question:
      "How do I escalate to someone else when the first person does not answer?",
    docsPage: "on-call/escalation-rules",
    alsoAnswers: ["guides/paging"],
    dashboardPage: "On-Call Policies",
    dashboardPath: "/dashboard/:projectId/on-call-duty/policies",
  },
  {
    question:
      "How do I cover someone's on-call shift while they are on vacation?",
    docsPage: "on-call/user-overrides",
    dashboardPage: "User Overrides",
  },
  {
    question: "How do I create a status page?",
    docsPage: "status-pages/index",
    alsoAnswers: ["guides/status-page"],
    dashboardPage: "All Status Pages",
    dashboardPath: "/dashboard/:projectId/status-pages",
  },
  {
    question: "How do I use my own domain for my status page?",
    docsPage: "status-pages/branding-and-domains",
    alsoAnswers: ["guides/status-page"],
  },
  {
    question: "How do I publish a status page on my own domain, with HTTPS?",
    docsPage: "guides/status-page",
    alsoAnswers: ["status-pages/branding-and-domains"],
    dashboardPage: "Publish a status page",
    dashboardPath: "/dashboard/:projectId/status-pages/setup",
  },
  {
    question: "How can my customers subscribe to status page updates?",
    docsPage: "status-pages/subscribers",
  },
  {
    question: "How do I schedule maintenance?",
    docsPage: "scheduled-maintenance/creating-events",
    dashboardPage: "Create Scheduled Maintenance",
    dashboardPath: "/dashboard/:projectId/scheduled-maintenance-events/create",
  },
  {
    question: "How do I declare an incident?",
    docsPage: "incidents/declaring-incidents",
    dashboardPage: "Declare Incident",
    dashboardPath: "/dashboard/:projectId/incidents/create",
  },
  {
    question: "How do I write a postmortem?",
    docsPage: "incidents/postmortems",
    dashboardPage: "Postmortems",
  },
  {
    question: "How do I add my own incident severities?",
    docsPage: "incidents/states-and-severities",
    dashboardPage: "Incident Severity",
  },
  {
    question: "How do I connect Slack?",
    docsPage: "workspace-connections/slack",
  },
  {
    question: "How do I connect Microsoft Teams?",
    docsPage: "workspace-connections/microsoft-teams",
  },
  {
    question: "How do I invite a teammate to my project?",
    docsPage: "permissions/inviting-people",
    dashboardPage: "All Users",
  },
  {
    question: "How do I set up SSO with SAML?",
    docsPage: "identity/sso",
    dashboardPage: "SSO",
  },
  {
    question: "How do I create an API key?",
    docsPage: "api-reference/api-reference",
    dashboardPage: "API Keys",
    dashboardPath: "/dashboard/:projectId/settings/api-keys",
  },
  {
    question: "How do I send my logs and traces with OpenTelemetry?",
    docsPage: "telemetry/open-telemetry",
  },
  {
    question: "Where do I get a telemetry ingestion key?",
    docsPage: "telemetry/ingestion-keys",
    dashboardPage: "Ingestion Keys",
    dashboardPath: "/dashboard/:projectId/settings/telemetry-ingestion-keys",
  },
  {
    question: "How do I get warned before my SSL certificate expires?",
    docsPage: "monitor/ssl-certificate-monitor",
    dashboardPage: "Create Monitor",
    dashboardPath: "/dashboard/:projectId/monitors/create",
  },
  {
    question: "How do I monitor a server's CPU, memory and disk?",
    docsPage: "monitor/server-monitor",
    dashboardPage: "Create Monitor",
    dashboardPath: "/dashboard/:projectId/monitors/create",
  },
  {
    question: "How do I know when my cron job stops sending a heartbeat?",
    docsPage: "monitor/incoming-request-monitor",
    dashboardPage: "Create Monitor",
    dashboardPath: "/dashboard/:projectId/monitors/create",
  },
  {
    question: "How do I run checks from inside my private network?",
    docsPage: "probe/custom-probe",
    dashboardPage: "Probes",
  },
  {
    question: "How do I check that my API returns the right response?",
    docsPage: "monitor/api-monitor",
    dashboardPage: "Create Monitor",
    dashboardPath: "/dashboard/:projectId/monitors/create",
  },
  {
    question: "How do I run a Playwright synthetic check of my login page?",
    docsPage: "monitor/synthetic-monitor",
    dashboardPage: "Create Monitor",
    dashboardPath: "/dashboard/:projectId/monitors/create",
  },
  {
    question: "How do I turn on two-factor authentication?",
    docsPage: "introduction/your-account",
    dashboardPage: "Two-factor authentication",
  },
  {
    question: "How do I move my on-call setup over from PagerDuty?",
    docsPage: "moving-to-oneuptime/pagerduty",
    dashboardPage: "Import from PagerDuty",
  },
  {
    question: "How do I set up an SLO and its error budget?",
    docsPage: "slo/introduction",
    dashboardPage: "SLOs",
  },
  {
    question: "How do I build a dashboard with charts?",
    docsPage: "dashboards/authoring",
    dashboardPage: "Dashboards",
  },
  {
    question: "How do I run a workflow when an incident is created?",
    docsPage: "workflows/triggers",
    alsoAnswers: [
      "workflows/index",
      "workflows/authoring",
      "incidents/settings",
    ],
    dashboardPage: "Workflows",
  },
  {
    question: "How do I write a runbook?",
    docsPage: "runbooks/authoring",
    dashboardPage: "Runbooks",
  },
  {
    question: "How do I connect my own LLM provider for Ask AI?",
    docsPage: "ai/llm-provider",
    dashboardPage: "LLM Providers",
  },
  {
    question: "How do I give someone a custom role with only some permissions?",
    docsPage: "permissions/index",
    dashboardPage: "Custom Roles",
  },
  {
    question: "How do I get my on-call shifts in my calendar?",
    docsPage: "on-call/calendar-feeds",
    dashboardPage: "Calendar Feed",
  },
  {
    question: "How do I keep logs for longer?",
    searchWords: "log data retention",
    docsPage: "telemetry/data-retention",
    dashboardPage: "Telemetry Data Retention",
  },
  {
    question: "How do I store a password a monitor uses without showing it?",
    docsPage: "monitor/monitor-secrets",
    dashboardPage: "Secrets",
  },
];

/*
 * The same questions asked in German and in Persian (written right to
 * left), as a newcomer there would ask them.
 */
export const ASK_AI_HOW_DO_I_QUESTIONS_TRANSLATED: ReadonlyArray<{
  language: string;
  question: string;
  docsPage: string;
  alsoAnswers?: Array<string> | undefined;
}> = [
  {
    language: "de",
    question: "Wie erstelle ich eine Statusseite?",
    docsPage: "status-pages/index",
  },
  {
    language: "de",
    question: "Wie richte ich einen Bereitschaftsplan ein?",
    docsPage: "on-call/schedules",
  },
  {
    language: "de",
    question: "Wie überwache ich meine Website?",
    docsPage: "monitor/website-monitor",
  },
  {
    language: "de",
    question: "Wie plane ich eine Wartung?",
    docsPage: "scheduled-maintenance/creating-events",
    alsoAnswers: ["scheduled-maintenance/index"],
  },
  {
    language: "fa",
    question: "چطور یک صفحه وضعیت بسازم؟",
    docsPage: "status-pages/index",
    alsoAnswers: ["status-pages/one-status-page-per-audience"],
  },
  {
    language: "fa",
    question: "چطور وب‌سایتم را پایش کنم؟",
    docsPage: "monitor/website-monitor",
  },
  {
    language: "fa",
    question: "چطور یک حادثه اعلام کنم؟",
    docsPage: "incidents/declaring-incidents",
  },
];
