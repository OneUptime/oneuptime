import TelemetryImprovementTaskTrigger from "../../../Server/Utils/AI/SRE/TelemetryImprovementTaskTrigger";
import SubjectCodeFixRun from "../../../Server/Utils/AI/SRE/SubjectCodeFixRun";
import ServiceService from "../../../Server/Services/ServiceService";
import Service from "../../../Models/DatabaseModels/Service";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * The service-scoped instrumentation-improvement triggers (ImproveLogging /
 * ImproveTracing): human-triggered, so every unmet gate fails EARLY with a
 * clear message — unsupported recipe, missing/foreign service, no
 * GitHub-App repository, or a duplicate active run for the same service.
 */

const projectId: ObjectID = ObjectID.generate();
const telemetryServiceId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

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
    jest
      .spyOn(SubjectCodeFixRun, "hasGitHubAppConnectedRepository")
      .mockResolvedValue(true);
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalRunForTelemetryService")
      .mockResolvedValue(null);
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
      }),
    ).rejects.toThrow(/not a telemetry-improvement recipe/);

    expect(findService).not.toHaveBeenCalled();
  });

  test("rejects a service from another project (root read, explicit tenant check)", async () => {
    mockService({ projectId: ObjectID.generate() });

    await expect(
      TelemetryImprovementTaskTrigger.createTelemetryImprovementTask({
        projectId,
        telemetryServiceId,
        taskType: CodeFixTaskType.ImproveLogging,
        userId,
      }),
    ).rejects.toThrow(/not found/);
  });

  test("rejects when no GitHub-App-connected repository exists", async () => {
    mockService();
    jest
      .spyOn(SubjectCodeFixRun, "hasGitHubAppConnectedRepository")
      .mockResolvedValue(false);

    await expect(
      TelemetryImprovementTaskTrigger.createTelemetryImprovementTask({
        projectId,
        telemetryServiceId,
        taskType: CodeFixTaskType.ImproveLogging,
        userId,
      }),
    ).rejects.toThrow(/GitHub-App-connected repository/);
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
      }),
    );
  });
});
