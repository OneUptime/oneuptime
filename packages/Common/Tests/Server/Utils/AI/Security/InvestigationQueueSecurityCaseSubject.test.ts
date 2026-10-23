import AIInvestigationQueue, {
  QueuedRunRef,
} from "../../../../../Server/Utils/AI/SRE/InvestigationQueue";
import SecurityCaseTriageRunner from "../../../../../Server/Utils/AI/Security/SecurityCaseTriageRunner";
import AIIncidentInvestigationRunner from "../../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import AIRunService from "../../../../../Server/Services/AIRunService";
import AIService from "../../../../../Server/Services/AIService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import logger from "../../../../../Server/Utils/Logger";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import Project from "../../../../../Models/DatabaseModels/Project";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../../Types/AI/AIRunType";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A security case's triage on the AI queue: an Investigation run whose
 * subject is the case (triggeredBySecurityCaseId), in the budgeted,
 * subjectless lane with insight triage. These hold that the run is
 * recorded with its case, is never also an incident's, alert's or
 * remediation's run, travels to the workers with its case, and is routed
 * to the triage runner with the claimed attempt.
 */

function mockBudget(exhausted: boolean): jest.SpyInstance {
  return jest
    .spyOn(AIService, "getAutonomousDailyBudgetStatus")
    .mockResolvedValue({
      exhausted,
      limitInTokens: exhausted ? 1000 : null,
      usedTokensToday: exhausted ? 1000 : 0,
    });
}

describe("AIInvestigationQueue — security case subject", () => {
  const projectId: ObjectID = new ObjectID(
    "11111111-1111-4111-8111-111111111111",
  );
  const securityCaseId: ObjectID = new ObjectID(
    "22222222-2222-4222-8222-222222222222",
  );
  const createdId: ObjectID = new ObjectID(
    "33333333-3333-4333-8333-333333333333",
  );

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {});
    jest.spyOn(logger, "debug").mockImplementation((): void => {});
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue({ id: projectId } as unknown as Project);
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(AIService, "getReachedProjectDailyLimit")
      .mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("enqueue records an Investigation run with its case and hands it to the workers", async () => {
    const budget: jest.SpyInstance = mockBudget(false);
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue({ id: createdId } as unknown as AIRun);
    const send: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "sendToWorkers")
      .mockResolvedValue(undefined);

    const returnedId: ObjectID | null = await AIInvestigationQueue.enqueue({
      projectId,
      subjectSecurityCaseId: securityCaseId,
    });

    expect(returnedId).toEqual(createdId);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          runType: AIRunType.Investigation,
          status: AIRunStatus.Queued,
          triggeredBySecurityCaseId: securityCaseId,
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
    // Neither an incident's nor an alert's run.
    const data: AIRun = (create.mock.calls[0]![0] as { data: AIRun }).data;
    expect(data.triggeredByIncidentId).toBeUndefined();
    expect(data.triggeredByAlertId).toBeUndefined();
    // The project's autonomous budget, in no incident or alert lane.
    expect(budget).toHaveBeenCalledWith(projectId, {
      incidentId: undefined,
      alertId: undefined,
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        id: createdId,
        projectId,
        runType: AIRunType.Investigation,
        triggeredBySecurityCaseId: securityCaseId,
      }),
    );
  });

  test("a spent daily budget records nothing", async () => {
    mockBudget(true);
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    expect(
      await AIInvestigationQueue.enqueue({
        projectId,
        subjectSecurityCaseId: securityCaseId,
      }),
    ).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  test.each([
    ["an incident", { subjectIncidentId: ObjectID.generate() }],
    ["an alert", { subjectAlertId: ObjectID.generate() }],
    [
      "a remediation",
      { subjectAutoRemediationSuggestionId: ObjectID.generate() },
    ],
  ])(
    "a triage that would also be %s's run is refused",
    async (_name: string, subject: Record<string, ObjectID>) => {
      mockBudget(false);
      const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

      expect(
        await AIInvestigationQueue.enqueue({
          projectId,
          subjectSecurityCaseId: securityCaseId,
          ...subject,
        }),
      ).toBeNull();
      expect(create).not.toHaveBeenCalled();
    },
  );

  test("a won claim is routed to the triage runner with the claimed attempt, never an incident's runner", async () => {
    mockBudget(false);
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
    const triage: jest.SpyInstance = jest
      .spyOn(SecurityCaseTriageRunner, "executeTriage")
      .mockResolvedValue(undefined);
    const incident: jest.SpyInstance = jest.spyOn(
      AIIncidentInvestigationRunner,
      "executeInvestigation",
    );

    const run: QueuedRunRef = {
      id: createdId,
      projectId,
      attemptCount: 0,
      runType: AIRunType.Investigation,
      triggeredBySecurityCaseId: securityCaseId,
    };

    await AIInvestigationQueue.processRun(run);

    expect(triage).toHaveBeenCalledWith({
      aiRunId: createdId,
      projectId,
      securityCaseId,
      attemptCount: 1,
    });
    expect(incident).not.toHaveBeenCalled();
  });
});
