import AIInvestigationEngine, {
  InvestigationRequest,
} from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIConfidenceSignal from "../../../../Server/Utils/AI/SRE/ConfidenceSignal";
import InvestigationTldr from "../../../../Server/Utils/AI/SRE/InvestigationTldr";
import ObservabilityAssistant, {
  ObservabilityAssistantResult,
} from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import LlmProviderChoice, {
  RuleLlmProviderChoice,
} from "../../../../Server/Utils/AI/LlmProviderChoice";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIService from "../../../../Server/Services/AIService";
import LlmProviderService from "../../../../Server/Services/LlmProviderService";
import ProjectService from "../../../../Server/Services/ProjectService";
import logger from "../../../../Server/Utils/Logger";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../../Models/DatabaseModels/Project";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import { InvestigationNotStartedCode } from "../../../../Types/AI/InvestigationNotStartedReason";
import {
  LlmProviderFallbackReason,
  LlmProviderSource,
} from "../../../../Types/AI/LlmProviderChoice";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * AN INVESTIGATION OR A REMEDIATION RUN USES THE LLM PROVIDER ITS RULE
 * PICKS (AIInvestigationEngine.executeRun - every investigation and
 * remediation run goes through it). When it starts, it decides from the
 * pick its rule recorded on it (Server/Utils/AI/LlmProviderChoice), says
 * which provider it used - or why another - first in its activity, and
 * hands the provider to every call it makes: the agent loop, the
 * confidence signal and the TL;DR. A run no rule picked one for is as it
 * always was. And the gates that ask whether AI can run at all ask about
 * the provider the run would use.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OPUS_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

const OPUS: LlmProvider = Object.assign(new LlmProvider(), {
  _id: OPUS_ID,
  name: "Claude Opus",
  projectId: PROJECT_ID,
  isGlobalLlm: false,
});

const AZURE_DEFAULT: LlmProvider = Object.assign(new LlmProvider(), {
  _id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  name: "Azure GPT-4o",
  projectId: PROJECT_ID,
  isGlobalLlm: false,
  isDefault: true,
});

function choice(
  overrides: Partial<RuleLlmProviderChoice>,
): RuleLlmProviderChoice {
  return {
    provider: null,
    source: null,
    fallbackReason: null,
    pickedProviderId: "",
    activity: null,
    ...overrides,
  };
}

const PICK_USED: RuleLlmProviderChoice = choice({
  provider: { id: OPUS_ID, name: "Claude Opus", isGlobal: false },
  source: LlmProviderSource.RulePick,
  pickedProviderId: OPUS_ID,
  llmProviderId: new ObjectID(OPUS_ID),
  providerRow: OPUS,
  activity: { source: LlmProviderSource.RulePick, providerName: "Claude Opus" },
});

const PICK_FELL_BACK: RuleLlmProviderChoice = choice({
  provider: {
    id: AZURE_DEFAULT._id!,
    name: "Azure GPT-4o",
    isGlobal: false,
  },
  source: LlmProviderSource.ProjectDefault,
  fallbackReason: LlmProviderFallbackReason.Unavailable,
  pickedProviderId: OPUS_ID,
  providerRow: AZURE_DEFAULT,
  activity: {
    source: LlmProviderSource.ProjectDefault,
    providerName: "Azure GPT-4o",
    fallbackReason: LlmProviderFallbackReason.Unavailable,
  },
});

describe("AIInvestigationEngine.executeRun: the run's LLM provider", () => {
  const aiRunId: ObjectID = ObjectID.generate();
  let events: Array<AIRunEvent>;
  let answer: SpyInstance<typeof ObservabilityAssistant.answerQuestion>;
  let confidence: SpyInstance<
    typeof AIConfidenceSignal.computeConfidenceSignal
  >;
  let tldr: SpyInstance<typeof InvestigationTldr.generateTldr>;
  let decideForRun: SpyInstance<typeof LlmProviderChoice.decideForRun>;

  function result(): ObservabilityAssistantResult {
    return {
      contentInMarkdown:
        "**Summary** — shop-api saturated the CPU of web-1.\n\n**Most likely root cause** — a CPU-bound container.",
      citations: [],
      totalTokens: 100,
      llmCallCount: 2,
      toolCallCount: 3,
    };
  }

  function request(): InvestigationRequest {
    return {
      feature: "AI Incident Investigation",
      incidentId: INCIDENT_ID,
      contextSummary: "# Incident\nTitle: Shop is down",
      persistAnalysisTldr: true,
      postAnalysis: async (): Promise<void> => {
        return undefined;
      },
    };
  }

  async function run(pick: RuleLlmProviderChoice): Promise<void> {
    decideForRun.mockResolvedValue(pick);

    await AIInvestigationEngine.executeRun({
      aiRunId,
      projectId: PROJECT_ID,
      attemptCount: 1,
      request: request(),
    });
  }

  beforeEach(() => {
    events = [];
    jest
      .spyOn(AIRunEventService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(AIRunEventService, "create")
      .mockImplementation(async (data: unknown) => {
        const event: AIRunEvent = (data as { data: AIRunEvent }).data;
        events.push(event);
        return event;
      });
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
    jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(1);
    confidence = jest
      .spyOn(AIConfidenceSignal, "computeConfidenceSignal")
      .mockResolvedValue({
        confident: true,
        codeFixRecommended: false,
        source: "classification",
      });
    tldr = jest
      .spyOn(InvestigationTldr, "generateTldr")
      .mockResolvedValue(null);
    answer = jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockResolvedValue(result());
    decideForRun = jest.spyOn(LlmProviderChoice, "decideForRun");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("decides from the run, once, when it starts", async () => {
    await run(PICK_USED);

    expect(decideForRun).toHaveBeenCalledTimes(1);
    expect(decideForRun).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      aiRunId,
    });
  });

  test("the rule's pick: said first in the activity, and handed to every call", async () => {
    await run(PICK_USED);

    expect(events[0]!.eventType).toBe(AIRunEventType.RunStarted);
    expect(events[1]!.eventType).toBe(AIRunEventType.ProgressLog);
    expect(events[1]!.resultSummary).toEqual({
      message: "Using Claude Opus, the rule's LLM provider",
      severity: "Info",
      llmProvider: {
        source: LlmProviderSource.RulePick,
        providerName: "Claude Opus",
      },
    });

    expect(
      (answer.mock.calls[0]![0] as { llmProviderId?: ObjectID })
        .llmProviderId?.toString(),
    ).toBe(OPUS_ID);
    expect(
      (confidence.mock.calls[0]![0] as { llmProviderId?: ObjectID })
        .llmProviderId?.toString(),
    ).toBe(OPUS_ID);
    expect(
      (tldr.mock.calls[0]![0] as { llmProviderId?: ObjectID }).llmProviderId
        ?.toString(),
    ).toBe(OPUS_ID);
  });

  test("a pick that fell back: a Warning that says why, and each call resolves the project's provider itself", async () => {
    await run(PICK_FELL_BACK);

    expect(events[1]!.resultSummary).toEqual({
      message:
        "Using Azure GPT-4o, the project's default LLM provider: the rule's provider is no longer available",
      severity: "Warning",
      llmProvider: {
        source: LlmProviderSource.ProjectDefault,
        providerName: "Azure GPT-4o",
        fallbackReason: LlmProviderFallbackReason.Unavailable,
      },
    });
    expect(
      (answer.mock.calls[0]![0] as { llmProviderId?: ObjectID }).llmProviderId,
    ).toBeUndefined();
  });

  test("a run no rule picked a provider for is as it always was: no line, no provider handed on", async () => {
    await run(choice({}));

    expect(
      events.filter((event: AIRunEvent): boolean => {
        return event.eventType === AIRunEventType.ProgressLog;
      }),
    ).toEqual([]);
    expect(
      (answer.mock.calls[0]![0] as { llmProviderId?: ObjectID }).llmProviderId,
    ).toBeUndefined();
    expect(
      (confidence.mock.calls[0]![0] as { llmProviderId?: ObjectID })
        .llmProviderId,
    ).toBeUndefined();
  });

  test("the events stay in order: the provider's line takes the next sequence", async () => {
    await run(PICK_USED);

    expect(
      events.map((event: AIRunEvent): number | undefined => {
        return event.sequence;
      }),
    ).toEqual(
      events.map((_event: AIRunEvent, index: number): number => {
        return index;
      }),
    );
  });
});

describe("AIInvestigationEngine: the gates ask about the provider the run would use", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("getProviderOrBalanceReason with a pick: the decided provider, not the project's", async () => {
    const projectProvider: SpyInstance<
      typeof LlmProviderService.getLLMProviderForProject
    > = jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockResolvedValue(null);
    jest.spyOn(LlmProviderChoice, "decide").mockResolvedValue(PICK_USED);
    const blocker: SpyInstance<typeof AIService.getAiBalanceBlocker> = jest
      .spyOn(AIService, "getAiBalanceBlocker")
      .mockResolvedValue(null);

    expect(
      await AIInvestigationEngine.getProviderOrBalanceReason(
        PROJECT_ID,
        new ObjectID(OPUS_ID),
      ),
    ).toBeNull();
    expect(projectProvider).not.toHaveBeenCalled();
    expect(blocker).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      llmProvider: OPUS,
    });
  });

  test("getProviderOrBalanceReason with a pick that leaves nothing to use: provider_missing", async () => {
    jest
      .spyOn(LlmProviderChoice, "decide")
      .mockResolvedValue(choice({ providerRow: null }));

    expect(
      await AIInvestigationEngine.getProviderOrBalanceReason(
        PROJECT_ID,
        new ObjectID(OPUS_ID),
      ),
    ).toBe("provider_missing");
  });

  test("getProviderOrBalanceReason with a pick the credits cannot pay for: insufficient_ai_balance", async () => {
    jest.spyOn(LlmProviderChoice, "decide").mockResolvedValue(PICK_USED);
    jest
      .spyOn(AIService, "getAiBalanceBlocker")
      .mockResolvedValue("used up");

    expect(
      await AIInvestigationEngine.getProviderOrBalanceReason(
        PROJECT_ID,
        new ObjectID(OPUS_ID),
      ),
    ).toBe("insufficient_ai_balance");
  });

  test("without a pick, the project's provider, as before", async () => {
    const decide: SpyInstance<typeof LlmProviderChoice.decide> = jest.spyOn(
      LlmProviderChoice,
      "decide",
    );
    jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockResolvedValue(AZURE_DEFAULT);
    jest.spyOn(AIService, "getAiBalanceBlocker").mockResolvedValue(null);

    expect(
      await AIInvestigationEngine.getProviderOrBalanceReason(PROJECT_ID),
    ).toBeNull();
    expect(decide).not.toHaveBeenCalled();
  });

  function mockDisabled(
    reasons: Array<InvestigationNotStartedCode | null>,
  ): SpyInstance<typeof AIInvestigationEngine.getDisabledReason> {
    const spy: SpyInstance<typeof AIInvestigationEngine.getDisabledReason> =
      jest.spyOn(AIInvestigationEngine, "getDisabledReason");

    for (const reason of reasons) {
      spy.mockResolvedValueOnce(reason);
    }

    return spy;
  }

  test("getDisabledReasonForSubject: a reason that is not the provider's is the project's, and no rule is read", async () => {
    for (const reason of [
      "ai_disabled",
      "automatic_investigation_disabled",
      "project_daily_limit_reached",
      "eligibility_check_failed",
    ] as Array<InvestigationNotStartedCode>) {
      mockDisabled([reason]);
      let ruleReads: number = 0;

      expect(
        await AIInvestigationEngine.getDisabledReasonForSubject({
          projectId: PROJECT_ID,
          subjectType: "Incident",
          getRuleLlmProviderId: async (): Promise<ObjectID | undefined> => {
            ruleReads++;
            return new ObjectID(OPUS_ID);
          },
        }),
      ).toBe(reason);
      expect(ruleReads).toBe(0);

      jest.restoreAllMocks();
    }
  });

  test("getDisabledReasonForSubject: nothing stops it - no rule is read", async () => {
    mockDisabled([null]);
    let ruleReads: number = 0;

    expect(
      await AIInvestigationEngine.getDisabledReasonForSubject({
        projectId: PROJECT_ID,
        subjectType: "Alert",
        getRuleLlmProviderId: async (): Promise<ObjectID | undefined> => {
          ruleReads++;
          return new ObjectID(OPUS_ID);
        },
      }),
    ).toBeNull();
    expect(ruleReads).toBe(0);
  });

  for (const reason of [
    "provider_missing",
    "insufficient_ai_balance",
  ] as Array<InvestigationNotStartedCode>) {
    test(`getDisabledReasonForSubject: ${reason} for the project, but the rules' provider can run it`, async () => {
      const spy: SpyInstance<typeof AIInvestigationEngine.getDisabledReason> =
        mockDisabled([reason, null]);

      expect(
        await AIInvestigationEngine.getDisabledReasonForSubject({
          projectId: PROJECT_ID,
          subjectType: "Incident",
          getRuleLlmProviderId: async (): Promise<ObjectID | undefined> => {
            return new ObjectID(OPUS_ID);
          },
        }),
      ).toBeNull();
      expect(spy.mock.calls[1]).toEqual([
        PROJECT_ID,
        "Incident",
        { llmProviderId: new ObjectID(OPUS_ID) },
      ]);
    });

    test(`getDisabledReasonForSubject: ${reason}, and no rule picks a provider - it stays`, async () => {
      mockDisabled([reason]);

      expect(
        await AIInvestigationEngine.getDisabledReasonForSubject({
          projectId: PROJECT_ID,
          subjectType: "Incident",
          getRuleLlmProviderId: async (): Promise<ObjectID | undefined> => {
            return undefined;
          },
        }),
      ).toBe(reason);
    });

    test(`getDisabledReasonForSubject: ${reason}, and the rules cannot be read - it stays`, async () => {
      mockDisabled([reason]);

      expect(
        await AIInvestigationEngine.getDisabledReasonForSubject({
          projectId: PROJECT_ID,
          subjectType: "Incident",
          getRuleLlmProviderId: async (): Promise<ObjectID | undefined> => {
            throw new Error("database is down");
          },
        }),
      ).toBe(reason);
    });
  }

  test("getDisabledReasonForSubject: the rules' provider cannot run it either - the second reason", async () => {
    mockDisabled(["provider_missing", "insufficient_ai_balance"]);

    expect(
      await AIInvestigationEngine.getDisabledReasonForSubject({
        projectId: PROJECT_ID,
        subjectType: "Incident",
        getRuleLlmProviderId: async (): Promise<ObjectID | undefined> => {
          return new ObjectID(OPUS_ID);
        },
      }),
    ).toBe("insufficient_ai_balance");
  });

  test("getDisabledReason hands the pick to the provider check, and reads the switches as before", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(
      Object.assign(new Project(), {
        enableAi: true,
        enableAutomaticIncidentInvestigation: true,
      }),
    );
    const providerCheck: SpyInstance<
      typeof AIInvestigationEngine.getProviderOrBalanceReason
    > = jest
      .spyOn(AIInvestigationEngine, "getProviderOrBalanceReason")
      .mockResolvedValue(null);
    jest.spyOn(AIService, "getReachedProjectDailyLimit").mockResolvedValue(null);

    expect(
      await AIInvestigationEngine.getDisabledReason(PROJECT_ID, "Incident", {
        llmProviderId: new ObjectID(OPUS_ID),
      }),
    ).toBeNull();
    expect(providerCheck).toHaveBeenCalledWith(
      PROJECT_ID,
      new ObjectID(OPUS_ID),
    );
  });
});
