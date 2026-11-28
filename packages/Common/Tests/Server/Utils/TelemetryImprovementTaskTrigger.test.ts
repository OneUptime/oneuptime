import TelemetryImprovementTaskTrigger from "../../../Server/Utils/AI/SRE/TelemetryImprovementTaskTrigger";
import SubjectCodeFixRun from "../../../Server/Utils/AI/SRE/SubjectCodeFixRun";
import ServiceService from "../../../Server/Services/ServiceService";
import Service from "../../../Models/DatabaseModels/Service";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import AIService, {
  AI_DISABLED_MESSAGE,
} from "../../../Server/Services/AIService";
import SuggestionOffer from "../../../Utils/Suggestions/SuggestionOffer";
import {
  PICK_A_REPOSITORY_FOR_THE_IMPROVEMENT_MESSAGE,
  TelemetryImprovementSuggestion,
} from "../../../Utils/Suggestions/TelemetryImprovementSuggestion";
import CodeFixStartGate, {
  CodeFixStart,
} from "../../../Server/Utils/AI/CodeFix/CodeFixStartGate";
import {
  CODE_TASK_PLAN_REQUIRED_MESSAGE,
  CODE_TASK_SUBSCRIPTION_UNPAID_MESSAGE,
} from "../../../Server/Utils/AI/CodeTask/CodeTaskGate";
import {
  CodeTaskBlocker,
  CodeTaskBlockerType,
} from "../../../Types/AI/CodeTask";
import CodeFixTaskContext from "../../../Types/AI/CodeFixTaskContext";
import CodeTaskThread from "../../../Server/Utils/AI/CodeTask/CodeTaskThread";
import CodeFixPersonRepository, {
  CodeFixRepositoryUse,
} from "../../../Server/Utils/AI/CodeFix/CodeFixPersonRepository";
import { ResolvableRepository } from "../../../Server/Utils/CodeRepository/StackTraceRepoResolver";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  CodeRepositoryAllowance,
  EVERY_CODE_REPOSITORY,
  NO_CODE_REPOSITORY,
} from "../../../Types/CodeRepository/CodeRepositoryAllowance";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { NO_REPOSITORY_YOU_MAY_USE_MESSAGE } from "../../../Utils/Suggestions/CodeFixRepositoryPick";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * The service-scoped instrumentation-improvement triggers (ImproveLogging /
 * ImproveTracing): human-triggered, so every unmet gate fails EARLY with a
 * clear message — unsupported recipe, AI switched off, missing/foreign
 * service, no GitHub-App repository, a duplicate active run for the same
 * service, or what Code's own gate says about the repository the run will
 * be queued on (CodeFixStartGate: the plan, AI credits or an LLM provider,
 * the daily AI limit, a Runner online). The service's page asks
 * getSuggestion first, and draws the card exactly when those gates would
 * let the click through.
 */

const GATE_REPOSITORY_ID: ObjectID = new ObjectID(
  "50000000-0000-4000-8000-000000000005",
);

// What Code's gate says when no Runner is online for the repository.
const NO_RUNNER: CodeTaskBlocker = {
  type: CodeTaskBlockerType.NoAgent,
  message: "No global Runner is online to work in this repository.",
};

function gateSays(
  blocker: CodeTaskBlocker | null,
  codeRepositoryId: ObjectID | null = GATE_REPOSITORY_ID,
): jest.SpyInstance {
  return jest
    .spyOn(CodeFixStartGate, "check")
    .mockResolvedValue({ codeRepositoryId, blocker } as CodeFixStart);
}

function aiSwitch(isOn: boolean): void {
  jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(isOn);
  if (isOn) {
    jest.spyOn(AIService, "assertProjectAIEnabled").mockResolvedValue();
  } else {
    jest
      .spyOn(AIService, "assertProjectAIEnabled")
      .mockRejectedValue(new BadDataException(AI_DISABLED_MESSAGE));
  }
}

const projectId: ObjectID = ObjectID.generate();
const telemetryServiceId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

// Who clicked Improve Logging or Improve Tracing, as their request reads.
const PERSON: DatabaseCommonInteractionProps = {
  userId,
  tenantId: projectId,
};

const OTHER_REPOSITORY_ID: string = "60000000-0000-4000-8000-000000000006";

function usableRepository(
  id: string = GATE_REPOSITORY_ID.toString(),
  name: string = "checkout",
): ResolvableRepository {
  return {
    id,
    name,
    organizationName: "acme",
    repositoryName: name,
    mainBranchName: "main",
    gitHubAppInstallationId: "1234",
  };
}

/*
 * The connected repositories the person may use in Code (#11209): the one
 * Code's gate is asked about, unless a test says otherwise.
 */
function personMayUse(
  use: CodeFixRepositoryUse = {
    connectedCount: 1,
    usable: [usableRepository()],
    allowance: EVERY_CODE_REPOSITORY,
  },
): jest.SpyInstance {
  return jest
    .spyOn(CodeFixPersonRepository, "getUsableRepositories")
    .mockResolvedValue(use);
}

function mockService(overrides: Partial<Service> = {}): void {
  jest.spyOn(ServiceService, "findOneById").mockResolvedValue({
    id: telemetryServiceId,
    name: "checkout",
    projectId: projectId,
    ...overrides,
  } as unknown as Service);
}

describe("TelemetryImprovementTaskTrigger.createTelemetryImprovementTask", () => {
  beforeEach(() => {
    aiSwitch(true);
    jest
      .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
      .mockResolvedValue(true);
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalRunForTelemetryService")
      .mockResolvedValue(null);
    gateSays(null);
    personMayUse();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("rejects non-improvement recipes before touching anything", async () => {
    const findService: jest.SpyInstance = jest.spyOn(
      ServiceService,
      "findOneById",
    );

    await expect(
      TelemetryImprovementTaskTrigger.createTelemetryImprovementTask({
        projectId,
        telemetryServiceId,
        taskType: CodeFixTaskType.FixException,
        userId,
        props: PERSON,
      }),
    ).rejects.toThrow(/not a telemetry-improvement recipe/);

    expect(findService).not.toHaveBeenCalled();
  });

  test("AI switched off for the project: refused in the switch's own words, before the service is read", async () => {
    aiSwitch(false);
    const findService: jest.SpyInstance = jest.spyOn(
      ServiceService,
      "findOneById",
    );
    const enqueue: jest.SpyInstance = jest.spyOn(
      SubjectCodeFixRun,
      "enqueueSubjectCodeFixRun",
    );

    await expect(
      TelemetryImprovementTaskTrigger.createTelemetryImprovementTask({
        projectId,
        telemetryServiceId,
        taskType: CodeFixTaskType.ImproveLogging,
        userId,
        props: PERSON,
      }),
    ).rejects.toThrow(AI_DISABLED_MESSAGE);

    expect(AIService.assertProjectAIEnabled).toHaveBeenCalledWith(projectId);
    expect(findService).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("rejects a service from another project (root read, explicit tenant check)", async () => {
    mockService({ projectId: ObjectID.generate() });

    await expect(
      TelemetryImprovementTaskTrigger.createTelemetryImprovementTask({
        projectId,
        telemetryServiceId,
        taskType: CodeFixTaskType.ImproveLogging,
        userId,
        props: PERSON,
      }),
    ).rejects.toThrow(/not found/);
  });

  test("rejects when no connected repository exists", async () => {
    mockService();
    jest
      .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
      .mockResolvedValue(false);

    await expect(
      TelemetryImprovementTaskTrigger.createTelemetryImprovementTask({
        projectId,
        telemetryServiceId,
        taskType: CodeFixTaskType.ImproveLogging,
        userId,
        props: PERSON,
      }),
    ).rejects.toThrow(/^No connected repository exists for this project/);
  });

  test("per-(service, recipe) dedupe: an active run for the service blocks a second one", async () => {
    mockService();
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalRunForTelemetryService")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);
    const enqueue: jest.SpyInstance = jest.spyOn(
      SubjectCodeFixRun,
      "enqueueSubjectCodeFixRun",
    );

    await expect(
      TelemetryImprovementTaskTrigger.createTelemetryImprovementTask({
        projectId,
        telemetryServiceId,
        taskType: CodeFixTaskType.ImproveTracing,
        userId,
        props: PERSON,
      }),
    ).rejects.toThrow(/already queued or running/);

    expect(enqueue).not.toHaveBeenCalled();
  });

  test("happy path: enqueues with the service captured in taskContext and the user attributed", async () => {
    mockService();
    const createdRun: AIRun = { id: ObjectID.generate() } as unknown as AIRun;
    const enqueue: jest.SpyInstance = jest
      .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
      .mockResolvedValue(createdRun);

    const run: AIRun =
      await TelemetryImprovementTaskTrigger.createTelemetryImprovementTask({
        projectId,
        telemetryServiceId,
        taskType: CodeFixTaskType.ImproveLogging,
        userId,
        props: PERSON,
      });

    expect(run).toBe(createdRun);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        taskType: CodeFixTaskType.ImproveLogging,
        userId,
        taskContext: expect.objectContaining({
          telemetryServiceId: telemetryServiceId.toString(),
          serviceName: "checkout",
        }),
        // Queued on the repository Code's gate was asked about.
        codeRepositoryId: GATE_REPOSITORY_ID,
      }),
    );
  });

  test("Code's gate is asked about the run as it will be queued: its recipe and the service's name", async () => {
    mockService();
    const check: jest.SpyInstance = gateSays(null);
    jest
      .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);

    await TelemetryImprovementTaskTrigger.createTelemetryImprovementTask({
      projectId,
      telemetryServiceId,
      taskType: CodeFixTaskType.ImproveTracing,
      userId,
      props: PERSON,
    });

    expect(check).toHaveBeenCalledTimes(1);
    const asked: {
      projectId: ObjectID;
      taskType: CodeFixTaskType;
      taskContext: CodeFixTaskContext;
      allowance: CodeRepositoryAllowance;
    } = check.mock.calls[0]![0];
    expect(asked.projectId).toBe(projectId);
    expect(asked.taskType).toBe(CodeFixTaskType.ImproveTracing);
    expect(asked.taskContext).toMatchObject({
      telemetryServiceId: telemetryServiceId.toString(),
      serviceName: "checkout",
    });
    // Resolved among the repositories the person may use (#11209).
    expect(asked.allowance).toEqual(EVERY_CODE_REPOSITORY);
    // The service was read once, for both the gate and the run.
    expect(ServiceService.findOneById).toHaveBeenCalledTimes(1);
  });

  test("no Runner online: refused in Code's words, nothing queued", async () => {
    mockService();
    gateSays(NO_RUNNER);
    const enqueue: jest.SpyInstance = jest.spyOn(
      SubjectCodeFixRun,
      "enqueueSubjectCodeFixRun",
    );

    await expect(
      TelemetryImprovementTaskTrigger.createTelemetryImprovementTask({
        projectId,
        telemetryServiceId,
        taskType: CodeFixTaskType.ImproveLogging,
        userId,
        props: PERSON,
      }),
    ).rejects.toThrow(new BadDataException(NO_RUNNER.message));

    expect(enqueue).not.toHaveBeenCalled();
  });

  test.each([
    [CodeTaskBlockerType.PlanRequired, CODE_TASK_PLAN_REQUIRED_MESSAGE],
    [
      CodeTaskBlockerType.SubscriptionUnpaid,
      CODE_TASK_SUBSCRIPTION_UNPAID_MESSAGE,
    ],
  ])(
    "%s: refused as a payment, the way Code refuses it",
    async (type: CodeTaskBlockerType, message: string) => {
      mockService();
      gateSays({ type, message });

      await expect(
        TelemetryImprovementTaskTrigger.createTelemetryImprovementTask({
          projectId,
          telemetryServiceId,
          taskType: CodeFixTaskType.ImproveLogging,
          userId,
          props: PERSON,
        }),
      ).rejects.toThrow(PaymentRequiredException);
    },
  );

  test("a run in flight is said before what Code's gate says", async () => {
    mockService();
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalRunForTelemetryService")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);
    const check: jest.SpyInstance = gateSays(NO_RUNNER);

    await expect(
      TelemetryImprovementTaskTrigger.createTelemetryImprovementTask({
        projectId,
        telemetryServiceId,
        taskType: CodeFixTaskType.ImproveTracing,
        userId,
        props: PERSON,
      }),
    ).rejects.toThrow(/already queued or running/);

    expect(check).not.toHaveBeenCalled();
  });

  /*
   * A run queued without a repository used to find none when it started,
   * and failed: now the person's one repository is the run's, and two or
   * more of theirs that the service's name matches none of ask for a pick
   * first (#11209).
   */
  test("no repository resolves by the service's name, and one is the person's: queued on it, and held to it", async () => {
    mockService();
    gateSays(null, null);
    const enqueue: jest.SpyInstance = jest
      .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);

    await TelemetryImprovementTaskTrigger.createTelemetryImprovementTask({
      projectId,
      telemetryServiceId,
      taskType: CodeFixTaskType.ImproveLogging,
      userId,
      props: PERSON,
    });

    const queued: {
      codeRepositoryId: ObjectID;
      taskContext: CodeFixTaskContext;
    } = enqueue.mock.calls[0]![0];
    expect(queued.codeRepositoryId.toString()).toBe(
      GATE_REPOSITORY_ID.toString(),
    );
    expect(queued.taskContext.pickedCodeRepositoryId).toBe(
      GATE_REPOSITORY_ID.toString(),
    );
  });

  test("no repository resolves by the service's name, and several are the person's: asked to pick, nothing queued", async () => {
    mockService();
    gateSays(null, null);
    personMayUse({
      connectedCount: 3,
      usable: [
        usableRepository(),
        usableRepository(OTHER_REPOSITORY_ID, "ledger"),
      ],
      allowance: {
        isEveryRepository: false,
        repositoryIds: [GATE_REPOSITORY_ID.toString(), OTHER_REPOSITORY_ID],
      },
    });
    const enqueue: jest.SpyInstance = jest.spyOn(
      SubjectCodeFixRun,
      "enqueueSubjectCodeFixRun",
    );

    await expect(
      TelemetryImprovementTaskTrigger.createTelemetryImprovementTask({
        projectId,
        telemetryServiceId,
        taskType: CodeFixTaskType.ImproveLogging,
        userId,
        props: PERSON,
      }),
    ).rejects.toThrow(
      new BadDataException(PICK_A_REPOSITORY_FOR_THE_IMPROVEMENT_MESSAGE),
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("none of the connected repositories the person's: refused, saying who can help - nothing queued", async () => {
    mockService();
    personMayUse({
      connectedCount: 2,
      usable: [],
      allowance: NO_CODE_REPOSITORY,
    });
    const enqueue: jest.SpyInstance = jest.spyOn(
      SubjectCodeFixRun,
      "enqueueSubjectCodeFixRun",
    );

    const refusal: unknown =
      await TelemetryImprovementTaskTrigger.createTelemetryImprovementTask({
        projectId,
        telemetryServiceId,
        taskType: CodeFixTaskType.ImproveTracing,
        userId,
        props: PERSON,
      }).catch((error: unknown) => {
        return error;
      });

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect((refusal as Error).message).toBe(NO_REPOSITORY_YOU_MAY_USE_MESSAGE);
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("the plan is said first, as a payment, before why the person may use none", async () => {
    mockService();
    personMayUse({
      connectedCount: 2,
      usable: [],
      allowance: NO_CODE_REPOSITORY,
    });
    gateSays(
      {
        type: CodeTaskBlockerType.PlanRequired,
        message: CODE_TASK_PLAN_REQUIRED_MESSAGE,
      },
      null,
    );

    await expect(
      TelemetryImprovementTaskTrigger.createTelemetryImprovementTask({
        projectId,
        telemetryServiceId,
        taskType: CodeFixTaskType.ImproveLogging,
        userId,
        props: PERSON,
      }),
    ).rejects.toThrow(PaymentRequiredException);
  });

  test("the person's repositories are weighed under their own props, after the service and dedupe gates", async () => {
    mockService();
    const usable: jest.SpyInstance = personMayUse();
    const inFlight: jest.SpyInstance = jest.spyOn(
      SubjectCodeFixRun,
      "findNonTerminalRunForTelemetryService",
    );
    jest
      .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);

    await TelemetryImprovementTaskTrigger.createTelemetryImprovementTask({
      projectId,
      telemetryServiceId,
      taskType: CodeFixTaskType.ImproveLogging,
      userId,
      props: PERSON,
    });

    expect(usable.mock.calls[0]![0]).toEqual({ projectId, props: PERSON });
    expect(usable.mock.invocationCallOrder[0]).toBeGreaterThan(
      inFlight.mock.invocationCallOrder[0]!,
    );
  });

  test("a pick is asked about by itself, and the run is held to it", async () => {
    mockService();
    const check: jest.SpyInstance = jest
      .spyOn(CodeFixPersonRepository, "checkRepositoryPick")
      .mockResolvedValue(null);
    const usable: jest.SpyInstance = personMayUse();
    gateSays(null, new ObjectID(OTHER_REPOSITORY_ID));
    const enqueue: jest.SpyInstance = jest
      .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);

    await TelemetryImprovementTaskTrigger.createTelemetryImprovementTask({
      projectId,
      telemetryServiceId,
      taskType: CodeFixTaskType.ImproveLogging,
      userId,
      props: PERSON,
      repositoryId: new ObjectID(OTHER_REPOSITORY_ID),
    });

    expect(check.mock.calls[0]![0]).toMatchObject({
      projectId,
      props: PERSON,
    });
    // A pick is never looked for among a list of the person's repositories.
    expect(usable).not.toHaveBeenCalled();
    expect(
      (enqueue.mock.calls[0]![0] as { taskContext: CodeFixTaskContext })
        .taskContext.pickedCodeRepositoryId,
    ).toBe(OTHER_REPOSITORY_ID);
  });
});

describe("TelemetryImprovementTaskTrigger.getSuggestion (what a service's page offers)", () => {
  // Who reads the service's page: a member, who may read the task unless a test says.
  const READER: DatabaseCommonInteractionProps = {
    userId,
    tenantId: projectId,
  };
  let hiddenTaskIds: Set<string>;
  let hiddenFrom: jest.SpyInstance;

  beforeEach(() => {
    hiddenTaskIds = new Set<string>();
    hiddenFrom = jest
      .spyOn(CodeTaskThread, "findTasksHiddenFrom")
      .mockImplementation(async () => {
        return hiddenTaskIds;
      });
    personMayUse();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function suggest(
    taskType: CodeFixTaskType = CodeFixTaskType.ImproveLogging,
  ): Promise<TelemetryImprovementSuggestion> {
    return TelemetryImprovementTaskTrigger.getSuggestion({
      projectId,
      telemetryServiceId,
      taskType,
      reader: READER,
    });
  }

  /*
   * A reply someone sent in Code keeps the improvement on its way (#9882):
   * and one that carried a private incident or alert into the task, which
   * the person may not open, is there - no second card - and nothing of
   * it, not even the link.
   */
  test("an improvement on its way in a task hidden from the person: nothing, and no link", async () => {
    aiSwitch(true);
    const taskId: ObjectID = ObjectID.generate();
    const reply: AIRun = new AIRun();
    reply.id = ObjectID.generate();
    reply.codeTaskId = taskId;
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalRunForTelemetryService")
      .mockResolvedValue(reply);
    hiddenTaskIds = new Set<string>([taskId.toString().toLowerCase()]);
    const check: jest.SpyInstance = gateSays(null);

    expect(await suggest()).toEqual({
      offer: SuggestionOffer.None,
      aiRunId: null,
      repositories: [],
    });
    // Asked of the task (a reply's is its first turn), for the person.
    expect(hiddenFrom).toHaveBeenCalledWith({
      projectId,
      taskIds: [taskId],
      reader: READER,
    });
    expect(check).not.toHaveBeenCalled();
  });

  test("a reply working on the improvement in a task the person may read: a link to its task", async () => {
    aiSwitch(true);
    const taskId: ObjectID = ObjectID.generate();
    const reply: AIRun = new AIRun();
    reply.id = ObjectID.generate();
    reply.codeTaskId = taskId;
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalRunForTelemetryService")
      .mockResolvedValue(reply);

    expect(await suggest()).toEqual({
      offer: SuggestionOffer.InProgress,
      aiRunId: taskId.toString(),
      repositories: [],
    });
  });

  test("nothing on its way: no task's sight is asked", async () => {
    aiSwitch(true);
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalRunForTelemetryService")
      .mockResolvedValue(null);
    jest
      .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
      .mockResolvedValue(true);
    mockService();
    gateSays(null);

    expect((await suggest()).offer).toBe(SuggestionOffer.Act);
    expect(hiddenFrom).not.toHaveBeenCalled();
  });

  test("a recipe that is not a logging or tracing improvement: nothing, nothing read", async () => {
    const isEnabled: jest.SpyInstance = jest.spyOn(
      AIService,
      "isProjectAIEnabled",
    );

    expect(await suggest(CodeFixTaskType.FixException)).toEqual({
      offer: SuggestionOffer.None,
      aiRunId: null,
      repositories: [],
    });
    expect(isEnabled).not.toHaveBeenCalled();
  });

  test("AI off: nothing, and no repository or run is read", async () => {
    aiSwitch(false);
    const repository: jest.SpyInstance = jest.spyOn(
      SubjectCodeFixRun,
      "hasConnectedRepository",
    );
    const run: jest.SpyInstance = jest.spyOn(
      SubjectCodeFixRun,
      "findNonTerminalRunForTelemetryService",
    );

    expect((await suggest()).offer).toBe(SuggestionOffer.None);
    expect(repository).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  test("no repository: nothing - no setup link on every page of every service", async () => {
    aiSwitch(true);
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalRunForTelemetryService")
      .mockResolvedValue(null);
    jest
      .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
      .mockResolvedValue(false);

    expect((await suggest()).offer).toBe(SuggestionOffer.None);
  });

  test("a repository and nothing in flight: the card", async () => {
    aiSwitch(true);
    mockService();
    gateSays(null);
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalRunForTelemetryService")
      .mockResolvedValue(null);
    jest
      .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
      .mockResolvedValue(true);

    expect(await suggest(CodeFixTaskType.ImproveTracing)).toEqual({
      offer: SuggestionOffer.Act,
      aiRunId: null,
      repositories: [],
    });
  });

  test.each([
    ["no Runner is online", NO_RUNNER],
    [
      "the plan does not include AI in Code",
      {
        type: CodeTaskBlockerType.PlanRequired,
        message: CODE_TASK_PLAN_REQUIRED_MESSAGE,
      },
    ],
  ])(
    "Code's gate says %s: no card - never a set-up step on every page of every service",
    async (_label: string, blocker: CodeTaskBlocker) => {
      aiSwitch(true);
      mockService();
      gateSays(blocker);
      jest
        .spyOn(SubjectCodeFixRun, "findNonTerminalRunForTelemetryService")
        .mockResolvedValue(null);
      jest
        .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
        .mockResolvedValue(true);

      expect(await suggest()).toEqual({
        offer: SuggestionOffer.None,
        aiRunId: null,
        repositories: [],
      });
    },
  );

  test("Code's gate is asked with the service's name, read as OneUptime", async () => {
    aiSwitch(true);
    mockService({ name: "payments-api" });
    const check: jest.SpyInstance = gateSays(null);
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalRunForTelemetryService")
      .mockResolvedValue(null);
    jest
      .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
      .mockResolvedValue(true);

    await suggest(CodeFixTaskType.ImproveLogging);

    expect(ServiceService.findOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: telemetryServiceId,
        props: { isRoot: true },
      }),
    );
    expect(check.mock.calls[0]![0]).toMatchObject({
      projectId,
      taskType: CodeFixTaskType.ImproveLogging,
      taskContext: {
        telemetryServiceId: telemetryServiceId.toString(),
        serviceName: "payments-api",
      },
    });
  });

  test("no repository, or a run in flight: Code's gate is not asked", async () => {
    aiSwitch(true);
    const check: jest.SpyInstance = gateSays(NO_RUNNER);
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalRunForTelemetryService")
      .mockResolvedValue(null);
    jest
      .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
      .mockResolvedValue(false);

    expect((await suggest()).offer).toBe(SuggestionOffer.None);

    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalRunForTelemetryService")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);

    expect((await suggest()).offer).toBe(SuggestionOffer.InProgress);
    expect(check).not.toHaveBeenCalled();
  });

  test("the same improvement already on its way: a link to it, and the repository is not asked about", async () => {
    aiSwitch(true);
    const activeRun: AIRun = { id: ObjectID.generate() } as unknown as AIRun;
    const run: jest.SpyInstance = jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalRunForTelemetryService")
      .mockResolvedValue(activeRun);
    const repository: jest.SpyInstance = jest.spyOn(
      SubjectCodeFixRun,
      "hasConnectedRepository",
    );

    expect(await suggest(CodeFixTaskType.ImproveTracing)).toEqual({
      offer: SuggestionOffer.InProgress,
      aiRunId: activeRun.id!.toString(),
      repositories: [],
    });
    expect(run).toHaveBeenCalledWith({
      projectId,
      taskType: CodeFixTaskType.ImproveTracing,
      telemetryServiceId: telemetryServiceId.toString(),
    });
    expect(repository).not.toHaveBeenCalled();
  });

  /*
   * The card is drawn exactly when the create route would accept the click:
   * every AI setting, repository, run in flight and word from Code's gate,
   * both recipes.
   */
  const cases: Array<
    [string, CodeFixTaskType, boolean, boolean, boolean, boolean]
  > = [];
  for (const taskType of [
    CodeFixTaskType.ImproveLogging,
    CodeFixTaskType.ImproveTracing,
  ]) {
    for (const isAiOn of [true, false]) {
      for (const hasRepository of [true, false]) {
        for (const hasActiveRun of [true, false]) {
          for (const isBlocked of [true, false]) {
            cases.push([
              `${taskType}, AI ${isAiOn ? "on" : "off"}, ${hasRepository ? "a repository" : "no repository"}, ${hasActiveRun ? "a run in flight" : "no run"}, ${isBlocked ? "Code's gate says no" : "nothing in the way"}`,
              taskType,
              isAiOn,
              hasRepository,
              hasActiveRun,
              isBlocked,
            ]);
          }
        }
      }
    }
  }

  test.each(cases)(
    "the server agrees with the page: %s",
    async (
      _title: string,
      taskType: CodeFixTaskType,
      isAiOn: boolean,
      hasRepository: boolean,
      hasActiveRun: boolean,
      isBlocked: boolean,
    ) => {
      aiSwitch(isAiOn);
      mockService();
      gateSays(isBlocked ? NO_RUNNER : null);
      jest
        .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
        .mockResolvedValue(hasRepository);
      jest
        .spyOn(SubjectCodeFixRun, "findNonTerminalRunForTelemetryService")
        .mockResolvedValue(
          hasActiveRun
            ? ({ id: ObjectID.generate() } as unknown as AIRun)
            : null,
        );
      jest
        .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
        .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);

      const suggestion: TelemetryImprovementSuggestion =
        await suggest(taskType);

      let created: boolean = true;
      try {
        await TelemetryImprovementTaskTrigger.createTelemetryImprovementTask({
          projectId,
          telemetryServiceId,
          taskType,
          userId,
          props: PERSON,
        });
      } catch {
        created = false;
      }

      expect(suggestion.offer === SuggestionOffer.Act).toBe(created);
    },
  );
});

/*
 * WHO THE CARD IS OFFERED TO, AND WITH WHICH REPOSITORIES (#11209): the
 * improvement is a code task on the person's behalf, held to the
 * repositories they may use in Code, so the card is drawn by that rule.
 */
describe("TelemetryImprovementTaskTrigger.getSuggestion, by the reader's repositories", () => {
  const READER: DatabaseCommonInteractionProps = {
    userId,
    tenantId: projectId,
  };

  beforeEach(() => {
    aiSwitch(true);
    mockService();
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalRunForTelemetryService")
      .mockResolvedValue(null);
    jest
      .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
      .mockResolvedValue(true);
    jest
      .spyOn(CodeTaskThread, "findTasksHiddenFrom")
      .mockResolvedValue(new Set<string>());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function suggest(): Promise<TelemetryImprovementSuggestion> {
    return TelemetryImprovementTaskTrigger.getSuggestion({
      projectId,
      telemetryServiceId,
      taskType: CodeFixTaskType.ImproveLogging,
      reader: READER,
    });
  }

  test("none of the connected repositories theirs: no card, and Code's gate is not asked", async () => {
    personMayUse({
      connectedCount: 2,
      usable: [],
      allowance: NO_CODE_REPOSITORY,
    });
    const check: jest.SpyInstance = gateSays(null);

    expect(await suggest()).toEqual({
      offer: SuggestionOffer.None,
      aiRunId: null,
      repositories: [],
    });
    expect(check).not.toHaveBeenCalled();
  });

  test("none OneUptime AI can work in after all: no card", async () => {
    personMayUse({
      connectedCount: 0,
      usable: [],
      allowance: NO_CODE_REPOSITORY,
    });
    const check: jest.SpyInstance = gateSays(null);

    expect((await suggest()).offer).toBe(SuggestionOffer.None);
    expect(check).not.toHaveBeenCalled();
  });

  test("their repositories are weighed for the reader, and Code's gate resolves the run among them", async () => {
    const allowance: CodeRepositoryAllowance = {
      isEveryRepository: false,
      repositoryIds: [GATE_REPOSITORY_ID.toString()],
    };
    const usable: jest.SpyInstance = personMayUse({
      connectedCount: 2,
      usable: [usableRepository()],
      allowance,
    });
    const check: jest.SpyInstance = gateSays(null);

    expect((await suggest()).offer).toBe(SuggestionOffer.Act);
    expect(usable.mock.calls[0]![0]).toEqual({ projectId, props: READER });
    expect(check.mock.calls[0]![0]).toMatchObject({ allowance });
  });

  test("several theirs, and the service's name matches none: the card, with the ones to pick from, by name", async () => {
    personMayUse({
      connectedCount: 3,
      usable: [
        usableRepository(OTHER_REPOSITORY_ID, "ledger"),
        usableRepository(),
      ],
      allowance: {
        isEveryRepository: false,
        repositoryIds: [OTHER_REPOSITORY_ID, GATE_REPOSITORY_ID.toString()],
      },
    });
    gateSays(null, null);

    expect(await suggest()).toEqual({
      offer: SuggestionOffer.Act,
      aiRunId: null,
      repositories: [
        { id: GATE_REPOSITORY_ID.toString(), name: "checkout" },
        { id: OTHER_REPOSITORY_ID, name: "ledger" },
      ],
    });
  });

  test("one theirs: the card asks no pick", async () => {
    personMayUse();
    gateSays(null, null);

    expect((await suggest()).repositories).toEqual([]);
  });

  test("the service's name matches one of theirs: no pick", async () => {
    personMayUse({
      connectedCount: 2,
      usable: [
        usableRepository(OTHER_REPOSITORY_ID, "ledger"),
        usableRepository(),
      ],
      allowance: EVERY_CODE_REPOSITORY,
    });
    gateSays(null);

    expect((await suggest()).repositories).toEqual([]);
  });

  test("Code's gate in the way: no card, and no pick", async () => {
    personMayUse({
      connectedCount: 2,
      usable: [
        usableRepository(OTHER_REPOSITORY_ID, "ledger"),
        usableRepository(),
      ],
      allowance: EVERY_CODE_REPOSITORY,
    });
    gateSays(NO_RUNNER, null);

    expect(await suggest()).toEqual({
      offer: SuggestionOffer.None,
      aiRunId: null,
      repositories: [],
    });
  });

  test("an improvement on its way: the reader's repositories are not weighed", async () => {
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalRunForTelemetryService")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);
    const usable: jest.SpyInstance = personMayUse();

    expect((await suggest()).offer).toBe(SuggestionOffer.InProgress);
    expect(usable).not.toHaveBeenCalled();
  });
});
