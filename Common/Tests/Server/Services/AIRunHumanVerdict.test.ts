import AIRunService from "../../../Server/Services/AIRunService";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIRunType from "../../../Types/AI/AIRunType";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AIRunHumanVerdict from "../../../Types/AI/AIRunHumanVerdict";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * Human verdict capture (Phase 2 measurement layer): the one-click
 * Confirm / Reject on the investigation panel lands here, via
 * POST /ai-investigation/verdict → applyHumanVerdictToLatestInvestigation.
 * Contract under test: the verdict applies to the LATEST COMPLETED
 * investigation for the subject, rejects when none exists, stores
 * verdict + at + byUserId, and overwriting is allowed (a user may change
 * their mind — there is deliberately no "already has a verdict" guard).
 */

const incidentId: ObjectID = ObjectID.generate();
const alertId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

function fakeRun(): AIRun {
  return { id: ObjectID.generate() } as unknown as AIRun;
}

describe("AIRunService.applyHumanVerdictToLatestInvestigation", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a subjectless call is rejected before any query", async () => {
    const findOneBy: jest.SpyInstance = jest.spyOn(AIRunService, "findOneBy");

    await expect(
      AIRunService.applyHumanVerdictToLatestInvestigation({
        verdict: AIRunHumanVerdict.Confirmed,
        verdictByUserId: userId,
      }),
    ).rejects.toThrow(BadDataException);

    expect(findOneBy).not.toHaveBeenCalled();
  });

  test("no completed investigation → reject with a clear message, nothing written", async () => {
    const findOneBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(null);
    const updateOneById: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "updateOneById",
    );

    await expect(
      AIRunService.applyHumanVerdictToLatestInvestigation({
        incidentId,
        verdict: AIRunHumanVerdict.Confirmed,
        verdictByUserId: userId,
      }),
    ).rejects.toThrow(/No completed AI investigation/);

    // The lookup must target the LATEST COMPLETED investigation.
    expect(findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          runType: AIRunType.Investigation,
          status: AIRunStatus.Completed,
          triggeredByIncidentId: incidentId,
        }),
        sort: expect.objectContaining({ createdAt: SortOrder.Descending }),
      }),
    );
    expect(updateOneById).not.toHaveBeenCalled();
  });

  test("happy path (incident): stores verdict + at + byUserId on the run and returns {runId, verdict}", async () => {
    const run: AIRun = fakeRun();
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(run);
    const updateOneById: jest.SpyInstance = jest
      .spyOn(AIRunService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const result: { runId: ObjectID; verdict: AIRunHumanVerdict } =
      await AIRunService.applyHumanVerdictToLatestInvestigation({
        incidentId,
        verdict: AIRunHumanVerdict.Confirmed,
        verdictByUserId: userId,
      });

    expect(result.runId).toBe(run.id);
    expect(result.verdict).toBe(AIRunHumanVerdict.Confirmed);

    expect(updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: run.id,
        data: expect.objectContaining({
          humanVerdict: AIRunHumanVerdict.Confirmed,
          humanVerdictAt: expect.any(Date),
          humanVerdictByUserId: userId,
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
  });

  test("happy path (alert): the lookup keys on triggeredByAlertId", async () => {
    const run: AIRun = fakeRun();
    const findOneBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(run);
    jest
      .spyOn(AIRunService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await AIRunService.applyHumanVerdictToLatestInvestigation({
      alertId,
      verdict: AIRunHumanVerdict.Rejected,
      verdictByUserId: userId,
    });

    expect(findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          runType: AIRunType.Investigation,
          status: AIRunStatus.Completed,
          triggeredByAlertId: alertId,
        }),
      }),
    );
  });

  test("idempotent overwrite: a run that already carries a verdict is simply re-written", async () => {
    // The service deliberately does NOT guard on an existing verdict.
    const run: AIRun = {
      id: ObjectID.generate(),
      humanVerdict: AIRunHumanVerdict.Confirmed,
    } as unknown as AIRun;
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(run);
    const updateOneById: jest.SpyInstance = jest
      .spyOn(AIRunService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const result: { runId: ObjectID; verdict: AIRunHumanVerdict } =
      await AIRunService.applyHumanVerdictToLatestInvestigation({
        incidentId,
        verdict: AIRunHumanVerdict.Rejected,
        verdictByUserId: userId,
      });

    expect(result.verdict).toBe(AIRunHumanVerdict.Rejected);
    expect(updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          humanVerdict: AIRunHumanVerdict.Rejected,
        }),
      }),
    );
  });
});
