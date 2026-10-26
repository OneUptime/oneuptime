/*
 * What Metrics' AI tab reads, answered as the server answers it: the
 * problems OneUptime found in the project's metrics (AIInsight rows of the
 * three metric kinds, with their evidence), the metric AI rules
 * (AutoRemediationRule with the Metric trigger), the pull request readiness
 * (POST /telemetry-ai/readiness), the AI logs (POST /telemetry-ai/logs),
 * Fix with AI on a finding (POST /telemetry-ai/fix-suggestion and
 * /telemetry-ai/fix, decided by Common's getTelemetryAiFixOffer as the
 * server decides it), the project's switches and its LLM providers.
 *
 * Every record is fabricated; each finding's title and evidence text are
 * what the detector writes for it (getMetricInsightTitle and
 * buildMetricInsightDetail). Scenarios, by query parameter:
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
 *   ?lane=       on (default) | off - "Improve metrics and add missing ones"
 *   ?ai=         on (default) | off - Enable AI
 *   ?fail=       fix - the fix route refuses
 *   ?names=      short (default) | long - the names a real estate has:
 *                long service, metric, attribute and operation names
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
  OTEL_DEFAULT_HISTOGRAM_BOUNDS,
  buildMetricInsightDetail,
  getMetricInsightSeverity,
  getMetricInsightTitle,
} from "Common/Utils/Metrics/MetricInsight";
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
const isLongNames = params.get("names") === "long";

// Each name, as a small project writes it or as a large estate does.
function named(short, long) {
  return isLongNames ? long : short;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const SERVICE_IDS = {
  checkout: "52310000-0000-4000-8000-0000000000a1",
  worker: "52310000-0000-4000-8000-0000000000a2",
  payments: "52310000-0000-4000-8000-0000000000a3",
};

export const SERVICE_NAMES = {
  [SERVICE_IDS.checkout]: named(
    "checkout",
    "storefront-checkout-service-eu-west-1-production",
  ),
  [SERVICE_IDS.worker]: named(
    "worker",
    "storefront-background-jobs-worker-eu-west-1",
  ),
  [SERVICE_IDS.payments]: named(
    "payments",
    "storefront-payments-gateway-eu-west-1-production",
  ),
};

export const AI_INSIGHT_IDS = {
  cardinality: "52310000-0000-4000-8000-0000000000e1",
  buckets: "52310000-0000-4000-8000-0000000000e2",
  names: "52310000-0000-4000-8000-0000000000e3",
  missing: "52310000-0000-4000-8000-0000000000e4",
};

export const AI_TASK_IDS = {
  automatic: "52310000-0000-4000-8000-0000000000f1",
  asked: "52310000-0000-4000-8000-0000000000f2",
  started: "52310000-0000-4000-8000-0000000000f3",
  running: "52310000-0000-4000-8000-0000000000f4",
};

export const REPOSITORY_IDS = {
  checkout: "52310000-0000-4000-8000-0000000000b1",
  platform: "52310000-0000-4000-8000-0000000000b2",
};

const RULE_IDS = {
  checkout: "52310000-0000-4000-8000-0000000000c1",
  everything: "52310000-0000-4000-8000-0000000000c2",
};

/*
 * The project's AI switches as the switches card and the notice read
 * them; a flip is kept, as the server would keep it.
 */
const projectSwitches = {
  enableAi: isAiOn,
  enableAutomaticMetricRemediation: isLaneOn,
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

// The whole clock hour before the look, as the detector reads it.
function readWindow(now) {
  const end = Math.floor(now / HOUR) * HOUR;

  return {
    windowStartTime: new Date(end - HOUR).toISOString(),
    windowEndTime: new Date(end).toISOString(),
  };
}

function cardinalityEvidence(now) {
  return {
    serviceId: SERVICE_IDS.checkout,
    kind: "HighCardinality",
    shape: "Attribute",
    ...readWindow(now),
    metricName: named(
      "http.server.request.count",
      "com.example.storefront.checkout.http.server.request.count.by.tenant",
    ),
    unit: "{request}",
    dataPointCount: 48000,
    attributeKey: named(
      "user.id",
      "app.storefront.customer.account.identifier",
    ),
    attributeValueCount: 12000,
    valueShape: "Uuid",
    otherAttributes: [{ key: "session.id", valueCount: 4000 }],
  };
}

function bucketsEvidence(now) {
  return {
    serviceId: SERVICE_IDS.checkout,
    kind: "HistogramBuckets",
    ...readWindow(now),
    metricName: named(
      "http.server.duration",
      "com.example.storefront.checkout.http.server.request.duration.seconds",
    ),
    unit: "s",
    dataPointCount: 2400,
    bucketProblem: "BelowSmallestBucket",
    bucketShare: 95,
    valueCount: 2040,
    boundCount: OTEL_DEFAULT_HISTOGRAM_BOUNDS.length,
    smallestBound: 5,
    largestBound: 10000,
    hasDefaultBounds: true,
    minValue: 0.012,
    maxValue: 4.8,
  };
}

function namesEvidence(now) {
  return {
    serviceId: SERVICE_IDS.worker,
    kind: "HighCardinality",
    shape: "Name",
    ...readWindow(now),
    namePattern: named(
      "job.{id}.duration",
      "storefront.background.jobs.{id}.queue.processing.duration.seconds",
    ),
    nameCount: 1234,
    dataPointCount: 56000,
  };
}

function missingEvidence(now) {
  return {
    serviceId: SERVICE_IDS.payments,
    kind: "MissingMetrics",
    ...readWindow(now),
    spanCount: 4200,
    failedSpanCount: 12,
    topOperations: [
      {
        name: named(
          "POST /payments",
          "POST /api/v2/storefront/payments/{paymentId}/authorizations/{authorizationId}/capture",
        ),
        spanCount: 2600,
      },
      {
        name: named(
          "GET /payments/:id",
          "GET /api/v2/storefront/payments/{paymentId}",
        ),
        spanCount: 1100,
      },
    ],
    sdkLanguage: "nodejs",
  };
}

// A finding as the detector files it: its title, severity and evidence text.
function finding(data) {
  const serviceName = SERVICE_NAMES[data.evidence.serviceId];

  return Object.assign(new AIInsight(), {
    _id: data.id,
    title: getMetricInsightTitle({ evidence: data.evidence, serviceName }),
    insightType: data.insightType,
    severity: getMetricInsightSeverity(data.evidence),
    status: data.status,
    serviceName,
    telemetryServiceId: new ObjectID(data.evidence.serviceId),
    ...(data.evidence.metricName
      ? { metricName: data.evidence.metricName }
      : {}),
    occurrenceCount: data.occurrenceCount,
    firstSeenAt: data.firstSeenAt,
    lastSeenAt: data.lastSeenAt,
    evidence: { metric: data.evidence },
    ...(data.fixAiRunId ? { fixAiRunId: new ObjectID(data.fixAiRunId) } : {}),
    detailMarkdown: buildMetricInsightDetail({
      serviceName,
      evidence: data.evidence,
    }).toString(),
  });
}

export function aiInsights(now) {
  if (insightsMode === "empty") {
    return [];
  }

  return [
    finding({
      id: AI_INSIGHT_IDS.cardinality,
      insightType: AIInsightType.MetricHighCardinality,
      status: AIInsightStatus.ActionRequired,
      evidence: cardinalityEvidence(now),
      occurrenceCount: 5,
      firstSeenAt: new Date(now - 5 * HOUR),
      lastSeenAt: new Date(now - 4 * MINUTE),
    }),
    finding({
      id: AI_INSIGHT_IDS.buckets,
      insightType: AIInsightType.MetricHistogramBuckets,
      status: AIInsightStatus.FixOpened,
      evidence: bucketsEvidence(now),
      fixAiRunId: AI_TASK_IDS.automatic,
      occurrenceCount: 3,
      firstSeenAt: new Date(now - 3 * HOUR),
      lastSeenAt: new Date(now - 4 * MINUTE),
    }),
    finding({
      id: AI_INSIGHT_IDS.names,
      insightType: AIInsightType.MetricHighCardinality,
      status: AIInsightStatus.ActionRequired,
      evidence: namesEvidence(now),
      occurrenceCount: 2,
      firstSeenAt: new Date(now - 2 * HOUR),
      lastSeenAt: new Date(now - 4 * MINUTE),
    }),
    finding({
      id: AI_INSIGHT_IDS.missing,
      insightType: AIInsightType.MetricMissingMetrics,
      status: AIInsightStatus.Detected,
      evidence: missingEvidence(now),
      occurrenceCount: 8,
      firstSeenAt: new Date(now - 8 * HOUR),
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
      triggerEntityType: AutoRemediationTriggerEntity.Metric,
      isEnabled: true,
      investigates: true,
      fixes: true,
      executionMode: AutoRemediationExecutionMode.Suggest,
      onlyIfOpenAfterMinutes: 60,
    }),
    Object.assign(new AutoRemediationRule(), {
      _id: RULE_IDS.everything,
      name: "Everything else: look, don't touch",
      triggerEntityType: AutoRemediationTriggerEntity.Metric,
      isEnabled: false,
      investigates: true,
      fixes: false,
      executionMode: AutoRemediationExecutionMode.Suggest,
    }),
  ];
}

export function aiReadiness() {
  return {
    lane: "Metric",
    isAiEnabled: projectSwitches.enableAi,
    isLaneOn: projectSwitches.enableAutomaticMetricRemediation,
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
 * Fix with AI on a finding, as MetricInsightFix.getSuggestion decides it:
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

  // Its kind too, as the server sends it: a verdict is said in its words.
  const insight = (id, evidence, serviceName, type) => {
    return {
      id,
      title: getMetricInsightTitle({ evidence, serviceName }),
      serviceName,
      type,
    };
  };
  const buckets = insight(
    AI_INSIGHT_IDS.buckets,
    bucketsEvidence(now),
    SERVICE_NAMES[SERVICE_IDS.checkout],
    AIInsightType.MetricHistogramBuckets,
  );
  const cardinality = insight(
    AI_INSIGHT_IDS.cardinality,
    cardinalityEvidence(now),
    SERVICE_NAMES[SERVICE_IDS.checkout],
    AIInsightType.MetricHighCardinality,
  );
  const missing = insight(
    AI_INSIGHT_IDS.missing,
    missingEvidence(now),
    SERVICE_NAMES[SERVICE_IDS.payments],
    AIInsightType.MetricMissingMetrics,
  );

  const entries = [
    {
      runId: AI_TASK_IDS.automatic,
      kind: "PullRequest",
      at: new Date(now - 2 * HOUR).toISOString(),
      state: "Done",
      insight: buckets,
      taskId: AI_TASK_IDS.automatic,
      repositoryName: "acme/checkout",
      repositoryHostedAt: "GitHub",
      pullRequest: {
        state: "open",
        number: 1311,
        url: "https://github.com/acme/checkout/pull/1311",
      },
    },
    {
      runId: "52310000-0000-4000-8000-0000000000d1",
      kind: "Investigation",
      at: new Date(now - 2 * HOUR - 5 * MINUTE).toISOString(),
      state: "Done",
      insight: buckets,
      classification: "code-fault",
    },
    {
      runId: AI_TASK_IDS.asked,
      kind: "PullRequest",
      at: new Date(now - 26 * HOUR).toISOString(),
      state: "NothingToChange",
      insight: cardinality,
      requestedBy: "Ada Lovelace",
      taskId: AI_TASK_IDS.asked,
      repositoryName: "acme/checkout",
    },
    {
      runId: "52310000-0000-4000-8000-0000000000d2",
      kind: "Investigation",
      at: new Date(now - 27 * HOUR).toISOString(),
      state: "Failed",
      insight: missing,
    },
  ];

  const page = entries.slice(skip || 0, (skip || 0) + 3);

  return { entries: page, totalCount: entries.length };
}

// The project's LLM providers, as POST /ai-chat/providers answers them.
export function aiProviders() {
  return {
    isAIEnabledForProject: projectSwitches.enableAi,
    defaultProviderId: "52310000-0000-4000-8000-0000000000a9",
    providers: [
      {
        id: "52310000-0000-4000-8000-0000000000a9",
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
