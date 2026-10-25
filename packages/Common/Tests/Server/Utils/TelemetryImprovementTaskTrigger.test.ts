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
import { TelemetryImprovementSuggestion } from "../../../Utils/Suggestions/TelemetryImprovementSuggestion";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * The service-scoped instrumentation-improvement triggers (ImproveLogging /
 * ImproveTracing): human-triggered, so every unmet gate fails EARLY with a
 * clear message — unsupported recipe, AI switched off, missing/foreign
 * service, no GitHub-App repository, or a duplicate active run for the same
 * service. The service's page asks getSuggestion first, and draws the card
 * exactly when those gates would let the click through.
 */

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

describe("TelemetryImprovementTaskTrigger.getSuggestion (what a service's page offers)", () => {
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
    });
  }

  test("a recipe that is not a logging or tracing improvement: nothing, nothing read", async () => {
    const isEnabled: jest.SpyInstance = jest.spyOn(
      AIService,
      "isProjectAIEnabled",
    );

    expect(await suggest(CodeFixTaskType.FixException)).toEqual({
      offer: SuggestionOffer.None,
      aiRunId: null,
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
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalRunForTelemetryService")
      .mockResolvedValue(null);
    jest
      .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
      .mockResolvedValue(true);

    expect(await suggest(CodeFixTaskType.ImproveTracing)).toEqual({
      offer: SuggestionOffer.Act,
      aiRunId: null,
    });
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
   * every AI setting, repository and run in flight, both recipes.
   */
  const cases: Array<[string, CodeFixTaskType, boolean, boolean, boolean]> = [];
  for (const taskType of [
    CodeFixTaskType.ImproveLogging,
    CodeFixTaskType.ImproveTracing,
  ]) {
    for (const isAiOn of [true, false]) {
      for (const hasRepository of [true, false]) {
        for (const hasActiveRun of [true, false]) {
          cases.push([
            `${taskType}, AI ${isAiOn ? "on" : "off"}, ${hasRepository ? "a repository" : "no repository"}, ${hasActiveRun ? "a run in flight" : "no run"}`,
            taskType,
            isAiOn,
            hasRepository,
            hasActiveRun,
          ]);
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
    ) => {
      aiSwitch(isAiOn);
      mockService();
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
        });
      } catch {
        created = false;
      }

      expect(suggestion.offer === SuggestionOffer.Act).toBe(created);
    },
  );
});
