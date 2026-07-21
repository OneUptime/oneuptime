import InsightScanner from "../../../../../Server/Utils/AI/SRE/Insights/InsightScanner";
import InsightStore, {
  UpsertCandidatesResult,
} from "../../../../../Server/Utils/AI/SRE/Insights/InsightStore";
import InsightDetectors from "../../../../../Server/Utils/AI/SRE/Insights/Detectors/Index";
import InsightFixRouting from "../../../../../Server/Utils/AI/SRE/Insights/FixRouting";
import InsightTriage from "../../../../../Server/Utils/AI/SRE/Insights/Triage";
import {
  InsightCandidate,
  InsightDetector,
  InsightScanContext,
} from "../../../../../Server/Utils/AI/SRE/Insights/Types";
import FixRunBudget, {
  FixRunBudgetDecision,
} from "../../../../../Server/Utils/AI/CodeFix/FixRunBudget";
import ProjectService from "../../../../../Server/Services/ProjectService";
import AIInsightService from "../../../../../Server/Services/AIInsightService";
import TelemetryExceptionService from "../../../../../Server/Services/TelemetryExceptionService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import Project from "../../../../../Models/DatabaseModels/Project";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import AIInsightStatus from "../../../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import AIInsightSeverity from "../../../../../Types/AI/AIInsightSeverity";
import LIMIT_MAX from "../../../../../Types/Database/LimitMax";
import ObjectID from "../../../../../Types/ObjectID";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * The scanner is the watch loop's orchestration and must uphold the quiet,
 * opt-in posture: only projects with enableAiInsights=true are ever
 * scanned (the flag query IS the gate), every layer fails in isolation (one
 * broken project, detector or insight never stops the rest), only NEWLY
 * created insights are routed — refreshed rows keep their status — and a
 * new insight always leaves the defensive Detected state in the same tick:
 * ActionRequired, with its triage enqueued. TRIAGE GATES THE FIX: the
 * scanner NEVER calls fix routing — the automatic fix decision moved to
 * the triage runner, which routes a fix only on a code-fault verdict.
 *
 * Plus the self-heal sweep: a row an earlier tick created but never routed
 * (pod death, failed status write) is stranded in Detected forever — the
 * refresh path never re-routes it, and its fingerprint stays pinned. The
 * sweep re-routes it on the next tick, runs BEFORE the detectors (so this
 * tick's own rows cannot be routed twice), never breaks the scan when it
 * fails, and cannot double-create work (the triage dedupe holds).
 */

const projectId: ObjectID = ObjectID.generate();

function fakeProject(overrides?: { id?: ObjectID }): Project {
  return {
    id: overrides?.id ?? projectId,
    enableAiInsights: true,
    enableInsightFixTasks: false,
    enableAi: true,
  } as unknown as Project;
}

function makeCandidate(
  overrides?: Partial<InsightCandidate>,
): InsightCandidate {
  return {
    insightType: AIInsightType.NewException,
    fingerprint: "new-exception:abc",
    title: "New exception in checkout",
    detailMarkdown: "**3 occurrences** in the last 24 hours.",
    severity: AIInsightSeverity.Medium,
    evidence: { exception: { recentOccurrenceCount: 3 } },
    ...overrides,
  };
}

function fakeInsight(): AIInsight {
  return {
    id: ObjectID.generate(),
    projectId,
    status: AIInsightStatus.Detected,
  } as unknown as AIInsight;
}

function fakeDetector(data: {
  insightType?: AIInsightType;
  candidates?: Array<InsightCandidate>;
  error?: Error;
}): InsightDetector {
  return {
    insightType: data.insightType ?? AIInsightType.NewException,
    detect: (
      _context: InsightScanContext,
    ): Promise<Array<InsightCandidate>> => {
      if (data.error) {
        return Promise.reject(data.error);
      }
      return Promise.resolve(data.candidates || []);
    },
  };
}

function emptyUpsertResult(
  overrides?: Partial<UpsertCandidatesResult>,
): UpsertCandidatesResult {
  return {
    created: [],
    refreshed: 0,
    suppressed: 0,
    droppedByCap: 0,
    ...overrides,
  };
}

describe("InsightScanner.scanAllProjects — flag gating and isolation", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("queries ONLY opted-in projects (enableAiInsights: true) as root and scans each", async () => {
    const projectA: Project = fakeProject({ id: ObjectID.generate() });
    const projectB: Project = fakeProject({ id: ObjectID.generate() });
    const findBy: jest.SpyInstance = jest
      .spyOn(ProjectService, "findBy")
      .mockResolvedValue([projectA, projectB]);
    const scanProject: jest.SpyInstance = jest
      .spyOn(InsightScanner, "scanProjectForInsights")
      .mockResolvedValue(undefined);

    await InsightScanner.scanAllProjects();

    expect(findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ enableAiInsights: true }),
        select: expect.objectContaining({
          _id: true,
          enableInsightFixTasks: true,
          enableAi: true,
        }),
        limit: LIMIT_MAX,
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
    expect(scanProject).toHaveBeenCalledTimes(2);
    expect(scanProject).toHaveBeenCalledWith(projectA);
    expect(scanProject).toHaveBeenCalledWith(projectB);
  });

  test("no opted-in projects → no scans", async () => {
    jest.spyOn(ProjectService, "findBy").mockResolvedValue([]);
    const scanProject: jest.SpyInstance = jest
      .spyOn(InsightScanner, "scanProjectForInsights")
      .mockResolvedValue(undefined);

    await InsightScanner.scanAllProjects();

    expect(scanProject).not.toHaveBeenCalled();
  });

  test("one project's scan failure does not stop the sweep — the rest still scan", async () => {
    const projectA: Project = fakeProject({ id: ObjectID.generate() });
    const projectB: Project = fakeProject({ id: ObjectID.generate() });
    jest
      .spyOn(ProjectService, "findBy")
      .mockResolvedValue([projectA, projectB]);
    const scanProject: jest.SpyInstance = jest
      .spyOn(InsightScanner, "scanProjectForInsights")
      .mockRejectedValueOnce(new Error("clickhouse down for tenant A"))
      .mockResolvedValueOnce(undefined);

    await expect(InsightScanner.scanAllProjects()).resolves.toBeUndefined();

    expect(scanProject).toHaveBeenCalledTimes(2);
    expect(scanProject).toHaveBeenCalledWith(projectB);
  });

  test("never throws into the cron caller — even the project listing failing resolves quietly", async () => {
    jest
      .spyOn(ProjectService, "findBy")
      .mockRejectedValue(new Error("db down"));
    const scanProject: jest.SpyInstance = jest
      .spyOn(InsightScanner, "scanProjectForInsights")
      .mockResolvedValue(undefined);

    await expect(InsightScanner.scanAllProjects()).resolves.toBeUndefined();

    expect(scanProject).not.toHaveBeenCalled();
  });
});

describe("InsightScanner.scanProjectForInsights — detectors and the store", () => {
  beforeEach(() => {
    // Nothing stranded: the self-heal sweep is a no-op for these tests.
    jest.spyOn(AIInsightService, "findBy").mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("one throwing detector does not prevent the others — the survivors' candidates still reach the store", async () => {
    const survivorCandidate: InsightCandidate = makeCandidate({
      insightType: AIInsightType.ErrorLogSpike,
      fingerprint: "error-log-spike:svc",
    });
    jest.spyOn(InsightDetectors, "getAllDetectors").mockReturnValue([
      fakeDetector({
        insightType: AIInsightType.NewException,
        error: new Error("query timeout"),
      }),
      fakeDetector({
        insightType: AIInsightType.ErrorLogSpike,
        candidates: [survivorCandidate],
      }),
    ]);
    const upsert: jest.SpyInstance = jest
      .spyOn(InsightStore, "upsertCandidates")
      .mockResolvedValue(emptyUpsertResult());

    await expect(
      InsightScanner.scanProjectForInsights(fakeProject()),
    ).resolves.toBeUndefined();

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        candidates: [survivorCandidate],
        now: expect.any(Date),
      }),
    );
  });

  test("every detector gets the projectId and the tick's single clock", async () => {
    const seenContexts: Array<InsightScanContext> = [];

    function recordingDetector(insightType: AIInsightType): InsightDetector {
      return {
        insightType,
        detect: (
          context: InsightScanContext,
        ): Promise<Array<InsightCandidate>> => {
          seenContexts.push(context);
          return Promise.resolve([]);
        },
      };
    }

    jest
      .spyOn(InsightDetectors, "getAllDetectors")
      .mockReturnValue([
        recordingDetector(AIInsightType.NewException),
        recordingDetector(AIInsightType.MetricDrift),
      ]);
    jest
      .spyOn(InsightStore, "upsertCandidates")
      .mockResolvedValue(emptyUpsertResult());

    await InsightScanner.scanProjectForInsights(fakeProject());

    expect(seenContexts).toHaveLength(2);
    expect(seenContexts[0]?.projectId).toBe(projectId);
    expect(seenContexts[0]?.now).toBeInstanceOf(Date);
    // Same clock for every detector — windows must line up across sensors.
    expect(seenContexts[1]?.now).toBe(seenContexts[0]?.now);
  });

  test("no candidates → the store is never touched", async () => {
    jest
      .spyOn(InsightDetectors, "getAllDetectors")
      .mockReturnValue([fakeDetector({ candidates: [] })]);
    const upsert: jest.SpyInstance = jest.spyOn(
      InsightStore,
      "upsertCandidates",
    );

    await InsightScanner.scanProjectForInsights(fakeProject());

    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("InsightScanner — routing newly created insights", () => {
  let updateOneById: jest.SpyInstance;
  let routeInsightFix: jest.SpyInstance;
  let enqueueInsightTriage: jest.SpyInstance;

  beforeEach(() => {
    jest
      .spyOn(InsightDetectors, "getAllDetectors")
      .mockReturnValue([fakeDetector({ candidates: [makeCandidate()] })]);
    // Nothing stranded: the self-heal sweep is a no-op for these tests.
    jest.spyOn(AIInsightService, "findBy").mockResolvedValue([]);
    updateOneById = jest
      .spyOn(AIInsightService, "updateOneById")
      .mockResolvedValue(undefined);
    routeInsightFix = jest
      .spyOn(InsightFixRouting, "routeInsightFix")
      .mockResolvedValue({});
    enqueueInsightTriage = jest
      .spyOn(InsightTriage, "enqueueInsightTriage")
      .mockResolvedValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a new insight lands on ActionRequired — the scanner NEVER calls fix routing (triage gates the fix)", async () => {
    const insight: AIInsight = fakeInsight();
    jest
      .spyOn(InsightStore, "upsertCandidates")
      .mockResolvedValue(emptyUpsertResult({ created: [insight] }));

    await InsightScanner.scanProjectForInsights(fakeProject());

    expect(routeInsightFix).not.toHaveBeenCalled();
    expect(updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: insight.id,
        data: expect.objectContaining({
          status: AIInsightStatus.ActionRequired,
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
    expect(enqueueInsightTriage).toHaveBeenCalledWith({ insight });
  });

  test("triage run enqueued → triageAiRunId persisted", async () => {
    const insight: AIInsight = fakeInsight();
    const triageAiRunId: ObjectID = ObjectID.generate();
    jest
      .spyOn(InsightStore, "upsertCandidates")
      .mockResolvedValue(emptyUpsertResult({ created: [insight] }));
    enqueueInsightTriage.mockResolvedValue({ triageAiRunId });

    await InsightScanner.scanProjectForInsights(fakeProject());

    expect(enqueueInsightTriage).toHaveBeenCalledWith({ insight });
    expect(updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: insight.id,
        data: expect.objectContaining({ triageAiRunId }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
  });

  test("no triage run enqueued (quiet skip) → no triageAiRunId write", async () => {
    const insight: AIInsight = fakeInsight();
    jest
      .spyOn(InsightStore, "upsertCandidates")
      .mockResolvedValue(emptyUpsertResult({ created: [insight] }));

    await InsightScanner.scanProjectForInsights(fakeProject());

    // Exactly one write: the ActionRequired status routing.
    expect(updateOneById).toHaveBeenCalledTimes(1);
  });

  test("triage runs for fix and non-fix insights alike — it enriches both", async () => {
    const fixable: AIInsight = fakeInsight();
    const nonFixable: AIInsight = fakeInsight();
    jest
      .spyOn(InsightStore, "upsertCandidates")
      .mockResolvedValue(emptyUpsertResult({ created: [fixable, nonFixable] }));
    routeInsightFix
      .mockResolvedValueOnce({ fixAiRunId: ObjectID.generate() })
      .mockResolvedValueOnce({});

    await InsightScanner.scanProjectForInsights(fakeProject());

    expect(enqueueInsightTriage).toHaveBeenCalledTimes(2);
    expect(enqueueInsightTriage).toHaveBeenCalledWith({ insight: fixable });
    expect(enqueueInsightTriage).toHaveBeenCalledWith({ insight: nonFixable });
  });

  test("refresh-only upsert result routes NOTHING: no fix, no triage, no status writes, no creates", async () => {
    jest
      .spyOn(InsightStore, "upsertCandidates")
      .mockResolvedValue(emptyUpsertResult({ refreshed: 3 }));
    const create: jest.SpyInstance = jest.spyOn(AIInsightService, "create");

    await InsightScanner.scanProjectForInsights(fakeProject());

    expect(routeInsightFix).not.toHaveBeenCalled();
    expect(enqueueInsightTriage).not.toHaveBeenCalled();
    expect(updateOneById).not.toHaveBeenCalled();
    // The scanner itself never creates rows — only the store does.
    expect(create).not.toHaveBeenCalled();
  });

  test("triage rejecting (contract breach) does not fail the scan — the status was already routed", async () => {
    const insight: AIInsight = fakeInsight();
    jest
      .spyOn(InsightStore, "upsertCandidates")
      .mockResolvedValue(emptyUpsertResult({ created: [insight] }));
    enqueueInsightTriage.mockRejectedValue(new Error("queue down"));

    await expect(
      InsightScanner.scanProjectForInsights(fakeProject()),
    ).resolves.toBeUndefined();

    expect(updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: AIInsightStatus.ActionRequired,
        }),
      }),
    );
  });

  test("per-insight isolation: a failing status write on the first insight does not stop routing the second", async () => {
    const first: AIInsight = fakeInsight();
    const second: AIInsight = fakeInsight();
    jest
      .spyOn(InsightStore, "upsertCandidates")
      .mockResolvedValue(emptyUpsertResult({ created: [first, second] }));
    updateOneById
      .mockRejectedValueOnce(new Error("write conflict"))
      .mockResolvedValue(undefined);

    await expect(
      InsightScanner.scanProjectForInsights(fakeProject()),
    ).resolves.toBeUndefined();

    expect(enqueueInsightTriage).toHaveBeenCalledWith({ insight: second });
    expect(updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: second.id,
        data: expect.objectContaining({
          status: AIInsightStatus.ActionRequired,
        }),
      }),
    );
  });
});

describe("InsightScanner — the self-heal sweep for insights stranded in Detected", () => {
  let findBy: jest.SpyInstance;
  let updateOneById: jest.SpyInstance;
  let routeInsightFix: jest.SpyInstance;
  let enqueueInsightTriage: jest.SpyInstance;

  beforeEach(() => {
    // No candidates this tick: only the sweep is under test.
    jest
      .spyOn(InsightDetectors, "getAllDetectors")
      .mockReturnValue([fakeDetector({ candidates: [] })]);
    findBy = jest
      .spyOn(AIInsightService, "findBy")
      .mockResolvedValue([] as unknown as Array<AIInsight>);
    updateOneById = jest
      .spyOn(AIInsightService, "updateOneById")
      .mockResolvedValue(undefined);
    routeInsightFix = jest
      .spyOn(InsightFixRouting, "routeInsightFix")
      .mockResolvedValue({});
    enqueueInsightTriage = jest
      .spyOn(InsightTriage, "enqueueInsightTriage")
      .mockResolvedValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a Detected row left over from an earlier tick is swept up and re-routed to ActionRequired (and triaged)", async () => {
    const stranded: AIInsight = fakeInsight();
    findBy.mockResolvedValue([stranded]);

    await InsightScanner.scanProjectForInsights(fakeProject());

    // Scoped to this project's unrouted rows only, as root.
    expect(findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          projectId,
          status: AIInsightStatus.Detected,
        }),
        limit: LIMIT_MAX,
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
    // Fix routing is NOT part of scan-time routing — triage gates the fix.
    expect(routeInsightFix).not.toHaveBeenCalled();
    expect(updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: stranded.id,
        data: expect.objectContaining({
          status: AIInsightStatus.ActionRequired,
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
    expect(enqueueInsightTriage).toHaveBeenCalledWith({ insight: stranded });
  });

  test("the sweep runs BEFORE the detectors — so rows created by THIS tick are routed exactly once, never twice", async () => {
    const callOrder: Array<string> = [];
    const created: AIInsight = fakeInsight();

    findBy.mockImplementation((): Promise<Array<AIInsight>> => {
      callOrder.push("sweep");
      // Nothing stranded: the row below does not exist yet at sweep time.
      return Promise.resolve([]);
    });
    jest.spyOn(InsightDetectors, "getAllDetectors").mockReturnValue([
      {
        insightType: AIInsightType.NewException,
        detect: (): Promise<Array<InsightCandidate>> => {
          callOrder.push("detect");
          return Promise.resolve([makeCandidate()]);
        },
      },
    ]);
    jest
      .spyOn(InsightStore, "upsertCandidates")
      .mockResolvedValue(emptyUpsertResult({ created: [created] }));

    await InsightScanner.scanProjectForInsights(fakeProject());

    expect(callOrder).toEqual(["sweep", "detect"]);
    expect(enqueueInsightTriage).toHaveBeenCalledTimes(1);
    expect(enqueueInsightTriage).toHaveBeenCalledWith({ insight: created });
  });

  test("a sweep failure never breaks the scan — detectors still run and this tick's new insights still route", async () => {
    const created: AIInsight = fakeInsight();
    findBy.mockRejectedValue(new Error("db down"));
    jest
      .spyOn(InsightDetectors, "getAllDetectors")
      .mockReturnValue([fakeDetector({ candidates: [makeCandidate()] })]);
    const upsert: jest.SpyInstance = jest
      .spyOn(InsightStore, "upsertCandidates")
      .mockResolvedValue(emptyUpsertResult({ created: [created] }));

    await expect(
      InsightScanner.scanProjectForInsights(fakeProject()),
    ).resolves.toBeUndefined();

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(enqueueInsightTriage).toHaveBeenCalledWith({ insight: created });
  });

  test("one stranded row failing to re-route does not stop the next one", async () => {
    const first: AIInsight = fakeInsight();
    const second: AIInsight = fakeInsight();
    findBy.mockResolvedValue([first, second]);
    updateOneById
      .mockRejectedValueOnce(new Error("write conflict"))
      .mockResolvedValue(undefined);

    await expect(
      InsightScanner.scanProjectForInsights(fakeProject()),
    ).resolves.toBeUndefined();

    expect(enqueueInsightTriage).toHaveBeenCalledWith({ insight: second });
  });
});

/*
 * The safety proof for the post-triage fix path: routing a fix for an
 * insight whose exception ALREADY has a run (the pod died after the run was
 * created but before the insight status write; or triage re-ran) cannot
 * create a second one. The dedupe lives inside the creation path itself —
 * this exercises the REAL InsightFixRouting against it, exactly as the
 * triage runner invokes it on a code-fault verdict.
 */
describe("InsightFixRouting — a dedupe rejection from the creation path is a quiet no-fix", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the creation path's per-(exception, recipe) dedupe rejection yields an empty result and stamps nothing", async () => {
    const insight: AIInsight = {
      id: ObjectID.generate(),
      projectId,
      insightType: AIInsightType.NewException,
      telemetryExceptionId: ObjectID.generate(),
      status: AIInsightStatus.ActionRequired,
    } as unknown as AIInsight;

    const optedInProject: Project = {
      id: projectId,
      enableAiInsights: true,
      // Fix tasks ON and AI ON: every gate ahead of the dedupe is open.
      enableInsightFixTasks: true,
      enableAi: true,
    } as unknown as Project;

    const budget: FixRunBudgetDecision = {
      allowed: true,
      limit: 25,
      paused: false,
      runsToday: 0,
    };

    jest.spyOn(FixRunBudget, "getBudgetStatus").mockResolvedValue(budget);
    jest
      .spyOn(TelemetryExceptionService, "getAIFixReadiness")
      .mockResolvedValue({ ready: true, checks: [] });

    /*
     * The dedupe: a fix run for this exception is still non-terminal, so
     * the creation path refuses a second one.
     */
    const create: jest.SpyInstance = jest
      .spyOn(TelemetryExceptionService, "createCodeFixRunForException")
      .mockRejectedValue(
        new Error(
          "An AI agent task is already in progress for this exception.",
        ),
      );
    const stamp: jest.SpyInstance = jest.spyOn(AIRunService, "updateOneById");

    const result: { fixAiRunId?: ObjectID | undefined } =
      await InsightFixRouting.routeInsightFix({
        insight,
        project: optedInProject,
      });

    // The creation path was asked exactly once — and it refused, quietly.
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.fixAiRunId).toBeUndefined();
    // No second run exists, so nothing was stamped.
    expect(stamp).not.toHaveBeenCalled();
  });
});
