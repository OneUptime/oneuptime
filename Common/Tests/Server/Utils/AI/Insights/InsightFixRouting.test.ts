import InsightFixRouting, {
  InsightFixRoutingResult,
} from "../../../../../Server/Utils/AI/Sentinel/Insights/FixRouting";
import FixPerformanceTaskTrigger from "../../../../../Server/Utils/AI/Sentinel/FixPerformanceTaskTrigger";
import SubjectCodeFixRun from "../../../../../Server/Utils/AI/Sentinel/SubjectCodeFixRun";
import SpanTreeAnalyzer, {
  AnalyzableSpan,
} from "../../../../../Server/Utils/AI/PerfEvidence/SpanTreeAnalyzer";
import FixRunBudget, {
  FixRunBudgetDecision,
} from "../../../../../Server/Utils/AI/CodeFix/FixRunBudget";
import TelemetryExceptionService from "../../../../../Server/Services/TelemetryExceptionService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import SentinelInsight from "../../../../../Models/DatabaseModels/SentinelInsight";
import Project from "../../../../../Models/DatabaseModels/Project";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import ObjectID from "../../../../../Types/ObjectID";
import SentinelInsightType from "../../../../../Types/AI/SentinelInsightType";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import {
  PerformanceFinding,
  PerformanceFindingType,
} from "../../../../../Types/AI/CodeFixTaskContext";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * Deterministic fix routing for newly created Sentinel insights (the
 * Preventive lane's auto-fix step). The invariants these tests lock in:
 *   (a) the two gates, in order: the Project.enableAi master kill switch
 *       (default TRUE — only an explicit false disables, so an unselected
 *       flag never silently kills routing) and then the strict opt-in
 *       Project.enableInsightFixTasks, which must be EXACTLY true (default
 *       false) or nothing downstream is even probed;
 *   (b) per-type eligibility is deterministic: exception insights need a
 *       telemetryExceptionId, latency insights need stored span-tree
 *       findings + a trace id, and ErrorLogSpike/MetricDrift are NEVER
 *       auto-fixed;
 *   (c) the daily fix-run budget (G11) and the AI-fix readiness precheck
 *       are quiet skips, never errors;
 *   (d) a created fix run is stamped with triggeredBySentinelInsightId
 *       (provenance) and returned as fixAiRunId;
 *   (e) routeInsightFix NEVER throws — creation-path rejections resolve
 *       to an empty result;
 * plus the FixPerformanceTaskTrigger refactor invariance: the spans path
 * still refuses traces with no deterministic finding BEFORE any other
 * gate, and the findings entry point enforces the repo + dedupe gates.
 */

const projectId: ObjectID = ObjectID.generate();
const insightId: ObjectID = ObjectID.generate();
const exceptionId: ObjectID = ObjectID.generate();
const fixRunId: ObjectID = ObjectID.generate();

function makeProject(overrides: Record<string, unknown> = {}): Project {
  return {
    id: projectId,
    enableInsightFixTasks: true,
    ...overrides,
  } as unknown as Project;
}

function makeInsight(overrides: Record<string, unknown> = {}): SentinelInsight {
  return {
    id: insightId,
    projectId,
    insightType: SentinelInsightType.NewException,
    telemetryExceptionId: exceptionId,
    ...overrides,
  } as unknown as SentinelInsight;
}

function makeFinding(): PerformanceFinding {
  return {
    findingType: PerformanceFindingType.NPlusOneQuery,
    headline: 'N+1: 12× "SELECT users"',
    evidence: "12 near-identical sibling spans under one parent",
    spanCount: 12,
    combinedDurationMs: 480,
    traceDurationMs: 600,
    percentOfTrace: 80,
    normalizedSpanName: "SELECT users",
    implicatedSpans: [{ spanId: "s1", name: "SELECT users", durationMs: 40 }],
  };
}

function makeLatencyInsight(
  overrides: Record<string, unknown> = {},
): SentinelInsight {
  return makeInsight({
    insightType: SentinelInsightType.TraceLatencyRegression,
    telemetryExceptionId: undefined,
    traceId: "trace-abc",
    serviceName: "checkout",
    evidence: {
      latency: {
        recentP99Ms: 2400,
        baselineP99Ms: 800,
        regressionMultiplier: 3,
        sampleTraceId: "trace-abc",
        performanceFindings: [makeFinding()],
        codeLocations: [{ filePath: "src/db.ts" }],
      },
    },
    ...overrides,
  });
}

function mockBudgetAllowed(allowed: boolean): jest.SpyInstance {
  const decision: FixRunBudgetDecision = {
    allowed,
    limit: 25,
    paused: false,
    runsToday: allowed ? 0 : 25,
  };
  return jest
    .spyOn(FixRunBudget, "getBudgetStatus")
    .mockResolvedValue(decision);
}

function mockReadiness(ready: boolean): jest.SpyInstance {
  return jest
    .spyOn(TelemetryExceptionService, "getAIFixReadiness")
    .mockResolvedValue({ ready, checks: [] });
}

describe("InsightFixRouting.routeInsightFix", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("skips everything when the project has not opted in (strict, default false)", async () => {
    const budget: jest.SpyInstance = mockBudgetAllowed(true);
    const create: jest.SpyInstance = jest.spyOn(
      TelemetryExceptionService,
      "createCodeFixRunForException",
    );

    const result: InsightFixRoutingResult =
      await InsightFixRouting.routeInsightFix({
        insight: makeInsight(),
        project: makeProject({ enableInsightFixTasks: undefined }),
      });

    expect(result).toEqual({});
    expect(budget).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test("the enableAi master kill switch wins over a legacy-true enableInsightFixTasks — nothing is probed, no run created", async () => {
    const budget: jest.SpyInstance = mockBudgetAllowed(true);
    const readiness: jest.SpyInstance = mockReadiness(true);
    const create: jest.SpyInstance = jest.spyOn(
      TelemetryExceptionService,
      "createCodeFixRunForException",
    );
    const createFromFindings: jest.SpyInstance = jest.spyOn(
      FixPerformanceTaskTrigger,
      "createPerformanceFixTaskFromFindings",
    );

    const exceptionResult: InsightFixRoutingResult =
      await InsightFixRouting.routeInsightFix({
        insight: makeInsight(),
        // AI off for the whole project, but the fix-task opt-in still true.
        project: makeProject({ enableAi: false, enableInsightFixTasks: true }),
      });

    const latencyResult: InsightFixRoutingResult =
      await InsightFixRouting.routeInsightFix({
        insight: makeLatencyInsight(),
        project: makeProject({ enableAi: false, enableInsightFixTasks: true }),
      });

    expect(exceptionResult).toEqual({});
    expect(latencyResult).toEqual({});
    expect(budget).not.toHaveBeenCalled();
    expect(readiness).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(createFromFindings).not.toHaveBeenCalled();
  });

  test("the master switch is NOT over-broad: enableAi true — and enableAi unselected/undefined (column defaults to true) — still route", async () => {
    mockBudgetAllowed(true);
    mockReadiness(true);
    const create: jest.SpyInstance = jest
      .spyOn(TelemetryExceptionService, "createCodeFixRunForException")
      .mockResolvedValue({ id: fixRunId } as unknown as AIRun);
    jest.spyOn(AIRunService, "updateOneById").mockResolvedValue(undefined);

    const explicitlyOn: InsightFixRoutingResult =
      await InsightFixRouting.routeInsightFix({
        insight: makeInsight(),
        project: makeProject({ enableAi: true }),
      });

    const unselected: InsightFixRoutingResult =
      await InsightFixRouting.routeInsightFix({
        insight: makeInsight(),
        project: makeProject({ enableAi: undefined }),
      });

    expect(explicitlyOn).toEqual({ fixAiRunId: fixRunId });
    expect(unselected).toEqual({ fixAiRunId: fixRunId });
    expect(create).toHaveBeenCalledTimes(2);
  });

  test("ErrorLogSpike and MetricDrift are never auto-fixed", async () => {
    const budget: jest.SpyInstance = mockBudgetAllowed(true);

    for (const insightType of [
      SentinelInsightType.ErrorLogSpike,
      SentinelInsightType.MetricDrift,
    ]) {
      const result: InsightFixRoutingResult =
        await InsightFixRouting.routeInsightFix({
          insight: makeInsight({ insightType }),
          project: makeProject(),
        });

      expect(result).toEqual({});
    }

    expect(budget).not.toHaveBeenCalled();
  });

  test("an exception insight without a telemetryExceptionId is skipped", async () => {
    const budget: jest.SpyInstance = mockBudgetAllowed(true);

    const result: InsightFixRoutingResult =
      await InsightFixRouting.routeInsightFix({
        insight: makeInsight({ telemetryExceptionId: undefined }),
        project: makeProject(),
      });

    expect(result).toEqual({});
    expect(budget).not.toHaveBeenCalled();
  });

  test("a latency insight without stored findings (or trace id) is skipped", async () => {
    const budget: jest.SpyInstance = mockBudgetAllowed(true);

    const noFindings: InsightFixRoutingResult =
      await InsightFixRouting.routeInsightFix({
        insight: makeLatencyInsight({
          evidence: { latency: { performanceFindings: [] } },
        }),
        project: makeProject(),
      });

    const noTraceId: InsightFixRoutingResult =
      await InsightFixRouting.routeInsightFix({
        insight: makeLatencyInsight({
          traceId: undefined,
          evidence: {
            latency: { performanceFindings: [makeFinding()] },
          },
        }),
        project: makeProject(),
      });

    expect(noFindings).toEqual({});
    expect(noTraceId).toEqual({});
    expect(budget).not.toHaveBeenCalled();
  });

  test("over-budget is a quiet skip — readiness is never probed", async () => {
    mockBudgetAllowed(false);
    const readiness: jest.SpyInstance = mockReadiness(true);

    const result: InsightFixRoutingResult =
      await InsightFixRouting.routeInsightFix({
        insight: makeInsight(),
        project: makeProject(),
      });

    expect(result).toEqual({});
    expect(readiness).not.toHaveBeenCalled();
  });

  test("a not-ready readiness check is a quiet skip — no run is created", async () => {
    mockBudgetAllowed(true);
    mockReadiness(false);
    const create: jest.SpyInstance = jest.spyOn(
      TelemetryExceptionService,
      "createCodeFixRunForException",
    );

    const result: InsightFixRoutingResult =
      await InsightFixRouting.routeInsightFix({
        insight: makeInsight(),
        project: makeProject(),
      });

    expect(result).toEqual({});
    expect(create).not.toHaveBeenCalled();
  });

  test("exception happy path: FixException run created as system, stamped with the insight, id returned", async () => {
    mockBudgetAllowed(true);
    mockReadiness(true);
    const create: jest.SpyInstance = jest
      .spyOn(TelemetryExceptionService, "createCodeFixRunForException")
      .mockResolvedValue({ id: fixRunId } as unknown as AIRun);
    const stamp: jest.SpyInstance = jest
      .spyOn(AIRunService, "updateOneById")
      .mockResolvedValue(undefined);

    const result: InsightFixRoutingResult =
      await InsightFixRouting.routeInsightFix({
        insight: makeInsight(),
        project: makeProject(),
      });

    expect(result).toEqual({ fixAiRunId: fixRunId });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        telemetryExceptionId: exceptionId,
        taskType: CodeFixTaskType.FixException,
        // System-triggered: root props, no userId attribution.
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
    expect(stamp).toHaveBeenCalledWith(
      expect.objectContaining({
        id: fixRunId,
        data: expect.objectContaining({
          triggeredBySentinelInsightId: insightId,
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
  });

  test("latency happy path: the findings entry point gets the stored evidence verbatim", async () => {
    mockBudgetAllowed(true);
    const finding: PerformanceFinding = makeFinding();
    const createFromFindings: jest.SpyInstance = jest
      .spyOn(FixPerformanceTaskTrigger, "createPerformanceFixTaskFromFindings")
      .mockResolvedValue({ id: fixRunId } as unknown as AIRun);
    const stamp: jest.SpyInstance = jest
      .spyOn(AIRunService, "updateOneById")
      .mockResolvedValue(undefined);

    const result: InsightFixRoutingResult =
      await InsightFixRouting.routeInsightFix({
        insight: makeLatencyInsight({
          evidence: {
            latency: {
              recentP99Ms: 2400,
              baselineP99Ms: 800,
              regressionMultiplier: 3,
              performanceFindings: [finding],
              codeLocations: [{ filePath: "src/db.ts" }],
            },
          },
        }),
        project: makeProject(),
      });

    expect(result).toEqual({ fixAiRunId: fixRunId });
    expect(createFromFindings).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        traceId: "trace-abc",
        serviceName: "checkout",
        findings: [finding],
        codeLocations: [{ filePath: "src/db.ts" }],
      }),
    );
    expect(stamp).toHaveBeenCalledWith(
      expect.objectContaining({
        id: fixRunId,
        data: expect.objectContaining({
          triggeredBySentinelInsightId: insightId,
        }),
      }),
    );
  });

  test("a missing insight.traceId falls back to the evidence's sampleTraceId", async () => {
    mockBudgetAllowed(true);
    const createFromFindings: jest.SpyInstance = jest
      .spyOn(FixPerformanceTaskTrigger, "createPerformanceFixTaskFromFindings")
      .mockResolvedValue({ id: fixRunId } as unknown as AIRun);
    jest.spyOn(AIRunService, "updateOneById").mockResolvedValue(undefined);

    await InsightFixRouting.routeInsightFix({
      insight: makeLatencyInsight({ traceId: undefined }),
      project: makeProject(),
    });

    expect(createFromFindings).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: "trace-abc" }),
    );
  });

  test("NEVER throws: a creation-path rejection (dedupe/readiness race) resolves to an empty result", async () => {
    mockBudgetAllowed(true);
    mockReadiness(true);
    jest
      .spyOn(TelemetryExceptionService, "createCodeFixRunForException")
      .mockRejectedValue(
        new Error(
          "An AI agent task is already in progress for this exception.",
        ),
      );

    await expect(
      InsightFixRouting.routeInsightFix({
        insight: makeInsight(),
        project: makeProject(),
      }),
    ).resolves.toEqual({});
  });

  test("NEVER throws: a budget-status failure resolves to an empty result", async () => {
    jest
      .spyOn(FixRunBudget, "getBudgetStatus")
      .mockRejectedValue(new Error("db down"));

    await expect(
      InsightFixRouting.routeInsightFix({
        insight: makeInsight(),
        project: makeProject(),
      }),
    ).resolves.toEqual({});
  });

  test("a failed provenance stamp still returns the created run id (best-effort)", async () => {
    mockBudgetAllowed(true);
    mockReadiness(true);
    jest
      .spyOn(TelemetryExceptionService, "createCodeFixRunForException")
      .mockResolvedValue({ id: fixRunId } as unknown as AIRun);
    jest
      .spyOn(AIRunService, "updateOneById")
      .mockRejectedValue(new Error("db down"));

    const result: InsightFixRoutingResult =
      await InsightFixRouting.routeInsightFix({
        insight: makeInsight(),
        project: makeProject(),
      });

    expect(result).toEqual({ fixAiRunId: fixRunId });
  });
});

describe("FixPerformanceTaskTrigger refactor invariance (spans path unchanged)", () => {
  const userId: ObjectID = ObjectID.generate();

  function makeSpan(): AnalyzableSpan {
    return {
      spanId: "s1",
      name: "SELECT users",
      durationMs: 40,
    } as unknown as AnalyzableSpan;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the no-deterministic-finding refusal is still thrown from the spans entry, before any other gate", async () => {
    jest.spyOn(SpanTreeAnalyzer, "analyzeTrace").mockReturnValue([]);
    const repoGate: jest.SpyInstance = jest.spyOn(
      SubjectCodeFixRun,
      "hasGitHubAppConnectedRepository",
    );

    await expect(
      FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
        projectId,
        traceId: "trace-abc",
        spans: [makeSpan()],
        userId,
      }),
    ).rejects.toThrow(/No deterministic performance pattern/);

    expect(repoGate).not.toHaveBeenCalled();
  });

  test("the spans path still rejects a missing traceId and an empty span list", async () => {
    await expect(
      FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
        projectId,
        traceId: "",
        spans: [makeSpan()],
        userId,
      }),
    ).rejects.toThrow(/traceId is required/);

    await expect(
      FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
        projectId,
        traceId: "trace-abc",
        spans: [],
        userId,
      }),
    ).rejects.toThrow(/no spans/);
  });

  test("spans happy path: same gates, same taskContext, userId attribution preserved", async () => {
    const finding: PerformanceFinding = makeFinding();
    jest.spyOn(SpanTreeAnalyzer, "analyzeTrace").mockReturnValue([finding]);
    jest
      .spyOn(SubjectCodeFixRun, "hasGitHubAppConnectedRepository")
      .mockResolvedValue(true);
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalPerformanceFixRunForTrace")
      .mockResolvedValue(null);
    const enqueue: jest.SpyInstance = jest
      .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
      .mockResolvedValue({ id: fixRunId } as unknown as AIRun);

    const run: AIRun =
      await FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
        projectId,
        traceId: "trace-abc",
        spans: [makeSpan()],
        serviceName: "checkout",
        userId,
      });

    expect(run.id).toEqual(fixRunId);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        taskType: CodeFixTaskType.FixPerformance,
        userId,
        taskContext: expect.objectContaining({
          traceId: "trace-abc",
          serviceName: "checkout",
          performanceFindings: [finding],
        }),
      }),
    );
  });

  test("the findings entry point still enforces the repository gate", async () => {
    jest
      .spyOn(SubjectCodeFixRun, "hasGitHubAppConnectedRepository")
      .mockResolvedValue(false);

    await expect(
      FixPerformanceTaskTrigger.createPerformanceFixTaskFromFindings({
        projectId,
        traceId: "trace-abc",
        findings: [makeFinding()],
        codeLocations: [],
      }),
    ).rejects.toThrow(/No GitHub-App-connected repository/);
  });

  test("the findings entry point still enforces the per-trace dedupe gate", async () => {
    jest
      .spyOn(SubjectCodeFixRun, "hasGitHubAppConnectedRepository")
      .mockResolvedValue(true);
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalPerformanceFixRunForTrace")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);

    await expect(
      FixPerformanceTaskTrigger.createPerformanceFixTaskFromFindings({
        projectId,
        traceId: "trace-abc",
        findings: [makeFinding()],
        codeLocations: [],
      }),
    ).rejects.toThrow(/already queued or running/);
  });
});
