/*
 * What Exceptions' AI tab reads, answered as the server answers it: the
 * problems OneUptime found in the project's exceptions (AIInsight rows of
 * the three exception kinds, with their evidence), the exception AI rules
 * (AutoRemediationRule with the Exception trigger), the pull request
 * readiness (POST /telemetry-ai/readiness), the AI logs (POST
 * /telemetry-ai/logs), Fix with AI on a finding (POST
 * /telemetry-ai/fix-suggestion and /telemetry-ai/fix, decided by Common's
 * getTelemetryAiFixOffer as ExceptionInsightFix.getSuggestion decides it,
 * with the pull request it would be: a fix, better handling, or a request
 * in Code), the project's switches and its LLM providers.
 *
 * Every record is fabricated; each finding's evidence text is what the
 * detector writes for it (buildNewExceptionDetail, buildExceptionSpikeDetail
 * and buildExceptionStackTraceDetail). Scenarios, by query parameter:
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
 *   ?verdict=    fault (default) | expected - the new exception's verdict:
 *                a fix, or better handling of an expected error
 *   ?lane=       on (default) | off - "Find and fix new and rising exceptions"
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
import CodeFixTaskType from "Common/Types/AI/CodeFixTaskType";
import AutoRemediationExecutionMode from "Common/Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationTriggerEntity from "Common/Types/AutoRemediation/AutoRemediationTriggerEntity";
import ObjectID from "Common/Types/ObjectID";
import {
  buildExceptionSpikeDetail,
  buildExceptionStackTraceDetail,
  buildNewExceptionDetail,
  getExceptionStackTraceTitle,
} from "Common/Utils/Exceptions/ExceptionInsight";
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
const isExpectedError = params.get("verdict") === "expected";
const isLaneOn = params.get("lane") !== "off";
const isAiOn = params.get("ai") !== "off";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const SERVICE_IDS = {
  checkout: "52400000-0000-4000-8000-0000000000a1",
  payments: "52400000-0000-4000-8000-0000000000a2",
  edge: "52400000-0000-4000-8000-0000000000a3",
};

export const EXCEPTION_IDS = {
  coupon: "52400000-0000-4000-8000-0000000000d1",
  declined: "52400000-0000-4000-8000-0000000000d2",
  timeout: "52400000-0000-4000-8000-0000000000d3",
  upstream: "52400000-0000-4000-8000-0000000000d4",
};

export const AI_INSIGHT_IDS = {
  newException: "52400000-0000-4000-8000-0000000000e1",
  spike: "52400000-0000-4000-8000-0000000000e2",
  stackTrace: "52400000-0000-4000-8000-0000000000e3",
};

export const AI_TASK_IDS = {
  automatic: "52400000-0000-4000-8000-0000000000f1",
  asked: "52400000-0000-4000-8000-0000000000f2",
  started: "52400000-0000-4000-8000-0000000000f3",
  running: "52400000-0000-4000-8000-0000000000f4",
};

export const REPOSITORY_IDS = {
  checkout: "52400000-0000-4000-8000-0000000000b1",
  platform: "52400000-0000-4000-8000-0000000000b2",
};

const RULE_IDS = {
  checkout: "52400000-0000-4000-8000-0000000000c1",
  everything: "52400000-0000-4000-8000-0000000000c2",
};

/*
 * The project's AI switches as the switches card and the notice read
 * them; a flip is kept, as the server would keep it.
 */
const projectSwitches = {
  enableAi: isAiOn,
  enableAutomaticExceptionRemediation: isLaneOn,
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

const COUPON_LABEL =
  "TypeError: Cannot read properties of undefined (reading 'id')";
const DECLINED_LABEL = "PaymentDeclinedError: card was declined";

// Where the new exception was raised: two frames of the application's own code.
const COUPON_FRAMES = [
  {
    functionName: "applyCoupon",
    fileName: "src/checkout/coupon.ts",
    lineNumber: 42,
  },
  {
    functionName: "handleCheckout",
    fileName: "src/routes/checkout.ts",
    lineNumber: 88,
  },
];

function newExceptionEvidence(now) {
  return {
    exception: {
      exceptionType: "TypeError",
      exceptionMessage: "Cannot read properties of undefined (reading 'id')",
      occurrenceCount: 46,
      firstSeenAt: new Date(now - 3 * HOUR).toISOString(),
      serviceId: SERVICE_IDS.checkout,
      stackFrameCount: 6,
      ownCodeFrames: COUPON_FRAMES,
    },
  };
}

function spikeEvidence(now) {
  return {
    exception: {
      exceptionType: "PaymentDeclinedError",
      exceptionMessage: "card was declined",
      recentOccurrenceCount: 240,
      baselineHourlyAverage: 20,
      spikeMultiplier: 12,
      firstSeenAt: new Date(now - 30 * 24 * HOUR).toISOString(),
      serviceId: SERVICE_IDS.payments,
      stackFrameCount: 5,
      ownCodeFrames: [
        {
          functionName: "chargeCard",
          fileName: "src/payments/charge.ts",
          lineNumber: 117,
        },
      ],
    },
  };
}

function stackTraceEvidence(now) {
  return {
    exceptionStackTrace: {
      serviceId: SERVICE_IDS.edge,
      windowStartTime: new Date(now - 24 * HOUR).toISOString(),
      windowEndTime: new Date(now).toISOString(),
      exceptions: [
        {
          telemetryExceptionId: EXCEPTION_IDS.timeout,
          exceptionType: "Error",
          exceptionMessage: "upstream request timed out",
          occurrenceCount: 1840,
          lastSeenAt: new Date(now - 6 * MINUTE).toISOString(),
        },
        {
          telemetryExceptionId: EXCEPTION_IDS.upstream,
          exceptionType: "Error",
          exceptionMessage: "connection reset by peer",
          occurrenceCount: 212,
          lastSeenAt: new Date(now - 40 * MINUTE).toISOString(),
        },
      ],
      exceptionCount: 2,
      occurrenceCount: 2052,
      withStackTraceCount: 0,
    },
  };
}

// The evidence as each detector writes it on the insight.
function newExceptionDetail(now) {
  return buildNewExceptionDetail({
    label: COUPON_LABEL,
    message: "Cannot read properties of undefined (reading 'id')",
    serviceName: "checkout",
    firstSeenAt: new Date(now - 3 * HOUR).toISOString(),
    lookbackHours: 24,
    totalOccurrenceCount: 46,
    groupCount: 1,
    stackFrameCount: 6,
    ownCodeFrames: COUPON_FRAMES,
  });
}

function spikeDetail(now) {
  return buildExceptionSpikeDetail({
    label: DECLINED_LABEL,
    message: "card was declined",
    serviceName: "payments",
    isDormantAwakening: false,
    recentWindowHours: 1,
    recentOccurrenceCount: 240,
    baselineWindowHours: 24,
    baselineHourlyAverage: 20,
    priorWindowCount: 480,
    multiplier: 12,
    firstSeenAt: new Date(now - 30 * 24 * HOUR).toISOString(),
    totalOccurrenceCount: 15800,
    stackFrameCount: 5,
    ownCodeFrames: spikeEvidence(now).exception.ownCodeFrames,
  });
}

export const NEW_EXCEPTION_TITLE = `New exception: ${COUPON_LABEL} in checkout`;
export const SPIKE_TITLE = `Exception spike: ${DECLINED_LABEL} at 12.0x normal rate in payments`;

export function stackTraceTitle(now) {
  return getExceptionStackTraceTitle({
    evidence: stackTraceEvidence(now).exceptionStackTrace,
    serviceName: "edge",
  });
}

export function aiInsights(now) {
  if (insightsMode === "empty") {
    return [];
  }

  return [
    Object.assign(new AIInsight(), {
      _id: AI_INSIGHT_IDS.newException,
      title: NEW_EXCEPTION_TITLE,
      insightType: AIInsightType.NewException,
      severity: AIInsightSeverity.Medium,
      status: AIInsightStatus.ActionRequired,
      serviceName: "checkout",
      telemetryServiceId: new ObjectID(SERVICE_IDS.checkout),
      telemetryExceptionId: new ObjectID(EXCEPTION_IDS.coupon),
      classification: isExpectedError ? "user-error" : "code-fault",
      occurrenceCount: 4,
      firstSeenAt: new Date(now - 3 * HOUR),
      lastSeenAt: new Date(now - 4 * MINUTE),
      evidence: newExceptionEvidence(now),
      detailMarkdown: newExceptionDetail(now),
    }),
    Object.assign(new AIInsight(), {
      _id: AI_INSIGHT_IDS.spike,
      title: SPIKE_TITLE,
      insightType: AIInsightType.ExceptionSpike,
      severity: AIInsightSeverity.High,
      status: AIInsightStatus.FixOpened,
      serviceName: "payments",
      telemetryServiceId: new ObjectID(SERVICE_IDS.payments),
      telemetryExceptionId: new ObjectID(EXCEPTION_IDS.declined),
      classification: "user-error",
      occurrenceCount: 3,
      firstSeenAt: new Date(now - 2 * HOUR),
      lastSeenAt: new Date(now - 4 * MINUTE),
      evidence: spikeEvidence(now),
      fixAiRunId: new ObjectID(AI_TASK_IDS.automatic),
      detailMarkdown: spikeDetail(now),
    }),
    Object.assign(new AIInsight(), {
      _id: AI_INSIGHT_IDS.stackTrace,
      title: stackTraceTitle(now),
      insightType: AIInsightType.ExceptionMissingStackTrace,
      severity: AIInsightSeverity.Medium,
      status: AIInsightStatus.Detected,
      serviceName: "edge",
      telemetryServiceId: new ObjectID(SERVICE_IDS.edge),
      occurrenceCount: 12,
      firstSeenAt: new Date(now - 20 * HOUR),
      lastSeenAt: new Date(now - 4 * MINUTE),
      evidence: stackTraceEvidence(now),
      detailMarkdown: buildExceptionStackTraceDetail({
        serviceName: "edge",
        evidence: stackTraceEvidence(now).exceptionStackTrace,
      }).toString(),
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
      triggerEntityType: AutoRemediationTriggerEntity.Exception,
      isEnabled: true,
      investigates: true,
      fixes: true,
      executionMode: AutoRemediationExecutionMode.Suggest,
      onlyIfOpenAfterMinutes: 30,
    }),
    Object.assign(new AutoRemediationRule(), {
      _id: RULE_IDS.everything,
      name: "Everything else: look, don't touch",
      triggerEntityType: AutoRemediationTriggerEntity.Exception,
      isEnabled: false,
      investigates: true,
      fixes: false,
      executionMode: AutoRemediationExecutionMode.Suggest,
    }),
  ];
}

export function aiReadiness() {
  return {
    lane: "Exception",
    isAiEnabled: projectSwitches.enableAi,
    isLaneOn: projectSwitches.enableAutomaticExceptionRemediation,
    connectedRepositoryCount: readinessMode === "connect" ? 0 : 2,
    blocker:
      readinessMode === "credits"
        ? {
            type: CodeTaskBlockerType.NoAiCredits,
            message: "The project has no AI credits left.",
          }
        : null,
    automaticFixesToday: 1,
    maxAutomaticFixesPerDay: 5,
  };
}

/*
 * Fix with AI on a finding, as ExceptionInsightFix.getSuggestion decides
 * it: the offer from Common's getTelemetryAiFixOffer, the repository the
 * code was found in or the ones to pick from, and which pull request it
 * would be - the exception's fix, its better handling once the
 * investigation found an expected error, or for missing stack traces a
 * request in Code.
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

  let recipe = CodeFixTaskType.FixException;

  if (
    insight &&
    insight.insightType === AIInsightType.ExceptionMissingStackTrace
  ) {
    recipe = CodeFixTaskType.CodeRequest;
  } else if (insight && insight.classification === "user-error") {
    recipe = CodeFixTaskType.ImproveExceptionHandling;
  }

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
    ...(decided.offer === "Act" ? { recipe } : {}),
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
  const spike = insight(AI_INSIGHT_IDS.spike, SPIKE_TITLE, "payments");
  const newException = insight(
    AI_INSIGHT_IDS.newException,
    NEW_EXCEPTION_TITLE,
    "checkout",
  );

  const entries = [
    {
      runId: AI_TASK_IDS.automatic,
      kind: "PullRequest",
      at: new Date(now - 90 * MINUTE).toISOString(),
      state: "Done",
      insight: spike,
      taskId: AI_TASK_IDS.automatic,
      repositoryName: "acme/payments",
      repositoryHostedAt: "GitHub",
      pullRequest: {
        state: "open",
        number: 2210,
        url: "https://github.com/acme/payments/pull/2210",
      },
    },
    {
      runId: "52400000-0000-4000-8000-000000000101",
      kind: "Investigation",
      at: new Date(now - 95 * MINUTE).toISOString(),
      state: "Done",
      insight: spike,
      classification: "user-error",
    },
    {
      runId: AI_TASK_IDS.asked,
      kind: "PullRequest",
      at: new Date(now - 20 * HOUR).toISOString(),
      state: "NothingToChange",
      insight: newException,
      requestedBy: "Ada Lovelace",
      taskId: AI_TASK_IDS.asked,
      repositoryName: "acme/checkout",
    },
    {
      runId: "52400000-0000-4000-8000-000000000102",
      kind: "Investigation",
      at: new Date(now - 21 * HOUR).toISOString(),
      state: "Failed",
      insight: newException,
    },
  ];

  const page = entries.slice(skip || 0, (skip || 0) + 3);

  return { entries: page, totalCount: entries.length };
}

// The project's LLM providers, as POST /ai-chat/providers answers them.
export function aiProviders() {
  return {
    isAIEnabledForProject: projectSwitches.enableAi,
    defaultProviderId: "52400000-0000-4000-8000-0000000000a9",
    providers: [
      {
        id: "52400000-0000-4000-8000-0000000000a9",
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
