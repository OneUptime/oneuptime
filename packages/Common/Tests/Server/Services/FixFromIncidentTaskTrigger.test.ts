import FixFromIncidentTaskTrigger from "../../../Server/Utils/AI/SRE/FixFromIncidentTaskTrigger";
import PostedRootCause from "../../../Server/Utils/AI/SRE/PostedRootCause";
import FixRunBudget from "../../../Server/Utils/AI/CodeFix/FixRunBudget";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import AIRunService from "../../../Server/Services/AIRunService";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import {
  getInvestigationSubjectLockKey,
  INVESTIGATION_SUBJECT_LOCK_NAMESPACE,
} from "../../../Server/Utils/AI/SRE/InvestigationSubjectLock";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIRunType from "../../../Types/AI/AIRunType";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AIRunCodeFixRecommendation from "../../../Types/AI/AIRunCodeFixRecommendation";
import CodeFixTaskContext from "../../../Types/AI/CodeFixTaskContext";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The human FixFromIncident trigger is authorized by the exact investigation
 * displayed in the panel. The latest subject run must be Completed and
 * Recommended, its immutable snapshot must match its exact posted report,
 * and repository/dedupe checks culminate in a lock-protected revalidation.
 */

const projectId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();
const alertId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const investigationRunId: ObjectID = ObjectID.generate();
const investigationCompletedAt: Date = new Date("2026-08-07T12:00:00.000Z");
const analysisMarkdown: string =
  "## Root cause\n\nA repository code change fixes this regression.";

function taskSnapshot(
  id: ObjectID = investigationRunId,
  analysis: string = analysisMarkdown,
): CodeFixTaskContext {
  return {
    sourceInvestigationRunId: id.toString(),
    sourceInvestigationAnalysisMarkdown: analysis,
  };
}

function fakeRun(
  recommendation: AIRunCodeFixRecommendation = AIRunCodeFixRecommendation.Recommended,
  status: AIRunStatus = AIRunStatus.Completed,
  taskContextOverride?: CodeFixTaskContext | null | undefined,
  id: ObjectID = investigationRunId,
): AIRun {
  return {
    id,
    completedAt: investigationCompletedAt,
    codeFixRecommendation: recommendation,
    status,
    taskContext:
      taskContextOverride === null
        ? undefined
        : taskContextOverride || taskSnapshot(id),
  } as unknown as AIRun;
}

function fakeLegacyRunWithoutRecommendation(): AIRun {
  return {
    id: investigationRunId,
    completedAt: investigationCompletedAt,
    status: AIRunStatus.Completed,
    taskContext: taskSnapshot(),
  } as unknown as AIRun;
}

describe("FixFromIncidentTaskTrigger.createFixTaskFromInvestigation", () => {
  beforeEach(() => {
    jest.spyOn(FixRunBudget, "assertWithinBudget").mockResolvedValue();
    jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue();
    jest
      .spyOn(PostedRootCause, "getForInvestigation")
      .mockResolvedValue(analysisMarkdown);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a subjectless call is rejected before any query", async () => {
    const findOneBy: jest.SpyInstance = jest.spyOn(AIRunService, "findOneBy");

    await expect(
      FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId,
        investigationRunId,
        userId,
      }),
    ).rejects.toThrow(BadDataException);

    expect(findOneBy).not.toHaveBeenCalled();
  });

  test("a call carrying both subject types is rejected before any query", async () => {
    const findOneBy: jest.SpyInstance = jest.spyOn(AIRunService, "findOneBy");

    await expect(
      FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId,
        incidentId,
        alertId,
        investigationRunId,
        userId,
      }),
    ).rejects.toThrow(/Exactly one/);

    expect(findOneBy).not.toHaveBeenCalled();
  });

  test("a missing investigation run id is rejected before any query", async () => {
    const findOneBy: jest.SpyInstance = jest.spyOn(AIRunService, "findOneBy");

    await expect(
      FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId,
        incidentId,
        investigationRunId: undefined as unknown as ObjectID,
        userId,
      }),
    ).rejects.toThrow(/investigation run id is required/i);

    expect(findOneBy).not.toHaveBeenCalled();
  });

  test("no investigation rejects before report, repository, or enqueue IO", async () => {
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
        investigationRunId,
        userId,
      }),
    ).rejects.toThrow(/No completed AI investigation/);

    expect(findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          projectId,
          runType: AIRunType.Investigation,
          triggeredByIncidentId: incidentId,
        },
        select: expect.objectContaining({
          _id: true,
          completedAt: true,
          status: true,
          codeFixRecommendation: true,
          taskContext: true,
        }),
        sort: { createdAt: SortOrder.Descending },
      }),
    );
    expect(PostedRootCause.getForInvestigation).not.toHaveBeenCalled();
    expect(countBy).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test.each([AIRunStatus.Running, AIRunStatus.Error])(
    "latest %s investigation blocks an older Recommended result",
    async (latestStatus: AIRunStatus) => {
      jest
        .spyOn(AIRunService, "findOneBy")
        .mockResolvedValue(
          fakeRun(AIRunCodeFixRecommendation.Recommended, latestStatus),
        );
      const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

      await expect(
        FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
          projectId,
          incidentId,
          investigationRunId,
          userId,
        }),
      ).rejects.toThrow(/latest AI investigation.*has not completed/i);

      expect(PostedRootCause.getForInvestigation).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    },
  );

  test("latest completed Pending investigation rejects until classification settles", async () => {
    jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(fakeRun(AIRunCodeFixRecommendation.Pending));

    await expect(
      FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId,
        incidentId,
        investigationRunId,
        userId,
      }),
    ).rejects.toThrow(/still deciding/i);

    expect(PostedRootCause.getForInvestigation).not.toHaveBeenCalled();
  });

  test("a stale displayed run id cannot borrow a newer Recommended analysis", async () => {
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(fakeRun());

    await expect(
      FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId,
        incidentId,
        investigationRunId: ObjectID.generate(),
        userId,
      }),
    ).rejects.toThrow(/newer AI investigation/i);

    expect(PostedRootCause.getForInvestigation).not.toHaveBeenCalled();
  });

  test("latest NotRecommended result is authoritative over an older Recommended result", async () => {
    jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(fakeRun(AIRunCodeFixRecommendation.NotRecommended));
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId,
        incidentId,
        investigationRunId,
        userId,
      }),
    ).rejects.toThrow(/did not recommend a code fix/i);

    expect(PostedRootCause.getForInvestigation).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test("legacy completed investigation without a recommendation fails closed", async () => {
    jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(fakeLegacyRunWithoutRecommendation());

    await expect(
      FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId,
        incidentId,
        investigationRunId,
        userId,
      }),
    ).rejects.toThrow(/did not recommend a code fix/i);
  });

  test.each([
    ["missing", null],
    [
      "missing analysis",
      { sourceInvestigationRunId: investigationRunId.toString() },
    ],
    [
      "missing run id",
      { sourceInvestigationAnalysisMarkdown: analysisMarkdown },
    ],
  ] as Array<[string, CodeFixTaskContext | null]>)(
    "%s stored analysis snapshot fails closed before report and repository IO",
    async (_label: string, taskContext: CodeFixTaskContext | null) => {
      jest
        .spyOn(AIRunService, "findOneBy")
        .mockResolvedValue(fakeRun(undefined, undefined, taskContext));
      const countBy: jest.SpyInstance = jest.spyOn(
        CodeRepositoryService,
        "countBy",
      );

      await expect(
        FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
          projectId,
          incidentId,
          investigationRunId,
          userId,
        }),
      ).rejects.toThrow(/no complete stored analysis snapshot/i);

      expect(PostedRootCause.getForInvestigation).not.toHaveBeenCalled();
      expect(countBy).not.toHaveBeenCalled();
    },
  );

  test("a snapshot naming a different investigation run fails closed", async () => {
    jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(
        fakeRun(undefined, undefined, taskSnapshot(ObjectID.generate())),
      );

    await expect(
      FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId,
        incidentId,
        investigationRunId,
        userId,
      }),
    ).rejects.toThrow(/no complete stored analysis snapshot/i);

    expect(PostedRootCause.getForInvestigation).not.toHaveBeenCalled();
  });

  test("the exact investigation must have a posted report before a task can be frozen", async () => {
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(fakeRun());
    jest
      .mocked(PostedRootCause.getForInvestigation)
      .mockResolvedValueOnce(null);
    const countBy: jest.SpyInstance = jest.spyOn(
      CodeRepositoryService,
      "countBy",
    );

    await expect(
      FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId,
        incidentId,
        investigationRunId,
        userId,
      }),
    ).rejects.toThrow(/No posted investigation analysis/);

    expect(PostedRootCause.getForInvestigation).toHaveBeenCalledWith({
      incidentId,
      alertId: undefined,
      aiRunId: investigationRunId,
      runCompletedAt: investigationCompletedAt,
    });
    expect(countBy).not.toHaveBeenCalled();
  });

  test("a posted report that differs from the Recommended snapshot fails closed", async () => {
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(fakeRun());
    jest
      .mocked(PostedRootCause.getForInvestigation)
      .mockResolvedValueOnce("## Different report");

    await expect(
      FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId,
        incidentId,
        investigationRunId,
        userId,
      }),
    ).rejects.toThrow(/does not match its durable recommendation snapshot/i);
  });

  test("no GitHub-App repository rejects without enqueueing", async () => {
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(fakeRun());
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId,
        incidentId,
        investigationRunId,
        userId,
      }),
    ).rejects.toThrow(/GitHub/);

    expect(create).not.toHaveBeenCalled();
  });

  test("an existing live FixFromIncident run blocks a duplicate", async () => {
    jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValueOnce(fakeRun())
      .mockResolvedValueOnce(fakeRun());
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId,
        incidentId,
        investigationRunId,
        userId,
      }),
    ).rejects.toThrow(/already queued or running/);

    expect(create).not.toHaveBeenCalled();
  });

  test("the locked second dedupe check closes a concurrent enqueue race", async () => {
    jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValueOnce(fakeRun())
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(fakeRun());
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId,
        incidentId,
        investigationRunId,
        userId,
      }),
    ).rejects.toThrow(/already queued or running/i);

    expect(Semaphore.lock).toHaveBeenCalledWith({
      key: getInvestigationSubjectLockKey({ projectId, incidentId }),
      namespace: INVESTIGATION_SUBJECT_LOCK_NAMESPACE,
      lockTimeout: 30 * 1000,
      acquireTimeout: 10 * 1000,
    });
    expect(Semaphore.release).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  test("a newer investigation inserted before locked revalidation fails closed", async () => {
    const newerInvestigation: AIRun = fakeRun(
      AIRunCodeFixRecommendation.NotRecommended,
      AIRunStatus.Completed,
      undefined,
      ObjectID.generate(),
    );
    jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValueOnce(fakeRun())
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(newerInvestigation);
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId,
        incidentId,
        investigationRunId,
        userId,
      }),
    ).rejects.toThrow(/no longer the latest durably Recommended analysis/i);

    expect(Semaphore.release).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  test("over-budget user request rejects without enqueueing", async () => {
    jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValueOnce(fakeRun())
      .mockResolvedValue(null);
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
        investigationRunId,
        userId,
      }),
    ).rejects.toThrow(/daily AI fix task limit/);

    expect(create).not.toHaveBeenCalled();
  });

  test("latest Recommended incident report is frozen into the locked task", async () => {
    const latestRecommended: AIRun = fakeRun();
    const findOneBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValueOnce(latestRecommended)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(latestRecommended);
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    const createdRun: AIRun = { id: ObjectID.generate() } as unknown as AIRun;
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue(createdRun);

    const run: AIRun =
      await FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId,
        incidentId,
        investigationRunId,
        userId,
      });

    expect(run).toBe(createdRun);
    expect(PostedRootCause.getForInvestigation).toHaveBeenCalledWith({
      incidentId,
      alertId: undefined,
      aiRunId: investigationRunId,
      runCompletedAt: investigationCompletedAt,
    });
    expect(findOneBy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        query: {
          projectId,
          runType: AIRunType.Investigation,
          triggeredByIncidentId: incidentId,
        },
        sort: { createdAt: SortOrder.Descending },
      }),
    );
    expect(findOneBy).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        query: expect.objectContaining({
          projectId,
          triggeredByIncidentId: incidentId,
        }),
        sort: { createdAt: SortOrder.Descending },
      }),
    );
    expect(create.mock.invocationCallOrder[0]).toBeGreaterThan(
      findOneBy.mock.invocationCallOrder[3]!,
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId,
          runType: AIRunType.CodeFix,
          codeFixTaskType: CodeFixTaskType.FixFromIncident,
          status: AIRunStatus.Queued,
          triggeredByIncidentId: incidentId,
          userId,
          taskContext: {
            sourceInvestigationRunId: investigationRunId.toString(),
            sourceInvestigationAnalysisMarkdown: analysisMarkdown,
          },
        }),
        props: { isRoot: true },
      }),
    );
  });

  test("alert happy path preserves exact report association and alert subject", async () => {
    const latestRecommended: AIRun = fakeRun();
    jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValueOnce(latestRecommended)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(latestRecommended);
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);

    await FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
      projectId,
      alertId,
      investigationRunId,
      userId,
    });

    expect(PostedRootCause.getForInvestigation).toHaveBeenCalledWith({
      incidentId: undefined,
      alertId,
      aiRunId: investigationRunId,
      runCompletedAt: investigationCompletedAt,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          triggeredByAlertId: alertId,
          userId,
          taskContext: {
            sourceInvestigationRunId: investigationRunId.toString(),
            sourceInvestigationAnalysisMarkdown: analysisMarkdown,
          },
        }),
      }),
    );
  });
});
