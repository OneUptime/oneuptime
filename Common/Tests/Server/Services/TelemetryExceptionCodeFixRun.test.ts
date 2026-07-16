import TelemetryExceptionService from "../../../Server/Services/TelemetryExceptionService";
import AIService from "../../../Server/Services/AIService";
import FixRunBudget from "../../../Server/Utils/AI/CodeFix/FixRunBudget";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import ServiceService from "../../../Server/Services/ServiceService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import AIAgentService from "../../../Server/Services/AIAgentService";
import AIRunService from "../../../Server/Services/AIRunService";
import { RepoResolution } from "../../../Server/Utils/CodeRepository/StackTraceRepoResolver";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import TelemetryService from "../../../Models/DatabaseModels/Service";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIAgent, {
  AIAgentConnectionStatus,
} from "../../../Models/DatabaseModels/AIAgent";
import AIRunType from "../../../Types/AI/AIRunType";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
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

function fakeException(): TelemetryException {
  return {
    id: exceptionId,
    projectId: projectId,
    primaryEntityId: serviceId,
    stackTrace: "at charge (/app/src/billing/charge.ts:12:5)",
  } as unknown as TelemetryException;
}

function fakeResolution(): RepoResolution {
  return {
    codeRepositoryId: ObjectID.generate().toString(),
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
  jest.spyOn(AIAgentService, "getAIAgentForProject").mockResolvedValue({
    id: ObjectID.generate(),
    name: "agent",
    connectionStatus: AIAgentConnectionStatus.Connected,
  } as unknown as AIAgent);
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
}

describe("TelemetryExceptionService.createCodeFixRunForException", () => {
  beforeEach(() => {
    // The daily fix-run budget has its own suite (FixRunBudget.test.ts).
    jest.spyOn(FixRunBudget, "assertWithinBudget").mockResolvedValue();
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
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
});

/*
 * The worker dispatches its task handler on the claimed run's taskType
 * (POST /ai-agent-task/get-pending-task), so the claim must normalize the
 * legacy null column to FixException before the run leaves the service.
 */
describe("AIRunService.claimNextQueuedCodeFixRun task recipe", () => {
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
      aiAgentId: ObjectID.generate(),
    });

    expect(claimed?.codeFixTaskType).toBe(CodeFixTaskType.WriteRegressionTest);
  });
});
