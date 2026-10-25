import InsightTriage, {
  InsightTriageResult,
} from "../../../../../Server/Utils/AI/SRE/Insights/Triage";
import AIInvestigationQueue from "../../../../../Server/Utils/AI/SRE/InvestigationQueue";
import ProjectService from "../../../../../Server/Services/ProjectService";
import LlmProviderService from "../../../../../Server/Services/LlmProviderService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import AIInsightService from "../../../../../Server/Services/AIInsightService";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import Project from "../../../../../Models/DatabaseModels/Project";
import LlmProvider from "../../../../../Models/DatabaseModels/LlmProvider";
import AIRunType from "../../../../../Types/AI/AIRunType";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * Per-insight LLM triage enqueue. The invariants these tests lock in:
 *   (a) the gates mirror the engine's enablement posture: enableAi must not
 *       be false, Project.enableAiInsights must be EXACTLY true
 *       (strictly true; the column defaults false), and an LLM provider must exist —
 *       each miss is a quiet skip;
 *   (b) dedupe: at most one non-terminal triage run per insight (the
 *       scanner refreshes recurring insights every tick — refreshes must
 *       not fan out into duplicate runs);
 *   (c) the happy path enqueues with subjectAIInsightId (so the
 *       queue stamps triggeredByAiInsightId and dispatch routes to
 *       the triage runner) and persists triageAiRunId onto the insight;
 *   (d) a null enqueue result (the queue's budget quiet-skip) means no
 *       link is written and no id is returned;
 *   (e) enqueueInsightTriage NEVER throws.
 */

const projectId: ObjectID = ObjectID.generate();
const insightId: ObjectID = ObjectID.generate();
const triageRunId: ObjectID = ObjectID.generate();

function makeInsight(): AIInsight {
  return { id: insightId, projectId } as unknown as AIInsight;
}

function mockProject(
  overrides: Record<string, unknown> = {},
): jest.SpyInstance {
  return jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    id: projectId,
    enableAiInsights: true,
    ...overrides,
  } as unknown as Project);
}

function mockProvider(exists: boolean): jest.SpyInstance {
  return jest
    .spyOn(LlmProviderService, "getLLMProviderForProject")
    .mockResolvedValue(
      exists ? ({ id: ObjectID.generate() } as unknown as LlmProvider) : null,
    );
}

function mockNonTerminalTriageRunCount(count: number): jest.SpyInstance {
  return jest
    .spyOn(AIRunService, "countBy")
    .mockResolvedValue(new PositiveNumber(count));
}

describe("InsightTriage.enqueueInsightTriage", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("skips when the project is not found", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(null);
    const enqueue: jest.SpyInstance = jest.spyOn(
      AIInvestigationQueue,
      "enqueue",
    );

    const result: InsightTriageResult =
      await InsightTriage.enqueueInsightTriage({ insight: makeInsight() });

    expect(result).toEqual({});
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("skips when AI is disabled for the project", async () => {
    mockProject({ enableAi: false });
    const enqueue: jest.SpyInstance = jest.spyOn(
      AIInvestigationQueue,
      "enqueue",
    );

    const result: InsightTriageResult =
      await InsightTriage.enqueueInsightTriage({ insight: makeInsight() });

    expect(result).toEqual({});
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("skips unless enableAiInsights is EXACTLY true (strict opt-in)", async () => {
    mockProject({ enableAiInsights: undefined });
    const enqueue: jest.SpyInstance = jest.spyOn(
      AIInvestigationQueue,
      "enqueue",
    );

    const result: InsightTriageResult =
      await InsightTriage.enqueueInsightTriage({ insight: makeInsight() });

    expect(result).toEqual({});
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("skips quietly when no LLM provider is configured", async () => {
    mockProject();
    mockProvider(false);
    const enqueue: jest.SpyInstance = jest.spyOn(
      AIInvestigationQueue,
      "enqueue",
    );

    const result: InsightTriageResult =
      await InsightTriage.enqueueInsightTriage({ insight: makeInsight() });

    expect(result).toEqual({});
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("dedupes: an existing non-terminal triage run for the insight blocks a second one", async () => {
    mockProject();
    mockProvider(true);
    const countBy: jest.SpyInstance = mockNonTerminalTriageRunCount(1);
    const enqueue: jest.SpyInstance = jest.spyOn(
      AIInvestigationQueue,
      "enqueue",
    );

    const result: InsightTriageResult =
      await InsightTriage.enqueueInsightTriage({ insight: makeInsight() });

    expect(result).toEqual({});
    expect(enqueue).not.toHaveBeenCalled();
    // The dedupe key is the provenance column, scoped to Investigation runs.
    expect(countBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          runType: AIRunType.Investigation,
          triggeredByAiInsightId: insightId,
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
  });

  test("happy path: enqueues with subjectAIInsightId and persists triageAiRunId onto the insight", async () => {
    mockProject();
    mockProvider(true);
    mockNonTerminalTriageRunCount(0);
    const enqueue: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockResolvedValue(triageRunId);
    const persist: jest.SpyInstance = jest
      .spyOn(AIInsightService, "updateOneById")
      .mockResolvedValue(1);

    const result: InsightTriageResult =
      await InsightTriage.enqueueInsightTriage({ insight: makeInsight() });

    expect(result).toEqual({ triageAiRunId: triageRunId });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        subjectAIInsightId: insightId,
      }),
    );
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        id: insightId,
        data: expect.objectContaining({ triageAiRunId: triageRunId }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
  });

  test("the queue's budget quiet-skip (null) means no link written and no id returned", async () => {
    mockProject();
    mockProvider(true);
    mockNonTerminalTriageRunCount(0);
    jest.spyOn(AIInvestigationQueue, "enqueue").mockResolvedValue(null);
    const persist: jest.SpyInstance = jest.spyOn(
      AIInsightService,
      "updateOneById",
    );

    const result: InsightTriageResult =
      await InsightTriage.enqueueInsightTriage({ insight: makeInsight() });

    expect(result).toEqual({});
    expect(persist).not.toHaveBeenCalled();
  });

  test("NEVER throws: a gate failure resolves to an empty result", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockRejectedValue(new Error("db down"));

    await expect(
      InsightTriage.enqueueInsightTriage({ insight: makeInsight() }),
    ).resolves.toEqual({});
  });
});

/*
 * A telemetry lane's problem (Types/AI/TelemetryAi - slow code a service's
 * profiles show) is the lane's: its switch is the one that counts, not
 * "Watch telemetry for problems", and the LLM provider its AI rules pick is
 * the run's.
 */
describe("InsightTriage.enqueueInsightTriage - a telemetry lane's problem", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function slowCode(): AIInsight {
    return {
      id: insightId,
      projectId,
      insightType: AIInsightType.ProfileHotspot,
    } as unknown as AIInsight;
  }

  test("the lane's switch decides, read with the project", async () => {
    const findProject: jest.SpyInstance = mockProject({
      enableAiInsights: false,
      enableAutomaticProfileRemediation: true,
    });
    mockProvider(true);
    mockNonTerminalTriageRunCount(0);
    const enqueue: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockResolvedValue(triageRunId);
    jest.spyOn(AIInsightService, "updateOneById").mockResolvedValue(1);

    const result: InsightTriageResult =
      await InsightTriage.enqueueInsightTriage({ insight: slowCode() });

    expect(result).toEqual({ triageAiRunId: triageRunId });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(findProject).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          enableAutomaticProfileRemediation: true,
        }),
      }),
    );
  });

  test("the lane's switch off: no triage, whatever AI Insights says", async () => {
    mockProject({
      enableAiInsights: true,
      enableAutomaticProfileRemediation: false,
    });
    const enqueue: jest.SpyInstance = jest.spyOn(
      AIInvestigationQueue,
      "enqueue",
    );

    await expect(
      InsightTriage.enqueueInsightTriage({ insight: slowCode() }),
    ).resolves.toEqual({});
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("the provider the rules pick is the run's, and decided on when it starts", async () => {
    mockProject({ enableAutomaticProfileRemediation: true });
    const provider: jest.SpyInstance = mockProvider(false);
    mockNonTerminalTriageRunCount(0);
    const enqueue: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockResolvedValue(triageRunId);
    jest.spyOn(AIInsightService, "updateOneById").mockResolvedValue(1);
    const picked: string = "5092eeee-0000-4000-8000-000000000001";

    await InsightTriage.enqueueInsightTriage({
      insight: slowCode(),
      llmProviderId: picked,
    });

    // Not the project's default provider: the run's own pick.
    expect(provider).not.toHaveBeenCalled();
    const call: Record<string, unknown> = enqueue.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(String(call["llmProviderId"])).toBe(picked);
  });

  test("AI off for the project: no triage, lane or not", async () => {
    mockProject({ enableAi: false, enableAutomaticProfileRemediation: true });
    const enqueue: jest.SpyInstance = jest.spyOn(
      AIInvestigationQueue,
      "enqueue",
    );

    await expect(
      InsightTriage.enqueueInsightTriage({ insight: slowCode() }),
    ).resolves.toEqual({});
    expect(enqueue).not.toHaveBeenCalled();
  });
});

/*
 * New and spiking exceptions are shared by Exceptions' AI section and AI
 * Insights: while the section's switch is on, it is the one that counts;
 * while it is off, AI Insights' own switch counts, as it always did. A
 * service's missing stack traces are the section's only.
 */
describe("InsightTriage.enqueueInsightTriage - a kind Exceptions' AI section shares with AI Insights", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function exceptionFinding(insightType: AIInsightType): AIInsight {
    return { id: insightId, projectId, insightType } as unknown as AIInsight;
  }

  async function isEnqueued(data: {
    insightType: AIInsightType;
    enableAiInsights: boolean;
    enableAutomaticExceptionRemediation: boolean;
  }): Promise<boolean> {
    jest.restoreAllMocks();
    const findProject: jest.SpyInstance = mockProject({
      enableAiInsights: data.enableAiInsights,
      enableAutomaticExceptionRemediation:
        data.enableAutomaticExceptionRemediation,
    });
    mockProvider(true);
    mockNonTerminalTriageRunCount(0);
    const enqueue: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockResolvedValue(triageRunId);
    jest.spyOn(AIInsightService, "updateOneById").mockResolvedValue(1);

    await InsightTriage.enqueueInsightTriage({
      insight: exceptionFinding(data.insightType),
    });

    // Read with both switches: either may be the one that counts.
    expect(findProject).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          enableAiInsights: true,
          enableAutomaticExceptionRemediation: true,
        }),
      }),
    );

    return enqueue.mock.calls.length === 1;
  }

  test("the section's switch on: it counts, whatever AI Insights says", async () => {
    for (const insightType of [
      AIInsightType.NewException,
      AIInsightType.ExceptionSpike,
    ]) {
      expect(
        await isEnqueued({
          insightType,
          enableAiInsights: false,
          enableAutomaticExceptionRemediation: true,
        }),
      ).toBe(true);
    }
  });

  test("the section's switch off: AI Insights' switch counts, as it always did", async () => {
    for (const insightType of [
      AIInsightType.NewException,
      AIInsightType.ExceptionSpike,
    ]) {
      expect(
        await isEnqueued({
          insightType,
          enableAiInsights: true,
          enableAutomaticExceptionRemediation: false,
        }),
      ).toBe(true);
      expect(
        await isEnqueued({
          insightType,
          enableAiInsights: false,
          enableAutomaticExceptionRemediation: false,
        }),
      ).toBe(false);
    }
  });

  test("missing stack traces are the section's only: AI Insights' switch never triages them", async () => {
    expect(
      await isEnqueued({
        insightType: AIInsightType.ExceptionMissingStackTrace,
        enableAiInsights: true,
        enableAutomaticExceptionRemediation: false,
      }),
    ).toBe(false);
    expect(
      await isEnqueued({
        insightType: AIInsightType.ExceptionMissingStackTrace,
        enableAiInsights: false,
        enableAutomaticExceptionRemediation: true,
      }),
    ).toBe(true);
  });
});
