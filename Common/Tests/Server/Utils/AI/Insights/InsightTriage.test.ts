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
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * Per-insight LLM triage enqueue. The invariants these tests lock in:
 *   (a) the gates mirror the engine's enablement posture: enableAi must not
 *       be false, Project.enableAiInsights must be EXACTLY true
 *       (strict opt-in, default false), and an LLM provider must exist —
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
      .mockResolvedValue(undefined);

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
