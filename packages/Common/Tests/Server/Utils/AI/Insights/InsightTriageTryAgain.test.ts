import InsightTriage, {
  INSIGHT_TRIAGE_NOT_ENQUEUED_MESSAGES,
  InsightTriageNotEnqueuedReason,
} from "../../../../../Server/Utils/AI/SRE/Insights/Triage";
import AIInvestigationQueue from "../../../../../Server/Utils/AI/SRE/InvestigationQueue";
import ProjectService from "../../../../../Server/Services/ProjectService";
import LlmProviderService from "../../../../../Server/Services/LlmProviderService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import AIInsightService from "../../../../../Server/Services/AIInsightService";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import LlmProvider from "../../../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../../../Models/DatabaseModels/Project";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Try again for an AI insight's triage (issue #6438): only a triage that did
 * not finish, through the scanner's own gates, with the LLM provider the
 * last run used, linked to the insight - and every refusal in words the
 * person can act on.
 */

const projectId: ObjectID = ObjectID.generate();
const insightId: ObjectID = ObjectID.generate();
const lastRunId: ObjectID = ObjectID.generate();
const newRunId: ObjectID = ObjectID.generate();
const ruleProviderId: ObjectID = ObjectID.generate();

function insightWithTriage(triageAiRunId: ObjectID | undefined): void {
  jest.spyOn(AIInsightService, "findOneById").mockResolvedValue({
    id: insightId,
    projectId,
    triageAiRunId,
  } as unknown as AIInsight);
}

function lastRunIs(
  status: AIRunStatus | null,
  llmProviderId?: ObjectID,
): jest.SpyInstance {
  return jest
    .spyOn(AIRunService, "findOneById")
    .mockResolvedValue(
      status
        ? ({ id: lastRunId, status, llmProviderId } as unknown as AIRun)
        : null,
    );
}

describe("InsightTriage.tryAgain", () => {
  let enqueue: jest.SpyInstance;
  let link: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      enableAiInsights: true,
    } as unknown as Project);
    jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as LlmProvider);
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    enqueue = jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockResolvedValue(newRunId);
    link = jest
      .spyOn(AIInsightService, "updateOneById")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([AIRunStatus.Error, AIRunStatus.Stale, AIRunStatus.Cancelled])(
    "a triage that is %s runs again, and the insight links to the new run",
    async (status: AIRunStatus) => {
      insightWithTriage(lastRunId);
      lastRunIs(status);

      await expect(InsightTriage.tryAgain({ insightId })).resolves.toBe(
        newRunId,
      );

      expect(enqueue).toHaveBeenCalledWith({
        projectId,
        subjectAIInsightId: insightId,
      });
      expect(link).toHaveBeenCalledWith(
        expect.objectContaining({
          id: insightId,
          data: { triageAiRunId: newRunId },
        }),
      );
    },
  );

  test("the LLM provider the last run used is the new run's: a rule's pick holds", async () => {
    insightWithTriage(lastRunId);
    lastRunIs(AIRunStatus.Error, ruleProviderId);
    const projectProvider: jest.SpyInstance = jest.spyOn(
      LlmProviderService,
      "getLLMProviderForProject",
    );

    await InsightTriage.tryAgain({ insightId });

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ llmProviderId: ruleProviderId }),
    );
    // The rule's pick is decided on when the run starts, as the scanner's.
    expect(projectProvider).not.toHaveBeenCalled();
  });

  test("an insight that is gone says so", async () => {
    jest.spyOn(AIInsightService, "findOneById").mockResolvedValue(null);

    await expect(InsightTriage.tryAgain({ insightId })).rejects.toThrow(
      INSIGHT_TRIAGE_NOT_ENQUEUED_MESSAGES[
        InsightTriageNotEnqueuedReason.NotFound
      ],
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("an insight never triaged has nothing to try again", async () => {
    insightWithTriage(undefined);
    const findRun: jest.SpyInstance = lastRunIs(null);

    await expect(InsightTriage.tryAgain({ insightId })).rejects.toThrow(
      "Only a triage that did not finish can be tried again.",
    );
    expect(findRun).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  test.each([AIRunStatus.Queued, AIRunStatus.Running])(
    "a triage that is %s is not started twice",
    async (status: AIRunStatus) => {
      insightWithTriage(lastRunId);
      lastRunIs(status);

      await expect(InsightTriage.tryAgain({ insightId })).rejects.toThrow(
        "This insight is being triaged already.",
      );
      expect(enqueue).not.toHaveBeenCalled();
    },
  );

  test("a triage that completed is not tried again", async () => {
    insightWithTriage(lastRunId);
    lastRunIs(AIRunStatus.Completed);

    await expect(InsightTriage.tryAgain({ insightId })).rejects.toThrow(
      "Only a triage that did not finish can be tried again.",
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("its run row gone: nothing to try again", async () => {
    insightWithTriage(lastRunId);
    lastRunIs(null);

    await expect(InsightTriage.tryAgain({ insightId })).rejects.toThrow(
      "Only a triage that did not finish can be tried again.",
    );
  });

  test.each([
    [
      "AI off for the project",
      (): void => {
        jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
          id: projectId,
          enableAi: false,
          enableAiInsights: true,
        } as unknown as Project);
      },
      InsightTriageNotEnqueuedReason.AiOff,
    ],
    [
      "AI Insights switched off",
      (): void => {
        jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
          id: projectId,
          enableAiInsights: false,
        } as unknown as Project);
      },
      InsightTriageNotEnqueuedReason.SwitchOff,
    ],
    [
      "no LLM provider",
      (): void => {
        jest
          .spyOn(LlmProviderService, "getLLMProviderForProject")
          .mockResolvedValue(null);
      },
      InsightTriageNotEnqueuedReason.NoProvider,
    ],
    [
      "a triage already queued (the dedupe)",
      (): void => {
        jest
          .spyOn(AIRunService, "countBy")
          .mockResolvedValue(new PositiveNumber(1));
      },
      InsightTriageNotEnqueuedReason.AlreadyRunning,
    ],
    [
      "the day's AI budget used up",
      (): void => {
        jest.spyOn(AIInvestigationQueue, "enqueue").mockResolvedValue(null);
      },
      InsightTriageNotEnqueuedReason.NotQueued,
    ],
    [
      "a read that fails on the way",
      (): void => {
        jest
          .spyOn(AIRunService, "countBy")
          .mockRejectedValue(new Error("db down"));
      },
      InsightTriageNotEnqueuedReason.Failed,
    ],
  ])(
    "%s: refused, saying what to do",
    async (
      _name: string,
      arrange: () => void,
      reason: InsightTriageNotEnqueuedReason,
    ) => {
      insightWithTriage(lastRunId);
      lastRunIs(AIRunStatus.Error);
      arrange();

      const failure: Promise<ObjectID> = InsightTriage.tryAgain({ insightId });

      await expect(failure).rejects.toBeInstanceOf(BadDataException);
      await expect(failure).rejects.toThrow(
        INSIGHT_TRIAGE_NOT_ENQUEUED_MESSAGES[reason],
      );
    },
  );

  test("every refusal has words, and the ones a setting fixes name where", () => {
    for (const reason of Object.values(InsightTriageNotEnqueuedReason)) {
      expect(INSIGHT_TRIAGE_NOT_ENQUEUED_MESSAGES[reason]).toBeTruthy();
    }

    // AI's own switch, and the provider, are in Project Settings.
    expect(
      INSIGHT_TRIAGE_NOT_ENQUEUED_MESSAGES[
        InsightTriageNotEnqueuedReason.AiOff
      ],
    ).toContain("Project Settings > AI > AI Features");
    expect(
      INSIGHT_TRIAGE_NOT_ENQUEUED_MESSAGES[
        InsightTriageNotEnqueuedReason.NoProvider
      ],
    ).toContain("Project Settings > AI > LLM Providers");
    /*
     * By the name that page gives it: an LLM provider, never an "AI
     * provider", which no setting is called (#6738).
     */
    expect(
      INSIGHT_TRIAGE_NOT_ENQUEUED_MESSAGES[
        InsightTriageNotEnqueuedReason.NoProvider
      ],
    ).toBe(
      "This project has no LLM provider to triage with. Add one in Project Settings > AI > LLM Providers, then try again.",
    );
    for (const reason of Object.values(InsightTriageNotEnqueuedReason)) {
      expect(INSIGHT_TRIAGE_NOT_ENQUEUED_MESSAGES[reason]).not.toMatch(
        /\bAI providers?\b/i,
      );
    }
    // AI Insights' switch is on its own Settings page, not Project Settings.
    expect(
      INSIGHT_TRIAGE_NOT_ENQUEUED_MESSAGES[
        InsightTriageNotEnqueuedReason.SwitchOff
      ],
    ).toContain("Watch telemetry for problems in AI → Insights → Settings");
  });

  /*
   * Said to whoever pressed Try again, who may not be one of the people who
   * can change the setting: it names who can, as the switches' update
   * permissions let them (the Project model).
   */
  test("a switch only some may flip names who can flip it", () => {
    expect(
      INSIGHT_TRIAGE_NOT_ENQUEUED_MESSAGES[
        InsightTriageNotEnqueuedReason.AiOff
      ],
    ).toContain(
      "A project owner or someone with Manage Billing can turn it on",
    );
    expect(
      INSIGHT_TRIAGE_NOT_ENQUEUED_MESSAGES[
        InsightTriageNotEnqueuedReason.SwitchOff
      ],
    ).toContain("A project owner or admin can turn on");
  });
});
