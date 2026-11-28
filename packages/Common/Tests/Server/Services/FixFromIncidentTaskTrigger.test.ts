import FixFromIncidentTaskTrigger, {
  NO_CONNECTED_REPOSITORY_FOR_CODE_FIX_MESSAGE,
} from "../../../Server/Utils/AI/SRE/FixFromIncidentTaskTrigger";
import PostedRootCause from "../../../Server/Utils/AI/SRE/PostedRootCause";
import FixRunBudget from "../../../Server/Utils/AI/CodeFix/FixRunBudget";
import CodeFixPersonRepository from "../../../Server/Utils/AI/CodeFix/CodeFixPersonRepository";
import CodeFixStartGate from "../../../Server/Utils/AI/CodeFix/CodeFixStartGate";
import { ResolvableRepository } from "../../../Server/Utils/CodeRepository/StackTraceRepoResolver";
import { CODE_TASK_PLAN_REQUIRED_MESSAGE } from "../../../Server/Utils/AI/CodeTask/CodeTaskGate";
import { CodeTaskBlockerType } from "../../../Types/AI/CodeTask";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  EVERY_CODE_REPOSITORY,
  NO_CODE_REPOSITORY,
} from "../../../Types/CodeRepository/CodeRepositoryAllowance";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import {
  NO_REPOSITORY_YOU_MAY_USE_MESSAGE,
  PICKED_REPOSITORY_NOT_ASKABLE_MESSAGE,
} from "../../../Utils/Suggestions/CodeFixRepositoryPick";
import { PICK_A_REPOSITORY_FOR_THE_CODE_FIX_MESSAGES } from "../../../Utils/Suggestions/InvestigationCodeFixSuggestion";
import CodeFixOnItsWay, {
  CodeFixProblemKind,
} from "../../../Server/Utils/AI/CodeFix/CodeFixOnItsWay";
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

// The project's one connected repository, which the person may use.
const REPOSITORY_ID: string = "11209000-0000-4000-8000-0000000000a1";

// Who clicked Open fix pull request, as their request reads.
const PERSON: DatabaseCommonInteractionProps = {
  userId,
  tenantId: projectId,
};

function usableRepository(id: string = REPOSITORY_ID): ResolvableRepository {
  return {
    id,
    name: "billing-api",
    organizationName: "acme",
    repositoryName: "billing-api",
    mainBranchName: "main",
    gitHubAppInstallationId: "1234",
  };
}

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
  /*
   * A fix of the subject on its way - a turn of its task queued or running,
   * a reply in Code included - by the one rule (CodeFixOnItsWay, which has
   * its own suites): none unless a test says.
   */
  let onItsWay: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(FixRunBudget, "assertWithinBudget").mockResolvedValue();
    jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue();
    jest
      .spyOn(PostedRootCause, "getForInvestigation")
      .mockResolvedValue(analysisMarkdown);
    onItsWay = jest.spyOn(CodeFixOnItsWay, "findTurn").mockResolvedValue(null);
    /*
     * The project's one repository is the person's to use, and Code's gate
     * says nothing (#11209): who may use which repository, and how the run
     * is held to it, has its own tests below and in
     * FixWithAiRepositoryYouMayUseOverHttp.
     */
    jest
      .spyOn(CodeFixPersonRepository, "getUsableRepositories")
      .mockResolvedValue({
        connectedCount: 1,
        usable: [usableRepository()],
        allowance: EVERY_CODE_REPOSITORY,
      });
    jest.spyOn(CodeFixStartGate, "check").mockResolvedValue({
      codeRepositoryId: new ObjectID(REPOSITORY_ID),
      blocker: null,
    });
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
        props: PERSON,
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
        props: PERSON,
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
        props: PERSON,
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
        props: PERSON,
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
          props: PERSON,
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
        props: PERSON,
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
        props: PERSON,
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
        props: PERSON,
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
        props: PERSON,
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
          props: PERSON,
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
        props: PERSON,
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
        props: PERSON,
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
        props: PERSON,
      }),
    ).rejects.toThrow(/does not match its durable recommendation snapshot/i);
  });

  test("no connected repository - on GitHub or any other host - rejects without enqueueing", async () => {
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(fakeRun());
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    // No repository connected through GitLab, Forgejo, Gitea or Git either.
    jest.spyOn(CodeRepositoryService, "findBy").mockResolvedValue([]);
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId,
        incidentId,
        investigationRunId,
        userId,
        props: PERSON,
      }),
    ).rejects.toThrow(/^No connected repository exists for this project/);

    expect(create).not.toHaveBeenCalled();
  });

  test("an existing live FixFromIncident run blocks a duplicate", async () => {
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValueOnce(fakeRun());
    onItsWay.mockResolvedValue(fakeRun());
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
        props: PERSON,
      }),
    ).rejects.toThrow(/already queued or running/);

    expect(create).not.toHaveBeenCalled();
  });

  test("the locked second dedupe check closes a concurrent enqueue race", async () => {
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValueOnce(fakeRun());
    // Nothing on its way at the gate; one by the time the lock is held.
    onItsWay.mockResolvedValueOnce(null).mockResolvedValueOnce(fakeRun());
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
        props: PERSON,
      }),
    ).rejects.toThrow(
      "OneUptime AI is already writing a fix pull request for this incident. Follow it in Code.",
    );

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
        props: PERSON,
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
        props: PERSON,
      }),
    ).rejects.toThrow(/daily AI fix task limit/);

    expect(create).not.toHaveBeenCalled();
  });

  test("latest Recommended incident report is frozen into the locked task", async () => {
    const latestRecommended: AIRun = fakeRun();
    const findOneBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValueOnce(latestRecommended)
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
        props: PERSON,
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
      2,
      expect.objectContaining({
        query: expect.objectContaining({
          projectId,
          triggeredByIncidentId: incidentId,
        }),
        sort: { createdAt: SortOrder.Descending },
      }),
    );
    expect(create.mock.invocationCallOrder[0]).toBeGreaterThan(
      findOneBy.mock.invocationCallOrder[1]!,
    );
    /*
     * No fix of the incident on its way, asked twice by the one rule: at the
     * gate, and again under the subject's lock.
     */
    expect(onItsWay).toHaveBeenCalledTimes(2);
    expect(onItsWay).toHaveBeenLastCalledWith({
      projectId,
      kind: CodeFixProblemKind.Incident,
      recordId: incidentId.toString(),
      taskTypes: [CodeFixTaskType.FixFromIncident],
    });
    expect(create.mock.invocationCallOrder[0]).toBeGreaterThan(
      onItsWay.mock.invocationCallOrder[1]!,
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
          // Queued on the repository decided for the person, and held to it.
          codeRepositoryId: new ObjectID(REPOSITORY_ID),
          taskContext: {
            sourceInvestigationRunId: investigationRunId.toString(),
            sourceInvestigationAnalysisMarkdown: analysisMarkdown,
            pickedCodeRepositoryId: REPOSITORY_ID,
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
      props: PERSON,
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
            pickedCodeRepositoryId: REPOSITORY_ID,
          },
        }),
      }),
    );
  });
});

/*
 * WHO MAY OPEN THE FIX PULL REQUEST, AND IN WHICH REPOSITORY (#11209): the
 * click is a code task on the person's behalf, so the run is held to the
 * repositories they may use in Code (CodeFixPersonRepository) - after the
 * investigation, repository and dedupe gates, and before anything is
 * written. Its per-repository answers have their own suite
 * (FixWithAiRepositoryYouMayUseOverHttp); here, how the trigger asks.
 */
describe("FixFromIncidentTaskTrigger.createFixTaskFromInvestigation holds the repository to the person", () => {
  const OTHER_REPOSITORY_ID: string = "11209000-0000-4000-8000-0000000000a2";

  beforeEach(() => {
    jest.spyOn(FixRunBudget, "assertWithinBudget").mockResolvedValue();
    jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue();
    jest
      .spyOn(PostedRootCause, "getForInvestigation")
      .mockResolvedValue(analysisMarkdown);
    jest.spyOn(CodeFixOnItsWay, "findTurn").mockResolvedValue(null);
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(fakeRun());
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    jest.spyOn(CodeFixStartGate, "check").mockResolvedValue({
      codeRepositoryId: new ObjectID(REPOSITORY_ID),
      blocker: null,
    });
    jest
      .spyOn(CodeFixPersonRepository, "getUsableRepositories")
      .mockResolvedValue({
        connectedCount: 1,
        usable: [usableRepository()],
        allowance: EVERY_CODE_REPOSITORY,
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    ["incident", { incidentId }],
    ["alert", { alertId }],
  ])(
    "asks for the %s's fix with the person, their pick and the record - in Fix the Cause's own words",
    async (
      subject: string,
      record: { incidentId?: ObjectID; alertId?: ObjectID },
    ) => {
      const decide: jest.SpyInstance = jest.spyOn(
        CodeFixPersonRepository,
        "decideRepository",
      );
      // The pick is the person's to use: its own checks have their own tests.
      jest
        .spyOn(CodeFixPersonRepository, "checkRepositoryPick")
        .mockResolvedValue(null);
      jest
        .spyOn(AIRunService, "create")
        .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);
      const pick: ObjectID = new ObjectID(REPOSITORY_ID);

      await FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId,
        ...record,
        investigationRunId,
        userId,
        props: PERSON,
        repositoryId: pick,
      });

      expect(decide).toHaveBeenCalledTimes(1);
      expect(decide.mock.calls[0]![0]).toMatchObject({
        projectId,
        taskType: CodeFixTaskType.FixFromIncident,
        person: PERSON,
        pickedRepositoryId: pick,
        incidentId: record.incidentId,
        alertId: record.alertId,
        refusals: {
          noConnectedRepository: NO_CONNECTED_REPOSITORY_FOR_CODE_FIX_MESSAGE,
          pickARepository:
            PICK_A_REPOSITORY_FOR_THE_CODE_FIX_MESSAGES[
              subject as "incident" | "alert"
            ],
        },
      });
    },
  );

  test("the person's repositories are weighed after the record's own gates, and before the run is written", async () => {
    const usable: jest.SpyInstance = jest.spyOn(
      CodeFixPersonRepository,
      "getUsableRepositories",
    );
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);

    await FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
      projectId,
      incidentId,
      investigationRunId,
      userId,
      props: PERSON,
    });

    expect(usable.mock.invocationCallOrder[0]).toBeGreaterThan(
      (CodeFixOnItsWay.findTurn as unknown as jest.Mock).mock
        .invocationCallOrder[0]!,
    );
    expect(create.mock.invocationCallOrder[0]).toBeGreaterThan(
      usable.mock.invocationCallOrder[0]!,
    );
    expect(usable.mock.calls[0]![0]).toEqual({ projectId, props: PERSON });
  });

  test("a fix already on its way is said before the person's repositories are weighed", async () => {
    jest.spyOn(CodeFixOnItsWay, "findTurn").mockResolvedValue(fakeRun());
    const usable: jest.SpyInstance = jest.spyOn(
      CodeFixPersonRepository,
      "getUsableRepositories",
    );

    await expect(
      FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId,
        incidentId,
        investigationRunId,
        userId,
        props: PERSON,
      }),
    ).rejects.toThrow(/already queued or running/);
    expect(usable).not.toHaveBeenCalled();
  });

  test("none of the connected repositories theirs: refused, nothing written", async () => {
    jest
      .spyOn(CodeFixPersonRepository, "getUsableRepositories")
      .mockResolvedValue({
        connectedCount: 2,
        usable: [],
        allowance: NO_CODE_REPOSITORY,
      });
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    const refusal: unknown =
      await FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId,
        incidentId,
        investigationRunId,
        userId,
        props: PERSON,
      }).catch((error: unknown) => {
        return error;
      });

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect((refusal as Error).message).toBe(NO_REPOSITORY_YOU_MAY_USE_MESSAGE);
    expect(create).not.toHaveBeenCalled();
  });

  test("the plan is said first, as a payment, before why the person may not use a repository", async () => {
    jest
      .spyOn(CodeFixPersonRepository, "getUsableRepositories")
      .mockResolvedValue({
        connectedCount: 2,
        usable: [],
        allowance: NO_CODE_REPOSITORY,
      });
    jest.spyOn(CodeFixStartGate, "check").mockResolvedValue({
      codeRepositoryId: null,
      blocker: {
        type: CodeTaskBlockerType.PlanRequired,
        message: CODE_TASK_PLAN_REQUIRED_MESSAGE,
      },
    });

    const refusal: unknown =
      await FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId,
        incidentId,
        investigationRunId,
        userId,
        props: PERSON,
      }).catch((error: unknown) => {
        return error;
      });

    expect(refusal).toBeInstanceOf(PaymentRequiredException);
    expect((refusal as Error).message).toBe(CODE_TASK_PLAN_REQUIRED_MESSAGE);
  });

  test("a pick they may read but not ask AI in: refused in the rule's words, nothing written", async () => {
    jest
      .spyOn(CodeFixPersonRepository, "checkRepositoryPick")
      .mockResolvedValue(
        new NotAuthorizedException(PICKED_REPOSITORY_NOT_ASKABLE_MESSAGE),
      );
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId,
        incidentId,
        investigationRunId,
        userId,
        props: PERSON,
        repositoryId: new ObjectID(OTHER_REPOSITORY_ID),
      }),
    ).rejects.toThrow(PICKED_REPOSITORY_NOT_ASKABLE_MESSAGE);
    expect(create).not.toHaveBeenCalled();
  });

  test("several theirs, and the monitor names none: asked to pick, in the incident's words", async () => {
    jest
      .spyOn(CodeFixPersonRepository, "getUsableRepositories")
      .mockResolvedValue({
        connectedCount: 3,
        usable: [usableRepository(), usableRepository(OTHER_REPOSITORY_ID)],
        allowance: {
          isEveryRepository: false,
          repositoryIds: [REPOSITORY_ID, OTHER_REPOSITORY_ID],
        },
      });
    jest.spyOn(CodeFixStartGate, "check").mockResolvedValue({
      codeRepositoryId: null,
      blocker: null,
    });
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId,
        incidentId,
        investigationRunId,
        userId,
        props: PERSON,
      }),
    ).rejects.toThrow(PICK_A_REPOSITORY_FOR_THE_CODE_FIX_MESSAGES.incident);
    expect(create).not.toHaveBeenCalled();
  });

  test("the pick taken is the one the run is queued on and held to, as the database writes it", async () => {
    jest
      .spyOn(CodeFixPersonRepository, "checkRepositoryPick")
      .mockResolvedValue(null);
    jest.spyOn(CodeFixStartGate, "check").mockResolvedValue({
      codeRepositoryId: new ObjectID(OTHER_REPOSITORY_ID),
      blocker: null,
    });
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);

    await FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
      projectId,
      incidentId,
      investigationRunId,
      userId,
      props: PERSON,
      repositoryId: new ObjectID(OTHER_REPOSITORY_ID.toUpperCase()),
    });

    const run: AIRun = (create.mock.calls[0]![0] as { data: AIRun }).data;
    expect(run.codeRepositoryId?.toString()).toBe(OTHER_REPOSITORY_ID);
    expect(run.taskContext?.pickedCodeRepositoryId).toBe(OTHER_REPOSITORY_ID);
    // The investigation's snapshot is kept beside the pin.
    expect(run.taskContext?.sourceInvestigationRunId).toBe(
      investigationRunId.toString(),
    );
  });
});
