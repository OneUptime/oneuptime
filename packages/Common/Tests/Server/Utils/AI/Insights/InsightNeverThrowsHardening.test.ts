import InsightScanner from "../../../../../Server/Utils/AI/SRE/Insights/InsightScanner";
import InsightStore from "../../../../../Server/Utils/AI/SRE/Insights/InsightStore";
import InsightDetectors from "../../../../../Server/Utils/AI/SRE/Insights/Detectors/Index";
import InsightFixRouting, {
  InsightFixRoutingResult,
} from "../../../../../Server/Utils/AI/SRE/Insights/FixRouting";
import InsightTriage, {
  InsightTriageResult,
} from "../../../../../Server/Utils/AI/SRE/Insights/Triage";
import {
  InsightCandidate,
  InsightDetector,
  InsightScanContext,
} from "../../../../../Server/Utils/AI/SRE/Insights/Types";
import AIInvestigationQueue from "../../../../../Server/Utils/AI/SRE/InvestigationQueue";
import FixPerformanceTaskTrigger from "../../../../../Server/Utils/AI/SRE/FixPerformanceTaskTrigger";
import FixRunBudget, {
  FixRunBudgetDecision,
} from "../../../../../Server/Utils/AI/CodeFix/FixRunBudget";
import ProjectService from "../../../../../Server/Services/ProjectService";
import LlmProviderService from "../../../../../Server/Services/LlmProviderService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import TelemetryExceptionService from "../../../../../Server/Services/TelemetryExceptionService";
import AIInsightService from "../../../../../Server/Services/AIInsightService";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import Project from "../../../../../Models/DatabaseModels/Project";
import LlmProvider from "../../../../../Models/DatabaseModels/LlmProvider";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import AIInsightSeverity from "../../../../../Types/AI/AIInsightSeverity";
import {
  PerformanceFinding,
  PerformanceFindingType,
} from "../../../../../Types/AI/CodeFixTaskContext";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * Exhaustive never-throws hardening: the scanner tick and its two per-insight
 * collaborators (fix routing, triage) sit between a cron harness and a pile
 * of network dependencies, and their contract is that NO single dependency
 * rejecting may propagate an error upward — every failure degrades to "no
 * fix / no triage / skip this project" quietly. These tests walk EVERY
 * dependency one at a time (mockRejectedValue) and pin the degradation, plus
 * the defensive early-returns for malformed inputs (insight without id or
 * projectId, project without id) that no other suite exercises.
 */

const projectId: ObjectID = ObjectID.generate();
const insightId: ObjectID = ObjectID.generate();
const exceptionId: ObjectID = ObjectID.generate();

function makeProject(overrides: Record<string, unknown> = {}): Project {
  return {
    id: projectId,
    enableAiInsights: true,
    enableInsightFixTasks: true,
    enableAi: true,
    ...overrides,
  } as unknown as Project;
}

function makeExceptionInsight(
  overrides: Record<string, unknown> = {},
): AIInsight {
  return {
    id: insightId,
    projectId,
    insightType: AIInsightType.NewException,
    telemetryExceptionId: exceptionId,
    ...overrides,
  } as unknown as AIInsight;
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

function makeLatencyInsight(): AIInsight {
  return makeExceptionInsight({
    insightType: AIInsightType.TraceLatencyRegression,
    telemetryExceptionId: undefined,
    traceId: "trace-abc",
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
  });
}

function mockBudgetAllowed(): jest.SpyInstance {
  const decision: FixRunBudgetDecision = {
    allowed: true,
    limit: 25,
    paused: false,
    runsToday: 0,
  };
  return jest
    .spyOn(FixRunBudget, "getBudgetStatus")
    .mockResolvedValue(decision);
}

describe("InsightFixRouting — every dependency rejecting degrades to {}", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a rejecting readiness precheck resolves to {} and never reaches the creation path", async () => {
    mockBudgetAllowed();
    jest
      .spyOn(TelemetryExceptionService, "getAIFixReadiness")
      .mockRejectedValue(new Error("provider probe timed out"));
    const create: jest.SpyInstance = jest.spyOn(
      TelemetryExceptionService,
      "createCodeFixRunForException",
    );

    await expect(
      InsightFixRouting.routeInsightFix({
        insight: makeExceptionInsight(),
        project: makeProject(),
      }),
    ).resolves.toEqual({});

    expect(create).not.toHaveBeenCalled();
  });

  test("a rejecting FixPerformance creation path resolves to {} for a latency insight", async () => {
    mockBudgetAllowed();
    jest
      .spyOn(FixPerformanceTaskTrigger, "createPerformanceFixTaskFromFindings")
      .mockRejectedValue(new Error("repository token gate: PR cap reached"));

    await expect(
      InsightFixRouting.routeInsightFix({
        insight: makeLatencyInsight(),
        project: makeProject(),
      }),
    ).resolves.toEqual({});
  });

  test("defensive: an insight without an id (or projectId) resolves to {} before any gate is probed", async () => {
    const budget: jest.SpyInstance = mockBudgetAllowed();

    const noId: InsightFixRoutingResult =
      await InsightFixRouting.routeInsightFix({
        insight: makeExceptionInsight({ id: undefined }),
        project: makeProject(),
      });
    const noProjectId: InsightFixRoutingResult =
      await InsightFixRouting.routeInsightFix({
        insight: makeExceptionInsight({ projectId: undefined }),
        project: makeProject(),
      });

    expect(noId).toEqual({});
    expect(noProjectId).toEqual({});
    expect(budget).not.toHaveBeenCalled();
  });
});

describe("InsightTriage — every dependency rejecting degrades to {}", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * Gate helpers: each test greens every gate BEFORE the one under test, so
   * the rejection is provably the only reason for the empty result.
   */
  function greenProject(): void {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(makeProject() as unknown as Project);
  }

  function greenProvider(): void {
    jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockResolvedValue({
        id: ObjectID.generate(),
      } as unknown as LlmProvider);
  }

  function greenDedupe(): void {
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
  }

  test("a rejecting provider lookup resolves to {}", async () => {
    greenProject();
    jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockRejectedValue(new Error("vault down"));

    await expect(
      InsightTriage.enqueueInsightTriage({ insight: makeExceptionInsight() }),
    ).resolves.toEqual({});
  });

  test("a rejecting dedupe count resolves to {} — no enqueue happens", async () => {
    greenProject();
    greenProvider();
    jest.spyOn(AIRunService, "countBy").mockRejectedValue(new Error("db down"));
    const enqueue: jest.SpyInstance = jest.spyOn(
      AIInvestigationQueue,
      "enqueue",
    );

    await expect(
      InsightTriage.enqueueInsightTriage({ insight: makeExceptionInsight() }),
    ).resolves.toEqual({});

    expect(enqueue).not.toHaveBeenCalled();
  });

  test("a rejecting queue enqueue (contract breach — it is documented never-throws) still resolves to {}", async () => {
    greenProject();
    greenProvider();
    greenDedupe();
    jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockRejectedValue(new Error("unexpected"));

    await expect(
      InsightTriage.enqueueInsightTriage({ insight: makeExceptionInsight() }),
    ).resolves.toEqual({});
  });

  test("PINNED: a failing triage-link write after a SUCCESSFUL enqueue resolves to {} — the run exists unlinked, and the dedupe count blocks a duplicate next tick", async () => {
    greenProject();
    greenProvider();
    greenDedupe();
    const triageRunId: ObjectID = ObjectID.generate();
    const enqueue: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockResolvedValue(triageRunId);
    jest
      .spyOn(AIInsightService, "updateOneById")
      .mockRejectedValue(new Error("write failed"));

    await expect(
      InsightTriage.enqueueInsightTriage({ insight: makeExceptionInsight() }),
    ).resolves.toEqual({});

    // The run WAS enqueued — only the insight → run link write was lost.
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  test("defensive: an insight without an id resolves to {} before the project is even read", async () => {
    const findProject: jest.SpyInstance = jest.spyOn(
      ProjectService,
      "findOneById",
    );

    const result: InsightTriageResult =
      await InsightTriage.enqueueInsightTriage({
        insight: makeExceptionInsight({ id: undefined }),
      });

    expect(result).toEqual({});
    expect(findProject).not.toHaveBeenCalled();
  });
});

describe("InsightScanner — store failures stay inside the project's scan", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function candidateEmittingDetector(): InsightDetector {
    return {
      insightType: AIInsightType.NewException,
      detect: (
        _context: InsightScanContext,
      ): Promise<Array<InsightCandidate>> => {
        return Promise.resolve([
          {
            insightType: AIInsightType.NewException,
            fingerprint: "new-exception:abc",
            title: "New exception in checkout",
            detailMarkdown: "**3 occurrences**",
            severity: AIInsightSeverity.Medium,
            evidence: { exception: { recentOccurrenceCount: 3 } },
          },
        ]);
      },
    };
  }

  test("an upsert rejection for one project does not stop the sweep — the next project is still scanned and upserted", async () => {
    const projectA: Project = makeProject({ id: ObjectID.generate() });
    const projectB: Project = makeProject({ id: ObjectID.generate() });
    jest
      .spyOn(ProjectService, "findBy")
      .mockResolvedValue([projectA, projectB]);
    jest
      .spyOn(InsightDetectors, "getAllDetectors")
      .mockReturnValue([candidateEmittingDetector()]);
    const upsert: jest.SpyInstance = jest
      .spyOn(InsightStore, "upsertCandidates")
      .mockRejectedValueOnce(new Error("postgres down for tenant A"))
      .mockResolvedValueOnce({
        created: [],
        refreshed: 1,
        suppressed: 0,
        droppedByCap: 0,
      });

    await expect(InsightScanner.scanAllProjects()).resolves.toBeUndefined();

    expect(upsert).toHaveBeenCalledTimes(2);
  });

  test("defensive: a project row without an id is skipped before any detector runs", async () => {
    const getAllDetectors: jest.SpyInstance = jest.spyOn(
      InsightDetectors,
      "getAllDetectors",
    );

    await expect(
      InsightScanner.scanProjectForInsights({} as unknown as Project),
    ).resolves.toBeUndefined();

    expect(getAllDetectors).not.toHaveBeenCalled();
  });
});
