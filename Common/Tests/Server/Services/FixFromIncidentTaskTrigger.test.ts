import FixFromIncidentTaskTrigger from "../../../Server/Utils/AI/SRE/FixFromIncidentTaskTrigger";
import FixRunBudget from "../../../Server/Utils/AI/CodeFix/FixRunBudget";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import AIRunService from "../../../Server/Services/AIRunService";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIRunType from "../../../Types/AI/AIRunType";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * The FixFromIncident trigger: the user clicks "Open Fix PR from this
 * analysis" on the investigation panel after a AI investigation
 * completes, and the agent turns the posted analysis into a fix pull
 * request. Human-triggered — so there is no project opt-in flag; the gates
 * are: a COMPLETED investigation must exist for the subject (its analysis
 * is the task's entire context), a GitHub-App repository must exist for the
 * PR, and at most one non-terminal FixFromIncident run per subject.
 * Unlike the ImproveInstrumentation sibling this runs inside a user-facing
 * endpoint and must THROW clear messages, not swallow.
 */

const projectId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();
const alertId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

function fakeRun(): AIRun {
  return { id: ObjectID.generate() } as unknown as AIRun;
}

describe("FixFromIncidentTaskTrigger.createFixTaskFromInvestigation", () => {
  beforeEach(() => {
    // The daily fix-run budget has its own suite (FixRunBudget.test.ts).
    jest.spyOn(FixRunBudget, "assertWithinBudget").mockResolvedValue();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a subjectless call is rejected before any query", async () => {
    const findOneBy: jest.SpyInstance = jest.spyOn(AIRunService, "findOneBy");

    await expect(
      FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId,
        userId,
      }),
    ).rejects.toThrow(BadDataException);

    expect(findOneBy).not.toHaveBeenCalled();
  });

  test("no completed investigation → reject with a clear message, nothing enqueued", async () => {
    // The completed-investigation lookup is the first query.
    const findOneBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(null);
    const countBy: jest.SpyInstance = jest.spyOn(
      CodeRepositoryService,
      "countBy",
    );
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId,
        incidentId,
        userId,
      }),
    ).rejects.toThrow(/No completed AI investigation/);

    expect(findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          runType: AIRunType.Investigation,
          status: AIRunStatus.Completed,
          triggeredByIncidentId: incidentId,
        }),
      }),
    );
    expect(countBy).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test("no GitHub-App repository → reject, nothing enqueued", async () => {
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(fakeRun());
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId,
        incidentId,
        userId,
      }),
    ).rejects.toThrow(/GitHub/);

    expect(create).not.toHaveBeenCalled();
  });

  test("dedupe: a live FixFromIncident run for the same subject blocks a second one", async () => {
    jest
      .spyOn(AIRunService, "findOneBy")
      // 1st: the completed investigation exists.
      .mockResolvedValueOnce(fakeRun())
      // 2nd: a non-terminal FixFromIncident run already exists.
      .mockResolvedValueOnce(fakeRun());
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId,
        incidentId,
        userId,
      }),
    ).rejects.toThrow(/already queued or running/);

    expect(create).not.toHaveBeenCalled();
  });

  test("over the daily fix-run budget: the user-facing call REJECTS with the budget message, nothing enqueued", async () => {
    jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValueOnce(fakeRun()) // completed investigation
      .mockResolvedValueOnce(null); // no duplicate run
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    jest
      .spyOn(FixRunBudget, "assertWithinBudget")
      .mockRejectedValue(
        new BadDataException(
          "The project's daily AI fix task limit has been reached",
        ),
      );
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId,
        incidentId,
        userId,
      }),
    ).rejects.toThrow(/daily AI fix task limit/);

    expect(create).not.toHaveBeenCalled();
  });

  test("happy path (incident): enqueues a Queued FixFromIncident run with user attribution", async () => {
    const findOneBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValueOnce(fakeRun()) // completed investigation
      .mockResolvedValueOnce(null); // no duplicate run
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    const createdRun: AIRun = fakeRun();
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue(createdRun);

    const run: AIRun =
      await FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId,
        incidentId,
        userId,
      });

    expect(run).toBe(createdRun);

    // The dedupe guard queries per (subject, FixFromIncident).
    expect(findOneBy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        query: expect.objectContaining({
          runType: AIRunType.CodeFix,
          codeFixTaskType: CodeFixTaskType.FixFromIncident,
          triggeredByIncidentId: incidentId,
        }),
      }),
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: projectId,
          runType: AIRunType.CodeFix,
          codeFixTaskType: CodeFixTaskType.FixFromIncident,
          status: AIRunStatus.Queued,
          triggeredByIncidentId: incidentId,
          // Attribution: the user who clicked the button.
          userId: userId,
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
  });

  test("happy path (alert): the run carries triggeredByAlertId", async () => {
    const findOneBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValueOnce(fakeRun())
      .mockResolvedValueOnce(null);
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue(fakeRun());

    await FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
      projectId,
      alertId,
      userId,
    });

    // The completed-investigation gate keys on the alert subject.
    expect(findOneBy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        query: expect.objectContaining({
          runType: AIRunType.Investigation,
          status: AIRunStatus.Completed,
          triggeredByAlertId: alertId,
        }),
      }),
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          codeFixTaskType: CodeFixTaskType.FixFromIncident,
          triggeredByAlertId: alertId,
          userId: userId,
        }),
      }),
    );
  });
});
