import AIService, {
  AI_DISABLED_MESSAGE,
  AI_INCIDENT_INVESTIGATION_FEATURE,
  AILogResponse,
  getProjectDailyLimitMessage,
  PROJECT_DAILY_AI_LIMIT_REACHED_PATTERN,
  PROJECT_DAILY_AI_LIMITS_LOCATION,
  ProjectAiDailyLimitStatus,
} from "../../../Server/Services/AIService";
import AIBillingService from "../../../Server/Services/AIBillingService";
import LlmLogService from "../../../Server/Services/LlmLogService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import ProjectService from "../../../Server/Services/ProjectService";
import { isPermanentInvestigationFailure } from "../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import LLMService from "../../../Server/Utils/LLM/LLMService";
import logger from "../../../Server/Utils/Logger";
import LlmLog from "../../../Models/DatabaseModels/LlmLog";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../Models/DatabaseModels/Project";
import { ProjectAiDailyLimit } from "../../../Types/AI/ProjectAiDailyLimits";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import LlmLogStatus from "../../../Types/LlmLogStatus";
import LlmType from "../../../Types/LLM/LlmType";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A project's own daily AI limits (Project Settings → AI Features → More
 * settings): the most tokens its AI may use each UTC day, and - where AI is
 * billed - the most AI credits it may spend. They are a ceiling over EVERY
 * AI call, Ask AI included, enforced inside AIService.executeWithLogging,
 * which every AI call in the codebase passes through.
 *
 * These pin: counting (only what applies, only since midnight UTC, tokens
 * of every call and the cost of billed calls), enforcement (refused with
 * one sentence, logged in the AI Logs, the model never called), the reset
 * at midnight UTC, unset meaning no limit (and no query), and billing both
 * ways - a spend limit counts only billed calls, and where AI is not billed
 * there is none.
 */

type MockBillingGlobal = typeof globalThis & {
  __projectDailyLimitsTestBillingEnabled: boolean;
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: MockBillingGlobal = globalThis as MockBillingGlobal;
  mockGlobal.__projectDailyLimitsTestBillingEnabled = false;

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockGlobal.__projectDailyLimitsTestBillingEnabled;
    },
  });

  return mocked;
});

function setBillingEnabled(value: boolean): void {
  (globalThis as MockBillingGlobal).__projectDailyLimitsTestBillingEnabled =
    value;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

// Ask AI's label in the AI Logs (ChatAgentRunner's OBSERVABILITY_CHAT_FEATURE).
const ASK_AI_FEATURE: string = "Observability Chat";

// Mid-afternoon, UTC.
const NOW: Date = new Date("2026-10-05T15:30:00.000Z");
const TODAY_MIDNIGHT_UTC: string = "2026-10-05T00:00:00.000Z";
const TOMORROW_MIDNIGHT_UTC: string = "2026-10-06T00:00:00.000Z";

/*
 * A project's AI Logs, as rows the usage sum reads: the fake
 * getProjectUsageSince adds up exactly the rows created since the time it
 * is asked about, so the day boundary is really exercised.
 */
interface FakeLogRow {
  createdAt: string;
  totalTokens: number;
  costInUSDCents: number;
  wasBilled: boolean;
}

let logRows: Array<FakeLogRow> = [];
let usageQuery: jest.SpyInstance;
let projectLookup: jest.SpyInstance;
let providerForChat: jest.SpyInstance;
let providerForProject: jest.SpyInstance;
let completion: jest.SpyInstance;
let createLog: jest.SpyInstance;

function projectRow(values: Record<string, unknown> = {}): Project {
  return {
    id: PROJECT_ID,
    enableAi: true,
    aiCurrentBalanceInUSDCents: 10_000,
    ...values,
  } as unknown as Project;
}

function ownProvider(): LlmProvider {
  return {
    id: ObjectID.generate(),
    name: "Our OpenAI",
    llmType: LlmType.OpenAI,
    isGlobalLlm: false,
    costPerMillionTokensInUSDCents: 0,
  } as unknown as LlmProvider;
}

// OneUptime's own provider on Cloud: billed to the project's AI credits.
function billedGlobalProvider(): LlmProvider {
  return {
    id: ObjectID.generate(),
    name: "OneUptime AI",
    llmType: LlmType.OpenAI,
    isGlobalLlm: true,
    costPerMillionTokensInUSDCents: 500,
  } as unknown as LlmProvider;
}

async function execute(
  feature: string = ASK_AI_FEATURE,
): Promise<AILogResponse> {
  return AIService.executeWithLogging({
    projectId: PROJECT_ID,
    feature,
    messages: [{ role: "user", content: "what broke?" }],
  });
}

// The LlmLog row the call wrote (the refusal, when it was refused).
function writtenLog(): LlmLog {
  return (createLog.mock.calls[0]![0] as { data: LlmLog }).data;
}

beforeEach(() => {
  setBillingEnabled(false);
  logRows = [];

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(NOW.getTime());
  });

  usageQuery = jest
    .spyOn(LlmLogService, "getProjectUsageSince")
    .mockImplementation(
      async (data: {
        projectId: ObjectID;
        since: Date;
      }): Promise<{ totalTokens: number; billedCostInUSDCents: number }> => {
        const rows: Array<FakeLogRow> = logRows.filter(
          (row: FakeLogRow): boolean => {
            return new Date(row.createdAt).getTime() >= data.since.getTime();
          },
        );

        return {
          totalTokens: rows.reduce((sum: number, row: FakeLogRow) => {
            return sum + row.totalTokens;
          }, 0),
          billedCostInUSDCents: rows.reduce((sum: number, row: FakeLogRow) => {
            return sum + (row.wasBilled ? row.costInUSDCents : 0);
          }, 0),
        };
      },
    );

  projectLookup = jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue(projectRow());
  providerForChat = jest
    .spyOn(LlmProviderService, "getProviderForChat")
    .mockResolvedValue(ownProvider());
  providerForProject = jest
    .spyOn(LlmProviderService, "getLLMProviderForProject")
    .mockResolvedValue(ownProvider());
  completion = jest.spyOn(LLMService, "getCompletion").mockResolvedValue({
    content: "the model answered",
    usage: { totalTokens: 1200 },
  } as Awaited<ReturnType<typeof LLMService.getCompletion>>);
  createLog = jest
    .spyOn(LlmLogService, "create")
    .mockResolvedValue(new LlmLog());
  jest
    .spyOn(ProjectService, "deductAiBalanceInUSDCents")
    .mockResolvedValue(undefined);
  jest
    .spyOn(AIBillingService, "rechargeIfBalanceIsLow")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  setBillingEnabled(false);
});

describe("the sentence a refusal says", () => {
  test("for the token limit: which limit, how much, when AI starts again, who can change it and where", () => {
    expect(
      getProjectDailyLimitMessage({
        reachedLimit: ProjectAiDailyLimit.Tokens,
        tokenLimit: 200000,
        spendLimitInUSD: null,
        usage: { usedTokensToday: 201234, spentTodayInUSDCents: 0 },
      }),
    ).toBe(
      "This project has reached its daily AI token limit: 201,234 of 200,000 tokens used today. OneUptime AI starts again at midnight UTC. A project owner or someone with Manage Billing can raise or remove the limit in Project Settings → AI Features → More settings.",
    );
  });

  test("for the spend limit, in dollars", () => {
    expect(
      getProjectDailyLimitMessage({
        reachedLimit: ProjectAiDailyLimit.Spend,
        tokenLimit: null,
        spendLimitInUSD: 25,
        usage: { usedTokensToday: 9_000_000, spentTodayInUSDCents: 2503 },
      }),
    ).toBe(
      "This project has reached its daily AI spend limit: $25.03 of $25 spent today. OneUptime AI starts again at midnight UTC. A project owner or someone with Manage Billing can raise or remove the limit in Project Settings → AI Features → More settings.",
    );
  });

  test("fits where it is shown: a failed run, a chat message and the AI Logs", () => {
    const longest: string = getProjectDailyLimitMessage({
      reachedLimit: ProjectAiDailyLimit.Tokens,
      tokenLimit: 2_000_000_000,
      spendLimitInUSD: null,
      usage: { usedTokensToday: 2_000_999_999, spentTodayInUSDCents: 0 },
    });

    // failOrRequeue keeps 400 characters, a chat message 480, LlmLog 490.
    expect(longest.length).toBeLessThan(400);
  });

  test("is recognised as a refusal no retry can get past", () => {
    for (const reached of [
      ProjectAiDailyLimit.Tokens,
      ProjectAiDailyLimit.Spend,
    ]) {
      const message: string = getProjectDailyLimitMessage({
        reachedLimit: reached,
        tokenLimit: 10,
        spendLimitInUSD: 1,
        usage: { usedTokensToday: 10, spentTodayInUSDCents: 100 },
      });

      expect(PROJECT_DAILY_AI_LIMIT_REACHED_PATTERN.test(message)).toBe(true);
      expect(isPermanentInvestigationFailure(message)).toBe(true);
      expect(message).toContain(PROJECT_DAILY_AI_LIMITS_LOCATION);
    }
  });

  test("a provider's own failure is still retried", () => {
    expect(
      isPermanentInvestigationFailure("429 Too Many Requests: rate limited"),
    ).toBe(false);
    expect(isPermanentInvestigationFailure("socket hang up")).toBe(false);
    // The lane budget's own refusal stays permanent too.
    expect(
      isPermanentInvestigationFailure(
        "Daily autonomous AI token budget exhausted (10 of 10 tokens used today).",
      ),
    ).toBe(true);
  });
});

describe("AIService.getProjectDailyLimitStatus: counting", () => {
  test("no limit set: nothing is counted, no provider is looked up, nothing is reached", async () => {
    logRows = [
      {
        createdAt: "2026-10-05T10:00:00.000Z",
        totalTokens: 999_999_999,
        costInUSDCents: 999_999,
        wasBilled: true,
      },
    ];

    const status: ProjectAiDailyLimitStatus =
      await AIService.getProjectDailyLimitStatus({ projectId: PROJECT_ID });

    expect(status).toEqual({
      tokenLimit: null,
      spendLimitInUSD: null,
      reachedLimit: null,
      usage: { usedTokensToday: 0, spentTodayInUSDCents: 0 },
      isSpendCounted: false,
      resetsAt: new Date(TOMORROW_MIDNIGHT_UTC),
    });
    expect(usageQuery).not.toHaveBeenCalled();
    expect(providerForProject).not.toHaveBeenCalled();
  });

  test("reads the two limit columns of this project, and when each last stopped AI, as root", async () => {
    await AIService.getProjectDailyLimitStatus({ projectId: PROJECT_ID });

    expect(projectLookup).toHaveBeenCalledWith({
      id: PROJECT_ID,
      select: {
        aiDailyTokenLimit: true,
        aiDailySpendLimitInUSD: true,
        aiDailyTokenLimitReachedAt: true,
        aiDailySpendLimitReachedAt: true,
      },
      props: { isRoot: true },
    });
  });

  test("uses the row a caller already read, without reading it again", async () => {
    await AIService.getProjectDailyLimitStatus({
      projectId: PROJECT_ID,
      project: projectRow({ aiDailyTokenLimit: 5000 }),
    });

    expect(projectLookup).not.toHaveBeenCalled();
    expect(usageQuery).toHaveBeenCalledTimes(1);
  });

  test("counts this project's AI use since midnight UTC", async () => {
    await AIService.getProjectDailyLimitStatus({
      projectId: PROJECT_ID,
      project: projectRow({ aiDailyTokenLimit: 5000 }),
    });

    expect(usageQuery).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      since: new Date(TODAY_MIDNIGHT_UTC),
    });
  });

  test.each([
    [4999, null],
    [5000, ProjectAiDailyLimit.Tokens],
    [7500, ProjectAiDailyLimit.Tokens],
  ])(
    "%s tokens used today against a 5,000-token limit: %s",
    async (used: number, reached: ProjectAiDailyLimit | null) => {
      logRows = [
        {
          createdAt: "2026-10-05T09:00:00.000Z",
          totalTokens: used,
          costInUSDCents: 0,
          wasBilled: false,
        },
      ];

      const status: ProjectAiDailyLimitStatus =
        await AIService.getProjectDailyLimitStatus({
          projectId: PROJECT_ID,
          project: projectRow({ aiDailyTokenLimit: 5000 }),
        });

      expect(status.reachedLimit).toBe(reached);
      expect(status.tokenLimit).toBe(5000);
      expect(status.usage.usedTokensToday).toBe(used);
    },
  );

  /*
   * Every call counts toward the token limit, whatever the feature or the
   * provider: the sum is over the project's whole AI Log for the day.
   */
  test("adds up every call of the day, whatever it was", async () => {
    logRows = [
      // Ask AI on the project's own provider.
      {
        createdAt: "2026-10-05T01:00:00.000Z",
        totalTokens: 2000,
        costInUSDCents: 0,
        wasBilled: false,
      },
      // An investigation on OneUptime's billed provider.
      {
        createdAt: "2026-10-05T02:00:00.000Z",
        totalTokens: 2500,
        costInUSDCents: 2,
        wasBilled: true,
      },
      // A refused call: no tokens.
      {
        createdAt: "2026-10-05T03:00:00.000Z",
        totalTokens: 0,
        costInUSDCents: 0,
        wasBilled: false,
      },
      {
        createdAt: "2026-10-05T15:29:59.000Z",
        totalTokens: 500,
        costInUSDCents: 1,
        wasBilled: true,
      },
    ];

    const status: ProjectAiDailyLimitStatus =
      await AIService.getProjectDailyLimitStatus({
        projectId: PROJECT_ID,
        project: projectRow({ aiDailyTokenLimit: 5000 }),
      });

    expect(status.usage.usedTokensToday).toBe(5000);
    expect(status.reachedLimit).toBe(ProjectAiDailyLimit.Tokens);
  });
});

/*
 * The day resets at midnight UTC: yesterday's use, however large, counts
 * for nothing today, and a limit reached late yesterday stops nothing once
 * the new UTC day has begun.
 */
describe("AIService.getProjectDailyLimitStatus: the reset at midnight UTC", () => {
  beforeEach(() => {
    logRows = [
      {
        createdAt: "2026-10-04T23:59:59.999Z",
        totalTokens: 900_000,
        costInUSDCents: 9000,
        wasBilled: true,
      },
    ];
  });

  function at(isoTime: string): void {
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date(isoTime);
    });
  }

  test("a limit reached a moment before midnight UTC holds until midnight", async () => {
    at("2026-10-04T23:59:59.999Z");

    const status: ProjectAiDailyLimitStatus =
      await AIService.getProjectDailyLimitStatus({
        projectId: PROJECT_ID,
        project: projectRow({ aiDailyTokenLimit: 100_000 }),
      });

    expect(status.reachedLimit).toBe(ProjectAiDailyLimit.Tokens);
    expect(status.resetsAt.toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });

  test("at midnight UTC the count starts again", async () => {
    at("2026-10-05T00:00:00.000Z");

    const status: ProjectAiDailyLimitStatus =
      await AIService.getProjectDailyLimitStatus({
        projectId: PROJECT_ID,
        project: projectRow({ aiDailyTokenLimit: 100_000 }),
      });

    expect(status.reachedLimit).toBeNull();
    expect(status.usage.usedTokensToday).toBe(0);
    expect(usageQuery).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      since: new Date("2026-10-05T00:00:00.000Z"),
    });
    expect(status.resetsAt.toISOString()).toBe("2026-10-06T00:00:00.000Z");
  });

  test("and the model is called again", async () => {
    at("2026-10-05T00:00:01.000Z");
    projectLookup.mockResolvedValue(projectRow({ aiDailyTokenLimit: 100_000 }));

    await expect(execute()).resolves.toBeDefined();
    expect(completion).toHaveBeenCalledTimes(1);
  });
});

describe("AIService.getProjectDailyLimitStatus: the spend limit, billing on", () => {
  beforeEach(() => {
    setBillingEnabled(true);
    logRows = [
      {
        createdAt: "2026-10-05T08:00:00.000Z",
        totalTokens: 400_000,
        costInUSDCents: 2000,
        wasBilled: true,
      },
      // Through the project's own provider: no cost to OneUptime credits.
      {
        createdAt: "2026-10-05T09:00:00.000Z",
        totalTokens: 600_000,
        costInUSDCents: 0,
        wasBilled: false,
      },
    ];
  });

  test("counts only what was billed to the project's AI credits", async () => {
    const status: ProjectAiDailyLimitStatus =
      await AIService.getProjectDailyLimitStatus({
        projectId: PROJECT_ID,
        project: projectRow({ aiDailySpendLimitInUSD: 25 }),
        isBilled: true,
      });

    expect(status.spendLimitInUSD).toBe(25);
    expect(status.usage.spentTodayInUSDCents).toBe(2000);
    expect(status.reachedLimit).toBeNull();
  });

  test("stops billed work once the spend reaches the limit", async () => {
    const status: ProjectAiDailyLimitStatus =
      await AIService.getProjectDailyLimitStatus({
        projectId: PROJECT_ID,
        project: projectRow({ aiDailySpendLimitInUSD: 20 }),
        isBilled: true,
      });

    expect(status.reachedLimit).toBe(ProjectAiDailyLimit.Spend);
    expect(status.isSpendCounted).toBe(true);
  });

  test("never stops work that is not billed, and counts nothing for it", async () => {
    const status: ProjectAiDailyLimitStatus =
      await AIService.getProjectDailyLimitStatus({
        projectId: PROJECT_ID,
        project: projectRow({ aiDailySpendLimitInUSD: 1 }),
        isBilled: false,
      });

    expect(status.reachedLimit).toBeNull();
    expect(status.isSpendCounted).toBe(false);
    expect(usageQuery).not.toHaveBeenCalled();
  });

  test("with no caller to say, the project's own provider decides whether the work is billed", async () => {
    providerForProject.mockResolvedValue(billedGlobalProvider());

    const billed: ProjectAiDailyLimitStatus =
      await AIService.getProjectDailyLimitStatus({
        projectId: PROJECT_ID,
        project: projectRow({ aiDailySpendLimitInUSD: 20 }),
      });

    expect(billed.reachedLimit).toBe(ProjectAiDailyLimit.Spend);
    expect(providerForProject).toHaveBeenCalledWith(PROJECT_ID);

    providerForProject.mockResolvedValue(ownProvider());

    const notBilled: ProjectAiDailyLimitStatus =
      await AIService.getProjectDailyLimitStatus({
        projectId: PROJECT_ID,
        project: projectRow({ aiDailySpendLimitInUSD: 20 }),
      });

    expect(notBilled.reachedLimit).toBeNull();
  });

  test("a free global provider bills nothing, so spend does not apply", async () => {
    providerForProject.mockResolvedValue({
      ...billedGlobalProvider(),
      costPerMillionTokensInUSDCents: 0,
    } as unknown as LlmProvider);

    const status: ProjectAiDailyLimitStatus =
      await AIService.getProjectDailyLimitStatus({
        projectId: PROJECT_ID,
        project: projectRow({ aiDailySpendLimitInUSD: 1 }),
      });

    expect(status.reachedLimit).toBeNull();
  });

  test("the token limit still applies beside a spend limit", async () => {
    const status: ProjectAiDailyLimitStatus =
      await AIService.getProjectDailyLimitStatus({
        projectId: PROJECT_ID,
        project: projectRow({
          aiDailyTokenLimit: 1_000_000,
          aiDailySpendLimitInUSD: 500,
        }),
        isBilled: false,
      });

    expect(status.usage.usedTokensToday).toBe(1_000_000);
    expect(status.reachedLimit).toBe(ProjectAiDailyLimit.Tokens);
  });
});

describe("AIService.getProjectDailyLimitStatus: the spend limit, billing off", () => {
  test("a stored spend limit limits nothing where AI is not billed", async () => {
    setBillingEnabled(false);
    logRows = [
      {
        createdAt: "2026-10-05T08:00:00.000Z",
        totalTokens: 10,
        costInUSDCents: 99_999,
        wasBilled: true,
      },
    ];

    const status: ProjectAiDailyLimitStatus =
      await AIService.getProjectDailyLimitStatus({
        projectId: PROJECT_ID,
        project: projectRow({ aiDailySpendLimitInUSD: 1 }),
        isBilled: true,
      });

    expect(status.spendLimitInUSD).toBeNull();
    expect(status.reachedLimit).toBeNull();
    expect(usageQuery).not.toHaveBeenCalled();
    expect(providerForProject).not.toHaveBeenCalled();
  });
});

describe("AIService.isProjectAiBilled", () => {
  test("only OneUptime's own costed provider, with billing on, bills", async () => {
    setBillingEnabled(true);

    expect(
      await AIService.isProjectAiBilled({
        projectId: PROJECT_ID,
        llmProvider: billedGlobalProvider(),
      }),
    ).toBe(true);
    expect(
      await AIService.isProjectAiBilled({
        projectId: PROJECT_ID,
        llmProvider: ownProvider(),
      }),
    ).toBe(false);
    expect(
      await AIService.isProjectAiBilled({
        projectId: PROJECT_ID,
        llmProvider: null,
      }),
    ).toBe(false);

    setBillingEnabled(false);

    expect(
      await AIService.isProjectAiBilled({
        projectId: PROJECT_ID,
        llmProvider: billedGlobalProvider(),
      }),
    ).toBe(false);
  });
});

describe("AIService.getReachedProjectDailyLimit", () => {
  test("is the status when a limit is reached", async () => {
    projectLookup.mockResolvedValue(projectRow({ aiDailyTokenLimit: 10 }));
    logRows = [
      {
        createdAt: "2026-10-05T08:00:00.000Z",
        totalTokens: 10,
        costInUSDCents: 0,
        wasBilled: false,
      },
    ];

    const reached: ProjectAiDailyLimitStatus | null =
      await AIService.getReachedProjectDailyLimit({ projectId: PROJECT_ID });

    expect(reached?.reachedLimit).toBe(ProjectAiDailyLimit.Tokens);
  });

  test("is null while there is room, and with no limit", async () => {
    projectLookup.mockResolvedValue(projectRow({ aiDailyTokenLimit: 10 }));

    expect(
      await AIService.getReachedProjectDailyLimit({ projectId: PROJECT_ID }),
    ).toBeNull();

    projectLookup.mockResolvedValue(projectRow());

    expect(
      await AIService.getReachedProjectDailyLimit({ projectId: PROJECT_ID }),
    ).toBeNull();
  });

  /*
   * It decides whether to START work. Limits it cannot read never stop
   * anything there: the model call itself still enforces them.
   */
  test("fails open, and says why in the server log", async () => {
    projectLookup.mockRejectedValue(new Error("database down"));
    const errorLog: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {
        return undefined as never;
      });

    expect(
      await AIService.getReachedProjectDailyLimit({ projectId: PROJECT_ID }),
    ).toBeNull();
    expect(String(errorLog.mock.calls[0]![0])).toContain(
      "could not check the daily AI limits",
    );
  });
});

describe("AIService.getProjectDailyUsage", () => {
  test("counts today's use even with no limit set: it is what someone choosing a limit needs", async () => {
    logRows = [
      {
        createdAt: "2026-10-05T08:00:00.000Z",
        totalTokens: 45210,
        costInUSDCents: 320,
        wasBilled: true,
      },
      {
        createdAt: "2026-10-04T08:00:00.000Z",
        totalTokens: 1_000_000,
        costInUSDCents: 10_000,
        wasBilled: true,
      },
    ];

    setBillingEnabled(true);

    const today: Awaited<ReturnType<typeof AIService.getProjectDailyUsage>> =
      await AIService.getProjectDailyUsage(PROJECT_ID);

    expect(today).toEqual({
      limits: { tokenLimit: null, spendLimitInUSD: null },
      usage: { usedTokensToday: 45210, spentTodayInUSDCents: 320 },
      reachedLimit: null,
      dayStartedAt: new Date(TODAY_MIDNIGHT_UTC),
      resetsAt: new Date(TOMORROW_MIDNIGHT_UTC),
    });
  });

  test("says which limit is reached", async () => {
    setBillingEnabled(true);
    projectLookup.mockResolvedValue(
      projectRow({ aiDailyTokenLimit: 999_999, aiDailySpendLimitInUSD: 3 }),
    );
    logRows = [
      {
        createdAt: "2026-10-05T08:00:00.000Z",
        totalTokens: 45210,
        costInUSDCents: 320,
        wasBilled: true,
      },
    ];

    const today: Awaited<ReturnType<typeof AIService.getProjectDailyUsage>> =
      await AIService.getProjectDailyUsage(PROJECT_ID);

    expect(today.reachedLimit).toBe(ProjectAiDailyLimit.Spend);
    expect(today.limits).toEqual({ tokenLimit: 999_999, spendLimitInUSD: 3 });
  });

  test("where AI is not billed, speaks of no spend and no spend limit", async () => {
    setBillingEnabled(false);
    projectLookup.mockResolvedValue(
      projectRow({ aiDailyTokenLimit: 50_000, aiDailySpendLimitInUSD: 3 }),
    );
    logRows = [
      {
        createdAt: "2026-10-05T08:00:00.000Z",
        totalTokens: 1000,
        costInUSDCents: 320,
        wasBilled: true,
      },
    ];

    const today: Awaited<ReturnType<typeof AIService.getProjectDailyUsage>> =
      await AIService.getProjectDailyUsage(PROJECT_ID);

    expect(today.usage).toEqual({
      usedTokensToday: 1000,
      spentTodayInUSDCents: 0,
    });
    expect(today.limits).toEqual({ tokenLimit: 50_000, spendLimitInUSD: null });
    expect(today.reachedLimit).toBeNull();
  });
});

describe.each([
  ["billing on", true],
  ["billing off", false],
])(
  "AIService.executeWithLogging and the project's daily token limit, %s",
  (_name: string, billing: boolean) => {
    beforeEach(() => {
      setBillingEnabled(billing);
    });

    test("no limit: the call runs, and nothing is counted", async () => {
      logRows = [
        {
          createdAt: "2026-10-05T08:00:00.000Z",
          totalTokens: 999_999_999,
          costInUSDCents: 0,
          wasBilled: false,
        },
      ];

      const response: AILogResponse = await execute();

      expect(response.content).toBe("the model answered");
      expect(usageQuery).not.toHaveBeenCalled();
    });

    test("reads the limits on the same project row as the AI switch: one read", async () => {
      projectLookup.mockResolvedValue(projectRow({ aiDailyTokenLimit: 5000 }));

      await execute();

      expect(projectLookup).toHaveBeenCalledTimes(1);
      expect(
        (projectLookup.mock.calls[0]![0] as { select: Record<string, boolean> })
          .select,
      ).toEqual({
        enableAi: true,
        aiCurrentBalanceInUSDCents: true,
        // Auto Recharge refills used-up credits before the call.
        enableAutoRechargeAiBalance: true,
        autoAiRechargeByBalanceInUSD: true,
        autoRechargeAiWhenCurrentBalanceFallsInUSD: true,
        // Whether the owners were told the credits ran out.
        lowAiBalanceNotificationSentToOwners: true,
        aiDailyTokenLimit: true,
        aiDailySpendLimitInUSD: true,
        // When each limit last stopped AI: telling the owners costs no read.
        aiDailyTokenLimitReachedAt: true,
        aiDailySpendLimitReachedAt: true,
      });
    });

    test("under the limit: the call runs", async () => {
      projectLookup.mockResolvedValue(projectRow({ aiDailyTokenLimit: 5000 }));
      logRows = [
        {
          createdAt: "2026-10-05T08:00:00.000Z",
          totalTokens: 4999,
          costInUSDCents: 0,
          wasBilled: false,
        },
      ];

      await expect(execute()).resolves.toBeDefined();
      expect(completion).toHaveBeenCalledTimes(1);
      expect(writtenLog().status).toBe(LlmLogStatus.Success);
    });

    /*
     * Ask AI is refused too: the project's ceiling is about everything its
     * AI does, unlike the incident and alert limits, which never stop it.
     */
    test.each([
      ["Ask AI", ASK_AI_FEATURE],
      ["an incident investigation", AI_INCIDENT_INVESTIGATION_FEATURE],
      ["a Generate with AI button", "Incident Postmortem"],
    ])(
      "at the limit, %s is refused in one sentence, logged, and the model is never called",
      async (_lane: string, feature: string) => {
        projectLookup.mockResolvedValue(
          projectRow({ aiDailyTokenLimit: 5000 }),
        );
        logRows = [
          {
            createdAt: "2026-10-05T08:00:00.000Z",
            totalTokens: 5000,
            costInUSDCents: 0,
            wasBilled: false,
          },
        ];

        const expected: string =
          "This project has reached its daily AI token limit: 5,000 of 5,000 tokens used today. OneUptime AI starts again at midnight UTC. A project owner or someone with Manage Billing can raise or remove the limit in Project Settings → AI Features → More settings.";

        const call: Promise<AILogResponse> = execute(feature);

        await expect(call).rejects.toBeInstanceOf(BadDataException);
        await expect(call).rejects.toThrow(expected);
        expect(completion).not.toHaveBeenCalled();

        // The AI Logs show the refused call and why.
        expect(createLog).toHaveBeenCalledTimes(1);
        const log: LlmLog = writtenLog();
        expect(log.status).toBe(LlmLogStatus.BudgetExceeded);
        expect(log.statusMessage).toBe(expected);
        expect(log.feature).toBe(feature);
        expect(log.projectId).toEqual(PROJECT_ID);
        expect(log.totalTokens).toBeUndefined();
      },
    );

    // Order: the switch is the reason a switched-off project hears.
    test("with AI switched off, the refusal is about the switch, not the limit", async () => {
      projectLookup.mockResolvedValue(
        projectRow({ enableAi: false, aiDailyTokenLimit: 1 }),
      );
      logRows = [
        {
          createdAt: "2026-10-05T08:00:00.000Z",
          totalTokens: 100,
          costInUSDCents: 0,
          wasBilled: false,
        },
      ];

      await expect(execute()).rejects.toThrow(AI_DISABLED_MESSAGE);
      expect(usageQuery).not.toHaveBeenCalled();
    });
  },
);

describe("AIService.executeWithLogging and the project's daily spend limit", () => {
  beforeEach(() => {
    logRows = [
      {
        createdAt: "2026-10-05T08:00:00.000Z",
        totalTokens: 400_000,
        costInUSDCents: 2500,
        wasBilled: true,
      },
    ];
  });

  test("billing on, OneUptime's billed provider: refused at the limit, in dollars", async () => {
    setBillingEnabled(true);
    providerForChat.mockResolvedValue(billedGlobalProvider());
    projectLookup.mockResolvedValue(projectRow({ aiDailySpendLimitInUSD: 25 }));

    const call: Promise<AILogResponse> = execute();

    await expect(call).rejects.toThrow(
      "This project has reached its daily AI spend limit: $25 of $25 spent today.",
    );
    expect(completion).not.toHaveBeenCalled();
    expect(writtenLog().status).toBe(LlmLogStatus.BudgetExceeded);
  });

  test("billing on, the project's own provider: the spend limit stops nothing", async () => {
    setBillingEnabled(true);
    providerForChat.mockResolvedValue(ownProvider());
    projectLookup.mockResolvedValue(projectRow({ aiDailySpendLimitInUSD: 25 }));

    await expect(execute()).resolves.toBeDefined();
    expect(completion).toHaveBeenCalledTimes(1);
    expect(usageQuery).not.toHaveBeenCalled();
  });

  test("billing off: a stored spend limit stops nothing, and nothing is counted", async () => {
    setBillingEnabled(false);
    providerForChat.mockResolvedValue(billedGlobalProvider());
    projectLookup.mockResolvedValue(projectRow({ aiDailySpendLimitInUSD: 1 }));

    await expect(execute()).resolves.toBeDefined();
    expect(completion).toHaveBeenCalledTimes(1);
    expect(usageQuery).not.toHaveBeenCalled();
  });

  /*
   * Order with the balance: a project with no AI credits is told to add
   * credits - that is what stops every billed call - before it is told
   * about a limit.
   */
  test("billing on, no balance and the limit reached: the balance refusal comes first", async () => {
    setBillingEnabled(true);
    providerForChat.mockResolvedValue(billedGlobalProvider());
    projectLookup.mockResolvedValue(
      projectRow({ aiCurrentBalanceInUSDCents: 0, aiDailySpendLimitInUSD: 25 }),
    );

    await expect(execute()).rejects.toThrow(
      /This project's AI credits are used up\./,
    );
    expect(writtenLog().status).toBe(LlmLogStatus.InsufficientBalance);
  });
});

/*
 * The incident and alert daily limits still apply under the project's
 * ceiling: a call with room left in the project is still refused by its
 * exhausted lane.
 */
describe("the incident and alert limits still apply under the ceiling", () => {
  test("room in the project, but the incident lane's budget is used up: the lane refuses", async () => {
    projectLookup.mockResolvedValue(
      projectRow({ aiDailyTokenLimit: 1_000_000 }),
    );
    const laneBudget: jest.SpyInstance = jest
      .spyOn(AIService, "getAutonomousDailyBudgetStatus")
      .mockResolvedValue({
        exhausted: true,
        limitInTokens: 100,
        usedTokensToday: 100,
      });

    await expect(
      AIService.executeWithLogging({
        projectId: PROJECT_ID,
        incidentId: ObjectID.generate(),
        feature: AI_INCIDENT_INVESTIGATION_FEATURE,
        messages: [{ role: "user", content: "investigate" }],
      }),
    ).rejects.toThrow(/Daily autonomous AI token budget exhausted/);
    expect(laneBudget).toHaveBeenCalledTimes(1);
    expect(completion).not.toHaveBeenCalled();
  });

  test("the project's ceiling reached: refused before the lane is even asked", async () => {
    projectLookup.mockResolvedValue(projectRow({ aiDailyTokenLimit: 10 }));
    logRows = [
      {
        createdAt: "2026-10-05T08:00:00.000Z",
        totalTokens: 10,
        costInUSDCents: 0,
        wasBilled: false,
      },
    ];
    const laneBudget: jest.SpyInstance = jest.spyOn(
      AIService,
      "getAutonomousDailyBudgetStatus",
    );

    await expect(
      AIService.executeWithLogging({
        projectId: PROJECT_ID,
        incidentId: ObjectID.generate(),
        feature: AI_INCIDENT_INVESTIGATION_FEATURE,
        messages: [{ role: "user", content: "investigate" }],
      }),
    ).rejects.toThrow(PROJECT_DAILY_AI_LIMIT_REACHED_PATTERN);
    expect(laneBudget).not.toHaveBeenCalled();
  });
});
