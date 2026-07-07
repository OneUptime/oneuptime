import { JSONObject } from "../JSON";

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

// One point in a chart series. x is an ISO timestamp (time charts) or a
// category label (categorical charts); y is the numeric value.
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
