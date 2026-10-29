import { JSONObject } from "../JSON";
import { AiContextActivity } from "./AiContext";
import { LlmProviderActivity } from "./LlmProviderChoice";

/*
 * Shared types for the AI observability chat feature. These shapes are
 * persisted as JSON columns on AIConversationMessage / AIRun / AIRunEvent and
 * rendered by the dashboard, so they must stay JSON-serializable.
 */

/*
 * Where a citation chip should deep-link to in the dashboard. The dashboard
 * maps each target type onto its own RouteMap entry.
 */
export enum AIChatCitationTargetType {
  Logs = "Logs",
  Traces = "Traces",
  TraceView = "TraceView",
  Metrics = "Metrics",
  Exceptions = "Exceptions",
  Incidents = "Incidents",
  IncidentView = "IncidentView",
  Alerts = "Alerts",
  AlertView = "AlertView",
  Monitors = "Monitors",
  MonitorView = "MonitorView",
  ScheduledMaintenanceEvents = "ScheduledMaintenanceEvents",
  ScheduledMaintenanceView = "ScheduledMaintenanceView",
  OnCallPolicies = "OnCallPolicies",
  OnCallPolicyView = "OnCallPolicyView",
  StatusPages = "StatusPages",
  StatusPageView = "StatusPageView",
  Slos = "Slos",
  SloView = "SloView",
  Runbooks = "Runbooks",
  RunbookView = "RunbookView",
  Workflows = "Workflows",
  WorkflowView = "WorkflowView",
  Probes = "Probes",
  Teams = "Teams",
  SecurityEvents = "SecurityEvents",
  // The security case queue, and one case; params: { securityCaseId }.
  SecurityCases = "SecurityCases",
  SecurityCaseView = "SecurityCaseView",
  // Threat Intel: the feeds and the indicators they hold.
  ThreatIntel = "ThreatIntel",
  SecurityPlaybooks = "SecurityPlaybooks",
  RumApplications = "RumApplications",
  RumApplicationView = "RumApplicationView",
  TelemetryResources = "TelemetryResources",
  TelemetryResourceView = "TelemetryResourceView",
  // One telemetry service's page; params: { serviceId }.
  ServiceView = "ServiceView",
  /*
   * The Profiler; params: { serviceId?, profileType?, startTime?, endTime? }
   * open it on the profiles the evidence was read from.
   */
  Profiles = "Profiles",
  /*
   * Data Security: the data stores and one store ({ dataStoreId }), the
   * issues and one issue ({ dataSecurityIssueId }), and who can reach what.
   */
  DataStores = "DataStores",
  DataStoreView = "DataStoreView",
  DataSecurityIssues = "DataSecurityIssues",
  DataSecurityIssueView = "DataSecurityIssueView",
  DataSecurityAccess = "DataSecurityAccess",
}

export interface AIChatCitationTarget {
  type: AIChatCitationTargetType;
  // Route params keyed by param name (e.g. { traceId: "abc" }).
  params?: { [key: string]: string };
}

/*
 * Citations are minted server-side from validated tool arguments — never by
 * the model. rowCount 0 is meaningful: it is proof of absence ("checked,
 * found nothing").
 */
export interface AIChatCitation {
  id: string; // "C1", "C2" — sequential per message
  toolName: string;
  label: string;
  queryArguments: JSONObject; // validated tool args as executed — replayable
  rowCount: number;
  target?: AIChatCitationTarget | undefined;
}

/*
 * ---------------------------------------------------------------------------
 * Inline widgets
 * ---------------------------------------------------------------------------
 * A tool can attach a widget to its result. The widget is persisted on the
 * assistant message (AIConversationMessage.widgets) and rendered inline in the
 * chat by the dashboard. Widget `data` is type-specific and MUST stay
 * JSON-serializable. Unlike the text sent to the LLM, widget data is built from
 * the RAW rows (not the redacted/truncated LLM payload) because it is rendered
 * back to the same user who already has RBAC access to it.
 */
export enum AIChatWidgetType {
  // A time-series line chart (e.g. a metric aggregated over time).
  TimeSeriesChart = "TimeSeriesChart",
  // A bar chart, optionally stacked (e.g. log volume by severity over time).
  BarChart = "BarChart",
  // A generic sortable table.
  Table = "Table",
  // A trace waterfall (span tree with durations).
  TraceWaterfall = "TraceWaterfall",
  // A list of incident cards.
  IncidentList = "IncidentList",
  // A list of alert cards.
  AlertList = "AlertList",
  // A list of exception cards.
  ExceptionList = "ExceptionList",
  // KPI stat tiles.
  StatCards = "StatCards",
  // A single created/updated resource (e.g. the incident the agent just made).
  ResourceCard = "ResourceCard",
}

/*
 * One point in a chart series. x is an ISO timestamp (time charts) or a
 * category label (categorical charts); y is the numeric value.
 */
export interface AIChatWidgetPoint {
  x: string;
  y: number | null;
}

export interface AIChatWidgetSeries {
  name: string;
  points: Array<AIChatWidgetPoint>;
}

export interface AIChatWidgetColumn {
  key: string;
  title: string;
  // Rough hint for alignment/formatting in the renderer.
  type?: "text" | "number" | "date" | undefined;
}

export interface AIChatWidgetStat {
  label: string;
  value: string | number;
  unit?: string | undefined;
}

export interface AIChatWidgetSpan {
  spanId: string;
  parentSpanId?: string | undefined;
  name: string;
  // Offset of the span start from the trace start, in milliseconds.
  startOffsetMs: number;
  durationMs: number;
  isError: boolean;
  serviceName?: string | undefined;
}

/*
 * Type-specific widget payload. Only the fields relevant to `type` are set:
 * - TimeSeriesChart / BarChart: `series` (+ `stacked`, `unit`, `xIsTime`)
 * - Table: `columns` + `rows`
 * - TraceWaterfall: `spans` + `totalDurationMs`
 * - IncidentList / AlertList / ExceptionList: `items`
 * - StatCards: `stats`
 * - ResourceCard: `resourceType`, `heading`, `subheading`, `fields`, `link`
 */
export interface AIChatWidgetData {
  series?: Array<AIChatWidgetSeries> | undefined;
  stacked?: boolean | undefined;
  xIsTime?: boolean | undefined;
  unit?: string | undefined;
  valueLabel?: string | undefined;
  columns?: Array<AIChatWidgetColumn> | undefined;
  rows?: Array<JSONObject> | undefined;
  spans?: Array<AIChatWidgetSpan> | undefined;
  totalDurationMs?: number | undefined;
  items?: Array<JSONObject> | undefined;
  stats?: Array<AIChatWidgetStat> | undefined;
  resourceType?: string | undefined;
  heading?: string | undefined;
  subheading?: string | undefined;
  fields?: Array<{ label: string; value: string }> | undefined;
  link?: AIChatCitationTarget | undefined;
}

export interface AIChatWidget {
  id: string; // "W1", "W2" — sequential per message
  citationId?: string | undefined; // correlates to the citation of the same tool call
  type: AIChatWidgetType;
  title: string;
  description?: string | undefined;
  data: AIChatWidgetData;
}

/*
 * ---------------------------------------------------------------------------
 * Tool actions (mutations + approvals)
 * ---------------------------------------------------------------------------
 * When the agent wants to run a mutating tool it records an AIChatToolAction on
 * the assistant message. In "Ask for approval" mode the action starts Pending
 * and the run pauses until the user approves/denies it; the resumed run then
 * executes approved actions and marks them Executed/Failed.
 */
export enum AIChatToolActionStatus {
  Pending = "Pending", // awaiting the user's decision
  Approved = "Approved", // user approved; not yet executed
  Denied = "Denied", // user declined
  Executed = "Executed", // ran successfully
  Failed = "Failed", // ran but failed
  Skipped = "Skipped", // not run (e.g. budget exhausted)
}

export interface AIChatToolAction {
  id: string; // equals the LLM tool call id
  toolName: string;
  title: string; // human label, e.g. "Create incident: Checkout is down"
  description?: string | undefined;
  arguments: JSONObject;
  isMutation: boolean;
  requiresApproval: boolean;
  status: AIChatToolActionStatus;
  resultSummary?: string | undefined;
}

export interface AIRunEventResultSummary {
  rowCount?: number | undefined;
  durationInMs?: number | undefined;
  isTruncated?: boolean | undefined;
  bytesSentToLlm?: number | undefined;
  errorMessage?: string | undefined;
  /*
   * Human-readable text for events that carry a message rather than query
   * stats — e.g. ProgressLog lines from the code-fix agent, or "Opened pull
   * request …" on ActionExecuted. Rendered by the run activity feed.
   */
  message?: string | undefined;
  // Log severity for ProgressLog events (Info/Warning/Error/…).
  severity?: string | undefined;
  /*
   * The server-minted citation label and deep-link target of the tool call
   * that completed (ToolCallCompleted events of autonomous investigations).
   * Persisted so the investigation panel can show exactly what each [C#]
   * checked without re-parsing the report text.
   */
  citationLabel?: string | undefined;
  citationTarget?: AIChatCitationTarget | undefined;
  /*
   * What was left out of the incident's or alert's text before the model
   * read it (ProgressLog events of autonomous investigations; see
   * Common/Utils/AI/PromptText). The run's activity says so in the reader's
   * language; `message` says the same in English.
   */
  promptOmissions?: AIPromptOmissions | undefined;
  /*
   * The infrastructure an investigation's subject is linked to, and how
   * many open or recent alerts were on it (ProgressLog events; see
   * Server/Utils/AI/SRE/LinkedInfrastructureContext). Worded in the
   * reader's language by the run's activity; `message` is the English.
   */
  linkedInfrastructure?: LinkedInfrastructureActivity | undefined;
  /*
   * Why an investigation checked its incident again: the alert that opened
   * on the incident's linked infrastructure after the first analysis
   * (ProgressLog events; see Server/Utils/AI/SRE/IncidentFollowUpCheck).
   */
  followUpCheck?: FollowUpCheckActivity | undefined;
  /*
   * The changes recorded before an investigation's subject, and how many of
   * them its service's telemetry made suspects (ProgressLog events; see
   * Server/Utils/AI/SRE/RecentChangesContext). Worded in the reader's
   * language by the run's activity; `message` is the English.
   */
  recentChanges?: RecentChangesActivity | undefined;
  /*
   * The LLM provider a run a rule picked one for used, or why it used
   * another (ProgressLog events; see Common/Types/AI/LlmProviderChoice and
   * Server/Utils/AI/LlmProviderChoice). Worded in the reader's language by
   * the run's activity; `message` is the English.
   */
  llmProvider?: LlmProviderActivity | undefined;
  /*
   * What the run read of the AI context the project's team wrote for
   * OneUptime AI - the project's, and the AI rules' that started it - word
   * for word (ProgressLog events; see Common/Types/AI/AiContext). The
   * run's activity draws a line that opens to show it, in the reader's
   * language; `message` is the English.
   */
  aiContext?: AiContextActivity | undefined;
}

// What an investigation read about the changes recorded before its subject.
export interface RecentChangesActivity {
  // The changes listed in the starting context.
  changeCount: number;
  // How many of them were followed by a jump in their service's telemetry.
  suspectCount: number;
  // How many of them had their service's telemetry checked.
  checkedCount: number;
  // True when more changes were recorded than were listed.
  hasMoreChanges: boolean;
  // How far before the subject a change counted.
  lookbackMinutes: number;
}

// What an investigation read about its subject's linked infrastructure.
export interface LinkedInfrastructureActivity {
  /*
   * The linked resources, in display order: `kind` is the kind of resource
   * (LinkedAffectedResourceType: Host, DockerHost, KubernetesCluster, ...).
   */
  resources: Array<{ kind: string; name: string }>;
  // The alerts listed: opened in the lookback before the subject, or still open.
  alertCount: number;
  // How many of them were still open.
  openAlertCount: number;
  // True when more alerts matched than were listed.
  hasMoreAlerts: boolean;
  // How far before the subject an alert counted.
  lookbackMinutes: number;
}

// The alert that made OneUptime AI check an incident again.
export interface FollowUpCheckActivity {
  alertNumber?: number | undefined;
  alertNumberWithPrefix?: string | undefined;
  // The linked resource it opened on.
  resourceKind: string;
  resourceName: string;
  // Whole minutes between the incident and the alert opening.
  minutesAfterIncident: number;
}

/*
 * What a prompt left out of the text it was built from (see
 * Common/Utils/AI/PromptText): the images and other data embedded in it -
 * a synthetic monitor's screenshot in a description is hundreds of
 * kilobytes of base64, which a model reads as noise and is billed for as
 * text - and the end of a text longer than its field may take.
 */
export interface AIPromptOmissions {
  // Images left out: data: URLs of images, and base64 whose bytes are one.
  imageCount: number;
  // Their size, in bytes.
  imageBytes: number;
  // Other encoded data left out: other data: URLs, long runs of base64.
  encodedDataCount: number;
  // Its size, in bytes (characters, for a run that may not be base64).
  encodedDataBytes: number;
  // Texts cut to the length their field may take.
  shortenedTextCount: number;
  // The characters those cuts left out.
  omittedCharacterCount: number;
}

/*
 * The verbatim content behind one run event — the raw material for debugging
 * a bad run: exactly what was sent to the model, exactly what it said back,
 * and exactly what a tool returned.
 *
 * This is the ONLY place a code-fix run's LLM content is persisted. It lives
 * on AIRunEvent.contentPayload, whose read ACL is empty precisely because
 * this content embeds customer source code: LlmLog deliberately redacts the
 * same content (CodeFixAgentCompletion passes storeContentPreviews: false)
 * because LlmLog is readable project-wide, and that redaction stays. Reach it
 * only through GET /code-fix-run/logs, which gates on ProjectOwner or
 * ProjectAdmin — the same "sensitive content behind a narrow endpoint" shape
 * AIRun.pausedState and AIRun.taskContext already use.
 *
 * Every field is capped at write time (see AIRunTranscript.ts) so one run can
 * never write an unbounded row.
 */
export interface AIRunEventContentPayload {
  // Messages newly sent to the model on this call — not the whole history.
  requestMessages?: Array<{
    role: string;
    content: string;
  }>;
  // The model's verbatim reply.
  responseContent?: string | undefined;
  // Tool calls the model asked for, with their full arguments.
  responseToolCalls?: Array<{
    id?: string | undefined;
    name: string;
    arguments?: JSONObject | undefined;
  }>;
  // A tool's verbatim return value (for tool events).
  toolResult?: string | undefined;
  modelName?: string | undefined;
  stopReason?: string | undefined;
  promptTokens?: number | undefined;
  completionTokens?: number | undefined;
  totalTokens?: number | undefined;
  // Set when any field above was clipped to its cap.
  isTruncated?: boolean | undefined;
}

// What was sent to which LLM during a run — the per-run egress manifest.
export interface AIRunEgressManifestToolEntry {
  toolName: string;
  rowCount: number;
  bytesSentToLlm: number;
  redactionCount: number;
}

/*
 * The serialized in-flight state of a turn that paused to wait for tool
 * approval. Persisted on AIRun.pausedState so ChatAgentRunner.resumeTurn can
 * rehydrate the exact conversation and continue the loop. `messages` and
 * `pendingToolCalls` are JSON projections of the runner's internal
 * LLMMessage / LLMToolCall types (kept as JSONObject here so this shared type
 * does not depend on server code).
 */
export interface AIRunPausedState {
  messages: Array<JSONObject>;
  pendingToolCalls: Array<JSONObject>;
  llmCallCount: number;
  toolCallCount: number;
  totalTokens: number;
  totalCostInUSDCents: number;
  eventSequence: number;
  citations: Array<AIChatCitation>;
  widgets: Array<AIChatWidget>;
  toolActions: Array<AIChatToolAction>;
  egressToolEntries: Array<AIRunEgressManifestToolEntry>;
  startedAtMs: number;
}

export interface AIRunEgressManifest {
  llmProviderName?: string | undefined;
  llmType?: string | undefined;
  modelName?: string | undefined;
  isGlobalProvider?: boolean | undefined;
  llmCallCount: number;
  totalTokens: number;
  toolDataSentToLlm: Array<AIRunEgressManifestToolEntry>;
}
