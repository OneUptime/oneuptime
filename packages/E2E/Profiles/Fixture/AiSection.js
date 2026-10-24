/*
 * The Profiler's AI section (Profiler → AI → Insights, Logs and Settings),
 * behind the same data boundary as the rest of the fixture: what the pages
 * read, answered as the server answers them - the slow code OneUptime
 * found (AIInsight rows of ProfileHotspot, with their evidence), the
 * profile AI rules (AutoRemediationRule with the Profile trigger), the
 * pull request readiness (POST /telemetry-ai/readiness), the AI logs (POST
 * /telemetry-ai/logs), the project's switches and its LLM providers.
 *
 * Every record is fabricated. Scenarios, by query parameter:
 *
 *   ?aiInsights= full (default) | empty
 *   ?aiRules=    none (default) | two
 *   ?readiness=  ready (default) | connect | credits
 *   ?aiLogs=     full (default) | empty | fail
 *   ?lane=       on (default) | off - "Find and fix slow code"
 *   ?ai=         on (default) | off - Enable AI (read by Fixture.js too)
 */
import AIInsight from "Common/Models/DatabaseModels/AIInsight";
import AutoRemediationRule from "Common/Models/DatabaseModels/AutoRemediationRule";
import Project from "Common/Models/DatabaseModels/Project";
import AIInsightSeverity from "Common/Types/AI/AIInsightSeverity";
import AIInsightStatus from "Common/Types/AI/AIInsightStatus";
import AIInsightType from "Common/Types/AI/AIInsightType";
import { CodeTaskBlockerType } from "Common/Types/AI/CodeTask";
import AutoRemediationExecutionMode from "Common/Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationTriggerEntity from "Common/Types/AutoRemediation/AutoRemediationTriggerEntity";
import ObjectID from "Common/Types/ObjectID";

const params = new URLSearchParams(window.location.search);
const insightsMode = params.get("aiInsights") || "full";
const rulesMode = params.get("aiRules") || "none";
const readinessMode = params.get("readiness") || "ready";
const logsMode = params.get("aiLogs") || "full";
const isLaneOn = params.get("lane") !== "off";
const isAiOn = params.get("ai") !== "off";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const AI_INSIGHT_IDS = {
  hot: "50920000-0000-4000-8000-0000000000e1",
  grew: "50920000-0000-4000-8000-0000000000e2",
};

export const AI_TASK_IDS = {
  automatic: "50920000-0000-4000-8000-0000000000f1",
  asked: "50920000-0000-4000-8000-0000000000f2",
};

const RULE_IDS = {
  checkout: "50920000-0000-4000-8000-0000000000c1",
  everything: "50920000-0000-4000-8000-0000000000c2",
};

/*
 * The project's AI switches as the switches card and the notice read
 * them; a flip is kept, as the server would keep it.
 */
const projectSwitches = {
  enableAi: isAiOn,
  enableAutomaticProfileRemediation: isLaneOn,
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

function hotEvidence(now, serviceId) {
  return {
    profile: {
      serviceId,
      functionName: "parseOrder",
      fileName: "src/orders/parse.ts",
      lineNumber: 88,
      profileType: "cpu",
      category: "cpu",
      reason: "Hot",
      ownShare: 34,
      functionSampleCount: 22200,
      windowSampleCount: 65400,
      windowStartTime: new Date(now - HOUR).toISOString(),
      windowEndTime: new Date(now).toISOString(),
      callers: [
        {
          functionName: "handleCheckout",
          fileName: "src/routes/checkout.ts",
          share: 34,
        },
      ],
      callees: [
        {
          functionName: "JSON.parse",
          fileName: "node:internal/json",
          share: 26,
        },
        {
          functionName: "normalizeLineItems",
          fileName: "src/orders/normalize.ts",
          share: 8,
        },
      ],
    },
  };
}

function grewEvidence(now, serviceId) {
  return {
    profile: {
      serviceId,
      functionName: "normalizeLineItems",
      fileName: "src/orders/normalize.ts",
      lineNumber: 14,
      profileType: "cpu",
      category: "cpu",
      reason: "Grew",
      ownShare: 9,
      ownShareBefore: 3,
      functionSampleCount: 5400,
      windowSampleCount: 65400,
      windowStartTime: new Date(now - HOUR).toISOString(),
      windowEndTime: new Date(now).toISOString(),
      baselineStartTime: new Date(now - 25 * HOUR).toISOString(),
      baselineEndTime: new Date(now - 24 * HOUR).toISOString(),
      callers: [],
      callees: [],
    },
  };
}

export function aiInsights(now, serviceId) {
  if (insightsMode === "empty") {
    return [];
  }

  return [
    Object.assign(new AIInsight(), {
      _id: AI_INSIGHT_IDS.hot,
      title: "parseOrder takes 34% of the CPU time in checkout",
      insightType: AIInsightType.ProfileHotspot,
      severity: AIInsightSeverity.High,
      status: AIInsightStatus.ActionRequired,
      serviceName: "checkout",
      telemetryServiceId: new ObjectID(serviceId),
      occurrenceCount: 6,
      firstSeenAt: new Date(now - 6 * HOUR),
      lastSeenAt: new Date(now - 4 * MINUTE),
      evidence: hotEvidence(now, serviceId),
      detailMarkdown:
        "**parseOrder** (`src/orders/parse.ts:88`) takes **34%** of the CPU time in checkout over the last hour: the time in it, and in the library and runtime code it calls.\n\n- 22,200 of 65,400 samples\n- Most of it is spent in `JSON.parse` (26%)\n- Called from `handleCheckout`",
    }),
    Object.assign(new AIInsight(), {
      _id: AI_INSIGHT_IDS.grew,
      title:
        "normalizeLineItems grew to 9% of the CPU time in checkout, from 3%",
      insightType: AIInsightType.ProfileHotspot,
      severity: AIInsightSeverity.Medium,
      status: AIInsightStatus.FixOpened,
      serviceName: "checkout",
      telemetryServiceId: new ObjectID(serviceId),
      occurrenceCount: 3,
      firstSeenAt: new Date(now - 3 * HOUR),
      lastSeenAt: new Date(now - 4 * MINUTE),
      evidence: grewEvidence(now, serviceId),
      fixAiRunId: new ObjectID(AI_TASK_IDS.automatic),
      detailMarkdown:
        "**normalizeLineItems** (`src/orders/normalize.ts:14`) grew from **3%** to **9%** of the CPU time in checkout since the same hour yesterday.",
    }),
  ];
}

// The rows a list or a count asks for: its status, when it names one.
export function filterInsights(rows, query) {
  const status = query && query.status;

  if (typeof status === "string") {
    return rows.filter((row) => row.status === status);
  }

  return rows;
}

export function aiRules() {
  if (rulesMode !== "two") {
    return [];
  }

  return [
    Object.assign(new AutoRemediationRule(), {
      _id: RULE_IDS.checkout,
      name: "Checkout services",
      triggerEntityType: AutoRemediationTriggerEntity.Profile,
      isEnabled: true,
      investigates: true,
      fixes: true,
      executionMode: AutoRemediationExecutionMode.Suggest,
      onlyIfOpenAfterMinutes: 60,
    }),
    Object.assign(new AutoRemediationRule(), {
      _id: RULE_IDS.everything,
      name: "Everything else: look, don't touch",
      triggerEntityType: AutoRemediationTriggerEntity.Profile,
      isEnabled: false,
      investigates: true,
      fixes: false,
      executionMode: AutoRemediationExecutionMode.Suggest,
    }),
  ];
}

export function aiReadiness() {
  return {
    lane: "Profile",
    isAiEnabled: projectSwitches.enableAi,
    isLaneOn: projectSwitches.enableAutomaticProfileRemediation,
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

export function aiLogs(now, skip) {
  if (logsMode === "fail") {
    return null;
  }

  if (logsMode === "empty") {
    return { entries: [], totalCount: 0 };
  }

  const insight = (id, title) => {
    return { id, title, serviceName: "checkout" };
  };

  const entries = [
    {
      runId: AI_TASK_IDS.automatic,
      kind: "PullRequest",
      at: new Date(now - 2 * HOUR).toISOString(),
      state: "Done",
      insight: insight(
        AI_INSIGHT_IDS.grew,
        "normalizeLineItems grew to 9% of the CPU time in checkout, from 3%",
      ),
      taskId: AI_TASK_IDS.automatic,
      repositoryName: "acme/checkout",
      repositoryHostedAt: "GitHub",
      pullRequest: {
        state: "open",
        number: 812,
        url: "https://github.com/acme/checkout/pull/812",
      },
    },
    {
      runId: "50920000-0000-4000-8000-0000000000d1",
      kind: "Investigation",
      at: new Date(now - 2 * HOUR - 5 * MINUTE).toISOString(),
      state: "Done",
      insight: insight(
        AI_INSIGHT_IDS.grew,
        "normalizeLineItems grew to 9% of the CPU time in checkout, from 3%",
      ),
      classification: "Actionable",
    },
    {
      runId: AI_TASK_IDS.asked,
      kind: "PullRequest",
      at: new Date(now - 26 * HOUR).toISOString(),
      state: "NothingToChange",
      insight: insight(
        AI_INSIGHT_IDS.hot,
        "parseOrder takes 34% of the CPU time in checkout",
      ),
      requestedBy: "Ada Lovelace",
      taskId: AI_TASK_IDS.asked,
      repositoryName: "acme/checkout",
    },
    {
      runId: "50920000-0000-4000-8000-0000000000d2",
      kind: "Investigation",
      at: new Date(now - 27 * HOUR).toISOString(),
      state: "Failed",
      insight: insight(
        AI_INSIGHT_IDS.hot,
        "parseOrder takes 34% of the CPU time in checkout",
      ),
    },
  ];

  const page = entries.slice(skip || 0, (skip || 0) + 3);

  return { entries: page, totalCount: entries.length };
}

// The project's LLM providers, as POST /ai-chat/providers answers them.
export function aiProviders() {
  return {
    isAIEnabledForProject: projectSwitches.enableAi,
    defaultProviderId: "50920000-0000-4000-8000-0000000000a9",
    providers: [
      {
        id: "50920000-0000-4000-8000-0000000000a9",
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
