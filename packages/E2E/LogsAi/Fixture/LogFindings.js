/*
 * What Logs' AI tab reads, answered as the server answers it: the problems
 * OneUptime found in the project's logs (AIInsight rows of the three log
 * kinds, with their evidence), the log AI rules (AutoRemediationRule with
 * the Log trigger), the pull request readiness (POST
 * /telemetry-ai/readiness), the AI activity (POST /telemetry-ai/logs), Fix
 * with AI on a finding (POST /telemetry-ai/fix-suggestion and
 * /telemetry-ai/fix, decided by Common's getTelemetryAiFixOffer as the
 * server decides it), the project's switches and its LLM providers.
 *
 * Every record is fabricated, and holds no log line as it was logged: a
 * finding keeps a message's pattern, as the detector does. Each finding's
 * title and evidence text are what the detector writes for it
 * (getLogInsightTitle, buildLogInsightDetail). Scenarios, by query
 * parameter:
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
 *   ?lane=       on (default) | off - "Find and fix error, missing and noisy logs"
 *   ?ai=         on (default) | off - Enable AI
 *   ?fail=       fix - the fix route refuses
 */
import AIInsight from "Common/Models/DatabaseModels/AIInsight";
import AutoRemediationRule from "Common/Models/DatabaseModels/AutoRemediationRule";
import Project from "Common/Models/DatabaseModels/Project";
import AIInsightStatus from "Common/Types/AI/AIInsightStatus";
import AIInsightType from "Common/Types/AI/AIInsightType";
import { CodeTaskBlockerType } from "Common/Types/AI/CodeTask";
import AutoRemediationExecutionMode from "Common/Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationTriggerEntity from "Common/Types/AutoRemediation/AutoRemediationTriggerEntity";
import ObjectID from "Common/Types/ObjectID";
import {
  getTelemetryAiFixOffer,
  telemetryAiFixSuggestionToJSON,
} from "Common/Utils/Suggestions/TelemetryAiFixSuggestion";
import {
  buildLogInsightDetail,
  getLogInsightSeverity,
  getLogInsightTitle,
} from "Common/Utils/Logs/LogInsight";

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
  checkout: "50940000-0000-4000-8000-0000000000a1",
  payments: "50940000-0000-4000-8000-0000000000a2",
  billing: "50940000-0000-4000-8000-0000000000a3",
};

export const AI_INSIGHT_IDS = {
  error: "50940000-0000-4000-8000-0000000000e1",
  silent: "50940000-0000-4000-8000-0000000000e2",
  noisy: "50940000-0000-4000-8000-0000000000e3",
  untraced: "50940000-0000-4000-8000-0000000000e4",
};

export const AI_TASK_IDS = {
  automatic: "50940000-0000-4000-8000-0000000000f1",
  asked: "50940000-0000-4000-8000-0000000000f2",
  started: "50940000-0000-4000-8000-0000000000f3",
  running: "50940000-0000-4000-8000-0000000000f4",
};

export const REPOSITORY_IDS = {
  checkout: "50940000-0000-4000-8000-0000000000b1",
  platform: "50940000-0000-4000-8000-0000000000b2",
};

export const SAMPLE_TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
export const FAILED_TRACE_ID = "5bf92f3577b34da6a3ce929d0e0e4737";

const RULE_IDS = {
  checkout: "50940000-0000-4000-8000-0000000000c1",
  everything: "50940000-0000-4000-8000-0000000000c2",
};

/*
 * The project's AI switches as the switches card and the notice read
 * them; a flip is kept, as the server would keep it.
 */
const projectSwitches = {
  enableAi: isAiOn,
  enableAutomaticLogRemediation: isLaneOn,
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

// One error message, logged at Error 1,240 times in the hour.
function errorEvidence(now) {
  return {
    serviceId: SERVICE_IDS.checkout,
    kind: "Error",
    ...readWindow(now),
    logCount: 18400,
    errorLogCount: 2100,
    pattern: "Payment provider returned <num>: card declined",
    patternCount: 1240,
    severities: ["Error"],
    searchText: "Payment provider returned",
    traceCount: 312,
    sampleTraceIds: [SAMPLE_TRACE_ID],
    codeLocations: [
      {
        filePath: "src/payments/charge.ts",
        functionName: "charge",
        lineNumber: 88,
      },
    ],
  };
}

// POST /charge fails and writes no log line.
function silentEvidence(now) {
  return {
    serviceId: SERVICE_IDS.payments,
    kind: "MissingLogging",
    gap: "SilentFailures",
    ...readWindow(now),
    logCount: 9200,
    tracedLogCount: 8800,
    operationName: "POST /charge",
    operationSpanCount: 400,
    failedSpanCount: 40,
    failedSampleSize: 20,
    sampleTraceId: FAILED_TRACE_ID,
    error: {
      exceptionType: "TimeoutError",
      exceptionMessage: "Card network did not answer in time",
      sampleMatches: 20,
      sampleSize: 20,
    },
  };
}

// One debug line, 62% of billing's logs.
function noisyEvidence(now) {
  return {
    serviceId: SERVICE_IDS.billing,
    kind: "Noisy",
    ...readWindow(now),
    logCount: 48000,
    pattern: "cache hit for key <uuid>",
    patternCount: 29760,
    patternPercent: 62,
    sampledLogCount: 48000,
    severities: ["Debug"],
    searchText: "cache hit for key",
  };
}

// billing's logs carry no trace id while it sends spans.
function untracedEvidence(now) {
  return {
    serviceId: SERVICE_IDS.billing,
    kind: "MissingLogging",
    gap: "NoTraceContext",
    ...readWindow(now),
    logCount: 48000,
    tracedLogCount: 0,
    serviceSpanCount: 6400,
  };
}

const SERVICE_NAMES = {
  [SERVICE_IDS.checkout]: "checkout",
  [SERVICE_IDS.payments]: "payments",
  [SERVICE_IDS.billing]: "billing",
};

// A finding as the detector files it: its title, severity and evidence text.
function finding(data) {
  const serviceName = SERVICE_NAMES[data.evidence.serviceId];

  return Object.assign(new AIInsight(), {
    _id: data.id,
    title: getLogInsightTitle({ evidence: data.evidence, serviceName }),
    insightType: data.insightType,
    severity: getLogInsightSeverity(data.evidence),
    status: data.status,
    serviceName: serviceName,
    telemetryServiceId: new ObjectID(data.evidence.serviceId),
    occurrenceCount: data.occurrenceCount,
    firstSeenAt: data.firstSeenAt,
    lastSeenAt: data.lastSeenAt,
    evidence: { log: data.evidence },
    detailMarkdown: buildLogInsightDetail({
      serviceName,
      evidence: data.evidence,
    }).toString(),
    ...(data.fixAiRunId ? { fixAiRunId: new ObjectID(data.fixAiRunId) } : {}),
  });
}

export function aiInsights(now) {
  if (insightsMode === "empty") {
    return [];
  }

  return [
    finding({
      id: AI_INSIGHT_IDS.error,
      insightType: AIInsightType.LogErrorPattern,
      status: AIInsightStatus.ActionRequired,
      evidence: errorEvidence(now),
      occurrenceCount: 5,
      firstSeenAt: new Date(now - 5 * HOUR),
      lastSeenAt: new Date(now - 4 * MINUTE),
    }),
    finding({
      id: AI_INSIGHT_IDS.silent,
      insightType: AIInsightType.LogMissingLogging,
      status: AIInsightStatus.FixOpened,
      evidence: silentEvidence(now),
      occurrenceCount: 3,
      firstSeenAt: new Date(now - 3 * HOUR),
      lastSeenAt: new Date(now - 4 * MINUTE),
      fixAiRunId: AI_TASK_IDS.automatic,
    }),
    finding({
      id: AI_INSIGHT_IDS.noisy,
      insightType: AIInsightType.LogNoisyPattern,
      status: AIInsightStatus.Detected,
      evidence: noisyEvidence(now),
      occurrenceCount: 8,
      firstSeenAt: new Date(now - 8 * HOUR),
      lastSeenAt: new Date(now - 4 * MINUTE),
    }),
    finding({
      id: AI_INSIGHT_IDS.untraced,
      insightType: AIInsightType.LogMissingLogging,
      status: AIInsightStatus.Detected,
      evidence: untracedEvidence(now),
      occurrenceCount: 2,
      firstSeenAt: new Date(now - 2 * HOUR),
      lastSeenAt: new Date(now - 4 * MINUTE),
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
      triggerEntityType: AutoRemediationTriggerEntity.Log,
      isEnabled: true,
      investigates: true,
      fixes: true,
      executionMode: AutoRemediationExecutionMode.Suggest,
      onlyIfOpenAfterMinutes: 60,
    }),
    Object.assign(new AutoRemediationRule(), {
      _id: RULE_IDS.everything,
      name: "Everything else: look, don't touch",
      triggerEntityType: AutoRemediationTriggerEntity.Log,
      isEnabled: false,
      investigates: true,
      fixes: false,
      executionMode: AutoRemediationExecutionMode.Suggest,
    }),
  ];
}

export function aiReadiness() {
  return {
    lane: "Log",
    isAiEnabled: projectSwitches.enableAi,
    isLaneOn: projectSwitches.enableAutomaticLogRemediation,
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
 * Fix with AI on a finding, as LogInsightFix.getSuggestion decides it: the
 * offer from Common's getTelemetryAiFixOffer, the repository the code was
 * found in or the ones to pick from.
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

  const insights = aiInsights(now);
  const insight = (id) => {
    const row = insights.find((candidate) => candidate.id.toString() === id);
    return { id, title: row.title, serviceName: row.serviceName };
  };
  const silent = insight(AI_INSIGHT_IDS.silent);
  const error = insight(AI_INSIGHT_IDS.error);

  const entries = [
    {
      runId: AI_TASK_IDS.automatic,
      kind: "PullRequest",
      at: new Date(now - 2 * HOUR).toISOString(),
      state: "Done",
      insight: silent,
      taskId: AI_TASK_IDS.automatic,
      repositoryName: "acme/payments",
      repositoryHostedAt: "GitHub",
      pullRequest: {
        state: "open",
        number: 1307,
        url: "https://github.com/acme/payments/pull/1307",
      },
    },
    {
      runId: "50940000-0000-4000-8000-0000000000d1",
      kind: "Investigation",
      at: new Date(now - 2 * HOUR - 5 * MINUTE).toISOString(),
      state: "Done",
      insight: silent,
      classification: "code-fault",
    },
    {
      runId: AI_TASK_IDS.asked,
      kind: "PullRequest",
      at: new Date(now - 26 * HOUR).toISOString(),
      state: "NothingToChange",
      insight: error,
      requestedBy: "Ada Lovelace",
      taskId: AI_TASK_IDS.asked,
      repositoryName: "acme/checkout",
    },
    {
      runId: "50940000-0000-4000-8000-0000000000d2",
      kind: "Investigation",
      at: new Date(now - 27 * HOUR).toISOString(),
      state: "Failed",
      insight: error,
    },
  ];

  const page = entries.slice(skip || 0, (skip || 0) + 3);

  return { entries: page, totalCount: entries.length };
}

// The project's LLM providers, as POST /ai-chat/providers answers them.
export function aiProviders() {
  return {
    isAIEnabledForProject: projectSwitches.enableAi,
    defaultProviderId: "50940000-0000-4000-8000-0000000000a9",
    providers: [
      {
        id: "50940000-0000-4000-8000-0000000000a9",
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
