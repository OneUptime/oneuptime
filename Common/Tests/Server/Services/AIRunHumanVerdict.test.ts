import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIRunService from "../../../Server/Services/AIRunService";
import AIRunHumanVerdict from "../../../Types/AI/AIRunHumanVerdict";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AIRunType from "../../../Types/AI/AIRunType";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Human verdict capture: Confirm / Reject must update the exact completed
 * investigation currently displayed by the client. The run, project, and
 * subject ids are one combined database predicate so a stale or forged run id
 * cannot put a verdict on another tenant's incident or alert investigation.
 */

const incidentId: ObjectID = ObjectID.generate();
const alertId: ObjectID = ObjectID.generate();
const aiRunId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

function fakeRun(id: ObjectID = aiRunId): AIRun {
  return { id } as unknown as AIRun;
}

describe("AIRunService.applyHumanVerdictToInvestigation", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a subjectless call is rejected before any query", async () => {
    const findOneBy: jest.SpyInstance = jest.spyOn(AIRunService, "findOneBy");

    await expect(
      AIRunService.applyHumanVerdictToInvestigation({
        aiRunId,
        projectId,
        verdict: AIRunHumanVerdict.Confirmed,
        verdictByUserId: userId,
      }),
    ).rejects.toThrow(BadDataException);

    expect(findOneBy).not.toHaveBeenCalled();
  });

  test("an incident lookup requires the exact run, project, and subject", async () => {
    const findOneBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(null);
    const updateOneById: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "updateOneById",
    );

    await expect(
      AIRunService.applyHumanVerdictToInvestigation({
        aiRunId,
        projectId,
        incidentId,
        verdict: AIRunHumanVerdict.Confirmed,
        verdictByUserId: userId,
      }),
    ).rejects.toThrow(/selected completed AI investigation does not exist/);

    expect(findOneBy).toHaveBeenCalledWith({
      query: {
        _id: aiRunId,
        projectId,
        runType: AIRunType.Investigation,
        status: AIRunStatus.Completed,
        triggeredByIncidentId: incidentId,
      },
      select: { _id: true },
      props: { isRoot: true },
    });
    expect(updateOneById).not.toHaveBeenCalled();
  });

  test("a run id that does not belong to the requested incident is rejected without a write", async () => {
    const requestedIncidentId: ObjectID = ObjectID.generate();
    const findOneBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(null);
    const updateOneById: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "updateOneById",
    );

    await expect(
      AIRunService.applyHumanVerdictToInvestigation({
        aiRunId,
        projectId,
        incidentId: requestedIncidentId,
        verdict: AIRunHumanVerdict.Rejected,
        verdictByUserId: userId,
      }),
    ).rejects.toThrow(BadDataException);

    expect(findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          _id: aiRunId,
          projectId,
          triggeredByIncidentId: requestedIncidentId,
        }),
      }),
    );
    expect(updateOneById).not.toHaveBeenCalled();
  });

  test("a different run id for the requested incident is rejected without falling back to its latest run", async () => {
    const requestedRunId: ObjectID = ObjectID.generate();
    const findOneBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(null);
    const updateOneById: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "updateOneById",
    );

    await expect(
      AIRunService.applyHumanVerdictToInvestigation({
        aiRunId: requestedRunId,
        projectId,
        incidentId,
        verdict: AIRunHumanVerdict.Confirmed,
        verdictByUserId: userId,
      }),
    ).rejects.toThrow(BadDataException);

    expect(findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          _id: requestedRunId,
          projectId,
          triggeredByIncidentId: incidentId,
        }),
      }),
    );
    expect(updateOneById).not.toHaveBeenCalled();
  });

  test("incident happy path stores verdict metadata on the exact selected run", async () => {
    const run: AIRun = fakeRun();
    const findOneBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(run);
    const updateOneById: jest.SpyInstance = jest
      .spyOn(AIRunService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const result: { runId: ObjectID; verdict: AIRunHumanVerdict } =
      await AIRunService.applyHumanVerdictToInvestigation({
        aiRunId,
        projectId,
        incidentId,
        verdict: AIRunHumanVerdict.Confirmed,
        verdictByUserId: userId,
      });

    expect(findOneBy).toHaveBeenCalledWith({
      query: {
        _id: aiRunId,
        projectId,
        runType: AIRunType.Investigation,
        status: AIRunStatus.Completed,
        triggeredByIncidentId: incidentId,
      },
      select: { _id: true },
      props: { isRoot: true },
    });
    expect(result).toEqual({
      runId: run.id,
      verdict: AIRunHumanVerdict.Confirmed,
    });
    expect(updateOneById).toHaveBeenCalledWith({
      id: run.id,
      data: {
        humanVerdict: AIRunHumanVerdict.Confirmed,
        humanVerdictAt: expect.any(Date),
        humanVerdictByUserId: userId,
      },
      props: { isRoot: true },
    });
  });

  test("alert happy path scopes the exact run to the alert and never adds incident scope", async () => {
    const run: AIRun = fakeRun();
    const findOneBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(run);
    jest
      .spyOn(AIRunService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await AIRunService.applyHumanVerdictToInvestigation({
      aiRunId,
      projectId,
      alertId,
      verdict: AIRunHumanVerdict.Rejected,
      verdictByUserId: userId,
    });

    expect(findOneBy).toHaveBeenCalledWith({
      query: {
        _id: aiRunId,
        projectId,
        runType: AIRunType.Investigation,
        status: AIRunStatus.Completed,
        triggeredByAlertId: alertId,
      },
      select: { _id: true },
      props: { isRoot: true },
    });
  });

  test("an existing verdict can be overwritten on that same exact run", async () => {
    const run: AIRun = {
      id: aiRunId,
      humanVerdict: AIRunHumanVerdict.Confirmed,
    } as unknown as AIRun;
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(run);
    const updateOneById: jest.SpyInstance = jest
      .spyOn(AIRunService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const result: { runId: ObjectID; verdict: AIRunHumanVerdict } =
      await AIRunService.applyHumanVerdictToInvestigation({
        aiRunId,
        projectId,
        incidentId,
        verdict: AIRunHumanVerdict.Rejected,
        verdictByUserId: userId,
      });

    expect(result.verdict).toBe(AIRunHumanVerdict.Rejected);
    expect(updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: aiRunId,
        data: expect.objectContaining({
          humanVerdict: AIRunHumanVerdict.Rejected,
        }),
      }),
    );
  });
});
