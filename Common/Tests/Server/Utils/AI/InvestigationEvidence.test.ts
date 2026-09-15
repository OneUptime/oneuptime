/*
 * Index MUST be imported before anything that reaches a tool module. The
 * toolbox sits in an import cycle (tool -> service -> ... ->
 * ObservabilityAssistant -> AIToolbox); entering through Index first is the
 * production order and keeps the registered tools array free of holes.
 */
import AIToolbox, {
  ToolCallOutcome,
} from "../../../../Server/Utils/AI/Toolbox/Index";
import {
  buildInvestigationEvidence,
  collectInvestigationToolCalls,
  deriveCitationTarget,
  EVIDENCE_EXCLUDED_TOOL_NAMES,
  findInvestigationToolCall,
  getCitationNumber,
  humanizeToolName,
  InvestigationToolCallRecord,
  isRerunnableEvidenceTool,
  MAX_EVIDENCE_ARGUMENT_ARRAY_ITEMS,
  MAX_EVIDENCE_ARGUMENT_KEYS,
  MAX_EVIDENCE_ARGUMENT_STRING_LENGTH,
  sanitizeEvidenceArguments,
} from "../../../../Server/Utils/AI/SRE/InvestigationEvidence";
import AIInvestigationEngine, {
  InvestigationRequest,
} from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import ObservabilityAssistant, {
  ObservabilityAssistantRequest,
  ObservabilityAssistantResult,
  ObservabilityAssistantStep,
} from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import AIService, {
  AILogResponse,
} from "../../../../Server/Services/AIService";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../Server/Services/AIRunService";
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
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The investigation panel lists every query the AI ran and lets a responder
 * load the rows behind it. That list is rebuilt from the run's own event
 * trail — never from the report text a model wrote — so these tests pin how
 * events pair up, which attempt counts, how labels and deep links are
 * recovered for older runs, what argument data may reach a viewer, and which
 * tools may ever be re-run.
 */

const INCIDENT_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ALERT_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MONITOR_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";

let nextSequence: number = 0;

function makeEvent(data: {
  eventType: AIRunEventType;
  toolName?: string | undefined;
  toolArguments?: JSONObject | undefined;
  resultSummary?: AIRunEventResultSummary | undefined;
  citationId?: string | undefined;
  createdAt?: Date | string | undefined;
}): AIRunEvent {
  const event: AIRunEvent = new AIRunEvent();
  event.sequence = nextSequence++;
  event.eventType = data.eventType;

  if (data.toolName !== undefined) {
    event.toolName = data.toolName;
  }
  if (data.toolArguments !== undefined) {
    event.toolArguments = data.toolArguments;
  }
  if (data.resultSummary !== undefined) {
    event.resultSummary = data.resultSummary;
  }
  if (data.citationId !== undefined) {
    event.citationId = data.citationId;
  }
  if (data.createdAt !== undefined) {
    event.createdAt = data.createdAt as Date;
  }

  return event;
}

function runStarted(): AIRunEvent {
  return makeEvent({ eventType: AIRunEventType.RunStarted });
}

function started(
  toolName: string,
  toolArguments: JSONObject,
  createdAt: string = "2026-09-14T18:01:00.000Z",
): AIRunEvent {
  return makeEvent({
    eventType: AIRunEventType.ToolCallStarted,
    toolName,
    toolArguments,
    createdAt: new Date(createdAt),
  });
}

function completed(data: {
  toolName: string;
  citationId?: string | undefined;
  rowCount?: number | undefined;
  durationInMs?: number | undefined;
  toolArguments?: JSONObject | undefined;
  citationLabel?: string | undefined;
  citationTarget?: AIChatCitationTarget | undefined;
  createdAt?: string | undefined;
  resultSummary?: AIRunEventResultSummary | undefined;
}): AIRunEvent {
  const resultSummary: AIRunEventResultSummary = data.resultSummary || {
    rowCount: data.rowCount ?? 3,
    durationInMs: data.durationInMs ?? 120,
  };

  if (data.citationLabel !== undefined) {
    resultSummary.citationLabel = data.citationLabel;
  }
  if (data.citationTarget !== undefined) {
    resultSummary.citationTarget = data.citationTarget;
  }

  return makeEvent({
    eventType: AIRunEventType.ToolCallCompleted,
    toolName: data.toolName,
    citationId: data.citationId,
    toolArguments: data.toolArguments,
    resultSummary,
    createdAt: new Date(data.createdAt || "2026-09-14T18:01:02.000Z"),
  });
}

function failed(toolName: string): AIRunEvent {
  return makeEvent({
    eventType: AIRunEventType.ToolCallFailed,
    toolName,
    resultSummary: { durationInMs: 5, errorMessage: "boom" },
    createdAt: new Date("2026-09-14T18:01:01.000Z"),
  });
}

function evidence(
  events: Array<AIRunEvent>,
  analysisMarkdown: string | null = null,
): Array<InvestigationEvidenceItem> {
  return buildInvestigationEvidence({ events, analysisMarkdown });
}

function onlyItem(
  events: Array<AIRunEvent>,
  analysisMarkdown: string | null = null,
): InvestigationEvidenceItem {
  const items: Array<InvestigationEvidenceItem> = evidence(
    events,
    analysisMarkdown,
  );
  expect(items).toHaveLength(1);
  return items[0]!;
}

beforeEach(() => {
  nextSequence = 0;
});

describe("buildInvestigationEvidence — a run recorded with citation metadata", () => {
  test("describes a cited tool call entirely from its ToolCallCompleted event", () => {
    const items: Array<InvestigationEvidenceItem> = evidence([
      runStarted(),
      makeEvent({ eventType: AIRunEventType.LlmCallStarted }),
      makeEvent({ eventType: AIRunEventType.LlmCallCompleted }),
      started("query_incidents", { state: "active" }),
      completed({
        toolName: "query_incidents",
        citationId: "C1",
        rowCount: 7,
        durationInMs: 412,
        toolArguments: { state: "active" },
        citationLabel: "Active incidents (7 total)",
        citationTarget: { type: AIChatCitationTargetType.Incidents },
      }),
      makeEvent({ eventType: AIRunEventType.RunCompleted }),
    ]);

    expect(items).toEqual([
      {
        citationId: "C1",
        toolName: "query_incidents",
        label: "Active incidents (7 total)",
        rowCount: 7,
        durationInMs: 412,
        queryArguments: { state: "active" },
        target: { type: AIChatCitationTargetType.Incidents },
        executedAt: "2026-09-14T18:01:00.000Z",
        canLoadRows: true,
      },
    ]);
  });

  test("the persisted label and target win over the report text and the derived target", () => {
    const item: InvestigationEvidenceItem = onlyItem(
      [
        runStarted(),
        started("query_incidents", { incidentId: INCIDENT_ID }),
        completed({
          toolName: "query_incidents",
          citationId: "C1",
          citationLabel: "Incident #6954",
          citationTarget: {
            type: AIChatCitationTargetType.IncidentView,
            params: { incidentId: INCIDENT_ID },
          },
        }),
      ],
      "**Summary** — x\n\n**Evidence checked**\n- **[C1]** A different label — 3 row(s)",
    );

    expect(item.label).toBe("Incident #6954");
    expect(item.target).toEqual({
      type: AIChatCitationTargetType.IncidentView,
      params: { incidentId: INCIDENT_ID },
    });
  });

  test("the completed event's own arguments win over the paired start's", () => {
    const item: InvestigationEvidenceItem = onlyItem([
      runStarted(),
      started("search_logs", { bodySearchText: "from the start" }),
      completed({
        toolName: "search_logs",
        citationId: "C1",
        toolArguments: { bodySearchText: "from the completion" },
      }),
    ]);

    expect(item.queryArguments).toEqual({
      bodySearchText: "from the completion",
    });
  });

  test("a persisted target with an unknown type falls back to the derived target", () => {
    const item: InvestigationEvidenceItem = onlyItem([
      runStarted(),
      started("query_monitors", { monitorId: MONITOR_ID }),
      completed({
        toolName: "query_monitors",
        citationId: "C1",
        citationTarget: {
          type: "NotARealPage" as AIChatCitationTargetType,
        },
      }),
    ]);

    expect(item.target).toEqual({
      type: AIChatCitationTargetType.MonitorView,
      params: { monitorId: MONITOR_ID },
    });
  });

  test("a persisted target keeps only string route params", () => {
    const item: InvestigationEvidenceItem = onlyItem([
      runStarted(),
      started("get_trace", { traceId: TRACE_ID }),
      completed({
        toolName: "get_trace",
        citationId: "C1",
        citationTarget: {
          type: AIChatCitationTargetType.TraceView,
          params: {
            traceId: TRACE_ID,
            bogus: 42 as unknown as string,
            empty: "",
          },
        },
      }),
    ]);

    expect(item.target).toEqual({
      type: AIChatCitationTargetType.TraceView,
      params: { traceId: TRACE_ID },
    });
  });

  test("a blank persisted label falls through to the next source", () => {
    const item: InvestigationEvidenceItem = onlyItem([
      runStarted(),
      started("query_metrics", { metricName: "cpu" }),
      completed({
        toolName: "query_metrics",
        citationId: "C1",
        citationLabel: "   ",
      }),
    ]);

    expect(item.label).toBe("Metrics query");
  });

  test("a very long label is clipped with an ellipsis", () => {
    const item: InvestigationEvidenceItem = onlyItem([
      runStarted(),
      started("search_incidents", {}),
      completed({
        toolName: "search_incidents",
        citationId: "C1",
        citationLabel: "x".repeat(2000),
      }),
    ]);

    expect(item.label).toHaveLength(500);
    expect(item.label.endsWith("…")).toBe(true);
  });
});

describe("buildInvestigationEvidence — pairing legacy events", () => {
  test("recovers the arguments and start time from the preceding ToolCallStarted", () => {
    const item: InvestigationEvidenceItem = onlyItem([
      runStarted(),
      started(
        "search_logs",
        {
          startTime: "2026-09-14T17:00:00.000Z",
          bodySearchText: "timeout",
        },
        "2026-09-14T18:02:00.000Z",
      ),
      completed({
        toolName: "search_logs",
        citationId: "C1",
        createdAt: "2026-09-14T18:02:03.000Z",
      }),
    ]);

    expect(item.queryArguments).toEqual({
      startTime: "2026-09-14T17:00:00.000Z",
      bodySearchText: "timeout",
    });
    expect(item.executedAt).toBe("2026-09-14T18:02:00.000Z");
  });

  test("pairs repeated calls of the same tool with their own starts", () => {
    const items: Array<InvestigationEvidenceItem> = evidence([
      runStarted(),
      started("search_logs", { bodySearchText: "first" }),
      completed({ toolName: "search_logs", citationId: "C1" }),
      started("search_logs", { bodySearchText: "second" }),
      completed({ toolName: "search_logs", citationId: "C2" }),
    ]);

    expect(
      items.map((item: InvestigationEvidenceItem): JSONObject => {
        return item.queryArguments;
      }),
    ).toEqual([{ bodySearchText: "first" }, { bodySearchText: "second" }]);
  });

  test("a failed call consumes its own start so the retry is paired correctly", () => {
    const item: InvestigationEvidenceItem = onlyItem([
      runStarted(),
      started("query_metrics", { metricName: "bad.name" }),
      failed("query_metrics"),
      started("query_metrics", { metricName: "good.name" }),
      completed({ toolName: "query_metrics", citationId: "C1" }),
    ]);

    expect(item.queryArguments).toEqual({ metricName: "good.name" });
  });

  test("a completion whose start was lost never inherits a failed call's arguments", () => {
    const item: InvestigationEvidenceItem = onlyItem([
      runStarted(),
      started("query_metrics", { metricName: "the failed call" }),
      failed("query_metrics"),
      // The retry's ToolCallStarted write failed (events are best-effort).
      completed({ toolName: "query_metrics", citationId: "C1" }),
    ]);

    expect(item.queryArguments).toEqual({});
    expect(item.executedAt).toBe("2026-09-14T18:01:02.000Z");
  });

  test("pairs by tool name, taking the nearest unpaired start of that tool", () => {
    const items: Array<InvestigationEvidenceItem> = evidence([
      runStarted(),
      started("search_logs", { bodySearchText: "logs" }),
      started("query_metrics", { metricName: "metric" }),
      completed({ toolName: "query_metrics", citationId: "C1" }),
      completed({ toolName: "search_logs", citationId: "C2" }),
    ]);

    expect(items[0]!.queryArguments).toEqual({ metricName: "metric" });
    expect(items[1]!.queryArguments).toEqual({ bodySearchText: "logs" });
  });

  test("with no start and no arguments, the query is empty and the time is the completion's", () => {
    const item: InvestigationEvidenceItem = onlyItem([
      runStarted(),
      completed({
        toolName: "top_exceptions",
        citationId: "C1",
        createdAt: "2026-09-14T18:05:00.000Z",
      }),
    ]);

    expect(item.queryArguments).toEqual({});
    expect(item.executedAt).toBe("2026-09-14T18:05:00.000Z");
  });

  test("accepts ISO string timestamps as well as Dates", () => {
    const item: InvestigationEvidenceItem = onlyItem([
      runStarted(),
      makeEvent({
        eventType: AIRunEventType.ToolCallStarted,
        toolName: "query_probes",
        toolArguments: {},
        createdAt: "2026-09-14T18:09:00.000Z",
      }),
      completed({ toolName: "query_probes", citationId: "C1" }),
    ]);

    expect(item.executedAt).toBe("2026-09-14T18:09:00.000Z");
  });

  test("omits executedAt when no event carries a usable timestamp", () => {
    const item: InvestigationEvidenceItem = onlyItem([
      runStarted(),
      makeEvent({
        eventType: AIRunEventType.ToolCallCompleted,
        toolName: "query_probes",
        citationId: "C1",
        resultSummary: { rowCount: 1 },
        createdAt: "not a date",
      }),
    ]);

    expect(item).not.toHaveProperty("executedAt");
    expect(item).not.toHaveProperty("durationInMs");
  });
});

describe("buildInvestigationEvidence — attempts, filtering and ordering", () => {
  test("only the latest attempt counts — citation ids restart per attempt", () => {
    const items: Array<InvestigationEvidenceItem> = evidence([
      runStarted(),
      started("query_incidents", { state: "active" }),
      completed({
        toolName: "query_incidents",
        citationId: "C1",
        citationLabel: "From the failed attempt",
      }),
      completed({
        toolName: "query_alerts",
        citationId: "C2",
        citationLabel: "Also from the failed attempt",
      }),
      makeEvent({ eventType: AIRunEventType.RunFailed }),
      runStarted(),
      started("search_logs", { bodySearchText: "retry" }),
      completed({
        toolName: "search_logs",
        citationId: "C1",
        citationLabel: "From the retry",
      }),
    ]);

    expect(
      items.map((item: InvestigationEvidenceItem): string => {
        return `${item.citationId}:${item.label}`;
      }),
    ).toEqual(["C1:From the retry"]);
  });

  test("a start from an earlier attempt is never paired with a later completion", () => {
    const item: InvestigationEvidenceItem = onlyItem([
      runStarted(),
      started("search_logs", { bodySearchText: "stale attempt" }),
      runStarted(),
      completed({ toolName: "search_logs", citationId: "C1" }),
    ]);

    expect(item.queryArguments).toEqual({});
  });

  test("events without a RunStarted are treated as one attempt", () => {
    expect(
      evidence([
        started("query_probes", {}),
        completed({ toolName: "query_probes", citationId: "C1" }),
      ]),
    ).toHaveLength(1);
  });

  test("ignores completions without a citation, malformed ids and nameless tools", () => {
    const items: Array<InvestigationEvidenceItem> = evidence([
      runStarted(),
      completed({ toolName: "query_probes" }),
      completed({ toolName: "query_probes", citationId: "X1" }),
      completed({ toolName: "query_probes", citationId: "C1234" }),
      completed({ toolName: "query_probes", citationId: "[C3]" }),
      completed({ toolName: "", citationId: "C4" }),
      completed({ toolName: "query_probes", citationId: " C5 " }),
    ]);

    expect(
      items.map((item: InvestigationEvidenceItem): string => {
        return item.citationId;
      }),
    ).toEqual(["C5"]);
  });

  test("a duplicated citation id keeps the first occurrence", () => {
    const item: InvestigationEvidenceItem = onlyItem([
      runStarted(),
      completed({
        toolName: "query_probes",
        citationId: "C1",
        citationLabel: "first",
      }),
      completed({
        toolName: "query_probes",
        citationId: "C1",
        citationLabel: "second",
      }),
    ]);

    expect(item.label).toBe("first");
  });

  test("sorts by citation number, not lexically", () => {
    const events: Array<AIRunEvent> = [runStarted()];

    for (const citationId of ["C10", "C2", "C1", "C11", "C3"]) {
      events.push(completed({ toolName: "query_probes", citationId }));
    }

    expect(
      evidence(events).map((item: InvestigationEvidenceItem): string => {
        return item.citationId;
      }),
    ).toEqual(["C1", "C2", "C3", "C10", "C11"]);
  });

  test("normalises the row count and duration", () => {
    const items: Array<InvestigationEvidenceItem> = evidence([
      runStarted(),
      completed({
        toolName: "query_probes",
        citationId: "C1",
        resultSummary: {},
      }),
      completed({
        toolName: "query_probes",
        citationId: "C2",
        resultSummary: { rowCount: -4, durationInMs: -1 },
      }),
      completed({
        toolName: "query_probes",
        citationId: "C3",
        resultSummary: { rowCount: 2.7, durationInMs: 0 },
      }),
      makeEvent({
        eventType: AIRunEventType.ToolCallCompleted,
        toolName: "query_probes",
        citationId: "C4",
      }),
    ]);

    expect(
      items.map((item: InvestigationEvidenceItem): [number, unknown] => {
        return [item.rowCount, item.durationInMs];
      }),
    ).toEqual([
      [0, undefined],
      [0, undefined],
      [2, 0],
      [0, undefined],
    ]);
  });

  test("no events, no evidence", () => {
    expect(evidence([])).toEqual([]);
    expect(
      buildInvestigationEvidence({
        events: undefined as unknown as Array<AIRunEvent>,
        analysisMarkdown: null,
      }),
    ).toEqual([]);
  });
});

describe("buildInvestigationEvidence — labels for runs without a persisted label", () => {
  const report: string = [
    "## 🧠 AI — Automated Root Cause Analysis",
    "",
    "**Summary** — the pool ran dry [C1].",
    "",
    "**Evidence checked**",
    "- **[C1]** Active incidents (7 total) — 7 row(s)",
    "- **[C2]** Logs 2026-09-14T17:00:00.000Z – 2026-09-14T18:00:00.000Z (25 shown) — 25 row(s)",
    "",
    "---",
    "*Investigated automatically by OneUptime AI — read-only, 3 queries run across your own telemetry. This is an AI-generated first pass; verify before acting.*",
  ].join("\n");

  test("takes the label from the report's Evidence checked list", () => {
    const items: Array<InvestigationEvidenceItem> = evidence(
      [
        runStarted(),
        started("query_incidents", { state: "active" }),
        completed({ toolName: "query_incidents", citationId: "C1" }),
        started("search_logs", {}),
        completed({ toolName: "search_logs", citationId: "C2" }),
        started("query_metrics", { metricName: "cpu" }),
        completed({ toolName: "query_metrics", citationId: "C3" }),
      ],
      report,
    );

    expect(
      items.map((item: InvestigationEvidenceItem): string => {
        return item.label;
      }),
    ).toEqual([
      "Active incidents (7 total)",
      "Logs 2026-09-14T17:00:00.000Z – 2026-09-14T18:00:00.000Z (25 shown)",
      // C3 is past the list (or the list was cut at 15): humanised fallback.
      "Metrics query",
    ]);
  });

  test("without a report the label is humanised from the tool name", () => {
    expect(
      onlyItem([
        runStarted(),
        completed({ toolName: "get_trace", citationId: "C1" }),
      ]).label,
    ).toBe("Trace lookup");
  });

  test.each([
    ["query_metrics", "Metrics query"],
    ["search_logs", "Logs search"],
    ["get_trace", "Trace lookup"],
    ["get_incident_timeline", "Incident timeline lookup"],
    ["list_code_repositories", "Code repositories list"],
    ["find_code_for_exception", "Code for exception lookup"],
    ["top_exceptions", "Top exceptions"],
    ["baseline_anomaly", "Baseline anomaly"],
    ["query_slos", "SLOs query"],
    ["query_ai_insights", "AI insights query"],
    ["query_on_call_policies", "On-call policies query"],
    ["recent_changes", "Recent changes"],
    ["query", "Query"],
    ["", "Query"],
    ["__", "Query"],
  ])("humanizeToolName(%j) is %j", (toolName: string, expected: string) => {
    expect(humanizeToolName(toolName)).toBe(expected);
  });
});

describe("deriveCitationTarget — legacy runs get the target the tool would mint", () => {
  test.each([
    [
      "query_incidents",
      { incidentId: INCIDENT_ID },
      {
        type: AIChatCitationTargetType.IncidentView,
        params: { incidentId: INCIDENT_ID },
      },
    ],
    [
      "get_incident_timeline",
      { incidentId: INCIDENT_ID },
      {
        type: AIChatCitationTargetType.IncidentView,
        params: { incidentId: INCIDENT_ID },
      },
    ],
    [
      "query_incidents",
      { state: "active" },
      { type: AIChatCitationTargetType.Incidents },
    ],
    [
      "search_incidents",
      { searchText: "db" },
      { type: AIChatCitationTargetType.Incidents },
    ],
    [
      "query_alerts",
      { alertId: ALERT_ID },
      {
        type: AIChatCitationTargetType.AlertView,
        params: { alertId: ALERT_ID },
      },
    ],
    [
      "get_alert_timeline",
      { alertId: ALERT_ID },
      {
        type: AIChatCitationTargetType.AlertView,
        params: { alertId: ALERT_ID },
      },
    ],
    ["query_alerts", {}, { type: AIChatCitationTargetType.Alerts }],
    [
      "query_monitors",
      { monitorId: MONITOR_ID },
      {
        type: AIChatCitationTargetType.MonitorView,
        params: { monitorId: MONITOR_ID },
      },
    ],
    [
      "query_monitors",
      { problemsOnly: true },
      { type: AIChatCitationTargetType.Monitors },
    ],
    [
      "get_trace",
      { traceId: TRACE_ID },
      {
        type: AIChatCitationTargetType.TraceView,
        params: { traceId: TRACE_ID },
      },
    ],
    ["query_traces", {}, { type: AIChatCitationTargetType.Traces }],
    ["search_logs", {}, { type: AIChatCitationTargetType.Logs }],
    ["log_histogram", {}, { type: AIChatCitationTargetType.Logs }],
    ["query_metrics", {}, { type: AIChatCitationTargetType.Metrics }],
    ["baseline_anomaly", {}, { type: AIChatCitationTargetType.Metrics }],
    ["top_exceptions", {}, { type: AIChatCitationTargetType.Exceptions }],
    [
      "find_code_for_exception",
      {},
      { type: AIChatCitationTargetType.Exceptions },
    ],
    [
      "query_scheduled_maintenance",
      { scheduledMaintenanceId: INCIDENT_ID },
      {
        type: AIChatCitationTargetType.ScheduledMaintenanceView,
        params: { scheduledMaintenanceId: INCIDENT_ID },
      },
    ],
    [
      "query_scheduled_maintenance",
      { pastDays: 7 },
      { type: AIChatCitationTargetType.ScheduledMaintenanceEvents },
    ],
    ["query_probes", {}, { type: AIChatCitationTargetType.Probes }],
    [
      "search_security_events",
      {},
      { type: AIChatCitationTargetType.SecurityEvents },
    ],
    [
      "security_event_summary",
      {},
      { type: AIChatCitationTargetType.SecurityEvents },
    ],
    [
      "query_on_call_policies",
      { onCallPolicyId: INCIDENT_ID },
      {
        type: AIChatCitationTargetType.OnCallPolicyView,
        params: { onCallDutyPolicyId: INCIDENT_ID },
      },
    ],
    [
      "get_on_call_status",
      {},
      { type: AIChatCitationTargetType.OnCallPolicies },
    ],
    [
      "query_status_pages",
      { statusPageId: INCIDENT_ID },
      {
        type: AIChatCitationTargetType.StatusPageView,
        params: { statusPageId: INCIDENT_ID },
      },
    ],
    ["query_slos", {}, { type: AIChatCitationTargetType.Slos }],
    [
      "query_runbooks",
      { runbookId: INCIDENT_ID },
      {
        type: AIChatCitationTargetType.RunbookView,
        params: { runbookId: INCIDENT_ID },
      },
    ],
    ["query_workflows", {}, { type: AIChatCitationTargetType.Workflows }],
    [
      "query_teams",
      { teamId: INCIDENT_ID },
      { type: AIChatCitationTargetType.Teams },
    ],
  ])(
    "%s %j → %j",
    (toolName: string, args: JSONObject, expected: AIChatCitationTarget) => {
      expect(deriveCitationTarget(toolName, args)).toEqual(expected);
    },
  );

  test.each([
    ["query_incidents", { incidentId: "6954" }, "Incidents"],
    ["query_incidents", { incidentId: "../../settings" }, "Incidents"],
    ["get_incident_timeline", { incidentId: 42 }, "Incidents"],
    ["query_alerts", { alertId: `${ALERT_ID}/delete` }, "Alerts"],
    ["query_monitors", { monitorId: " " }, "Monitors"],
    ["get_trace", { traceId: "not-a-trace" }, "Traces"],
    ["get_trace", { traceId: "javascript:alert(1)" }, "Traces"],
    [
      "query_scheduled_maintenance",
      { scheduledMaintenanceId: "x" },
      "ScheduledMaintenanceEvents",
    ],
  ])(
    "%s never puts an invalid id %j into a route param (falls back to %s)",
    (toolName: string, args: JSONObject, expectedType: string) => {
      const target: AIChatCitationTarget | undefined = deriveCitationTarget(
        toolName,
        args,
      );
      expect(target).toEqual({ type: expectedType });
      expect(target).not.toHaveProperty("params");
    },
  );

  test("trims a valid id before using it", () => {
    expect(
      deriveCitationTarget("query_incidents", {
        incidentId: `  ${INCIDENT_ID}  `,
      }),
    ).toEqual({
      type: AIChatCitationTargetType.IncidentView,
      params: { incidentId: INCIDENT_ID },
    });
  });

  test.each([
    "lookup_context",
    "recent_changes",
    "list_code_repositories",
    "search_code",
    "read_code_file",
    "query_ai_insights",
    "execute_remediation_command",
    "made_up_tool",
  ])("%s has no dashboard page — no target", (toolName: string) => {
    expect(deriveCitationTarget(toolName, {})).toBeUndefined();
  });

  test("a legacy evidence item carries the derived target", () => {
    expect(
      onlyItem([
        runStarted(),
        started("get_alert_timeline", { alertId: ALERT_ID }),
        completed({ toolName: "get_alert_timeline", citationId: "C1" }),
      ]).target,
    ).toEqual({
      type: AIChatCitationTargetType.AlertView,
      params: { alertId: ALERT_ID },
    });
  });

  test("a legacy item for a tool without a page has no target key", () => {
    expect(
      onlyItem([
        runStarted(),
        completed({ toolName: "recent_changes", citationId: "C1" }),
      ]),
    ).not.toHaveProperty("target");
  });
});

describe("sanitizeEvidenceArguments — what argument data may reach a viewer", () => {
  test("keeps strings, finite numbers, booleans and arrays of those", () => {
    expect(
      sanitizeEvidenceArguments({
        state: "active",
        limit: 10,
        problemsOnly: false,
        severityTexts: ["Error", "Fatal"],
        mixed: ["a", 1, true],
        empty: [],
      }),
    ).toEqual({
      state: "active",
      limit: 10,
      problemsOnly: false,
      severityTexts: ["Error", "Fatal"],
      mixed: ["a", 1, true],
      empty: [],
    });
  });

  test("drops nested objects, nulls and non-finite numbers", () => {
    expect(
      sanitizeEvidenceArguments({
        nested: { secret: "x" },
        nothing: null,
        notANumber: NaN,
        infinite: Infinity,
        fn: (() => {
          return 1;
        }) as unknown as string,
        kept: "yes",
      }),
    ).toEqual({ kept: "yes" });
  });

  test("filters unsupported items out of arrays and drops arrays left empty", () => {
    expect(
      sanitizeEvidenceArguments({
        partly: ["a", { b: 1 }, null, 2, ["nested"]],
        onlyObjects: [{ a: 1 }, { b: 2 }],
      }),
    ).toEqual({ partly: ["a", 2] });
  });

  test(`clips strings to ${MAX_EVIDENCE_ARGUMENT_STRING_LENGTH} characters, in arrays too`, () => {
    const sanitized: JSONObject = sanitizeEvidenceArguments({
      bodySearchText: "a".repeat(5000),
      severityTexts: ["b".repeat(301), "short"],
      exact: "c".repeat(MAX_EVIDENCE_ARGUMENT_STRING_LENGTH),
    });

    expect(sanitized["bodySearchText"]).toBe(
      "a".repeat(MAX_EVIDENCE_ARGUMENT_STRING_LENGTH),
    );
    expect(sanitized["severityTexts"]).toEqual([
      "b".repeat(MAX_EVIDENCE_ARGUMENT_STRING_LENGTH),
      "short",
    ]);
    expect(sanitized["exact"]).toBe(
      "c".repeat(MAX_EVIDENCE_ARGUMENT_STRING_LENGTH),
    );
  });

  test(`keeps at most ${MAX_EVIDENCE_ARGUMENT_ARRAY_ITEMS} array items`, () => {
    const values: Array<number> = Array.from(
      { length: 100 },
      (_value: unknown, index: number): number => {
        return index;
      },
    );

    expect(sanitizeEvidenceArguments({ values })["values"]).toEqual(
      values.slice(0, MAX_EVIDENCE_ARGUMENT_ARRAY_ITEMS),
    );
  });

  test(`keeps at most ${MAX_EVIDENCE_ARGUMENT_KEYS} keys, counting only kept ones`, () => {
    const args: JSONObject = { dropped: { nested: true } };

    for (let index: number = 0; index < 60; index++) {
      args[`key${index}`] = index;
    }

    const sanitized: JSONObject = sanitizeEvidenceArguments(args);

    expect(Object.keys(sanitized)).toHaveLength(MAX_EVIDENCE_ARGUMENT_KEYS);
    expect(Object.keys(sanitized)[0]).toBe("key0");
    expect(sanitized).not.toHaveProperty("dropped");
    expect(sanitized).not.toHaveProperty(`key${MAX_EVIDENCE_ARGUMENT_KEYS}`);
  });

  test("never assigns prototype-reaching or absurdly long keys", () => {
    const args: JSONObject = JSON.parse(
      `{"__proto__": "polluted", "constructor": "x", "prototype": "y", "${"k".repeat(
        200,
      )}": "long", "ok": 1}`,
    ) as JSONObject;

    const sanitized: JSONObject = sanitizeEvidenceArguments(args);

    expect(Object.keys(sanitized)).toEqual(["ok"]);
    expect(Object.getPrototypeOf(sanitized)).toBe(Object.prototype);
    expect(({} as JSONObject)["polluted"]).toBeUndefined();
  });

  test.each([null, undefined, "string", 42, ["array"]])(
    "a non-object %j sanitises to {}",
    (value: unknown) => {
      expect(sanitizeEvidenceArguments(value)).toEqual({});
    },
  );

  test("the evidence item carries sanitised arguments, never the raw ones", () => {
    const item: InvestigationEvidenceItem = onlyItem([
      runStarted(),
      started("search_logs", {
        bodySearchText: "z".repeat(1000),
        filters: { nested: "object" },
      }),
      completed({ toolName: "search_logs", citationId: "C1" }),
    ]);

    expect(item.queryArguments).toEqual({
      bodySearchText: "z".repeat(MAX_EVIDENCE_ARGUMENT_STRING_LENGTH),
    });
  });
});

describe("canLoadRows — which evidence may be re-run for a viewer", () => {
  test.each([
    "query_incidents",
    "search_logs",
    "query_metrics",
    "get_trace",
    "baseline_anomaly",
    "recent_changes",
    "lookup_context",
  ])("read-only toolbox tool %s is re-runnable", (toolName: string) => {
    expect(isRerunnableEvidenceTool(toolName)).toBe(true);
  });

  test.each([
    "create_incident",
    "acknowledge_incident",
    "resolve_alert",
    "page_on_call_policy",
    "run_runbook",
    "commit_code_to_branch",
  ])("mutation tool %s is never re-runnable", (toolName: string) => {
    expect(AIToolbox.getToolByName(toolName)?.isMutation).toBe(true);
    expect(isRerunnableEvidenceTool(toolName)).toBe(false);
  });

  test.each([...EVIDENCE_EXCLUDED_TOOL_NAMES])(
    "investigation-excluded tool %s is never re-runnable",
    (toolName: string) => {
      expect(isRerunnableEvidenceTool(toolName)).toBe(false);
    },
  );

  test("get_ai_investigation is a registered read tool, excluded by name", () => {
    const tool: ReturnType<typeof AIToolbox.getToolByName> =
      AIToolbox.getToolByName("get_ai_investigation");
    expect(tool).toBeDefined();
    expect(tool?.isMutation).toBeFalsy();
    expect(isRerunnableEvidenceTool("get_ai_investigation")).toBe(false);
  });

  test.each([
    // Remediation runs graft these on; they are not toolbox tools.
    "execute_remediation_command",
    "propose_remediation_commands",
    "list_command_targets",
    "made_up_tool",
    "",
  ])("unregistered tool %j is never re-runnable", (toolName: string) => {
    expect(isRerunnableEvidenceTool(toolName)).toBe(false);
  });

  test("the evidence item reflects the rule per tool", () => {
    const items: Array<InvestigationEvidenceItem> = evidence([
      runStarted(),
      completed({ toolName: "search_logs", citationId: "C1" }),
      completed({ toolName: "execute_remediation_command", citationId: "C2" }),
      completed({ toolName: "create_incident", citationId: "C3" }),
      completed({ toolName: "start_investigation", citationId: "C4" }),
    ]);

    expect(
      items.map((item: InvestigationEvidenceItem): boolean => {
        return item.canLoadRows;
      }),
    ).toEqual([true, false, false, false]);
  });
});

describe("findInvestigationToolCall — the server-side view the evidence route uses", () => {
  test("returns the unsanitised arguments and the start time for one citation", () => {
    const longText: string = "q".repeat(1000);
    const record: InvestigationToolCallRecord | null =
      findInvestigationToolCall({
        events: [
          runStarted(),
          started(
            "search_logs",
            { bodySearchText: longText, filters: { a: 1 } },
            "2026-09-14T18:03:00.000Z",
          ),
          completed({ toolName: "search_logs", citationId: "C1" }),
          started("query_metrics", { metricName: "cpu" }),
          completed({ toolName: "query_metrics", citationId: "C2" }),
        ],
        citationId: "C1",
      });

    expect(record).not.toBeNull();
    expect(record!.rawArguments).toEqual({
      bodySearchText: longText,
      filters: { a: 1 },
    });
    expect(record!.startedAt?.toISOString()).toBe("2026-09-14T18:03:00.000Z");
    expect(record!.item.queryArguments).toEqual({
      bodySearchText: "q".repeat(MAX_EVIDENCE_ARGUMENT_STRING_LENGTH),
    });
  });

  test("returns null for a citation the latest attempt did not mint", () => {
    expect(
      findInvestigationToolCall({
        events: [
          runStarted(),
          completed({ toolName: "search_logs", citationId: "C2" }),
          runStarted(),
          completed({ toolName: "search_logs", citationId: "C1" }),
        ],
        citationId: "C2",
      }),
    ).toBeNull();
  });

  test("a legacy completion without a start has no startedAt", () => {
    const records: Array<InvestigationToolCallRecord> =
      collectInvestigationToolCalls({
        events: [
          runStarted(),
          completed({ toolName: "search_logs", citationId: "C1" }),
        ],
        analysisMarkdown: null,
      });

    expect(records[0]).not.toHaveProperty("startedAt");
  });

  test.each([
    ["C1", 1],
    ["C999", 999],
    ["C0", 0],
    ["C1000", null],
    ["c1", null],
    ["C", null],
    ["1", null],
  ])("getCitationNumber(%j) is %j", (citationId: string, expected: unknown) => {
    expect(getCitationNumber(citationId)).toBe(expected);
  });
});

describe("the evidence trail the builder reads is persisted by the agent loop", () => {
  const projectId: ObjectID = ObjectID.generate();
  const aiRunId: ObjectID = ObjectID.generate();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function llmResponse(data: Partial<AILogResponse>): AILogResponse {
    return {
      content: "",
      llmLog: { totalTokens: 10, modelName: "test-model" },
      ...data,
    } as unknown as AILogResponse;
  }

  test("ObservabilityAssistant emits tool_completed with the arguments, label and target", async () => {
    const steps: Array<ObservabilityAssistantStep> = [];

    jest
      .spyOn(AIService, "executeWithLogging")
      .mockResolvedValueOnce(
        llmResponse({
          toolCalls: [
            {
              id: "call-1",
              name: "query_incidents",
              arguments: { incidentId: INCIDENT_ID },
            },
            {
              id: "call-2",
              name: "search_logs",
              arguments: { bodySearchText: "timeout" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        llmResponse({ content: "**Summary** — found it [C1]." }),
      );

    const executeTool: jest.SpyInstance = jest
      .spyOn(AIToolbox, "executeTool")
      .mockImplementation(
        async (data: { name: string }): Promise<ToolCallOutcome> => {
          if (data.name === "search_logs") {
            return {
              success: false,
              textForLlm: "Error",
              errorMessage: "Logs unavailable",
            };
          }

          return {
            success: true,
            textForLlm: "rows",
            result: {
              dataForLlm: "rows",
              rowCount: 1,
              citationLabel: "Incident #6954",
              citationTarget: {
                type: AIChatCitationTargetType.IncidentView,
                params: { incidentId: INCIDENT_ID },
              },
              redactionCount: 0,
              isTruncated: false,
            },
          };
        },
      );

    const result: ObservabilityAssistantResult =
      await ObservabilityAssistant.answerQuestion({
        projectId,
        props: { isRoot: true },
        question: "What happened?",
        feature: "Test",
        onStep: async (step: ObservabilityAssistantStep): Promise<void> => {
          steps.push(step);
        },
      } as ObservabilityAssistantRequest);

    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(result.citations).toHaveLength(1);

    const completedSteps: Array<ObservabilityAssistantStep> = steps.filter(
      (step: ObservabilityAssistantStep): boolean => {
        return step.type === "tool_completed";
      },
    );

    expect(completedSteps).toHaveLength(1);
    expect(completedSteps[0]).toEqual(
      expect.objectContaining({
        type: "tool_completed",
        toolName: "query_incidents",
        toolArguments: { incidentId: INCIDENT_ID },
        rowCount: 1,
        citationId: "C1",
        citationLabel: "Incident #6954",
        citationTarget: {
          type: AIChatCitationTargetType.IncidentView,
          params: { incidentId: INCIDENT_ID },
        },
      }),
    );

    const failedStep: ObservabilityAssistantStep | undefined = steps.find(
      (step: ObservabilityAssistantStep): boolean => {
        return step.type === "tool_failed";
      },
    );

    expect(failedStep).toBeDefined();
    expect(failedStep).not.toHaveProperty("citationLabel");
    expect(failedStep).not.toHaveProperty("citationId");
  });

  test("the engine persists label, target and arguments on ToolCallCompleted — and the builder reads them back", async () => {
    const createdEvents: Array<AIRunEvent> = [];

    jest
      .spyOn(AIRunEventService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(AIRunEventService, "create")
      .mockImplementation(
        async (data: { data: AIRunEvent }): Promise<AIRunEvent> => {
          data.data.createdAt = new Date(
            Date.UTC(2026, 8, 14, 18, 0, createdEvents.length),
          );
          createdEvents.push(data.data);
          return data.data;
        },
      );
    // A lost Completed CAS ends the run right after the loop — nothing posts.
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(0);

    jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockImplementation(
        async (
          request: ObservabilityAssistantRequest,
        ): Promise<ObservabilityAssistantResult> => {
          await request.onStep!({
            type: "tool_started",
            toolName: "search_logs",
            toolArguments: { bodySearchText: "timeout" },
          });
          await request.onStep!({
            type: "tool_completed",
            toolName: "search_logs",
            toolArguments: { bodySearchText: "timeout" },
            durationMs: 250,
            rowCount: 25,
            citationId: "C1",
            citationLabel: "Logs 17:00 – 18:00 (25 shown)",
            citationTarget: { type: AIChatCitationTargetType.Logs },
          });
          await request.onStep!({
            type: "tool_failed",
            toolName: "query_metrics",
            durationMs: 3,
            errorMessage: "bad metric",
          });

          return {
            contentInMarkdown: "**Summary** — x [C1].",
            citations: [],
            totalTokens: 10,
            llmCallCount: 1,
            toolCallCount: 2,
          };
        },
      );

    await AIInvestigationEngine.executeRun({
      aiRunId,
      projectId,
      attemptCount: 1,
      request: {
        feature: "Test Investigation",
        contextSummary: "# Subject",
        postAnalysis:
          jest.fn() as unknown as InvestigationRequest["postAnalysis"],
      },
    });

    const completedEvent: AIRunEvent | undefined = createdEvents.find(
      (event: AIRunEvent): boolean => {
        return event.eventType === AIRunEventType.ToolCallCompleted;
      },
    );

    expect(completedEvent).toBeDefined();
    expect(completedEvent!.toolName).toBe("search_logs");
    expect(completedEvent!.citationId).toBe("C1");
    expect(completedEvent!.toolArguments).toEqual({
      bodySearchText: "timeout",
    });
    expect(completedEvent!.resultSummary).toEqual({
      rowCount: 25,
      durationInMs: 250,
      citationLabel: "Logs 17:00 – 18:00 (25 shown)",
      citationTarget: { type: AIChatCitationTargetType.Logs },
    });

    const failedEvent: AIRunEvent | undefined = createdEvents.find(
      (event: AIRunEvent): boolean => {
        return event.eventType === AIRunEventType.ToolCallFailed;
      },
    );

    expect(failedEvent!.resultSummary).toEqual({
      durationInMs: 3,
      errorMessage: "bad metric",
    });
    expect(failedEvent!.resultSummary).not.toHaveProperty("citationLabel");

    expect(
      buildInvestigationEvidence({
        events: createdEvents,
        analysisMarkdown: null,
      }),
    ).toEqual([
      {
        citationId: "C1",
        toolName: "search_logs",
        label: "Logs 17:00 – 18:00 (25 shown)",
        rowCount: 25,
        durationInMs: 250,
        queryArguments: { bodySearchText: "timeout" },
        target: { type: AIChatCitationTargetType.Logs },
        executedAt: createdEvents[1]!.createdAt!.toISOString(),
        canLoadRows: true,
      },
    ]);
  });
});
