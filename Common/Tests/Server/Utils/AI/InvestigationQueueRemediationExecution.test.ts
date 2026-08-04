import AIInvestigationQueue from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import RemediationExecutionRunner from "../../../../Server/Utils/AI/Remediation/RemediationExecutionRunner";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIService from "../../../../Server/Services/AIService";
import ProjectService from "../../../../Server/Services/ProjectService";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Project from "../../../../Models/DatabaseModels/Project";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Contract under test — how the durable investigation queue carries
 * RemediationExecution runs (AI-composed commands, Phase 3):
 *
 * - enqueue with a suggestion subject records the run as the requested
 *   remediationRunType (RemediationExecution), and still defaults to
 *   RemediationPlan when no remediationRunType is given (back-compat with
 *   aiSelectsRunbook callers);
 * - a claimed RemediationExecution run dispatches to
 *   RemediationExecutionRunner.executeRemediation with the run/suggestion
 *   linkage and the claimed attempt number — runType routing comes before
 *   the incident/alert subject columns, which remain set for dashboard
 *   linkage;
 * - a RemediationExecution run without a suggestion subject can never
 *   execute — it finalizes as Error;
 * - RemediationExecution runs count in the BACKGROUND lane: when the
 *   background sub-cap is full the run stays Queued (no claim, no
 *   dispatch) for the poller / TTL to deal with.
 */

const RUN_ID: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

function mockBudgetOk(): void {
  jest.spyOn(AIService, "getAutonomousDailyBudgetStatus").mockResolvedValue({
    exhausted: false,
    limitInTokens: null,
    usedTokensToday: 0,
  });
}

function flushDetachedKick(): Promise<unknown> {
  // The inline kick is detached; give the microtask a beat.
  return new Promise((resolve: (value: unknown) => void) => {
    setTimeout(resolve, 0);
  });
}

describe("AIInvestigationQueue — RemediationExecution runs", () => {
  beforeEach(() => {
    mockBudgetOk();
    // No per-project cap override => default of 3.
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue({ id: PROJECT_ID } as unknown as Project);
    // Nothing running (both the global cap and the background lane pass).
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("enqueue records a RemediationExecution run when the caller asks for one", async () => {
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue({ id: RUN_ID } as unknown as AIRun);
    const processRun: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "processRun")
      .mockResolvedValue(undefined);

    const aiRunId: ObjectID | null = await AIInvestigationQueue.enqueue({
      projectId: PROJECT_ID,
      subjectIncidentId: INCIDENT_ID,
      subjectAutoRemediationSuggestionId: SUGGESTION_ID,
      remediationRunType: AIRunType.RemediationExecution,
    });

    expect(aiRunId).toEqual(RUN_ID);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: AIRunStatus.Queued,
          runType: AIRunType.RemediationExecution,
          triggeredByAutoRemediationSuggestionId: SUGGESTION_ID,
          // Incident linkage stays set for the dashboard.
          triggeredByIncidentId: INCIDENT_ID,
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );

    await flushDetachedKick();
    expect(processRun).toHaveBeenCalledWith(
      expect.objectContaining({
        id: RUN_ID,
        attemptCount: 0,
        runType: AIRunType.RemediationExecution,
        triggeredByAutoRemediationSuggestionId: SUGGESTION_ID,
      }),
    );
  });

  test("enqueue defaults a suggestion-subject run to RemediationPlan when no remediationRunType is given", async () => {
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue({ id: RUN_ID } as unknown as AIRun);
    jest.spyOn(AIInvestigationQueue, "processRun").mockResolvedValue(undefined);

    await AIInvestigationQueue.enqueue({
      projectId: PROJECT_ID,
      subjectIncidentId: INCIDENT_ID,
      subjectAutoRemediationSuggestionId: SUGGESTION_ID,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          runType: AIRunType.RemediationPlan,
          triggeredByAutoRemediationSuggestionId: SUGGESTION_ID,
        }),
      }),
    );
  });

  test("a claimed RemediationExecution run dispatches to the execution runner", async () => {
    const claim: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);
    const execute: jest.SpyInstance = jest
      .spyOn(RemediationExecutionRunner, "executeRemediation")
      .mockResolvedValue(undefined);

    await AIInvestigationQueue.processRun({
      id: RUN_ID,
      projectId: PROJECT_ID,
      attemptCount: 0,
      runType: AIRunType.RemediationExecution,
      // Subject columns set for linkage must NOT reroute to the RCA runner.
      triggeredByIncidentId: INCIDENT_ID,
      triggeredByAutoRemediationSuggestionId: SUGGESTION_ID,
    });

    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({
        aiRunId: RUN_ID,
        fromStatus: AIRunStatus.Queued,
        expectedAttemptCount: 0,
        set: expect.objectContaining({
          status: AIRunStatus.Running,
          attemptCount: 1,
        }),
      }),
    );
    expect(execute).toHaveBeenCalledWith({
      aiRunId: RUN_ID,
      projectId: PROJECT_ID,
      suggestionId: SUGGESTION_ID,
      attemptCount: 1,
    });
  });

  test("a RemediationExecution run without a suggestion subject finalizes as Error", async () => {
    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);
    const execute: jest.SpyInstance = jest
      .spyOn(RemediationExecutionRunner, "executeRemediation")
      .mockResolvedValue(undefined);

    await AIInvestigationQueue.processRun({
      id: RUN_ID,
      projectId: PROJECT_ID,
      attemptCount: 0,
      runType: AIRunType.RemediationExecution,
    });

    expect(execute).not.toHaveBeenCalled();
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        aiRunId: RUN_ID,
        fromStatus: AIRunStatus.Running,
        set: expect.objectContaining({
          status: AIRunStatus.Error,
        }),
      }),
    );
  });

  test("a RemediationExecution run stays Queued when the background lane is full", async () => {
    /*
     * Cap 3 => background sub-cap 2 (one slot reserved for interactive
     * RCA). Global count 2 passes the cap; triage 1 + plans 1 = 2 fills
     * the background lane.
     */
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValueOnce(new PositiveNumber(2))
      .mockResolvedValueOnce(new PositiveNumber(1))
      .mockResolvedValueOnce(new PositiveNumber(1));
    const claim: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);
    const execute: jest.SpyInstance = jest
      .spyOn(RemediationExecutionRunner, "executeRemediation")
      .mockResolvedValue(undefined);

    await AIInvestigationQueue.processRun({
      id: RUN_ID,
      projectId: PROJECT_ID,
      attemptCount: 0,
      runType: AIRunType.RemediationExecution,
      triggeredByAutoRemediationSuggestionId: SUGGESTION_ID,
    });

    // No claim: the run must remain Queued for the poller / TTL.
    expect(claim).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
