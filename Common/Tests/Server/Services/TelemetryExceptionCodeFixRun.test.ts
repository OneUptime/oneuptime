import TelemetryExceptionService from "../../../Server/Services/TelemetryExceptionService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import ServiceService from "../../../Server/Services/ServiceService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import AIAgentService from "../../../Server/Services/AIAgentService";
import AIRunService from "../../../Server/Services/AIRunService";
import { RepoResolution } from "../../../Server/Utils/CodeRepository/StackTraceRepoResolver";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import TelemetryService from "../../../Models/DatabaseModels/Service";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIAgent, {
  AIAgentConnectionStatus,
} from "../../../Models/DatabaseModels/AIAgent";
import AIRunType from "../../../Types/AI/AIRunType";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * "Fix with AI Agent" on the AIRun substrate: creation records a Queued
 * CodeFix run carrying triggeredByTelemetryExceptionId (the link table is
 * gone), and the duplicate guard blocks a second run while one is still in
 * a non-terminal status — the exact invariant that keeps the exception page
 * from stacking concurrent fixes.
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
    .spyOn(LlmProviderService, "getLlmProviderForAgentTasks")
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
}

describe("TelemetryExceptionService.createCodeFixRunForException", () => {
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
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
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
