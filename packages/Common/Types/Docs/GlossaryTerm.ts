import { getDocsPagePath } from "./DocsLanguage";

/*
 * The terms of the docs' Glossary (/docs/<lang>/introduction/glossary), by
 * the anchor each one answers in every language.
 *
 * A term's anchor is its English heading's ("### On-Call Policy" is
 * #on-call-policy). A translated Glossary keeps the English page's shape,
 * and the docs give each translated heading its English anchor too, so
 * /docs/de/introduction/glossary#on-call-policy opens the German page at
 * that term. Link to a term with getGlossaryTermPath, never by spelling the
 * address out, so a term that leaves the page fails to compile.
 *
 * The docs suite GlossaryDocs holds the page to this list in every
 * language: each value is the anchor of one term heading, in this order.
 * Renaming a term's English heading changes its anchor and fails it. Keep
 * the heading (a new name goes under "Also called"), or change the value
 * here and every link to it in the same change.
 *
 * The same entries, with their definitions and other names in each
 * language, are served as JSON by the docs' glossary route, one file per
 * language (App/FeatureSet/Docs/Utils/Glossary.ts).
 */
enum GlossaryTerm {
  // Start here
  Project = "project",
  Account = "account",
  Team = "team",
  Monitor = "monitor",
  Criteria = "criteria",
  MonitorStatus = "monitor-status",
  Probe = "probe",
  Incident = "incident",
  Alert = "alert",
  Episode = "episode",
  OnCallPolicy = "on-call-policy",
  EscalationRule = "escalation-rule",
  OnCallSchedule = "on-call-schedule",
  Layer = "layer",
  NotificationMethod = "notification-method",
  // A person's own paging rules: the page #6820 named, #6817 defined.
  HowToReachMe = "how-to-reach-me",
  StatusPage = "status-page",
  Subscriber = "subscriber",
  ScheduledMaintenance = "scheduled-maintenance",
  Telemetry = "telemetry",
  // What you watch
  MonitorGroup = "monitor-group",
  Service = "service",
  Host = "host",
  Kubernetes = "kubernetes",
  Infrastructure = "infrastructure",
  Network = "network",
  Cloud = "cloud",
  AppPlatforms = "app-platforms",
  Serverless = "serverless",
  Databases = "databases",
  Queues = "queues",
  RealUserMonitoring = "real-user-monitoring",
  Inventory = "inventory",
  Topology = "topology",
  SLO = "slo",
  ErrorBudget = "error-budget",
  // Working on a problem
  State = "state",
  Severity = "severity",
  Owner = "owner",
  Label = "label",
  Exception = "exception",
  AIInsights = "ai-insights",
  SecurityEvents = "security-events",
  SecurityCase = "security-case",
  // Telemetry and dashboards
  Logs = "logs",
  Metrics = "metrics",
  Traces = "traces",
  Profiles = "profiles",
  AILLM = "ai-llm",
  DataObservability = "data-observability",
  DataSecurity = "data-security",
  Dashboard = "dashboard",
  PublicDashboard = "public-dashboard",
  // Automation and AI
  Workflow = "workflow",
  Runbook = "runbook",
  Playbook = "playbook",
  AIRule = "ai-rule",
  OneUptimeAI = "oneuptime-ai",
  AskAI = "ask-ai",
  Code = "code",
  Form = "form",
  // What you install, and the keys
  InfrastructureAgent = "infrastructure-agent",
  KubernetesAgent = "kubernetes-agent",
  OpenTelemetryCollector = "opentelemetry-collector",
  Runner = "runner",
  IngestionKey = "ingestion-key",
  APIKey = "api-key",
  // Words with more than one meaning
  Rule = "rule",
  Role = "role",
  Resource = "resource",
  Settings = "settings",
  Policy = "policy",
  Template = "template",
  Workspace = "workspace",
  Agent = "agent",
  OnCallRules = "on-call-rules",
  NotificationSettings = "notification-settings",
}

export default GlossaryTerm;

// The Glossary's address, under /docs/<lang>/.
export const GLOSSARY_DOCS_PAGE: string = "introduction/glossary";

/*
 * The docs address of a term, in the reader's language when the docs are
 * written in it, else in English: "/docs/de/introduction/glossary#monitor".
 * A language is a docs language code ("de", "zh-CN"); a Dashboard language
 * the docs have no copy in (Arabic) opens the English page.
 */
export const getGlossaryTermPath: (
  term: GlossaryTerm,
  language?: string | undefined,
) => string = (term: GlossaryTerm, language?: string | undefined): string => {
  return `${getDocsPagePath(GLOSSARY_DOCS_PAGE, language)}#${term}`;
};

// Every term, in the Glossary's order.
export const ALL_GLOSSARY_TERMS: ReadonlyArray<GlossaryTerm> = Object.values(
  GlossaryTerm,
) as Array<GlossaryTerm>;
