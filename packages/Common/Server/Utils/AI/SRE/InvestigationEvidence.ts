import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import {
  AIChatCitationTarget,
  AIChatCitationTargetType,
  AIRunEventResultSummary,
} from "../../../../Types/AI/AIChatTypes";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import { InvestigationEvidenceItem } from "../../../../Types/AI/InvestigationEvidence";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  InvestigationEvidenceCheckedEntry,
  parseInvestigationReport,
} from "../../../../Utils/AI/InvestigationReport";
import AIToolbox from "../Toolbox/Index";
import { ObservabilityTool } from "../Toolbox/ToolTypes";

/*
 * Structured evidence for an AI investigation report, rebuilt from the run's
 * own AIRunEvent trail.
 *
 * The report markdown only carries a flat "Evidence checked" list of labels.
 * Every [C#] it cites was minted server-side by a completed tool call, and the
 * engine persists that call as a ToolCallCompleted event (citation id, row
 * count, duration and — for runs recorded after this module shipped — the
 * label, the deep-link target and the arguments). Older runs only stored the
 * arguments on the preceding ToolCallStarted event and had no label/target,
 * so those are recovered by pairing and by deriving the target the tool
 * would have minted.
 *
 * Pure: no database access. Callers load the events (as root, after checking
 * the viewer can read the subject) and hand them in.
 */

/*
 * Tools the investigation engine hides from itself. They can never have
 * produced a citation in an investigation, and re-running them on a viewer's
 * behalf would read (or start!) AI runs rather than telemetry.
 */
export const EVIDENCE_EXCLUDED_TOOL_NAMES: ReadonlyArray<string> = [
  "get_ai_investigation",
  "start_investigation",
];

// Sanitisation limits for the arguments shipped to every viewer of the panel.
export const MAX_EVIDENCE_ARGUMENT_KEYS: number = 25;
export const MAX_EVIDENCE_ARGUMENT_ARRAY_ITEMS: number = 20;
export const MAX_EVIDENCE_ARGUMENT_STRING_LENGTH: number = 300;
const MAX_EVIDENCE_ARGUMENT_KEY_LENGTH: number = 100;
const MAX_EVIDENCE_LABEL_LENGTH: number = 500;

// "C1" … "C999" — the shape the agent loop mints and the evidence route accepts.
export const EVIDENCE_CITATION_ID_REGEX: RegExp = /^C(\d{1,3})$/;

// OpenTelemetry trace ids are hex (16 bytes → 32 chars; allow 8–32 bytes).
const TRACE_ID_REGEX: RegExp = /^[0-9a-fA-F]{16,64}$/;

// Keys that could reach an object's prototype chain when assigned.
const UNSAFE_ARGUMENT_KEYS: ReadonlySet<string> = new Set<string>([
  "__proto__",
  "constructor",
  "prototype",
]);

const CITATION_TARGET_TYPES: ReadonlySet<string> = new Set<string>(
  Object.values(AIChatCitationTargetType) as Array<string>,
);

/*
 * One cited tool call: the evidence item the panel renders, plus the
 * unsanitised arguments and start time the evidence route needs to re-run
 * it. The raw arguments never leave the server.
 */
export interface InvestigationToolCallRecord {
  item: InvestigationEvidenceItem;
  rawArguments: JSONObject;
  // createdAt of the paired ToolCallStarted event, when there is one.
  startedAt?: Date | undefined;
}

export interface BuildInvestigationEvidenceInput {
  // The run's events in sequence order.
  events: Array<AIRunEvent>;
  // The published report, used only for legacy label fallbacks.
  analysisMarkdown: string | null;
}

export function isRerunnableEvidenceTool(toolName: string): boolean {
  if (!toolName || EVIDENCE_EXCLUDED_TOOL_NAMES.includes(toolName)) {
    return false;
  }

  const tool: ObservabilityTool | undefined = AIToolbox.getToolByName(toolName);

  return Boolean(tool) && !tool?.isMutation;
}

export function getCitationNumber(citationId: string): number | null {
  const match: RegExpExecArray | null =
    EVIDENCE_CITATION_ID_REGEX.exec(citationId);

  if (!match) {
    return null;
  }

  return Number(match[1]);
}

/*
 * A readable name for a tool when neither the event nor the report carries a
 * label: "query_metrics" → "Metrics query", "get_trace" → "Trace lookup".
 */
export function humanizeToolName(toolName: string): string {
  const words: Array<string> = (toolName || "")
    .split(/[_\s]+/)
    .map((word: string): string => {
      return word.trim().toLowerCase();
    })
    .filter((word: string): boolean => {
      return word.length > 0;
    });

  if (words.length === 0) {
    return "Query";
  }

  const verbNouns: { [verb: string]: string } = {
    query: "query",
    search: "search",
    get: "lookup",
    find: "lookup",
    lookup: "lookup",
    list: "list",
    read: "read",
  };

  const firstWord: string = words[0]!;
  let phraseWords: Array<string> = words;

  if (verbNouns[firstWord] && words.length > 1) {
    phraseWords = [...words.slice(1), verbNouns[firstWord]!];
  }

  const casedWords: Array<string> = phraseWords.map((word: string): string => {
    if (word === "ai") {
      return "AI";
    }

    if (word === "slo" || word === "slos") {
      return word.toUpperCase().replace(/S$/, "s");
    }

    return word;
  });

  const phrase: string = casedWords
    .join(" ")
    .replace(/\bon call\b/g, "on-call");

  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

function readString(args: JSONObject, key: string): string | undefined {
  const value: unknown = args[key];

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed: string = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

function readUUID(args: JSONObject, key: string): string | undefined {
  const value: string | undefined = readString(args, key);

  return value && ObjectID.isValidUUID(value) ? value : undefined;
}

function viewOrList(data: {
  id: string | undefined;
  paramName: string;
  viewType: AIChatCitationTargetType;
  listType: AIChatCitationTargetType;
}): AIChatCitationTarget {
  if (data.id) {
    return { type: data.viewType, params: { [data.paramName]: data.id } };
  }

  return { type: data.listType };
}

/*
 * The target a tool would have minted, for runs recorded before targets were
 * persisted. Mirrors the tools' own citationTarget logic. Ids are validated
 * (UUIDs, hex trace ids) so a malformed model argument can never end up as a
 * route parameter — an invalid id falls back to the list page.
 */
export function deriveCitationTarget(
  toolName: string,
  args: JSONObject,
): AIChatCitationTarget | undefined {
  switch (toolName) {
    case "query_incidents":
    case "get_incident_timeline":
      return viewOrList({
        id: readUUID(args, "incidentId"),
        paramName: "incidentId",
        viewType: AIChatCitationTargetType.IncidentView,
        listType: AIChatCitationTargetType.Incidents,
      });
    case "search_incidents":
      return { type: AIChatCitationTargetType.Incidents };
    case "query_alerts":
    case "get_alert_timeline":
      return viewOrList({
        id: readUUID(args, "alertId"),
        paramName: "alertId",
        viewType: AIChatCitationTargetType.AlertView,
        listType: AIChatCitationTargetType.Alerts,
      });
    case "query_monitors":
      return viewOrList({
        id: readUUID(args, "monitorId"),
        paramName: "monitorId",
        viewType: AIChatCitationTargetType.MonitorView,
        listType: AIChatCitationTargetType.Monitors,
      });
    case "get_trace": {
      const traceId: string | undefined = readString(args, "traceId");

      return viewOrList({
        id: traceId && TRACE_ID_REGEX.test(traceId) ? traceId : undefined,
        paramName: "traceId",
        viewType: AIChatCitationTargetType.TraceView,
        listType: AIChatCitationTargetType.Traces,
      });
    }
    case "query_traces":
      return { type: AIChatCitationTargetType.Traces };
    case "search_logs":
    case "log_histogram":
      return { type: AIChatCitationTargetType.Logs };
    case "query_metrics":
    case "baseline_anomaly":
      return { type: AIChatCitationTargetType.Metrics };
    case "top_exceptions":
    case "find_code_for_exception":
      return { type: AIChatCitationTargetType.Exceptions };
    case "query_scheduled_maintenance":
      return viewOrList({
        id: readUUID(args, "scheduledMaintenanceId"),
        paramName: "scheduledMaintenanceId",
        viewType: AIChatCitationTargetType.ScheduledMaintenanceView,
        listType: AIChatCitationTargetType.ScheduledMaintenanceEvents,
      });
    case "query_probes":
      return { type: AIChatCitationTargetType.Probes };
    case "search_security_events":
    case "security_event_summary":
      return { type: AIChatCitationTargetType.SecurityEvents };
    case "query_on_call_policies":
    case "get_on_call_status":
    case "query_on_call_pages":
      return viewOrList({
        id: readUUID(args, "onCallPolicyId"),
        paramName: "onCallDutyPolicyId",
        viewType: AIChatCitationTargetType.OnCallPolicyView,
        listType: AIChatCitationTargetType.OnCallPolicies,
      });
    case "query_status_pages":
    case "query_status_page_announcements":
      return viewOrList({
        id: readUUID(args, "statusPageId"),
        paramName: "statusPageId",
        viewType: AIChatCitationTargetType.StatusPageView,
        listType: AIChatCitationTargetType.StatusPages,
      });
    case "query_slos":
      return viewOrList({
        id: readUUID(args, "sloId"),
        paramName: "sloId",
        viewType: AIChatCitationTargetType.SloView,
        listType: AIChatCitationTargetType.Slos,
      });
    case "query_runbooks":
      return viewOrList({
        id: readUUID(args, "runbookId"),
        paramName: "runbookId",
        viewType: AIChatCitationTargetType.RunbookView,
        listType: AIChatCitationTargetType.Runbooks,
      });
    case "query_workflows":
      return viewOrList({
        id: readUUID(args, "workflowId"),
        paramName: "workflowId",
        viewType: AIChatCitationTargetType.WorkflowView,
        listType: AIChatCitationTargetType.Workflows,
      });
    case "query_teams":
      return { type: AIChatCitationTargetType.Teams };
    default:
      return undefined;
  }
}

function sanitizeArgumentPrimitive(
  value: unknown,
): string | number | boolean | undefined {
  if (typeof value === "string") {
    return value.length > MAX_EVIDENCE_ARGUMENT_STRING_LENGTH
      ? value.substring(0, MAX_EVIDENCE_ARGUMENT_STRING_LENGTH)
      : value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return undefined;
}

/*
 * The arguments as shown to viewers: primitives and arrays of primitives only
 * (max 20 items), strings clipped to 300 characters, at most 25 keys. Nested
 * objects, nulls and non-finite numbers are dropped.
 */
export function sanitizeEvidenceArguments(args: unknown): JSONObject {
  const sanitized: JSONObject = {};

  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return sanitized;
  }

  let keyCount: number = 0;

  for (const [key, value] of Object.entries(args as JSONObject)) {
    if (keyCount >= MAX_EVIDENCE_ARGUMENT_KEYS) {
      break;
    }

    if (
      !key ||
      key.length > MAX_EVIDENCE_ARGUMENT_KEY_LENGTH ||
      UNSAFE_ARGUMENT_KEYS.has(key)
    ) {
      continue;
    }

    if (Array.isArray(value)) {
      const items: Array<string | number | boolean> = [];

      for (const item of value) {
        const sanitizedItem: string | number | boolean | undefined =
          sanitizeArgumentPrimitive(item);

        if (sanitizedItem !== undefined) {
          items.push(sanitizedItem);
        }

        if (items.length >= MAX_EVIDENCE_ARGUMENT_ARRAY_ITEMS) {
          break;
        }
      }

      // An array of only unsupported values says nothing — drop the key.
      if (items.length === 0 && value.length > 0) {
        continue;
      }

      sanitized[key] = items;
      keyCount++;
      continue;
    }

    const sanitizedValue: string | number | boolean | undefined =
      sanitizeArgumentPrimitive(value);

    if (sanitizedValue === undefined) {
      continue;
    }

    sanitized[key] = sanitizedValue;
    keyCount++;
  }

  return sanitized;
}

// A persisted target, accepted only when it has a known type and string params.
function readPersistedTarget(value: unknown): AIChatCitationTarget | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const candidate: JSONObject = value as JSONObject;
  const type: unknown = candidate["type"];

  if (typeof type !== "string" || !CITATION_TARGET_TYPES.has(type)) {
    return undefined;
  }

  const target: AIChatCitationTarget = {
    type: type as AIChatCitationTargetType,
  };

  const params: unknown = candidate["params"];

  if (params && typeof params === "object" && !Array.isArray(params)) {
    const stringParams: { [key: string]: string } = {};

    for (const [key, paramValue] of Object.entries(params as JSONObject)) {
      if (
        typeof paramValue === "string" &&
        paramValue.length > 0 &&
        !UNSAFE_ARGUMENT_KEYS.has(key)
      ) {
        stringParams[key] = paramValue;
      }
    }

    if (Object.keys(stringParams).length > 0) {
      target.params = stringParams;
    }
  }

  return target;
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? undefined : value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed: Date = new Date(value);
    return isNaN(parsed.getTime()) ? undefined : parsed;
  }

  return undefined;
}

function readObject(value: unknown): JSONObject | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JSONObject;
  }

  return undefined;
}

function readNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function clipLabel(label: string): string {
  return label.length > MAX_EVIDENCE_LABEL_LENGTH
    ? `${label.substring(0, MAX_EVIDENCE_LABEL_LENGTH - 1)}…`
    : label;
}

/*
 * Events of the attempt that produced the report: citation ids restart at C1
 * on every retried attempt, so only events after the LATEST RunStarted count.
 */
function getLatestAttemptEvents(events: Array<AIRunEvent>): Array<AIRunEvent> {
  let latestRunStartedIndex: number = -1;

  events.forEach((event: AIRunEvent, index: number): void => {
    if (event.eventType === AIRunEventType.RunStarted) {
      latestRunStartedIndex = index;
    }
  });

  return events.slice(latestRunStartedIndex + 1);
}

/*
 * Every cited tool call of the latest attempt, sorted by citation number.
 * Each ToolCallCompleted/ToolCallFailed consumes the nearest preceding
 * unpaired ToolCallStarted of the same tool, which is how legacy runs (whose
 * completed events carry no arguments) recover what was asked.
 */
export function collectInvestigationToolCalls(
  data: BuildInvestigationEvidenceInput,
): Array<InvestigationToolCallRecord> {
  const attemptEvents: Array<AIRunEvent> = getLatestAttemptEvents(
    data.events || [],
  );

  const unpairedStarts: Array<AIRunEvent> = [];
  const records: Array<InvestigationToolCallRecord> = [];
  const seenCitationIds: Set<string> = new Set<string>();

  let evidenceChecked: Array<InvestigationEvidenceCheckedEntry> | undefined =
    undefined;

  const getEvidenceCheckedLabel: (citationId: string) => string | undefined = (
    citationId: string,
  ): string | undefined => {
    if (evidenceChecked === undefined) {
      evidenceChecked = data.analysisMarkdown
        ? parseInvestigationReport(data.analysisMarkdown).evidenceChecked
        : [];
    }

    const entry: InvestigationEvidenceCheckedEntry | undefined =
      evidenceChecked.find((candidate: InvestigationEvidenceCheckedEntry) => {
        return candidate.citationId === citationId;
      });

    const label: string = (entry?.label || "").trim();

    return label || undefined;
  };

  for (const event of attemptEvents) {
    if (event.eventType === AIRunEventType.ToolCallStarted) {
      unpairedStarts.push(event);
      continue;
    }

    if (
      event.eventType !== AIRunEventType.ToolCallCompleted &&
      event.eventType !== AIRunEventType.ToolCallFailed
    ) {
      continue;
    }

    const toolName: string = event.toolName || "";

    let startedEvent: AIRunEvent | undefined = undefined;

    for (let index: number = unpairedStarts.length - 1; index >= 0; index--) {
      if ((unpairedStarts[index]!.toolName || "") === toolName) {
        startedEvent = unpairedStarts.splice(index, 1)[0];
        break;
      }
    }

    if (event.eventType !== AIRunEventType.ToolCallCompleted) {
      continue;
    }

    const citationId: string = (event.citationId || "").trim();

    if (
      !toolName ||
      getCitationNumber(citationId) === null ||
      seenCitationIds.has(citationId)
    ) {
      continue;
    }

    seenCitationIds.add(citationId);

    const resultSummary: AIRunEventResultSummary =
      (readObject(event.resultSummary) as AIRunEventResultSummary) || {};

    const rawArguments: JSONObject =
      readObject(event.toolArguments) ||
      readObject(startedEvent?.toolArguments) ||
      {};

    const startedAt: Date | undefined = toDate(startedEvent?.createdAt);
    const executedAt: Date | undefined =
      startedAt || toDate(event.createdAt) || undefined;

    const persistedLabel: string =
      typeof resultSummary.citationLabel === "string"
        ? resultSummary.citationLabel.trim()
        : "";

    const label: string = clipLabel(
      persistedLabel ||
        getEvidenceCheckedLabel(citationId) ||
        humanizeToolName(toolName),
    );

    const target: AIChatCitationTarget | undefined =
      readPersistedTarget(resultSummary.citationTarget) ||
      deriveCitationTarget(toolName, rawArguments);

    const durationInMs: number | undefined = readNonNegativeNumber(
      resultSummary.durationInMs,
    );

    const item: InvestigationEvidenceItem = {
      citationId,
      toolName,
      label,
      rowCount: Math.floor(readNonNegativeNumber(resultSummary.rowCount) || 0),
      queryArguments: sanitizeEvidenceArguments(rawArguments),
      canLoadRows: isRerunnableEvidenceTool(toolName),
    };

    if (durationInMs !== undefined) {
      item.durationInMs = durationInMs;
    }

    if (target) {
      item.target = target;
    }

    if (executedAt) {
      item.executedAt = executedAt.toISOString();
    }

    records.push({
      item,
      rawArguments,
      ...(startedAt ? { startedAt } : {}),
    });
  }

  return records.sort(
    (
      a: InvestigationToolCallRecord,
      b: InvestigationToolCallRecord,
    ): number => {
      return (
        (getCitationNumber(a.item.citationId) || 0) -
        (getCitationNumber(b.item.citationId) || 0)
      );
    },
  );
}

export function buildInvestigationEvidence(
  data: BuildInvestigationEvidenceInput,
): Array<InvestigationEvidenceItem> {
  return collectInvestigationToolCalls(data).map(
    (record: InvestigationToolCallRecord): InvestigationEvidenceItem => {
      return record.item;
    },
  );
}

// The latest attempt's tool call behind one citation, or null.
export function findInvestigationToolCall(data: {
  events: Array<AIRunEvent>;
  citationId: string;
}): InvestigationToolCallRecord | null {
  return (
    collectInvestigationToolCalls({
      events: data.events,
      analysisMarkdown: null,
    }).find((record: InvestigationToolCallRecord): boolean => {
      return record.item.citationId === data.citationId;
    }) || null
  );
}
