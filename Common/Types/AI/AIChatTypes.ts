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

export interface AIRunEgressManifest {
  llmProviderName?: string | undefined;
  llmType?: string | undefined;
  modelName?: string | undefined;
  isGlobalProvider?: boolean | undefined;
  llmCallCount: number;
  totalTokens: number;
  toolDataSentToLlm: Array<AIRunEgressManifestToolEntry>;
}
