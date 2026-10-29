import AIService, {
  AI_INCIDENT_INVESTIGATION_FEATURE,
  AILogResponse,
} from "../../../Server/Services/AIService";
import AIBillingService from "../../../Server/Services/AIBillingService";
import LlmLogService from "../../../Server/Services/LlmLogService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import ProjectService from "../../../Server/Services/ProjectService";
import AiCreditsUsedUpOwnerNotice from "../../../Server/Utils/AI/AiCreditsUsedUpOwnerNotice";
import ProjectAiDailyLimitOwnerNotice from "../../../Server/Utils/AI/ProjectAiDailyLimitOwnerNotice";
import LLMService, { LLMUsage } from "../../../Server/Utils/LLM/LLMService";
import LLMPromptCacheKey from "../../../Server/Utils/LLM/LLMPromptCacheKey";
import logger from "../../../Server/Utils/Logger";
import LlmLog from "../../../Models/DatabaseModels/LlmLog";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../Models/DatabaseModels/Project";
import LlmLogStatus from "../../../Types/LlmLogStatus";
import LlmType from "../../../Types/LLM/LlmType";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Issue #5073, the accounting half. A call's tokens counted at full weight
 * whether the provider read them fresh or from its prompt cache, so with
 * caching OneUptime's count - and on OneUptime Cloud the AI credits charged
 * for it - ran far ahead of what the calls cost. Every AI call goes through
 * AIService.executeWithLogging, and these hold it to counting tokens by what
 * they cost (AiTokenCount: a cache read or write counts at what the call's
 * model charges for it next to a fresh token - on Claude Sonnet 5.5, the
 * hosted provider here, a read is a twentieth of a token and a write one and
 * a quarter; a day's sums with no model, a tenth and one and a quarter):
 *
 *  - the AI credits a call through the OneUptime-hosted provider is charged;
 *  - the project's own daily token limit, read before every call;
 *  - the incident (and alert) daily token limit of autonomous work;
 *  - while the AI Logs row keeps the tokens as the provider reported them.
 */

type MockBillingGlobal = typeof globalThis & {
  __cachedTokensTestBillingEnabled: boolean;
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: MockBillingGlobal = globalThis as MockBillingGlobal;
  mockGlobal.__cachedTokensTestBillingEnabled = false;

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockGlobal.__cachedTokensTestBillingEnabled;
    },
  });

  return mocked;
});

function setBillingEnabled(value: boolean): void {
  (globalThis as MockBillingGlobal).__cachedTokensTestBillingEnabled = value;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

// $5 per million tokens, as the OneUptime-hosted provider is priced.
const PRICE_PER_MILLION_IN_CENTS: number = 500;

// A day's AI Logs, as the usage statements add them up.
interface DayOfCalls {
  totalTokens: number;
  cacheRead: number;
  cacheWrite: number;
  billedCostInUSDCents: number;
}

let today: DayOfCalls;
let project: Project;
let provider: LlmProvider;
let usage: LLMUsage;
let completion: jest.SpyInstance;
let createLog: jest.SpyInstance;
let deduct: jest.SpyInstance;

function projectRow(values: Record<string, unknown> = {}): Project {
  return {
    id: PROJECT_ID,
    enableAi: true,
    aiCurrentBalanceInUSDCents: 100_000,
    ...values,
  } as unknown as Project;
}

function globalProvider(): LlmProvider {
  return {
    id: ObjectID.generate(),
    name: "OneUptime AI",
    llmType: LlmType.Anthropic,
    modelName: "claude-sonnet-5-5",
    isGlobalLlm: true,
    costPerMillionTokensInUSDCents: PRICE_PER_MILLION_IN_CENTS,
  } as unknown as LlmProvider;
}

function ownProvider(): LlmProvider {
  return {
    id: ObjectID.generate(),
    name: "Our Anthropic",
    llmType: LlmType.Anthropic,
    modelName: "claude-sonnet-5-5",
    isGlobalLlm: false,
    costPerMillionTokensInUSDCents: 0,
  } as unknown as LlmProvider;
}

// The AI Logs row the call wrote.
function writtenLog(): LlmLog {
  return (createLog.mock.calls[0]![0] as { data: LlmLog }).data;
}

async function askAi(): Promise<AILogResponse> {
  return AIService.executeWithLogging({
    projectId: PROJECT_ID,
    feature: "Observability Chat",
    messages: [{ role: "user", content: "what broke?" }],
  });
}

async function investigate(): Promise<AILogResponse> {
  return AIService.executeWithLogging({
    projectId: PROJECT_ID,
    feature: AI_INCIDENT_INVESTIGATION_FEATURE,
    incidentId: INCIDENT_ID,
    messages: [{ role: "user", content: "investigate" }],
  });
}

beforeEach(() => {
  setBillingEnabled(false);
  today = {
    totalTokens: 0,
    cacheRead: 0,
    cacheWrite: 0,
    billedCostInUSDCents: 0,
  };
  project = projectRow();
  provider = ownProvider();
  usage = { promptTokens: 1_000, completionTokens: 0, totalTokens: 1_000 };

  jest.spyOn(logger, "error").mockImplementation((): void => {});

  jest.spyOn(ProjectService, "findOneById").mockImplementation(async () => {
    return project;
  });
  jest
    .spyOn(LlmProviderService, "getProviderForChat")
    .mockImplementation(async () => {
      return provider;
    });
  jest
    .spyOn(LlmProviderService, "getLLMProviderForProject")
    .mockImplementation(async () => {
      return provider;
    });

  completion = jest
    .spyOn(LLMService, "getCompletion")
    .mockImplementation(async () => {
      return { content: "the model answered", usage: usage };
    });

  createLog = jest
    .spyOn(LlmLogService, "create")
    .mockImplementation(async (data: { data: LlmLog }) => {
      return data.data;
    });

  // Both usage statements, answered from `today`.
  jest.spyOn(LlmLogService, "getRepository").mockReturnValue({
    manager: {
      query: async (sql: string): Promise<Array<Record<string, unknown>>> => {
        if (sql.includes('AS "billedCostInUSDCents"')) {
          return [
            {
              totalTokens: String(today.totalTokens),
              cacheRead: String(today.cacheRead),
              cacheWrite: String(today.cacheWrite),
              billedCostInUSDCents: String(today.billedCostInUSDCents),
            },
          ];
        }

        return [
          {
            total: String(today.totalTokens),
            cacheRead: String(today.cacheRead),
            cacheWrite: String(today.cacheWrite),
          },
        ];
      },
    },
  } as unknown as ReturnType<typeof LlmLogService.getRepository>);

  deduct = jest
    .spyOn(ProjectService, "deductAiBalanceInUSDCents")
    .mockResolvedValue(undefined);
  jest
    .spyOn(AIBillingService, "rechargeIfBalanceIsLow")
    .mockResolvedValue(50_000 as never);
  jest
    .spyOn(AiCreditsUsedUpOwnerNotice, "notifyIfUsedUp")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectAiDailyLimitOwnerNotice, "notifyIfFirstToday")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  setBillingEnabled(false);
});

describe("AI credits: a call through the OneUptime-hosted provider is charged for its tokens as counted", () => {
  beforeEach(() => {
    setBillingEnabled(true);
    provider = globalProvider();
  });

  test("tokens read from the prompt cache are charged what the model charges for them: a twentieth on Claude Sonnet 5.5", async () => {
    // A million tokens, 900,000 of them read from the cache: counted 145,000.
    usage = {
      promptTokens: 980_000,
      completionTokens: 20_000,
      totalTokens: 1_000_000,
      cachedInputTokens: 900_000,
    };

    await askAi();

    const log: LlmLog = writtenLog();

    // 100,000 fresh + 45,000 (900,000 ÷ 20) at $5 a million: 72.5 cents, up.
    expect(log.costInUSDCents).toBe(73);
    expect(log.wasBilled).toBe(true);
    expect(deduct).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      amountInUSDCents: 73,
    });
  });

  test("on a model whose cache reads cost half, they are charged half", async () => {
    provider = {
      ...globalProvider(),
      llmType: LlmType.OpenAI,
      modelName: "gpt-4o",
    } as unknown as LlmProvider;
    usage = {
      promptTokens: 980_000,
      completionTokens: 20_000,
      totalTokens: 1_000_000,
      cachedInputTokens: 900_000,
    };

    await askAi();

    // 100,000 fresh + 450,000 (900,000 ÷ 2) at $5 a million.
    expect(writtenLog().costInUSDCents).toBe(275);
    expect(writtenLog().modelName).toBe("gpt-4o");
  });

  test("the model the call asked for decides, when the provider names none", async () => {
    provider = {
      ...globalProvider(),
      llmType: LlmType.OpenAI,
      modelName: undefined,
    } as unknown as LlmProvider;
    completion.mockImplementation(async () => {
      return {
        content: "the model answered",
        usage: usage,
        modelName: "gpt-4o",
      };
    });
    usage = {
      promptTokens: 980_000,
      completionTokens: 20_000,
      totalTokens: 1_000_000,
      cachedInputTokens: 900_000,
    };

    await askAi();

    expect(writtenLog().modelName).toBe("gpt-4o");
    expect(writtenLog().costInUSDCents).toBe(275);
  });

  test("a model the cost catalog has no cache price for is charged a tenth for a read", async () => {
    provider = {
      ...globalProvider(),
      llmType: LlmType.OpenAICompatible,
      modelName: "house-model-v2",
    } as unknown as LlmProvider;
    usage = {
      promptTokens: 980_000,
      completionTokens: 20_000,
      totalTokens: 1_000_000,
      cachedInputTokens: 900_000,
    };

    await askAi();

    // 100,000 fresh + 90,000 (900,000 ÷ 10): 95 cents, as every model was.
    expect(writtenLog().costInUSDCents).toBe(95);
  });

  test("the call asks OpenAI to keep one prompt cache for the project's kind of work", async () => {
    await askAi();

    const request: { promptCacheKey?: string } = completion.mock
      .calls[0]![0] as { promptCacheKey?: string };

    expect(request.promptCacheKey).toBe(
      LLMPromptCacheKey.build({
        projectId: PROJECT_ID,
        feature: "Observability Chat",
      }),
    );

    await investigate();

    const investigation: { promptCacheKey?: string } = completion.mock
      .calls[1]![0] as { promptCacheKey?: string };

    expect(investigation.promptCacheKey).toBe(
      LLMPromptCacheKey.build({
        projectId: PROJECT_ID,
        feature: AI_INCIDENT_INVESTIGATION_FEATURE,
      }),
    );
    expect(investigation.promptCacheKey).not.toBe(request.promptCacheKey);
  });

  test("tokens written to the prompt cache are charged one and a quarter", async () => {
    usage = {
      promptTokens: 1_000_000,
      completionTokens: 0,
      totalTokens: 1_000_000,
      cacheCreationTokens: 1_000_000,
    };

    await askAi();

    expect(writtenLog().costInUSDCents).toBe(625);
    expect(deduct).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      amountInUSDCents: 625,
    });
  });

  test("a call that used no cache is charged every token, as before", async () => {
    usage = {
      promptTokens: 990_000,
      completionTokens: 10_000,
      totalTokens: 1_000_000,
    };

    await askAi();

    expect(writtenLog().costInUSDCents).toBe(500);
  });

  test("an agent loop's call - mostly read back from the cache - costs a fraction of its tokens", async () => {
    // The issue's second call: 28,496 tokens, 20,654 of them read from the cache.
    usage = {
      promptTokens: 26_925,
      completionTokens: 1_571,
      totalTokens: 28_496,
      cachedInputTokens: 20_654,
    };

    await askAi();

    // 9,908 counted tokens at $5 a million: 4.954 cents, rounded up.
    expect(writtenLog().costInUSDCents).toBe(5);
    expect(deduct).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      amountInUSDCents: 5,
    });
  });

  test("the AI Logs row keeps the tokens as the provider reported them", async () => {
    usage = {
      promptTokens: 26_925,
      completionTokens: 1_571,
      totalTokens: 28_496,
      cachedInputTokens: 20_654,
      cacheCreationTokens: 3_000,
    };

    const response: AILogResponse = await askAi();
    const log: LlmLog = writtenLog();

    expect(log.status).toBe(LlmLogStatus.Success);
    expect(log.totalTokens).toBe(28_496);
    expect(log.completionTokens).toBe(1_571);
    expect(log.cachedInputTokens).toBe(20_654);
    expect(log.cacheCreationTokens).toBe(3_000);
    expect(response.llmLog).toBe(log);
  });
});

describe("a call nobody is charged for is charged nothing", () => {
  test("the project's own provider, with billing on", async () => {
    setBillingEnabled(true);
    usage = {
      promptTokens: 1_000_000,
      completionTokens: 0,
      totalTokens: 1_000_000,
      cachedInputTokens: 500_000,
    };

    await askAi();

    expect(writtenLog().costInUSDCents).toBeUndefined();
    expect(writtenLog().wasBilled).toBeUndefined();
    expect(deduct).not.toHaveBeenCalled();
  });

  test("a self-hosted server, whose global provider has a price", async () => {
    provider = globalProvider();
    usage = {
      promptTokens: 1_000_000,
      completionTokens: 0,
      totalTokens: 1_000_000,
      cachedInputTokens: 500_000,
    };

    await askAi();

    expect(writtenLog().costInUSDCents).toBeUndefined();
    expect(deduct).not.toHaveBeenCalled();
  });
});

describe("the project's own daily token limit counts the day by what it cost", () => {
  beforeEach(() => {
    project = projectRow({ aiDailyTokenLimit: 200_000 });
  });

  test("a day of a million tokens, 900,000 of them read from the cache, counts 190,000: AI goes on", async () => {
    today = {
      totalTokens: 1_000_000,
      cacheRead: 900_000,
      cacheWrite: 0,
      billedCostInUSDCents: 0,
    };

    await askAi();

    expect(completion).toHaveBeenCalledTimes(1);
    expect(writtenLog().status).toBe(LlmLogStatus.Success);
  });

  test("the same million tokens read fresh reach the limit: AI stops, and says how many counted", async () => {
    today = {
      totalTokens: 1_000_000,
      cacheRead: 0,
      cacheWrite: 0,
      billedCostInUSDCents: 0,
    };

    await expect(askAi()).rejects.toThrow(
      "This project has reached its daily AI token limit: 1,000,000 of 200,000 tokens used today.",
    );
    expect(completion).not.toHaveBeenCalled();
    expect(writtenLog().status).toBe(LlmLogStatus.BudgetExceeded);
  });

  test("writing to the cache counts more than the tokens written: 160,000 written count 200,000", async () => {
    today = {
      totalTokens: 160_000,
      cacheRead: 0,
      cacheWrite: 160_000,
      billedCostInUSDCents: 0,
    };

    await expect(askAi()).rejects.toThrow(
      "200,000 of 200,000 tokens used today",
    );
    expect(completion).not.toHaveBeenCalled();
  });

  test("the AI Features page says the same count", async () => {
    today = {
      totalTokens: 1_000_000,
      cacheRead: 900_000,
      cacheWrite: 0,
      billedCostInUSDCents: 0,
    };

    const daily: Awaited<ReturnType<typeof AIService.getProjectDailyUsage>> =
      await AIService.getProjectDailyUsage(PROJECT_ID);

    expect(daily.usage.usedTokensToday).toBe(190_000);
    expect(daily.reachedLimit).toBeNull();
  });
});

describe("the incident daily token limit counts the lane's day by what it cost", () => {
  beforeEach(() => {
    project = projectRow({ incidentAiDailyAutonomousTokenLimit: 200_000 });
  });

  test("an investigation lane that read most of its tokens from the cache goes on", async () => {
    today = {
      totalTokens: 1_000_000,
      cacheRead: 900_000,
      cacheWrite: 0,
      billedCostInUSDCents: 0,
    };

    await investigate();

    expect(completion).toHaveBeenCalledTimes(1);
    expect(
      (
        await AIService.getAutonomousDailyBudgetStatus(PROJECT_ID, {
          incidentId: INCIDENT_ID,
        })
      ).usedTokensToday,
    ).toBe(190_000);
  });

  test("the same tokens read fresh exhaust it, and the refusal counts them as counted", async () => {
    today = {
      totalTokens: 1_000_000,
      cacheRead: 0,
      cacheWrite: 0,
      billedCostInUSDCents: 0,
    };

    await expect(investigate()).rejects.toThrow(
      "Daily autonomous AI token budget exhausted (1,000,000 of 200,000 tokens used today).",
    );
    expect(completion).not.toHaveBeenCalled();
  });
});
