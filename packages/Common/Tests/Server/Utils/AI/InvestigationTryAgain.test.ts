import InvestigationTryAgain, {
  INVESTIGATION_NOT_ENQUEUED_MESSAGE,
} from "../../../../Server/Utils/AI/SRE/InvestigationTryAgain";
import AIInvestigationEngine from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIInvestigationQueue from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import InvestigationRules from "../../../../Server/Utils/AI/SRE/InvestigationRules";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import { InvestigationNotStartedCode } from "../../../../Types/AI/InvestigationNotStartedReason";
import ProjectAiDailyLimits from "../../../../Types/AI/ProjectAiDailyLimits";
import { PROJECT_AI_CREDITS_USED_UP_MESSAGE } from "../../../../Utils/Project/ProjectBalance";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Try again for an incident's or alert's AI investigation (issue #6438):
 * a new run, queued as Ask AI's start_investigation queues one, only for an
 * investigation that did not finish, once, and never past AI being off, a
 * missing provider or the project's limits - each refusal in words the
 * person can act on.
 */

const projectId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();
const alertId: ObjectID = ObjectID.generate();
const newRunId: ObjectID = ObjectID.generate();
const ruleProviderId: ObjectID = ObjectID.generate();

function lastRunIs(status: AIRunStatus | null): jest.SpyInstance {
  const run: AIRun | null = status
    ? ({ id: ObjectID.generate(), status } as unknown as AIRun)
    : null;
  return jest.spyOn(AIRunService, "findBy").mockResolvedValue(run ? [run] : []);
}

describe("InvestigationTryAgain.tryAgain", () => {
  let enqueue: jest.SpyInstance;
  let disabledReason: jest.SpyInstance;
  let liveRunCount: jest.SpyInstance;

  beforeEach(() => {
    enqueue = jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockImplementation(
        async (data: {
          admitInsideSubjectLock?: (() => Promise<boolean>) | undefined;
        }): Promise<ObjectID | null> => {
          // The queue asks inside the subject's lock, as it does for real.
          if (
            data.admitInsideSubjectLock &&
            !(await data.admitInsideSubjectLock())
          ) {
            return null;
          }
          return newRunId;
        },
      );
    disabledReason = jest
      .spyOn(AIInvestigationEngine, "getDisabledReasonForSubject")
      .mockResolvedValue(null);
    jest
      .spyOn(InvestigationRules, "getSubjectLlmProviderId")
      .mockResolvedValue(ruleProviderId);
    liveRunCount = jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([AIRunStatus.Error, AIRunStatus.Stale, AIRunStatus.Cancelled])(
    "an incident investigation that is %s starts again, with the provider its rules pick",
    async (status: AIRunStatus) => {
      lastRunIs(status);

      await expect(
        InvestigationTryAgain.tryAgain({
          projectId,
          subjectType: "incident",
          subjectId: incidentId,
        }),
      ).resolves.toBe(newRunId);

      expect(enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId,
          subjectIncidentId: incidentId,
          llmProviderId: ruleProviderId,
        }),
      );
      expect(enqueue.mock.calls[0]![0]).not.toHaveProperty("subjectAlertId");
    },
  );

  test("an alert's starts again as the alert's, gated on the alert lane", async () => {
    lastRunIs(AIRunStatus.Error);

    await InvestigationTryAgain.tryAgain({
      projectId,
      subjectType: "alert",
      subjectId: alertId,
    });

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ subjectAlertId: alertId }),
    );
    expect(disabledReason).toHaveBeenCalledWith(
      expect.objectContaining({ projectId, subjectType: "Alert" }),
    );
    expect(InvestigationRules.getSubjectLlmProviderId).toHaveBeenCalledWith({
      projectId,
      alertId,
    });
  });

  test("the latest run is the card's: the subject's newest Investigation, in the project", async () => {
    const findBy: jest.SpyInstance = lastRunIs(AIRunStatus.Error);

    await InvestigationTryAgain.tryAgain({
      projectId,
      subjectType: "incident",
      subjectId: incidentId,
    });

    expect(findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          projectId,
          runType: AIRunType.Investigation,
          triggeredByIncidentId: incidentId,
        },
        sort: { createdAt: SortOrder.Descending },
        limit: 1,
        props: { isRoot: true },
      }),
    );
  });

  test("a subject never investigated has nothing to try again", async () => {
    lastRunIs(null);

    await expect(
      InvestigationTryAgain.tryAgain({
        projectId,
        subjectType: "incident",
        subjectId: incidentId,
      }),
    ).rejects.toThrow("This incident has no investigation to try again.");
    expect(enqueue).not.toHaveBeenCalled();
  });

  test.each([
    AIRunStatus.Queued,
    AIRunStatus.Running,
    AIRunStatus.WaitingForApproval,
  ])(
    "an investigation that is %s is not started twice",
    async (status: AIRunStatus) => {
      lastRunIs(status);

      await expect(
        InvestigationTryAgain.tryAgain({
          projectId,
          subjectType: "alert",
          subjectId: alertId,
        }),
      ).rejects.toThrow(
        "This alert's investigation is queued or running already.",
      );
      expect(enqueue).not.toHaveBeenCalled();
    },
  );

  test.each([AIRunStatus.Completed, AIRunStatus.NoFixFound])(
    "an investigation that is %s finished: it is not tried again",
    async (status: AIRunStatus) => {
      lastRunIs(status);

      await expect(
        InvestigationTryAgain.tryAgain({
          projectId,
          subjectType: "incident",
          subjectId: incidentId,
        }),
      ).rejects.toThrow(
        "Only an investigation that did not finish can be tried again.",
      );
      expect(enqueue).not.toHaveBeenCalled();
    },
  );

  test.each([
    [
      "ai_disabled",
      "OneUptime AI is switched off for this project. A project owner or someone with Manage Billing can turn it on in Project Settings > AI > AI Features.",
    ],
    [
      "provider_missing",
      "This project has no LLM provider to investigate with. Add one in Project Settings > AI > LLM Providers, then try again.",
    ],
    // The shared words: who can add AI credits, and where.
    ["insufficient_ai_balance", PROJECT_AI_CREDITS_USED_UP_MESSAGE],
    [
      "project_daily_limit_reached",
      `The project reached its daily AI limit. OneUptime AI starts again at midnight UTC. ${ProjectAiDailyLimits.getWhoCanChangeSentence()}`,
    ],
  ])(
    "%s: refused, saying what to do, and nothing is queued",
    async (code: string, words: string) => {
      lastRunIs(AIRunStatus.Error);
      disabledReason.mockResolvedValue(code as InvestigationNotStartedCode);

      const failure: Promise<ObjectID> = InvestigationTryAgain.tryAgain({
        projectId,
        subjectType: "incident",
        subjectId: incidentId,
      });

      await expect(failure).rejects.toBeInstanceOf(BadDataException);
      await expect(failure).rejects.toThrow(words);
      expect(enqueue).not.toHaveBeenCalled();
    },
  );

  test("the automatic lane's own switch does not stop a person's Try again", async () => {
    lastRunIs(AIRunStatus.Error);
    // A reason the queue's automatic start honours, but a person overrides.
    disabledReason.mockResolvedValue("automatic_investigation_disabled");

    await expect(
      InvestigationTryAgain.tryAgain({
        projectId,
        subjectType: "incident",
        subjectId: incidentId,
      }),
    ).resolves.toBe(newRunId);
  });

  test("the rules' provider is what the gate checks for a missing provider", async () => {
    lastRunIs(AIRunStatus.Error);

    await InvestigationTryAgain.tryAgain({
      projectId,
      subjectType: "incident",
      subjectId: incidentId,
    });

    const gate: {
      getRuleLlmProviderId: () => Promise<ObjectID | undefined>;
    } = disabledReason.mock.calls[0]![0] as {
      getRuleLlmProviderId: () => Promise<ObjectID | undefined>;
    };
    await expect(gate.getRuleLlmProviderId()).resolves.toBe(ruleProviderId);
  });

  test("two people pressing Try again at once start it once", async () => {
    lastRunIs(AIRunStatus.Error);
    // By the time the lock is held, the other press queued its run.
    liveRunCount.mockResolvedValue(new PositiveNumber(1));

    await expect(
      InvestigationTryAgain.tryAgain({
        projectId,
        subjectType: "incident",
        subjectId: incidentId,
      }),
    ).rejects.toThrow(
      "This incident's investigation is queued or running already.",
    );

    // The check inside the lock counts the subject's live Investigations.
    const query: Record<string, unknown> = (
      liveRunCount.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(query).toMatchObject({
      projectId,
      runType: AIRunType.Investigation,
      triggeredByIncidentId: incidentId,
    });
    expect(query["status"]).toBeDefined();
  });

  test("a queue that records nothing (the day's budget) says so", async () => {
    lastRunIs(AIRunStatus.Error);
    enqueue.mockResolvedValue(null);

    await expect(
      InvestigationTryAgain.tryAgain({
        projectId,
        subjectType: "incident",
        subjectId: incidentId,
      }),
    ).rejects.toThrow(
      "The investigation could not start: the project may have reached its daily AI limit, which resets at midnight UTC. Try again later.",
    );
  });

  /*
   * #7157: the record's own daily AI token limit stopped it. Try again
   * names that limit, of the record it was pressed on, and a limit of 0
   * (or below) says it pauses the work until someone raises it: waiting
   * for midnight never lifts it.
   */
  test.each([
    {
      subjectType: "incident" as const,
      limitInTokens: 0,
      message:
        "The Daily Incident AI Token Limit is set to 0, which pauses automatic AI work for incidents. Raise it above 0 under Incidents → AI → Settings → More settings, or clear it, then try again.",
    },
    {
      subjectType: "incident" as const,
      limitInTokens: -7,
      message:
        "The Daily Incident AI Token Limit is set to 0, which pauses automatic AI work for incidents. Raise it above 0 under Incidents → AI → Settings → More settings, or clear it, then try again.",
    },
    {
      subjectType: "incident" as const,
      limitInTokens: 400,
      message:
        "Automatic AI work for incidents used up today's Daily Incident AI Token Limit. Raise or clear it under Incidents → AI → Settings → More settings, or wait until midnight UTC, when it resets. Then try again.",
    },
    {
      subjectType: "alert" as const,
      limitInTokens: 0,
      message:
        "The Daily Alert AI Token Limit is set to 0, which pauses automatic AI work for alerts. Raise it above 0 under Alerts → AI → Settings → More settings, or clear it, then try again.",
    },
    {
      subjectType: "alert" as const,
      limitInTokens: -1,
      message:
        "The Daily Alert AI Token Limit is set to 0, which pauses automatic AI work for alerts. Raise it above 0 under Alerts → AI → Settings → More settings, or clear it, then try again.",
    },
    {
      subjectType: "alert" as const,
      limitInTokens: 400,
      message:
        "Automatic AI work for alerts used up today's Daily Alert AI Token Limit. Raise or clear it under Alerts → AI → Settings → More settings, or wait until midnight UTC, when it resets. Then try again.",
    },
  ])(
    "$subjectType, its daily AI token limit $limitInTokens: Try again names it",
    (data: {
      subjectType: "incident" | "alert";
      limitInTokens: number;
      message: string;
    }) => {
      const message: string = InvestigationTryAgain.getNotEnqueuedMessage({
        subjectType: data.subjectType,
        notEnqueued: {
          code: "daily_budget_exhausted",
          budget: {
            exhausted: true,
            limitInTokens: data.limitInTokens,
            usedTokensToday: data.limitInTokens > 0 ? data.limitInTokens : 0,
          },
        },
      });

      expect(message).toBe(data.message);
      expect(message.includes("midnight")).toBe(data.limitInTokens > 0);
      expect(message).not.toMatch(/project/i);
    },
  );

  test("what the queue said reaches the person who pressed Try again", async () => {
    lastRunIs(AIRunStatus.Error);
    enqueue.mockImplementation(
      async (
        data: Parameters<typeof AIInvestigationQueue.enqueue>[0],
      ): Promise<ObjectID | null> => {
        await data.onNotEnqueued?.("daily_budget_exhausted", {
          exhausted: true,
          limitInTokens: 0,
          usedTokensToday: 0,
        });
        return null;
      },
    );

    await expect(
      InvestigationTryAgain.tryAgain({
        projectId,
        subjectType: "alert",
        subjectId: alertId,
      }),
    ).rejects.toThrow(
      "The Daily Alert AI Token Limit is set to 0, which pauses automatic AI work for alerts. Raise it above 0 under Alerts → AI → Settings → More settings, or clear it, then try again.",
    );
  });

  test("a queue that names no record's limit says what the checks before it say, else the old words", () => {
    expect(
      InvestigationTryAgain.getNotEnqueuedMessage({
        subjectType: "incident",
        notEnqueued: { code: "project_daily_limit_reached" },
      }),
    ).toBe(
      `The project reached its daily AI limit. OneUptime AI starts again at midnight UTC. ${ProjectAiDailyLimits.getWhoCanChangeSentence()}`,
    );
    expect(
      InvestigationTryAgain.getNotEnqueuedMessage({
        subjectType: "incident",
        notEnqueued: { code: "enqueue_failed" },
      }),
    ).toBe(INVESTIGATION_NOT_ENQUEUED_MESSAGE);
    expect(
      InvestigationTryAgain.getNotEnqueuedMessage({
        subjectType: "alert",
        notEnqueued: null,
      }),
    ).toBe(INVESTIGATION_NOT_ENQUEUED_MESSAGE);
  });
});
