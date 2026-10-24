/*
 * What Traces' AI tab reads, answered as the server answers it: the
 * problems OneUptime found in the project's traces (AIInsight rows of the
 * three trace kinds, with their evidence), the trace AI rules
 * (AutoRemediationRule with the Trace trigger), the pull request readiness
 * (POST /telemetry-ai/readiness), the AI logs (POST /telemetry-ai/logs),
 * Fix with AI on a finding (POST /telemetry-ai/fix-suggestion and
 * /telemetry-ai/fix, decided by Common's getTelemetryAiFixOffer as the
 * server decides it), the project's switches and its LLM providers.
 *
 * Every record is fabricated. Scenarios, by query parameter:
 *
 *   ?aiInsights= full (default) | empty
 *   ?aiRules=    none (default) | two
 *   ?readiness=  ready (default) | connect | credits
 *   ?aiLogs=     full (default) | empty | fail
 *   ?offer=      found (default) | pick | connect | credits | running
 *                found:   the code is in acme/checkout
 *                pick:    two repositories, neither found to hold it
 *                connect: no repository connected in Code
 *                credits: Code's gate says the project has no AI credits
 *                running: a fix is already on its way
 *   ?lane=       on (default) | off - "Find and fix slow and failing operations"
 *   ?ai=         on (default) | off - Enable AI
 *   ?fail=       fix - the fix route refuses
 */
import AIInsight from "Common/Models/DatabaseModels/AIInsight";
import AutoRemediationRule from "Common/Models/DatabaseModels/AutoRemediationRule";
import Project from "Common/Models/DatabaseModels/Project";
import AIInsightSeverity from "Common/Types/AI/AIInsightSeverity";
import AIInsightStatus from "Common/Types/AI/AIInsightStatus";
import AIInsightType from "Common/Types/AI/AIInsightType";
import { CodeTaskBlockerType } from "Common/Types/AI/CodeTask";
import { PerformanceFindingType } from "Common/Types/AI/CodeFixTaskContext";
import AutoRemediationExecutionMode from "Common/Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationTriggerEntity from "Common/Types/AutoRemediation/AutoRemediationTriggerEntity";
import ObjectID from "Common/Types/ObjectID";
import {
  getTelemetryAiFixOffer,
  telemetryAiFixSuggestionToJSON,
} from "Common/Utils/Suggestions/TelemetryAiFixSuggestion";

const params = new URLSearchParams(window.location.search);
const insightsMode = params.get("aiInsights") || "full";
const rulesMode = params.get("aiRules") || "none";
const readinessMode = params.get("readiness") || "ready";
const logsMode = params.get("aiLogs") || "full";
const offerMode = params.get("offer") || "found";
const isLaneOn = params.get("lane") !== "off";
const isAiOn = params.get("ai") !== "off";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const SERVICE_IDS = {
  checkout: "50930000-0000-4000-8000-0000000000a1",
  edge: "50930000-0000-4000-8000-0000000000a2",
};

export const AI_INSIGHT_IDS = {
  slow: "50930000-0000-4000-8000-0000000000e1",
  failing: "50930000-0000-4000-8000-0000000000e2",
  untraced: "50930000-0000-4000-8000-0000000000e3",
};

export const AI_TASK_IDS = {
  automatic: "50930000-0000-4000-8000-0000000000f1",
  asked: "50930000-0000-4000-8000-0000000000f2",
  started: "50930000-0000-4000-8000-0000000000f3",
  running: "50930000-0000-4000-8000-0000000000f4",
};

export const REPOSITORY_IDS = {
  checkout: "50930000-0000-4000-8000-0000000000b1",
  platform: "50930000-0000-4000-8000-0000000000b2",
};

export const SAMPLE_TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";

const RULE_IDS = {
  checkout: "50930000-0000-4000-8000-0000000000c1",
  everything: "50930000-0000-4000-8000-0000000000c2",
};

/*
 * The project's AI switches as the switches card and the notice read
 * them; a flip is kept, as the server would keep it.
 */
const projectSwitches = {
  enableAi: isAiOn,
  enableAutomaticTraceRemediation: isLaneOn,
};

export function aiProject(projectId) {
  return Object.assign(new Project(), {
    _id: projectId,
    name: "Commerce",
    ...projectSwitches,
  });
}

export function saveProjectSwitches(data) {
  for (const [column, value] of Object.entries(data || {})) {
    if (column in projectSwitches) {
      projectSwitches[column] = value;
    }
  }
}

function readWindow(now) {
  return {
    windowStartTime: new Date(now - HOUR).toISOString(),
    windowEndTime: new Date(now).toISOString(),
  };
}

function slowEvidence(now) {
  return {
    trace: {
      serviceId: SERVICE_IDS.checkout,
      kind: "Slow",
      operationName: "GET /orders",
      ...readWindow(now),
      spanCount: 1840,
      failedSpanCount: 0,
      p50Ms: 640,
      p99Ms: 2400,
      sampleTraceId: SAMPLE_TRACE_ID,
      sampleSpanId: "00f067aa0ba902b7",
      sampleDurationMs: 2200,
      performanceFindings: [
        {
          findingType: PerformanceFindingType.NPlusOneQuery,
          headline:
            'N+1: 40× "SELECT order_items" under "OrderRepository.load"',
          evidence:
            "The same database query ran 40 times in OrderRepository.load, 1.4 s together: 64% of the request.",
          spanCount: 40,
          combinedDurationMs: 1408,
          traceDurationMs: 2200,
          percentOfTrace: 64,
          normalizedSpanName: "SELECT order_items",
          parentSpanName: "OrderRepository.load",
          normalizedDbStatement: "SELECT * FROM order_items WHERE order_id = ?",
          dbSystem: "postgresql",
          implicatedSpans: [{ name: "SELECT order_items", durationMs: 35 }],
        },
      ],
    },
  };
}

function failingEvidence(now) {
  return {
    trace: {
      serviceId: SERVICE_IDS.checkout,
      kind: "Failing",
      operationName: "POST /checkout",
      ...readWindow(now),
      spanCount: 2600,
      failedSpanCount: 312,
      p50Ms: 180,
      p99Ms: 900,
      sampleTraceId: "5bf92f3577b34da6a3ce929d0e0e4737",
      sampleSpanId: "10f067aa0ba902b8",
      error: {
        exceptionType: "TypeError",
        exceptionMessage: "Cannot read properties of undefined (reading 'id')",
        stackTrace:
          "TypeError: Cannot read properties of undefined (reading 'id')\n    at applyCoupon (src/checkout/coupon.ts:42:19)\n    at handleCheckout (src/routes/checkout.ts:88:7)",
        sampleMatches: 5,
        sampleSize: 5,
      },
    },
  };
}

function untracedEvidence(now) {
  return {
    trace: {
      serviceId: SERVICE_IDS.edge,
      kind: "MissingTracing",
      gap: "NoChildSpans",
      ...readWindow(now),
      spanCount: 9200,
      failedSpanCount: 40,
      topOperations: [
        { name: "GET /", spanCount: 5100 },
        { name: "GET /static/*", spanCount: 2900 },
      ],
    },
  };
}

export function aiInsights(now) {
  if (insightsMode === "empty") {
    return [];
  }

  return [
    Object.assign(new AIInsight(), {
      _id: AI_INSIGHT_IDS.slow,
      title: "GET /orders in checkout runs the same database query 40 times",
      insightType: AIInsightType.TraceSlowOperation,
      severity: AIInsightSeverity.High,
      status: AIInsightStatus.ActionRequired,
      serviceName: "checkout",
      telemetryServiceId: new ObjectID(SERVICE_IDS.checkout),
      traceId: SAMPLE_TRACE_ID,
      occurrenceCount: 5,
      firstSeenAt: new Date(now - 5 * HOUR),
      lastSeenAt: new Date(now - 4 * MINUTE),
      evidence: slowEvidence(now),
      detailMarkdown:
        "**GET /orders** in checkout has a P99 of **2.4 s** over the last hour (1,840 spans). Its slowest request ran the same database query **40 times** in `OrderRepository.load`: 1.4 s together, 64% of the request.\n\n- `SELECT * FROM order_items WHERE order_id = ?`\n- One query for all the order's items would do.",
    }),
    Object.assign(new AIInsight(), {
      _id: AI_INSIGHT_IDS.failing,
      title: "POST /checkout in checkout fails 12% of the time",
      insightType: AIInsightType.TraceFailingOperation,
      severity: AIInsightSeverity.Medium,
      status: AIInsightStatus.FixOpened,
      serviceName: "checkout",
      telemetryServiceId: new ObjectID(SERVICE_IDS.checkout),
      occurrenceCount: 3,
      firstSeenAt: new Date(now - 3 * HOUR),
      lastSeenAt: new Date(now - 4 * MINUTE),
      evidence: failingEvidence(now),
      fixAiRunId: new ObjectID(AI_TASK_IDS.automatic),
      detailMarkdown:
        "**312** of **2,600** POST /checkout spans failed over the last hour (12%), each with `TypeError: Cannot read properties of undefined (reading 'id')` in `applyCoupon`.",
    }),
    Object.assign(new AIInsight(), {
      _id: AI_INSIGHT_IDS.untraced,
      title: "edge's requests have no spans inside them",
      insightType: AIInsightType.TraceMissingTracing,
      severity: AIInsightSeverity.Low,
      status: AIInsightStatus.Detected,
      serviceName: "edge",
      telemetryServiceId: new ObjectID(SERVICE_IDS.edge),
      occurrenceCount: 8,
      firstSeenAt: new Date(now - 8 * HOUR),
      lastSeenAt: new Date(now - 4 * MINUTE),
      evidence: untracedEvidence(now),
      detailMarkdown:
        "All **9,200** of edge's spans over the last hour were the only span of their trace: nothing records what a request did inside it.\n\n- Busiest: `GET /` (5,100), `GET /static/*` (2,900)",
    }),
  ];
}

// The rows a list or a count asks for: its status and kind, when it names them.
export function filterInsights(rows, query) {
  const status = query && query.status;
  let kept = rows;

  if (typeof status === "string") {
    kept = kept.filter((row) => row.status === status);
  }

  const insightType = query && query.insightType;

  if (typeof insightType === "string") {
    kept = kept.filter((row) => row.insightType === insightType);
  }

  return kept;
}

export function aiRules() {
  if (rulesMode !== "two") {
    return [];
  }

  return [
    Object.assign(new AutoRemediationRule(), {
      _id: RULE_IDS.checkout,
      name: "Checkout services",
      triggerEntityType: AutoRemediationTriggerEntity.Trace,
      isEnabled: true,
      investigates: true,
      fixes: true,
      executionMode: AutoRemediationExecutionMode.Suggest,
      onlyIfOpenAfterMinutes: 60,
    }),
    Object.assign(new AutoRemediationRule(), {
      _id: RULE_IDS.everything,
      name: "Everything else: look, don't touch",
      triggerEntityType: AutoRemediationTriggerEntity.Trace,
      isEnabled: false,
      investigates: true,
      fixes: false,
      executionMode: AutoRemediationExecutionMode.Suggest,
    }),
  ];
}

export function aiReadiness() {
  return {
    lane: "Trace",
    isAiEnabled: projectSwitches.enableAi,
    isLaneOn: projectSwitches.enableAutomaticTraceRemediation,
    connectedRepositoryCount: readinessMode === "connect" ? 0 : 2,
    blocker:
      readinessMode === "credits"
        ? {
            type: CodeTaskBlockerType.NoAiCredits,
            message: "The project has no AI credits left.",
          }
        : null,
    automaticFixesToday: 2,
    maxAutomaticFixesPerDay: 5,
  };
}

/*
 * Fix with AI on a finding, as TraceInsightFix.getSuggestion decides it:
 * the offer from Common's getTelemetryAiFixOffer, the repository the code
 * was found in or the ones to pick from.
 */
export function fixSuggestion(insight, startedTaskIds) {
  const insightId = insight ? insight.id.toString() : "";
  const isOpen =
    insight &&
    insight.status !== AIInsightStatus.Resolved &&
    insight.status !== AIInsightStatus.Dismissed;
  const isRunning =
    offerMode === "running" || Boolean(startedTaskIds[insightId]);
  const decided = getTelemetryAiFixOffer({
    isAiEnabled: projectSwitches.enableAi,
    isFixable: Boolean(isOpen && !insight.fixAiRunId),
    hasActiveFix: isRunning,
    hasConnectedRepository: offerMode !== "connect",
    blocker:
      offerMode === "credits"
        ? {
            type: CodeTaskBlockerType.NoAiCredits,
            message: "The project has no AI credits left.",
          }
        : null,
  });

  return telemetryAiFixSuggestionToJSON({
    offer: decided.offer,
    blocker: decided.blocker,
    repository:
      offerMode === "found"
        ? { id: REPOSITORY_IDS.checkout, name: "acme/checkout" }
        : null,
    repositories:
      offerMode === "pick"
        ? [
            { id: REPOSITORY_IDS.checkout, name: "acme/checkout" },
            { id: REPOSITORY_IDS.platform, name: "acme/platform" },
          ]
        : [],
    taskId: isRunning ? startedTaskIds[insightId] || AI_TASK_IDS.running : null,
  });
}

export function aiLogs(now, skip) {
  if (logsMode === "fail") {
    return null;
  }

  if (logsMode === "empty") {
    return { entries: [], totalCount: 0 };
  }

  const insight = (id, title, serviceName) => {
    return { id, title, serviceName };
  };
  const failing = insight(
    AI_INSIGHT_IDS.failing,
    "POST /checkout in checkout fails 12% of the time",
    "checkout",
  );
  const slow = insight(
    AI_INSIGHT_IDS.slow,
    "GET /orders in checkout runs the same database query 40 times",
    "checkout",
  );

  const entries = [
    {
      runId: AI_TASK_IDS.automatic,
      kind: "PullRequest",
      at: new Date(now - 2 * HOUR).toISOString(),
      state: "Done",
      insight: failing,
      taskId: AI_TASK_IDS.automatic,
      repositoryName: "acme/checkout",
      repositoryHostedAt: "GitHub",
      pullRequest: {
        state: "open",
        number: 1204,
        url: "https://github.com/acme/checkout/pull/1204",
      },
    },
    {
      runId: "50930000-0000-4000-8000-0000000000d1",
      kind: "Investigation",
      at: new Date(now - 2 * HOUR - 5 * MINUTE).toISOString(),
      state: "Done",
      insight: failing,
      classification: "Actionable",
    },
    {
      runId: AI_TASK_IDS.asked,
      kind: "PullRequest",
      at: new Date(now - 26 * HOUR).toISOString(),
      state: "NothingToChange",
      insight: slow,
      requestedBy: "Ada Lovelace",
      taskId: AI_TASK_IDS.asked,
      repositoryName: "acme/checkout",
    },
    {
      runId: "50930000-0000-4000-8000-0000000000d2",
      kind: "Investigation",
      at: new Date(now - 27 * HOUR).toISOString(),
      state: "Failed",
      insight: slow,
    },
  ];

  const page = entries.slice(skip || 0, (skip || 0) + 3);

  return { entries: page, totalCount: entries.length };
}

// The project's LLM providers, as POST /ai-chat/providers answers them.
export function aiProviders() {
  return {
    isAIEnabledForProject: projectSwitches.enableAi,
    defaultProviderId: "50930000-0000-4000-8000-0000000000a9",
    providers: [
      {
        id: "50930000-0000-4000-8000-0000000000a9",
        name: "Azure GPT-4o",
        modelName: "gpt-4o",
        isDefault: true,
        isGlobal: false,
        description: null,
        llmType: null,
      },
    ],
  };
}
