import TelemetryExceptionService from "../../../Server/Services/TelemetryExceptionService";
import AIService, {
  AI_DISABLED_MESSAGE,
} from "../../../Server/Services/AIService";
import FixRunBudget from "../../../Server/Utils/AI/CodeFix/FixRunBudget";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import ServiceService from "../../../Server/Services/ServiceService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import CodeRepositoryRunnerChoice from "../../../Server/Utils/AI/CodeFix/CodeRepositoryRunnerChoice";
import AIRunService from "../../../Server/Services/AIRunService";
import AIAgentTaskPullRequestService from "../../../Server/Services/AIAgentTaskPullRequestService";
import { RepoResolution } from "../../../Server/Utils/CodeRepository/StackTraceRepoResolver";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import TelemetryService from "../../../Models/DatabaseModels/Service";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import AIRunType from "../../../Types/AI/AIRunType";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  CodeRepositoryRunnerChoiceKind,
  CodeWorker,
  CodeWorkerKind,
} from "../../../Types/Runner/CodeRepositoryRunner";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * "Fix with AI Agent" on the AIRun substrate: creation records a Queued
 * CodeFix run carrying triggeredByTelemetryExceptionId (the link table is
 * gone) and the task recipe (codeFixTaskType), and the duplicate guard
 * blocks a second run of the SAME recipe while one is still in a
 * non-terminal status — per (exception, taskType), so a live FixException
 * run does not block queuing a WriteRegressionTest run and vice versa.
 * Recipes that are declared but not yet user-triggerable are rejected
 * before any run is created.
 */

const projectId: ObjectID = ObjectID.generate();
const exceptionId: ObjectID = ObjectID.generate();
const serviceId: ObjectID = ObjectID.generate();

function fakeException(
  overrides: Partial<TelemetryException> = {},
): TelemetryException {
  return {
    id: exceptionId,
    projectId: projectId,
    primaryEntityId: serviceId,
    message: "Failed to charge card for user 123",
    exceptionType: "PaymentError",
    stackTrace: "at charge (/app/src/billing/charge.ts:12:5)",
    isResolved: false,
    isArchived: false,
    ...overrides,
  } as unknown as TelemetryException;
}

// The repository the exception resolves to.
const resolvedRepositoryId: ObjectID = ObjectID.generate();

function fakeResolution(): RepoResolution {
  return {
    codeRepositoryId: resolvedRepositoryId.toString(),
    organizationName: "acme",
    repositoryName: "checkout",
    servicePathInRepository: null,
    method: "stack-trace",
    evidence: "Matched src/billing/charge.ts in acme/checkout",
  };
}

// All three readiness checks pass; run creation is gated only by the guard.
function mockReadinessOk(): void {
  jest
    .spyOn(TelemetryExceptionService, "findOneById")
    .mockResolvedValue(fakeException());
  jest
    .spyOn(LlmProviderService, "getLlmProviderForMeteredAgentPath")
    .mockResolvedValue({
      id: ObjectID.generate(),
      name: "BYO",
    } as unknown as LlmProvider);
  jest.spyOn(ServiceService, "findOneById").mockResolvedValue({
    id: serviceId,
    name: "checkout",
  } as unknown as TelemetryService);
  jest
    .spyOn(CodeRepositoryService, "resolveRepositoryForException")
    .mockResolvedValue(fakeResolution());
  /*
   * The resolved repository picks no Runner, and a global Runner for code
   * is online to take its work (CodeRepositoryRunnerChoice, which has its
   * own suite).
   */
  jest.spyOn(CodeRepositoryService, "findOneBy").mockResolvedValue({
    id: resolvedRepositoryId,
  } as unknown as CodeRepository);
  jest
    .spyOn(CodeRepositoryRunnerChoice, "getStatusForRepository")
    .mockResolvedValue({
      decision: { kind: CodeRepositoryRunnerChoiceKind.Global },
      isOnline: true,
    });
  /*
   * The llmProvider check also gates on the daily autonomous token budget
   * (AI_CODE_FIX_FEATURE is autonomous, so executeWithLogging enforces it).
   * Default it to unset — this suite is about the duplicate guard, and the
   * budget has its own suite (AIServiceDailyBudget.test.ts).
   */
  jest.spyOn(AIService, "getAutonomousDailyBudgetStatus").mockResolvedValue({
    exhausted: false,
    limitInTokens: null,
    usedTokensToday: 0,
  });

  /*
   * Cross-group duplicate guard collaborators: no non-terminal runs and no
   * open AI pull requests unless a test overrides these. findBy on the
   * exception service itself is only reached when candidates exist.
   */
  jest.spyOn(AIRunService, "findBy").mockResolvedValue([]);
  jest.spyOn(AIAgentTaskPullRequestService, "findBy").mockResolvedValue([]);
}

describe("TelemetryExceptionService.createCodeFixRunForException", () => {
  beforeEach(() => {
    // The daily fix-run budget has its own suite (FixRunBudget.test.ts).
    jest.spyOn(FixRunBudget, "assertWithinBudget").mockResolvedValue();
    // AI on: the switch's own refusal is held below.
    jest.spyOn(AIService, "assertProjectAIEnabled").mockResolvedValue();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("AI switched off for the project: refused in the switch's own words, before the budget, the readiness probes or any run", async () => {
    mockReadinessOk();
    jest
      .spyOn(AIService, "assertProjectAIEnabled")
      .mockRejectedValue(new BadDataException(AI_DISABLED_MESSAGE));
    const budget: jest.SpyInstance = jest.spyOn(
      FixRunBudget,
      "assertWithinBudget",
    );
    const readiness: jest.SpyInstance = jest.spyOn(
      TelemetryExceptionService,
      "getAIFixReadiness",
    );
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      TelemetryExceptionService.createCodeFixRunForException({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      }),
    ).rejects.toThrow(AI_DISABLED_MESSAGE);

    expect(AIService.assertProjectAIEnabled).toHaveBeenCalledWith(projectId);
    expect(budget).not.toHaveBeenCalled();
    expect(readiness).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test("records a Queued CodeFix AIRun carrying the triggering exception", async () => {
    mockReadinessOk();

    // Duplicate guard finds nothing.
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);
    const createdId: ObjectID = ObjectID.generate();
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue({ id: createdId } as unknown as AIRun);

    const run: AIRun =
      await TelemetryExceptionService.createCodeFixRunForException({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      });

    expect(run.id).toBe(createdId);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: projectId,
          runType: AIRunType.CodeFix,
          status: AIRunStatus.Queued,
          triggeredByTelemetryExceptionId: exceptionId,
          // New rows are stamped explicitly; only legacy rows are null.
          codeFixTaskType: CodeFixTaskType.FixException,
          /*
           * Queued on the repository the exception resolved to, so the
           * Runner that repository picks is the one that takes it.
           */
          codeRepositoryId: resolvedRepositoryId,
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
  });

  test("the run's Runner is the resolved repository's: its readiness asks about that repository's Runner", async () => {
    mockReadinessOk();
    const pickedRunnerId: ObjectID = ObjectID.generate();
    jest.spyOn(CodeRepositoryService, "findOneBy").mockResolvedValue({
      id: resolvedRepositoryId,
      runnerId: pickedRunnerId,
    } as unknown as CodeRepository);
    const status: jest.SpyInstance = jest
      .spyOn(CodeRepositoryRunnerChoice, "getStatusForRepository")
      .mockResolvedValue({
        decision: {
          kind: CodeRepositoryRunnerChoiceKind.Custom,
          runnerId: pickedRunnerId.toString(),
        },
        isOnline: false,
        runnerName: "prod-eu-runner",
      });
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      TelemetryExceptionService.createCodeFixRunForException({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      }),
    ).rejects.toThrow(/Runner online/);

    expect(status).toHaveBeenCalledWith({
      projectId: projectId,
      runnerId: pickedRunnerId,
    });
    // The picked Runner is offline: no run that would only wait is queued.
    expect(create).not.toHaveBeenCalled();
  });

  test("over the daily fix-run budget: rejects BEFORE the readiness probes, nothing created", async () => {
    mockReadinessOk();

    jest
      .spyOn(FixRunBudget, "assertWithinBudget")
      .mockRejectedValue(
        new BadDataException(
          "The project's daily AI fix task limit has been reached",
        ),
      );
    const readinessProbe: jest.SpyInstance = jest.spyOn(
      LlmProviderService,
      "getLlmProviderForMeteredAgentPath",
    );
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      TelemetryExceptionService.createCodeFixRunForException({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      }),
    ).rejects.toThrow(/daily AI fix task limit/);

    // Budget is the cheaper gate — the readiness checks never ran.
    expect(readinessProbe).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test("duplicate guard: an active (non-terminal) run for the exception blocks creation", async () => {
    mockReadinessOk();

    const findActiveRun: jest.SpyInstance = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      TelemetryExceptionService.createCodeFixRunForException({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      }),
    ).rejects.toThrow(/already in progress/);

    expect(create).not.toHaveBeenCalled();
    // The guard queries by run type + triggering exception, not a link table.
    expect(findActiveRun).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          runType: AIRunType.CodeFix,
          triggeredByTelemetryExceptionId: exceptionId,
        }),
      }),
    );
  });

  test("duplicate guard is per task type: an active FixException run blocks another FixException but not a WriteRegressionTest", async () => {
    mockReadinessOk();

    /*
     * The guard queries codeFixTaskType per recipe: WriteRegressionTest as
     * the plain enum value, FixException as a null-inclusive operator
     * (legacy rows predate the column). Simulate a live FixException run
     * and nothing else.
     */
    jest
      .spyOn(AIRunService, "findOneBy")
      .mockImplementation(
        async (findOneBy: FindOneBy<AIRun>): Promise<AIRun | null> => {
          if (
            findOneBy.query.codeFixTaskType ===
            CodeFixTaskType.WriteRegressionTest
          ) {
            return null;
          }

          return { id: ObjectID.generate() } as unknown as AIRun;
        },
      );

    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);

    // The same recipe is blocked while its run is live...
    await expect(
      TelemetryExceptionService.createCodeFixRunForException({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
        taskType: CodeFixTaskType.FixException,
      }),
    ).rejects.toThrow(/already in progress/);
    expect(create).not.toHaveBeenCalled();

    // ...but a different recipe for the same exception is not.
    await expect(
      TelemetryExceptionService.createCodeFixRunForException({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
        taskType: CodeFixTaskType.WriteRegressionTest,
      }),
    ).resolves.toBeDefined();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          codeFixTaskType: CodeFixTaskType.WriteRegressionTest,
          triggeredByTelemetryExceptionId: exceptionId,
        }),
      }),
    );
  });

  test("rejects task recipes that are not user-triggerable yet, before touching anything", async () => {
    const findOneBy: jest.SpyInstance = jest.spyOn(AIRunService, "findOneBy");
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      TelemetryExceptionService.createCodeFixRunForException({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
        taskType: CodeFixTaskType.ImproveInstrumentation,
      }),
    ).rejects.toThrow(/not user-triggerable yet/);

    expect(findOneBy).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test("attributes the run to the requesting user when one is present", async () => {
    mockReadinessOk();

    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);

    const userId: ObjectID = ObjectID.generate();

    await TelemetryExceptionService.createCodeFixRunForException({
      telemetryExceptionId: exceptionId,
      props: { isRoot: true, userId },
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId }),
      }),
    );
  });

  test("rejects resolved and archived exceptions server-side", async () => {
    mockReadinessOk();
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    jest
      .spyOn(TelemetryExceptionService, "findOneById")
      .mockResolvedValue(fakeException({ isResolved: true }));

    await expect(
      TelemetryExceptionService.createCodeFixRunForException({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      }),
    ).rejects.toThrow(/marked as resolved/);

    jest
      .spyOn(TelemetryExceptionService, "findOneById")
      .mockResolvedValue(fakeException({ isArchived: true }));

    await expect(
      TelemetryExceptionService.createCodeFixRunForException({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      }),
    ).rejects.toThrow(/archived/);

    expect(create).not.toHaveBeenCalled();
  });

  test("a declined AI fix (aiFixDeclinedAt) blocks the automatic lane but a user click clears the stamp and proceeds", async () => {
    mockReadinessOk();

    jest
      .spyOn(TelemetryExceptionService, "findOneById")
      .mockResolvedValue(fakeException({ aiFixDeclinedAt: new Date() }));
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);
    const clearStamp: jest.SpyInstance = jest
      .spyOn(TelemetryExceptionService, "updateOneById")
      .mockResolvedValue(undefined as never);

    // System-triggered (no userId): blocked.
    await expect(
      TelemetryExceptionService.createCodeFixRunForException({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      }),
    ).rejects.toThrow(/closed without merging/);
    expect(create).not.toHaveBeenCalled();

    // A human click: clears the stamp and creates the run.
    await expect(
      TelemetryExceptionService.createCodeFixRunForException({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true, userId: ObjectID.generate() },
      }),
    ).resolves.toBeDefined();

    expect(clearStamp).toHaveBeenCalledWith(
      expect.objectContaining({
        id: exceptionId,
        data: expect.objectContaining({ aiFixDeclinedAt: null }),
      }),
    );
    expect(create).toHaveBeenCalled();
  });

  test("the decline stamp is scoped to FixException: other recipes are neither blocked by it nor clear it", async () => {
    mockReadinessOk();

    jest
      .spyOn(TelemetryExceptionService, "findOneById")
      .mockResolvedValue(fakeException({ aiFixDeclinedAt: new Date() }));
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);
    const exceptionUpdates: jest.SpyInstance = jest
      .spyOn(TelemetryExceptionService, "updateOneById")
      .mockResolvedValue(undefined as never);

    /*
     * A user asking for a regression TEST on a group whose FIX a human
     * declined: the test run proceeds, and — critically — the fix-decline
     * suppression stays in force (the user never overrode the fix).
     */
    await expect(
      TelemetryExceptionService.createCodeFixRunForException({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true, userId: ObjectID.generate() },
        taskType: CodeFixTaskType.WriteRegressionTest,
      }),
    ).resolves.toBeDefined();

    expect(create).toHaveBeenCalled();
    expect(exceptionUpdates).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ aiFixDeclinedAt: null }),
      }),
    );
  });

  test("cross-group duplicate guard: a similar exception (same type + normalized message) with an active run blocks creation", async () => {
    mockReadinessOk();

    /*
     * The observed flood shape: one throw site interpolating a different
     * UUID per request splinters into one fingerprint (and one exception
     * group) per value. Normalization collapses both messages to
     * `...uuid: "<UUID>"`, which is what the guard compares.
     */
    jest.spyOn(TelemetryExceptionService, "findOneById").mockResolvedValue(
      fakeException({
        message:
          'invalid input syntax for type uuid: "550e8400-e29b-41d4-a716-446655440000"',
        exceptionType: "QueryFailedError",
      }),
    );

    // Per-exception guard finds nothing for THIS exception...
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);

    /*
     * ...but another exception group — same root cause, different
     * interpolated value — has a non-terminal FixException run.
     */
    const similarExceptionId: ObjectID = ObjectID.generate();
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([
      {
        triggeredByTelemetryExceptionId: similarExceptionId,
      } as unknown as AIRun,
    ]);
    jest.spyOn(TelemetryExceptionService, "findBy").mockResolvedValue([
      {
        _id: similarExceptionId.toString(),
        message:
          'invalid input syntax for type uuid: "123e4567-e89b-12d3-a456-426614174000"',
        exceptionType: "QueryFailedError",
      } as unknown as TelemetryException,
    ]);

    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      TelemetryExceptionService.createCodeFixRunForException({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      }),
    ).rejects.toThrow(/similar exception/);

    expect(create).not.toHaveBeenCalled();
  });

  test("cross-group duplicate guard: a DIFFERENT normalized message does not block", async () => {
    mockReadinessOk();

    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);

    const otherExceptionId: ObjectID = ObjectID.generate();
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([
      {
        triggeredByTelemetryExceptionId: otherExceptionId,
      } as unknown as AIRun,
    ]);
    jest.spyOn(TelemetryExceptionService, "findBy").mockResolvedValue([
      {
        _id: otherExceptionId.toString(),
        message: "Connection refused to redis",
        exceptionType: "ConnectionError",
      } as unknown as TelemetryException,
    ]);

    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);

    await expect(
      TelemetryExceptionService.createCodeFixRunForException({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
      }),
    ).resolves.toBeDefined();

    expect(create).toHaveBeenCalled();
  });
});

/*
 * Started for a finding of Exceptions' AI section (ExceptionInsightFix): the
 * run links the finding that started it and the provider the AI rules
 * picked, resolves only among the repositories the rules allow, and is
 * queued as it is in a repository a person picked - so Code lists it with
 * why it was opened, and the Runner of the right repository takes it.
 */
describe("TelemetryExceptionService.createCodeFixRunForException - from an exception finding", () => {
  beforeEach(() => {
    jest.spyOn(FixRunBudget, "assertWithinBudget").mockResolvedValue();
    jest.spyOn(AIService, "assertProjectAIEnabled").mockResolvedValue();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the run links the finding that started it, and the provider its AI rules picked", async () => {
    mockReadinessOk();
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);
    const insightId: ObjectID = ObjectID.generate();
    const llmProviderId: ObjectID = ObjectID.generate();

    await TelemetryExceptionService.createCodeFixRunForException({
      telemetryExceptionId: exceptionId,
      props: { isRoot: true },
      taskType: CodeFixTaskType.ImproveExceptionHandling,
      triggeredByAiInsightId: insightId,
      llmProviderId,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          codeFixTaskType: CodeFixTaskType.ImproveExceptionHandling,
          triggeredByTelemetryExceptionId: exceptionId,
          triggeredByAiInsightId: insightId,
          llmProviderId,
        }),
      }),
    );
  });

  test("left out, neither is written - the exception page's own run is as it was", async () => {
    mockReadinessOk();
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);

    await TelemetryExceptionService.createCodeFixRunForException({
      telemetryExceptionId: exceptionId,
      props: { isRoot: true },
    });

    const run: AIRun = create.mock.calls[0][0].data as AIRun;

    expect(run.triggeredByAiInsightId).toBeUndefined();
    expect(run.llmProviderId).toBeUndefined();
  });

  test("the rules' repositories bound where the exception may resolve; left out, any", async () => {
    mockReadinessOk();
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);
    jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);
    const resolve: jest.SpyInstance = jest
      .spyOn(CodeRepositoryService, "resolveRepositoryForException")
      .mockResolvedValue(fakeResolution());
    const allowance: {
      isEveryRepository: boolean;
      repositoryIds: Array<string>;
    } = {
      isEveryRepository: false,
      repositoryIds: [resolvedRepositoryId.toString()],
    };

    await TelemetryExceptionService.createCodeFixRunForException({
      telemetryExceptionId: exceptionId,
      props: { isRoot: true },
      codeRepositoryAllowance: allowance,
    });

    expect(resolve).toHaveBeenLastCalledWith(
      expect.objectContaining({
        projectId,
        stackTrace: "at charge (/app/src/billing/charge.ts:12:5)",
        serviceName: "checkout",
        allowance,
      }),
    );

    await TelemetryExceptionService.createCodeFixRunForException({
      telemetryExceptionId: exceptionId,
      props: { isRoot: true },
    });

    expect(resolve.mock.calls[1][0]).not.toHaveProperty("allowance");
  });

  test("none of the rules' repositories holds the code: refused, nothing queued", async () => {
    mockReadinessOk();
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);
    jest
      .spyOn(CodeRepositoryService, "resolveRepositoryForException")
      .mockResolvedValue(null);
    // With no repository, the Runner check asks about the project's.
    jest
      .spyOn(CodeRepositoryRunnerChoice, "isAnyRunnerOnlineForProject")
      .mockResolvedValue(true);
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      TelemetryExceptionService.createCodeFixRunForException({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true },
        codeRepositoryAllowance: {
          isEveryRepository: false,
          repositoryIds: [ObjectID.generate().toString()],
        },
      }),
    ).rejects.toThrow(/Repository resolved/);
    expect(create).not.toHaveBeenCalled();
  });

  test("a repository a person picked is the run's as it is - nothing resolved", async () => {
    mockReadinessOk();
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);
    const resolve: jest.SpyInstance = jest.spyOn(
      CodeRepositoryService,
      "resolveRepositoryForException",
    );
    const pickedId: ObjectID = ObjectID.generate();
    const findRepository: jest.SpyInstance = jest
      .spyOn(CodeRepositoryService, "findOneBy")
      .mockImplementation(async (data: unknown) => {
        const query: { _id: string; projectId: ObjectID } = (
          data as { query: { _id: string; projectId: ObjectID } }
        ).query;

        return {
          id: new ObjectID(query._id.toString()),
          organizationName: "acme",
          repositoryName: "payments",
        } as unknown as CodeRepository;
      });

    await TelemetryExceptionService.createCodeFixRunForException({
      telemetryExceptionId: exceptionId,
      props: { isRoot: true, userId: ObjectID.generate() },
      codeRepositoryId: pickedId,
    });

    expect(resolve).not.toHaveBeenCalled();
    // The picked repository is read as the project's own.
    expect(findRepository).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { _id: pickedId.toString(), projectId },
        props: { isRoot: true },
      }),
    );
    expect(
      (create.mock.calls[0][0].data as AIRun).codeRepositoryId?.toString(),
    ).toBe(pickedId.toString());
  });

  test("a picked repository that is not the project's: refused, nothing queued", async () => {
    mockReadinessOk();
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);
    jest.spyOn(CodeRepositoryService, "findOneBy").mockResolvedValue(null);
    jest
      .spyOn(CodeRepositoryRunnerChoice, "isAnyRunnerOnlineForProject")
      .mockResolvedValue(true);
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      TelemetryExceptionService.createCodeFixRunForException({
        telemetryExceptionId: exceptionId,
        props: { isRoot: true, userId: ObjectID.generate() },
        codeRepositoryId: ObjectID.generate(),
      }),
    ).rejects.toThrow(/Repository resolved/);
    expect(create).not.toHaveBeenCalled();
  });
});

/*
 * The worker dispatches its task handler on the claimed run's taskType
 * (POST /ai-agent-task/get-pending-task), so the claim must normalize the
 * legacy null column to FixException before the run leaves the service.
 */
describe("AIRunService.claimNextQueuedCodeFixRun task recipe", () => {
  // Who claims; the candidate query always names one (see AIRunCodeFixClaim).
  const WORKER: CodeWorker = {
    kind: CodeWorkerKind.GlobalRunner,
    id: new ObjectID("0a1b2c3d-8888-4222-8333-944455556666"),
  };

  beforeEach(() => {
    jest
      .spyOn(AIRunService, "findNextClaimableCodeFixRunId")
      .mockResolvedValue("0a1b2c3d-9999-4222-8333-944455556666");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function fakeQueuedRun(codeFixTaskType?: CodeFixTaskType): AIRun {
    return {
      id: ObjectID.generate(),
      projectId: projectId,
      triggeredByTelemetryExceptionId: exceptionId,
      attemptCount: 0,
      codeFixTaskType: codeFixTaskType,
    } as unknown as AIRun;
  }

  test("a claimed legacy run (null codeFixTaskType) carries FixException", async () => {
    jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(fakeQueuedRun(undefined));
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);

    const claimed: AIRun | null = await AIRunService.claimNextQueuedCodeFixRun({
      worker: WORKER,
      aiAgentId: ObjectID.generate(),
    });

    expect(claimed).not.toBeNull();
    expect(claimed?.codeFixTaskType).toBe(CodeFixTaskType.FixException);
  });

  test("a claimed run keeps its explicit task recipe", async () => {
    jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(fakeQueuedRun(CodeFixTaskType.WriteRegressionTest));
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);

    const claimed: AIRun | null = await AIRunService.claimNextQueuedCodeFixRun({
      worker: WORKER,
      aiAgentId: ObjectID.generate(),
    });

    expect(claimed?.codeFixTaskType).toBe(CodeFixTaskType.WriteRegressionTest);
  });
});
