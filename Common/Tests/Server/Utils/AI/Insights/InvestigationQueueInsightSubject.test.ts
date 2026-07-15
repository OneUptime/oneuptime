import AIInvestigationQueue, {
  INSIGHT_TRIAGE_RESERVED_SLOTS,
} from "../../../../../Server/Utils/AI/SRE/InvestigationQueue";
import InsightTriageRunner from "../../../../../Server/Utils/AI/SRE/Insights/InsightTriageRunner";
import AIIncidentInvestigationRunner from "../../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import AIRunService from "../../../../../Server/Services/AIRunService";
import AIService from "../../../../../Server/Services/AIService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import Project from "../../../../../Models/DatabaseModels/Project";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * The investigation queue's AI-insight subject support. The
 * invariants these tests lock in:
 *   (a) enqueue stamps subjectAIInsightId onto the run as
 *       triggeredByAiInsightId (provenance + the dispatch key) and
 *       returns the created run's id so the caller can link the insight;
 *   (b) the budget quiet-skip returns null and creates nothing — the
 *       existing enqueue-time gate applies to triage runs too;
 *   (c) dispatch recognizes insight runs as subject-BEARING and routes
 *       them to InsightTriageRunner.executeTriage with the claimed attempt;
 *   (d) a run with no subject at all is still failed at dispatch;
 *   (e) LANE PRIORITY: triage (the preventive lane) may hold at most
 *       (cap - INSIGHT_TRIAGE_RESERVED_SLOTS) of the project's concurrency
 *       slots, so a scan's triage backlog can never starve the interactive
 *       lane (incident/alert RCA, where a human is waiting) — while the
 *       interactive lane's own gating is left byte-for-byte unchanged.
 */

function mockBudget(exhausted: boolean): void {
  jest.spyOn(AIService, "getAutonomousDailyBudgetStatus").mockResolvedValue({
    exhausted,
    limitInTokens: exhausted ? 1000 : null,
    usedTokensToday: exhausted ? 1000 : 0,
  });
}

describe("AIInvestigationQueue — insight subject", () => {
  beforeEach(() => {
    // No per-project cap override; no investigations currently running.
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as Project);
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("enqueue stamps triggeredByAiInsightId and returns the created run id", async () => {
    mockBudget(false);
    const insightId: ObjectID = ObjectID.generate();
    const createdId: ObjectID = ObjectID.generate();

    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue({ id: createdId } as unknown as AIRun);
    jest.spyOn(AIInvestigationQueue, "processRun").mockResolvedValue(undefined);

    const returnedId: ObjectID | null = await AIInvestigationQueue.enqueue({
      projectId: ObjectID.generate(),
      subjectAIInsightId: insightId,
    });

    expect(returnedId).toEqual(createdId);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: AIRunStatus.Queued,
          triggeredByAiInsightId: insightId,
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
  });

  test("the budget quiet-skip returns null and creates no run", async () => {
    mockBudget(true);
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    const returnedId: ObjectID | null = await AIInvestigationQueue.enqueue({
      projectId: ObjectID.generate(),
      subjectAIInsightId: ObjectID.generate(),
    });

    expect(returnedId).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  test("a won claim on an insight run dispatches to the triage runner with the claimed attempt", async () => {
    mockBudget(false);
    const runId: ObjectID = ObjectID.generate();
    const projectId: ObjectID = ObjectID.generate();
    const insightId: ObjectID = ObjectID.generate();

    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
    const executeTriage: jest.SpyInstance = jest
      .spyOn(InsightTriageRunner, "executeTriage")
      .mockResolvedValue(undefined);

    await AIInvestigationQueue.processRun({
      id: runId,
      projectId,
      attemptCount: 0,
      triggeredByAiInsightId: insightId,
    });

    expect(executeTriage).toHaveBeenCalledWith(
      expect.objectContaining({
        aiRunId: runId,
        projectId,
        sentinelInsightId: insightId,
        attemptCount: 1,
      }),
    );
  });

  test("a run with no subject at all is still failed at dispatch", async () => {
    mockBudget(false);
    const runId: ObjectID = ObjectID.generate();
    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);
    const executeTriage: jest.SpyInstance = jest.spyOn(
      InsightTriageRunner,
      "executeTriage",
    );

    await AIInvestigationQueue.processRun({
      id: runId,
      projectId: ObjectID.generate(),
      attemptCount: 0,
    });

    expect(executeTriage).not.toHaveBeenCalled();
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        aiRunId: runId,
        fromStatus: AIRunStatus.Running,
        set: expect.objectContaining({
          status: AIRunStatus.Error,
        }),
      }),
    );
  });
});

/*
 * The starvation scenario this locks down: a scan files 10 insights, so 10
 * triage runs queue. Without the lane sub-cap they would fill every slot of
 * the default cap of 3 and the incident that fires a minute later would wait
 * behind them. With it, triage tops out at (cap - 1) and the incident's
 * inline kick at enqueue always finds the reserved slot free.
 */
describe("AIInvestigationQueue — lane priority (triage never starves RCA)", () => {
  const projectId: ObjectID = ObjectID.generate();

  // Per-project concurrency cap. The default is 3; make it explicit here.
  function mockCap(cap: number): void {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      aiMaxConcurrentInvestigations: cap,
    } as unknown as Project);
  }

  /*
   * The claim gates count Running investigations twice: once globally, and
   * once filtered to the triage lane (the query carrying
   * triggeredByAiInsightId). Answer each query independently so the
   * two caps can be driven apart.
   */
  function mockRunningCounts(counts: {
    total: number;
    triage: number;
  }): jest.SpyInstance {
    return jest
      .spyOn(AIRunService, "countBy")
      .mockImplementation((data: unknown): Promise<PositiveNumber> => {
        const query: Record<string, unknown> =
          ((data as { query?: Record<string, unknown> }).query as Record<
            string,
            unknown
          >) || {};

        const isTriageLaneQuery: boolean =
          query["triggeredByAiInsightId"] !== undefined;

        return Promise.resolve(
          new PositiveNumber(isTriageLaneQuery ? counts.triage : counts.total),
        );
      });
  }

  beforeEach(() => {
    mockBudget(false);
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the reserved slot is real: with the triage lane full (2 of cap 3), an incident investigation still claims and dispatches", async () => {
    mockCap(3);
    // Both running investigations are triage runs — the lane's sub-cap.
    mockRunningCounts({ total: 2, triage: 2 });
    const claim: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "attemptStatusTransition",
    );
    const executeInvestigation: jest.SpyInstance = jest
      .spyOn(AIIncidentInvestigationRunner, "executeInvestigation")
      .mockResolvedValue(undefined);

    const incidentId: ObjectID = ObjectID.generate();

    await AIInvestigationQueue.processRun({
      id: ObjectID.generate(),
      projectId,
      attemptCount: 0,
      triggeredByIncidentId: incidentId,
    });

    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({ fromStatus: AIRunStatus.Queued }),
    );
    expect(executeInvestigation).toHaveBeenCalledWith(
      expect.objectContaining({ incidentId, attemptCount: 1 }),
    );
  });

  test("a triage run at the lane sub-cap is left Queued — the claim is never even attempted", async () => {
    mockCap(3);
    // 2 triage running = cap(3) - RESERVED(1): the lane is full.
    mockRunningCounts({ total: 2, triage: 3 - INSIGHT_TRIAGE_RESERVED_SLOTS });
    const claim: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "attemptStatusTransition",
    );
    const executeTriage: jest.SpyInstance = jest.spyOn(
      InsightTriageRunner,
      "executeTriage",
    );

    await AIInvestigationQueue.processRun({
      id: ObjectID.generate(),
      projectId,
      attemptCount: 0,
      triggeredByAiInsightId: ObjectID.generate(),
    });

    // Left Queued for the poller/TTL — never claimed, never executed.
    expect(claim).not.toHaveBeenCalled();
    expect(executeTriage).not.toHaveBeenCalled();
  });

  test("triage still runs while under the lane sub-cap — the sub-cap throttles, it does not disable", async () => {
    mockCap(3);
    mockRunningCounts({ total: 1, triage: 1 });
    const executeTriage: jest.SpyInstance = jest
      .spyOn(InsightTriageRunner, "executeTriage")
      .mockResolvedValue(undefined);

    await AIInvestigationQueue.processRun({
      id: ObjectID.generate(),
      projectId,
      attemptCount: 0,
      triggeredByAiInsightId: ObjectID.generate(),
    });

    expect(executeTriage).toHaveBeenCalledWith(
      expect.objectContaining({ attemptCount: 1 }),
    );
  });

  test("a project pinned to the minimum cap of 1 still triages — the lane floor is 1, not 0 (no deadlock)", async () => {
    mockCap(1);
    mockRunningCounts({ total: 0, triage: 0 });
    const executeTriage: jest.SpyInstance = jest
      .spyOn(InsightTriageRunner, "executeTriage")
      .mockResolvedValue(undefined);

    await AIInvestigationQueue.processRun({
      id: ObjectID.generate(),
      projectId,
      attemptCount: 0,
      triggeredByAiInsightId: ObjectID.generate(),
    });

    expect(executeTriage).toHaveBeenCalled();
  });

  test("interactive gating is unchanged when no insight runs exist: one global count query, no lane query, and the run claims", async () => {
    mockCap(3);
    const countBy: jest.SpyInstance = mockRunningCounts({
      total: 0,
      triage: 0,
    });
    const executeInvestigation: jest.SpyInstance = jest
      .spyOn(AIIncidentInvestigationRunner, "executeInvestigation")
      .mockResolvedValue(undefined);

    await AIInvestigationQueue.processRun({
      id: ObjectID.generate(),
      projectId,
      attemptCount: 0,
      triggeredByIncidentId: ObjectID.generate(),
    });

    expect(executeInvestigation).toHaveBeenCalled();
    // The lane sub-cap query is only paid for by the lane it caps.
    expect(countBy).toHaveBeenCalledTimes(1);
    expect(countBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.not.objectContaining({
          triggeredByAiInsightId: expect.anything(),
        }),
      }),
    );
  });
});
