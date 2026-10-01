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
import AIRunCodeFixRecommendation from "../../../../../Types/AI/AIRunCodeFixRecommendation";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../../Types/AI/AIRunType";
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
 *   (e) LANE PRIORITY: triage is subjectless, has no setting and so no
 *       cap — it never waits on anything but the budget. Inside a lane a
 *       project HAS capped, background work (remediation plans and
 *       executions) may hold at most (cap - INSIGHT_TRIAGE_RESERVED_SLOTS)
 *       of the slots, so it can never starve the interactive lane
 *       (incident/alert RCA, where a human is waiting).
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
          codeFixRecommendation: AIRunCodeFixRecommendation.NotRecommended,
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
 * The starvation scenario this locks down. With no caps (the default),
 * nothing waits on anything: a scan's ten triage runs and the incident that
 * fires a minute later all start at once. When a project caps a lane, the
 * background work in it tops out at (cap - 1), so the incident's inline kick
 * at enqueue always finds the reserved slot free.
 */
describe("AIInvestigationQueue — lane priority (triage never starves RCA)", () => {
  const projectId: ObjectID = ObjectID.generate();

  // The cap a project set on its incident lane, for the capped-lane tests.
  const INCIDENT_CAP: number = 3;

  /*
   * The claim gates count Running investigations in the lane, then the
   * background kinds within it: the triage-lane query carries
   * triggeredByAiInsightId, the remediation one filters runType to the plan
   * kinds. Answer each query independently so the caps can be driven apart.
   */
  function mockRunningCounts(counts: {
    total: number;
    triage: number;
    /*
     * Running remediation runs (RemediationPlan + RemediationExecution) —
     * the other background-lane kind.
     */
    plans?: number;
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

        /*
         * Both the lane and the remediation counts filter runType with
         * QueryHelper.any(...), so they are told apart by what is IN the
         * list: only the lane one counts Investigations.
         */
        const runTypeFilter: string = JSON.stringify(query["runType"] ?? null);

        const isPlanLaneQuery: boolean =
          runTypeFilter.includes(AIRunType.RemediationPlan) &&
          !runTypeFilter.includes(AIRunType.Investigation);

        if (isTriageLaneQuery) {
          return Promise.resolve(new PositiveNumber(counts.triage));
        }

        if (isPlanLaneQuery) {
          return Promise.resolve(new PositiveNumber(counts.plans || 0));
        }

        return Promise.resolve(new PositiveNumber(counts.total));
      });
  }

  function capIncidentLane(cap: number | undefined): void {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      incidentAiMaxConcurrentInvestigations: cap,
    } as unknown as Project);
  }

  beforeEach(() => {
    mockBudget(false);
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
    // No lane overrides: no lane has a cap.
    capIncidentLane(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * Triage used to run under a fixed cap of 3 with one slot held back, so a
   * scan's backlog drained two at a time. It has no setting, so no cap.
   */
  test("triage has no cap: a triage run claims however many triage runs are running, without counting them", async () => {
    const countBy: jest.SpyInstance = mockRunningCounts({
      total: 40,
      triage: 40,
    });
    const executeTriage: jest.SpyInstance = jest
      .spyOn(InsightTriageRunner, "executeTriage")
      .mockResolvedValue(undefined);

    await AIInvestigationQueue.processRun({
      id: ObjectID.generate(),
      projectId,
      attemptCount: 0,
      triggeredByAiInsightId: ObjectID.generate(),
    });

    expect(countBy).not.toHaveBeenCalled();
    expect(executeTriage).toHaveBeenCalledWith(
      expect.objectContaining({ attemptCount: 1 }),
    );
  });

  test("with no caps, an incident investigation claims straight away whatever background work is running", async () => {
    const countBy: jest.SpyInstance = mockRunningCounts({
      total: 10,
      triage: 5,
      plans: 5,
    });
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

    expect(countBy).not.toHaveBeenCalled();
    expect(executeInvestigation).toHaveBeenCalledWith(
      expect.objectContaining({ incidentId, attemptCount: 1 }),
    );
  });

  test("the reserved slot is real: in a capped lane with its background share full, an incident investigation still claims and dispatches", async () => {
    capIncidentLane(INCIDENT_CAP);
    // Both running runs are remediation work — the background share of 3.
    mockRunningCounts({ total: 2, triage: 0, plans: 2 });
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

  test("in a capped lane, background work at cap - reserved leaves a remediation plan Queued", async () => {
    capIncidentLane(INCIDENT_CAP);
    // 2 plans running = cap(3) - RESERVED(1): the background share is full.
    mockRunningCounts({
      total: 2,
      triage: 0,
      plans: INCIDENT_CAP - INSIGHT_TRIAGE_RESERVED_SLOTS,
    });
    const claim: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "attemptStatusTransition",
    );

    await AIInvestigationQueue.processRun({
      id: ObjectID.generate(),
      projectId,
      attemptCount: 0,
      runType: AIRunType.RemediationPlan,
      triggeredByIncidentId: ObjectID.generate(),
      triggeredByAutoRemediationSuggestionId: ObjectID.generate(),
    });

    // Left Queued — the reserved RCA slot stays reachable.
    expect(claim).not.toHaveBeenCalled();
  });

  test("in a capped lane, background work still runs while under its share — the sub-cap throttles, it does not disable", async () => {
    capIncidentLane(INCIDENT_CAP);
    mockRunningCounts({ total: 1, triage: 0, plans: 1 });
    const claim: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "attemptStatusTransition",
    );

    await AIInvestigationQueue.processRun({
      id: ObjectID.generate(),
      projectId,
      attemptCount: 0,
      runType: AIRunType.RemediationPlan,
      triggeredByIncidentId: ObjectID.generate(),
      triggeredByAutoRemediationSuggestionId: ObjectID.generate(),
    });

    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({ fromStatus: AIRunStatus.Queued }),
    );
  });

  test("interactive gating in a capped lane: one lane count query, no background query, and the run claims", async () => {
    capIncidentLane(INCIDENT_CAP);
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
    // The background sub-cap queries are only paid for by background work.
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
