import LlmProviderChoice, {
  RuleLlmProviderChoice,
} from "../../../../Server/Utils/AI/LlmProviderChoice";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIService from "../../../../Server/Services/AIService";
import LlmProviderService from "../../../../Server/Services/LlmProviderService";
import logger from "../../../../Server/Utils/Logger";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import { AIRunEventResultSummary } from "../../../../Types/AI/AIChatTypes";
import {
  LLM_PROVIDER_ACTIVITY_TEMPLATES,
  LlmProviderFallbackReason,
  LlmProviderSource,
} from "../../../../Types/AI/LlmProviderChoice";
import { ProjectAiDailyLimit } from "../../../../Types/AI/ProjectAiDailyLimits";
import ObjectID from "../../../../Types/ObjectID";
import { setTestBillingEnabled } from "../../Enterprise/TestBillingFlag";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../../Enterprise/TestBillingFlag",
    ) as typeof import("../../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

/*
 * THE LLM PROVIDER A RULE'S WORK USES, read from the database
 * (Server/Utils/AI/LlmProviderChoice): the rule's pick when the project may
 * use it and nothing stops it, else the project's default, else the global
 * provider - and what the run says about it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RUN_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const OPUS_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const AZURE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const GLOBAL_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";

function provider(fields: Partial<LlmProvider> & { _id: string }): LlmProvider {
  return Object.assign(new LlmProvider(), {
    isGlobalLlm: false,
    costPerMillionTokensInUSDCents: 0,
    ...fields,
  });
}

const OPUS: LlmProvider = provider({
  _id: OPUS_ID,
  name: "Claude Opus",
  modelName: "claude-opus-4-5",
  projectId: PROJECT_ID,
});

const AZURE_DEFAULT: LlmProvider = provider({
  _id: AZURE_ID,
  name: "Azure GPT-4o",
  projectId: PROJECT_ID,
  isDefault: true,
});

const BILLED_GLOBAL: LlmProvider = provider({
  _id: GLOBAL_ID,
  name: "OneUptime AI",
  isGlobalLlm: true,
  costPerMillionTokensInUSDCents: 300,
});

const FREE_GLOBAL: LlmProvider = provider({
  _id: GLOBAL_ID,
  name: "OneUptime AI",
  isGlobalLlm: true,
  costPerMillionTokensInUSDCents: 0,
});

interface Mocks {
  findOneBy: SpyInstance<typeof LlmProviderService.findOneBy>;
  getLLMProviderForProject: SpyInstance<
    typeof LlmProviderService.getLLMProviderForProject
  >;
  getAiBalanceBlocker: SpyInstance<typeof AIService.getAiBalanceBlocker>;
  getProjectDailyLimitStatus: SpyInstance<
    typeof AIService.getProjectDailyLimitStatus
  >;
}

function mockProviders(data: {
  rows?: Array<LlmProvider>;
  projectProvider?: LlmProvider | null;
  balanceBlocker?: string | null;
  reachedLimit?: ProjectAiDailyLimit | null;
}): Mocks {
  return {
    findOneBy: jest
      .spyOn(LlmProviderService, "findOneBy")
      .mockImplementation(async (options: unknown) => {
        const query: { _id?: unknown } =
          (options as { query?: { _id?: unknown } }).query || {};

        return (
          (data.rows || []).find((row: LlmProvider): boolean => {
            return row._id === query._id;
          }) || null
        );
      }),
    getLLMProviderForProject: jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockResolvedValue(data.projectProvider ?? null),
    getAiBalanceBlocker: jest
      .spyOn(AIService, "getAiBalanceBlocker")
      .mockResolvedValue(data.balanceBlocker ?? null),
    getProjectDailyLimitStatus: jest
      .spyOn(AIService, "getProjectDailyLimitStatus")
      .mockResolvedValue({
        tokenLimit: null,
        spendLimitInUSD: data.reachedLimit ? 10 : null,
        reachedLimit: data.reachedLimit ?? null,
        usage: { usedTokensToday: 0, spentTodayInUSDCents: 0 },
        isSpendCounted: Boolean(data.reachedLimit),
        resetsAt: new Date(),
      } as never),
  };
}

beforeEach(() => {
  setTestBillingEnabled(false);
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("LlmProviderChoice.decide: no rule pick", () => {
  test("the project's default provider, as getLLMProviderForProject resolves it; no id to hand on", async () => {
    const mocks: Mocks = mockProviders({ projectProvider: AZURE_DEFAULT });

    const choice: RuleLlmProviderChoice = await LlmProviderChoice.decide({
      projectId: PROJECT_ID,
    });

    expect(choice.source).toBe(LlmProviderSource.ProjectDefault);
    expect(choice.provider?.name).toBe("Azure GPT-4o");
    expect(choice.fallbackReason).toBeNull();
    expect(choice.providerRow).toBe(AZURE_DEFAULT);
    // Each call resolves the project's provider itself, as it always has.
    expect(choice.llmProviderId).toBeUndefined();
    expect(choice.activity).toBeNull();
    expect(mocks.findOneBy).not.toHaveBeenCalled();
    expect(mocks.getLLMProviderForProject).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("a project with no default uses the global provider", async () => {
    mockProviders({ projectProvider: FREE_GLOBAL });

    const choice: RuleLlmProviderChoice = await LlmProviderChoice.decide({
      projectId: PROJECT_ID,
    });

    expect(choice.source).toBe(LlmProviderSource.Global);
    expect(choice.provider?.isGlobal).toBe(true);
  });

  test("no provider at all: none", async () => {
    mockProviders({ projectProvider: null });

    const choice: RuleLlmProviderChoice = await LlmProviderChoice.decide({
      projectId: PROJECT_ID,
    });

    expect(choice.provider).toBeNull();
    expect(choice.source).toBeNull();
    expect(choice.providerRow).toBeNull();
  });
});

describe("LlmProviderChoice.decide: the rule's pick", () => {
  test("the project's own provider: used, handed to every call, and said in the run's activity", async () => {
    const mocks: Mocks = mockProviders({
      rows: [OPUS, AZURE_DEFAULT],
      projectProvider: AZURE_DEFAULT,
    });

    const choice: RuleLlmProviderChoice = await LlmProviderChoice.decide({
      projectId: PROJECT_ID,
      pickedProviderId: new ObjectID(OPUS_ID),
    });

    expect(choice.source).toBe(LlmProviderSource.RulePick);
    expect(choice.llmProviderId?.toString()).toBe(OPUS_ID);
    expect(choice.providerRow).toBe(OPUS);
    expect(choice.pickedProviderId).toBe(OPUS_ID);
    expect(choice.activity).toEqual({
      source: LlmProviderSource.RulePick,
      providerName: "Claude Opus",
    });
    // The pick is all that is read: no project provider, no budget.
    expect(mocks.getLLMProviderForProject).not.toHaveBeenCalled();
    expect(mocks.getAiBalanceBlocker).not.toHaveBeenCalled();
  });

  test("the pick is read as root, by its id, never with its secrets", async () => {
    const mocks: Mocks = mockProviders({ rows: [OPUS] });

    await LlmProviderChoice.decide({
      projectId: PROJECT_ID,
      pickedProviderId: OPUS_ID,
    });

    const options: {
      query: unknown;
      select: Record<string, unknown>;
      props: unknown;
    } = mocks.findOneBy.mock.calls[0]![0] as never;

    expect(options.query).toEqual({ _id: OPUS_ID });
    expect(options.props).toEqual({ isRoot: true });
    expect(options.select["apiKey"]).toBeUndefined();
    expect(options.select["additionalParams"]).toBeUndefined();
    expect(options.select).toMatchObject({
      _id: true,
      name: true,
      projectId: true,
      isGlobalLlm: true,
      costPerMillionTokensInUSDCents: true,
    });
  });

  test("a global provider is the project's to pick too", async () => {
    mockProviders({ rows: [FREE_GLOBAL], projectProvider: AZURE_DEFAULT });

    const choice: RuleLlmProviderChoice = await LlmProviderChoice.decide({
      projectId: PROJECT_ID,
      pickedProviderId: GLOBAL_ID,
    });

    expect(choice.source).toBe(LlmProviderSource.RulePick);
    expect(choice.llmProviderId?.toString()).toBe(GLOBAL_ID);
  });

  test("another project's provider cannot be used: the project's default, and the run says why", async () => {
    const otherProjects: LlmProvider = provider({
      _id: OPUS_ID,
      name: "Someone else's",
      projectId: OTHER_PROJECT_ID,
    });

    mockProviders({ rows: [otherProjects], projectProvider: AZURE_DEFAULT });

    const choice: RuleLlmProviderChoice = await LlmProviderChoice.decide({
      projectId: PROJECT_ID,
      pickedProviderId: OPUS_ID,
    });

    expect(choice.source).toBe(LlmProviderSource.ProjectDefault);
    expect(choice.fallbackReason).toBe(LlmProviderFallbackReason.Unavailable);
    expect(choice.llmProviderId).toBeUndefined();
    expect(choice.activity).toEqual({
      source: LlmProviderSource.ProjectDefault,
      providerName: "Azure GPT-4o",
      fallbackReason: LlmProviderFallbackReason.Unavailable,
    });
    // Never the other project's name, anywhere.
    expect(JSON.stringify(choice.activity)).not.toContain("Someone else's");
  });

  test("a deleted provider: the global one when the project has no default", async () => {
    mockProviders({ rows: [], projectProvider: FREE_GLOBAL });

    const choice: RuleLlmProviderChoice = await LlmProviderChoice.decide({
      projectId: PROJECT_ID,
      pickedProviderId: OPUS_ID,
    });

    expect(choice.source).toBe(LlmProviderSource.Global);
    expect(choice.fallbackReason).toBe(LlmProviderFallbackReason.Unavailable);
    expect(choice.providerRow).toBe(FREE_GLOBAL);
  });

  test("a global provider an administrator stopped sharing is no longer the project's", async () => {
    const unshared: LlmProvider = provider({
      _id: GLOBAL_ID,
      name: "Retired global",
      isGlobalLlm: false,
    });

    mockProviders({ rows: [unshared], projectProvider: AZURE_DEFAULT });

    const choice: RuleLlmProviderChoice = await LlmProviderChoice.decide({
      projectId: PROJECT_ID,
      pickedProviderId: GLOBAL_ID,
    });

    expect(choice.fallbackReason).toBe(LlmProviderFallbackReason.Unavailable);
    expect(choice.source).toBe(LlmProviderSource.ProjectDefault);
  });

  test("an id that is not one is not looked up, and falls back", async () => {
    const mocks: Mocks = mockProviders({ projectProvider: AZURE_DEFAULT });

    const choice: RuleLlmProviderChoice = await LlmProviderChoice.decide({
      projectId: PROJECT_ID,
      pickedProviderId: "not-a-uuid",
    });

    expect(mocks.findOneBy).not.toHaveBeenCalled();
    expect(choice.fallbackReason).toBe(LlmProviderFallbackReason.Unavailable);
  });

  test("a pick that cannot be read falls back, logged - never a failed run", async () => {
    mockProviders({ projectProvider: AZURE_DEFAULT });
    jest
      .spyOn(LlmProviderService, "findOneBy")
      .mockRejectedValue(new Error("database is down"));

    const choice: RuleLlmProviderChoice = await LlmProviderChoice.decide({
      projectId: PROJECT_ID,
      pickedProviderId: OPUS_ID,
    });

    expect(choice.source).toBe(LlmProviderSource.ProjectDefault);
    expect(choice.fallbackReason).toBe(LlmProviderFallbackReason.Unavailable);
    expect(logger.error).toHaveBeenCalled();
  });

  test("with nothing to fall back to: no provider, and the reason", async () => {
    mockProviders({ rows: [], projectProvider: null });

    const choice: RuleLlmProviderChoice = await LlmProviderChoice.decide({
      projectId: PROJECT_ID,
      pickedProviderId: OPUS_ID,
    });

    expect(choice.provider).toBeNull();
    expect(choice.activity).toEqual({
      fallbackReason: LlmProviderFallbackReason.Unavailable,
    });
  });
});

describe("LlmProviderChoice.decide: a pick the AI credits pay for", () => {
  test("billing off: nothing is billed, so nothing about budgets is read", async () => {
    setTestBillingEnabled(false);
    const mocks: Mocks = mockProviders({
      rows: [BILLED_GLOBAL],
      projectProvider: AZURE_DEFAULT,
      balanceBlocker: "used up",
    });

    const choice: RuleLlmProviderChoice = await LlmProviderChoice.decide({
      projectId: PROJECT_ID,
      pickedProviderId: GLOBAL_ID,
    });

    expect(choice.source).toBe(LlmProviderSource.RulePick);
    expect(mocks.getAiBalanceBlocker).not.toHaveBeenCalled();
    expect(mocks.getProjectDailyLimitStatus).not.toHaveBeenCalled();
  });

  test("a free global provider costs no credits: nothing about budgets is read", async () => {
    setTestBillingEnabled(true);
    const mocks: Mocks = mockProviders({
      rows: [FREE_GLOBAL],
      projectProvider: AZURE_DEFAULT,
    });

    await LlmProviderChoice.decide({
      projectId: PROJECT_ID,
      pickedProviderId: GLOBAL_ID,
    });

    expect(mocks.getAiBalanceBlocker).not.toHaveBeenCalled();
  });

  test("credits used up: the project's own default, and the run says why", async () => {
    setTestBillingEnabled(true);
    const mocks: Mocks = mockProviders({
      rows: [BILLED_GLOBAL],
      projectProvider: AZURE_DEFAULT,
      balanceBlocker: "This project's AI credit balance is used up",
    });

    const choice: RuleLlmProviderChoice = await LlmProviderChoice.decide({
      projectId: PROJECT_ID,
      pickedProviderId: GLOBAL_ID,
    });

    expect(choice.source).toBe(LlmProviderSource.ProjectDefault);
    expect(choice.fallbackReason).toBe(LlmProviderFallbackReason.CreditsUsedUp);
    expect(choice.providerRow).toBe(AZURE_DEFAULT);
    expect(choice.llmProviderId).toBeUndefined();
    // The balance is asked about the picked provider, read already.
    expect(mocks.getAiBalanceBlocker).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      llmProvider: BILLED_GLOBAL,
    });
  });

  test("credits used up and no project default: the pick stays, refused for what stops it", async () => {
    setTestBillingEnabled(true);
    mockProviders({
      rows: [BILLED_GLOBAL],
      projectProvider: BILLED_GLOBAL,
      balanceBlocker: "used up",
    });

    const choice: RuleLlmProviderChoice = await LlmProviderChoice.decide({
      projectId: PROJECT_ID,
      pickedProviderId: GLOBAL_ID,
    });

    expect(choice.source).toBe(LlmProviderSource.RulePick);
    expect(choice.fallbackReason).toBeNull();
    expect(choice.providerRow).toBe(BILLED_GLOBAL);
  });

  test("the daily AI spend limit reached: the project's own default", async () => {
    setTestBillingEnabled(true);
    const mocks: Mocks = mockProviders({
      rows: [BILLED_GLOBAL],
      projectProvider: AZURE_DEFAULT,
      reachedLimit: ProjectAiDailyLimit.Spend,
    });

    const choice: RuleLlmProviderChoice = await LlmProviderChoice.decide({
      projectId: PROJECT_ID,
      pickedProviderId: GLOBAL_ID,
    });

    expect(choice.fallbackReason).toBe(
      LlmProviderFallbackReason.SpendLimitReached,
    );
    expect(mocks.getProjectDailyLimitStatus).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID, isBilled: true }),
    );
  });

  test("the daily token limit stops every provider alike: the pick stays", async () => {
    setTestBillingEnabled(true);
    mockProviders({
      rows: [BILLED_GLOBAL],
      projectProvider: AZURE_DEFAULT,
      reachedLimit: ProjectAiDailyLimit.Tokens,
    });

    const choice: RuleLlmProviderChoice = await LlmProviderChoice.decide({
      projectId: PROJECT_ID,
      pickedProviderId: GLOBAL_ID,
    });

    expect(choice.source).toBe(LlmProviderSource.RulePick);
    expect(choice.fallbackReason).toBeNull();
  });

  test("a budget that cannot be read stops nothing: the call checks it again", async () => {
    setTestBillingEnabled(true);
    mockProviders({ rows: [BILLED_GLOBAL], projectProvider: AZURE_DEFAULT });
    jest
      .spyOn(AIService, "getAiBalanceBlocker")
      .mockRejectedValue(new Error("no balance"));
    jest
      .spyOn(AIService, "getProjectDailyLimitStatus")
      .mockRejectedValue(new Error("no limits"));

    const choice: RuleLlmProviderChoice = await LlmProviderChoice.decide({
      projectId: PROJECT_ID,
      pickedProviderId: GLOBAL_ID,
    });

    expect(choice.source).toBe(LlmProviderSource.RulePick);
  });

  test("the project's own pick is never paid for with credits: nothing about budgets is read", async () => {
    setTestBillingEnabled(true);
    const mocks: Mocks = mockProviders({
      rows: [OPUS],
      projectProvider: AZURE_DEFAULT,
      balanceBlocker: "used up",
    });

    const choice: RuleLlmProviderChoice = await LlmProviderChoice.decide({
      projectId: PROJECT_ID,
      pickedProviderId: OPUS_ID,
    });

    expect(choice.source).toBe(LlmProviderSource.RulePick);
    expect(mocks.getAiBalanceBlocker).not.toHaveBeenCalled();
  });
});

describe("LlmProviderChoice.decideIfPicked and decideForRun", () => {
  test("no pick: nothing read, nothing to say", async () => {
    const mocks: Mocks = mockProviders({ projectProvider: AZURE_DEFAULT });

    const choice: RuleLlmProviderChoice =
      await LlmProviderChoice.decideIfPicked({
        projectId: PROJECT_ID,
        pickedProviderId: undefined,
      });

    expect(choice).toMatchObject({
      provider: null,
      source: null,
      activity: null,
      pickedProviderId: "",
    });
    expect(choice.llmProviderId).toBeUndefined();
    expect(mocks.getLLMProviderForProject).not.toHaveBeenCalled();
    expect(mocks.findOneBy).not.toHaveBeenCalled();
  });

  test("a pick: decided", async () => {
    mockProviders({ rows: [OPUS] });

    const choice: RuleLlmProviderChoice =
      await LlmProviderChoice.decideIfPicked({
        projectId: PROJECT_ID,
        pickedProviderId: OPUS_ID,
      });

    expect(choice.llmProviderId?.toString()).toBe(OPUS_ID);
  });

  test("a run reads the pick its rule recorded on it", async () => {
    mockProviders({ rows: [OPUS] });
    const findRun: SpyInstance<typeof AIRunService.findOneById> = jest
      .spyOn(AIRunService, "findOneById")
      .mockResolvedValue(
        Object.assign(new AIRun(), { llmProviderId: new ObjectID(OPUS_ID) }),
      );

    const choice: RuleLlmProviderChoice = await LlmProviderChoice.decideForRun({
      projectId: PROJECT_ID,
      aiRunId: RUN_ID,
    });

    expect(choice.source).toBe(LlmProviderSource.RulePick);
    expect(findRun).toHaveBeenCalledWith({
      id: RUN_ID,
      select: { llmProviderId: true },
      props: { isRoot: true },
    });
  });

  test("a run no rule picked a provider for: nothing more is read", async () => {
    const mocks: Mocks = mockProviders({ projectProvider: AZURE_DEFAULT });
    jest.spyOn(AIRunService, "findOneById").mockResolvedValue(new AIRun());

    const choice: RuleLlmProviderChoice = await LlmProviderChoice.decideForRun({
      projectId: PROJECT_ID,
      aiRunId: RUN_ID,
    });

    expect(choice.activity).toBeNull();
    expect(choice.llmProviderId).toBeUndefined();
    expect(mocks.getLLMProviderForProject).not.toHaveBeenCalled();
  });

  test("a run that cannot be read uses the project's provider, logged", async () => {
    mockProviders({ projectProvider: AZURE_DEFAULT });
    jest
      .spyOn(AIRunService, "findOneById")
      .mockRejectedValue(new Error("gone"));

    const choice: RuleLlmProviderChoice = await LlmProviderChoice.decideForRun({
      projectId: PROJECT_ID,
      aiRunId: RUN_ID,
    });

    expect(choice.activity).toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });

  test("a run queued before its provider was deleted falls back, and says so", async () => {
    mockProviders({ rows: [], projectProvider: AZURE_DEFAULT });
    jest
      .spyOn(AIRunService, "findOneById")
      .mockResolvedValue(
        Object.assign(new AIRun(), { llmProviderId: new ObjectID(OPUS_ID) }),
      );

    const choice: RuleLlmProviderChoice = await LlmProviderChoice.decideForRun({
      projectId: PROJECT_ID,
      aiRunId: RUN_ID,
    });

    expect(LlmProviderChoice.getEventSummary(choice)).toEqual({
      message:
        "Using Azure GPT-4o, the project's default LLM provider, because the rule's provider is no longer available",
      severity: "Warning",
      llmProvider: {
        source: LlmProviderSource.ProjectDefault,
        providerName: "Azure GPT-4o",
        fallbackReason: LlmProviderFallbackReason.Unavailable,
      },
    });
  });
});

describe("what a run records", () => {
  test("no event for a run no rule picked a provider for", async () => {
    mockProviders({ projectProvider: AZURE_DEFAULT });

    expect(
      LlmProviderChoice.getEventSummary(
        await LlmProviderChoice.decideIfPicked({ projectId: PROJECT_ID }),
      ),
    ).toBeNull();
  });

  test("the pick, used: an Info line naming it", async () => {
    mockProviders({ rows: [OPUS] });

    const summary: AIRunEventResultSummary | null =
      LlmProviderChoice.getEventSummary(
        await LlmProviderChoice.decide({
          projectId: PROJECT_ID,
          pickedProviderId: OPUS_ID,
        }),
      );

    expect(summary).toEqual({
      message: LLM_PROVIDER_ACTIVITY_TEMPLATES.rulePick.replace(
        "{{provider}}",
        "Claude Opus",
      ),
      severity: "Info",
      llmProvider: {
        source: LlmProviderSource.RulePick,
        providerName: "Claude Opus",
      },
    });
  });

  test("a fix run whose pick fell back names the provider the metered path used", async () => {
    mockProviders({ rows: [], projectProvider: FREE_GLOBAL });

    const choice: RuleLlmProviderChoice = await LlmProviderChoice.decide({
      projectId: PROJECT_ID,
      pickedProviderId: OPUS_ID,
    });

    // The metered path preferred a provider the project owns.
    expect(
      LlmProviderChoice.getFallbackActivity({
        choice,
        usedProvider: AZURE_DEFAULT,
      }),
    ).toEqual({
      source: LlmProviderSource.ProjectDefault,
      providerName: "Azure GPT-4o",
      fallbackReason: LlmProviderFallbackReason.Unavailable,
    });

    expect(
      LlmProviderChoice.getFallbackActivity({ choice, usedProvider: null }),
    ).toEqual({ fallbackReason: LlmProviderFallbackReason.Unavailable });
  });

  test("a fix run whose pick is used keeps the pick's activity", async () => {
    mockProviders({ rows: [OPUS] });

    const choice: RuleLlmProviderChoice = await LlmProviderChoice.decide({
      projectId: PROJECT_ID,
      pickedProviderId: OPUS_ID,
    });

    expect(
      LlmProviderChoice.getFallbackActivity({ choice, usedProvider: OPUS }),
    ).toEqual(choice.activity);
  });
});

describe("LlmProviderChoice.isBilledProvider", () => {
  test("only a global provider with a cost, and only with billing on", () => {
    setTestBillingEnabled(true);
    expect(LlmProviderChoice.isBilledProvider(BILLED_GLOBAL)).toBe(true);
    expect(LlmProviderChoice.isBilledProvider(FREE_GLOBAL)).toBe(false);
    expect(LlmProviderChoice.isBilledProvider(OPUS)).toBe(false);

    setTestBillingEnabled(false);
    expect(LlmProviderChoice.isBilledProvider(BILLED_GLOBAL)).toBe(false);
  });
});
