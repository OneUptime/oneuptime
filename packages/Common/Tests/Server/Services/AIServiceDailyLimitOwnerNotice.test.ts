import AIService from "../../../Server/Services/AIService";
import AIBillingService from "../../../Server/Services/AIBillingService";
import LlmLogService from "../../../Server/Services/LlmLogService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import ProjectService from "../../../Server/Services/ProjectService";
import LLMService from "../../../Server/Utils/LLM/LLMService";
import LlmLog from "../../../Models/DatabaseModels/LlmLog";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../Models/DatabaseModels/Project";
import OneUptimeDate from "../../../Types/Date";
import LlmType from "../../../Types/LLM/LlmType";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Regression (found in #4410): when a project's own daily AI limit (Project
 * Settings → AI Features → More settings) was reached, nobody was told. AI
 * work was refused or skipped - the AI Logs, the folded settings section and
 * the investigation card said so - but the project's owners, the people who
 * set the limit and may change it, heard nothing.
 *
 * Now the owners are emailed the first time a limit stops OneUptime AI in a
 * UTC day: once a day for each limit, through the same owner email the
 * billing notices use (ProjectService.sendEmailToProjectOwners).
 *
 * The suite drives the real entry points - a model call refused by the
 * limit (AIService.executeWithLogging) and the pre-check that skips AI work
 * before it starts (getReachedProjectDailyLimit) - with only the database,
 * the provider and the mail mocked. The "told today" claim is a single
 * conditional UPDATE on the project row, stood in for here by a fake
 * repository that keeps the column in memory and applies the same WHERE.
 */

type MockGlobal = typeof globalThis & {
  __ownerNoticeTestBillingEnabled: boolean;
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const urlModule: { default: { fromString: (url: string) => unknown } } =
    jest.requireActual("../../../Types/API/URL");
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: MockGlobal = globalThis as MockGlobal;
  mockGlobal.__ownerNoticeTestBillingEnabled = false;

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockGlobal.__ownerNoticeTestBillingEnabled;
    },
  });

  // The dashboard's address, so the email can link to the limits.
  mocked["DashboardClientUrl"] = urlModule.default.fromString(
    "https://oneuptime.example.com/dashboard",
  );

  return mocked;
});

function setBillingEnabled(value: boolean): void {
  (globalThis as MockGlobal).__ownerNoticeTestBillingEnabled = value;
}

// Mid-afternoon, UTC.
const NOW: Date = new Date("2026-10-05T15:30:00.000Z");
const NEXT_DAY: Date = new Date("2026-10-06T09:00:00.000Z");

let now: Date = NOW;
let usedTokensToday: number = 0;
let spentTodayInUSDCents: number = 0;
let projectRow: Project;

/*
 * The "owners told today" columns, as the database holds them, per project
 * and column: what the fake repository's conditional UPDATE reads and
 * writes.
 */
let toldAt: Map<string, Date | null> = new Map();
let claimStatements: Array<string> = [];

let ownerEmails: jest.SpyInstance;

function ownProvider(): LlmProvider {
  return {
    id: ObjectID.generate(),
    name: "Our OpenAI",
    llmType: LlmType.OpenAI,
    isGlobalLlm: false,
    costPerMillionTokensInUSDCents: 0,
  } as unknown as LlmProvider;
}

function billedGlobalProvider(): LlmProvider {
  return {
    id: ObjectID.generate(),
    name: "OneUptime AI",
    llmType: LlmType.OpenAI,
    isGlobalLlm: true,
    costPerMillionTokensInUSDCents: 500,
  } as unknown as LlmProvider;
}

function newProject(values: Record<string, unknown>): Project {
  return {
    id: ObjectID.generate(),
    name: "Acme Production",
    enableAi: true,
    aiCurrentBalanceInUSDCents: 10_000,
    ...values,
  } as unknown as Project;
}

/*
 * A stand-in for the project table behind ProjectService's raw statements:
 * a conditional UPDATE of one "told at" column succeeds - and returns the
 * row - only when the column is empty or earlier than the day start it is
 * given, exactly as Postgres would.
 */
function fakeProjectRepository(): unknown {
  return {
    manager: {
      query: async (
        sql: string,
        params: Array<unknown>,
      ): Promise<Array<{ _id: string }>> => {
        claimStatements.push(sql);

        const column: string | undefined = [
          "aiDailyTokenLimitReachedAt",
          "aiDailySpendLimitReachedAt",
        ].find((name: string): boolean => {
          return sql.includes(`"${name}"`);
        });

        if (!column) {
          throw new Error(`Unexpected statement: ${sql}`);
        }

        const projectId: string = params.find((value: unknown): boolean => {
          return typeof value === "string";
        }) as string;

        const dates: Array<Date> = params
          .filter((value: unknown): value is Date => {
            return value instanceof Date;
          })
          .sort((a: Date, b: Date): number => {
            return a.getTime() - b.getTime();
          });

        const dayStart: Date = dates[0]!;
        const writtenAt: Date = dates[dates.length - 1]!;
        const key: string = `${projectId}:${column}`;
        const current: Date | null = toldAt.get(key) || null;

        if (current && current.getTime() >= dayStart.getTime()) {
          return [];
        }

        toldAt.set(key, writtenAt);
        return [{ _id: projectId }];
      },
    },
  };
}

async function askAi(): Promise<unknown> {
  return AIService.executeWithLogging({
    projectId: projectRow.id!,
    feature: "Observability Chat",
    messages: [{ role: "user", content: "what broke?" }],
  });
}

function emailsFor(projectId: ObjectID): Array<Array<unknown>> {
  return ownerEmails.mock.calls.filter((call: Array<unknown>): boolean => {
    return (call[0] as ObjectID).toString() === projectId.toString();
  });
}

beforeEach(() => {
  setBillingEnabled(false);
  now = NOW;
  usedTokensToday = 0;
  spentTodayInUSDCents = 0;
  toldAt = new Map();
  claimStatements = [];
  projectRow = newProject({ aiDailyTokenLimit: 5000 });

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(now.getTime());
  });

  jest
    .spyOn(LlmLogService, "getProjectUsageSince")
    .mockImplementation(async () => {
      return {
        totalTokens: usedTokensToday,
        billedCostInUSDCents: spentTodayInUSDCents,
      };
    });

  jest.spyOn(ProjectService, "findOneById").mockImplementation(async () => {
    return projectRow;
  });

  jest
    .spyOn(ProjectService, "getRepository")
    .mockImplementation(fakeProjectRepository as never);

  ownerEmails = jest
    .spyOn(ProjectService, "sendEmailToProjectOwners")
    .mockResolvedValue(undefined);

  jest
    .spyOn(LlmProviderService, "getProviderForChat")
    .mockResolvedValue(ownProvider());
  jest
    .spyOn(LlmProviderService, "getLLMProviderForProject")
    .mockResolvedValue(ownProvider());
  jest.spyOn(LLMService, "getCompletion").mockResolvedValue({
    content: "the model answered",
    usage: { totalTokens: 1200 },
  } as Awaited<ReturnType<typeof LLMService.getCompletion>>);
  jest.spyOn(LlmLogService, "create").mockResolvedValue(new LlmLog());
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

describe("the project's owners hear when a daily AI limit stops OneUptime AI", () => {
  test("a model call refused by the token limit emails the owners: which limit, today's usage, the reset and where to change it", async () => {
    usedTokensToday = 5000;

    await expect(askAi()).rejects.toThrow(
      /reached its daily AI token limit/,
    );

    const emails: Array<Array<unknown>> = emailsFor(projectRow.id!);
    expect(emails).toHaveLength(1);

    const [, subject, message] = emails[0] as [ObjectID, string, string];

    expect(subject).toBe("Daily AI token limit reached for Acme Production");
    expect(message).toContain(
      "This project has reached its daily AI token limit: 5,000 of 5,000 tokens used today.",
    );
    expect(message).toContain("00:00 UTC on Oct 6, 2026");
    expect(message).toContain(
      `https://oneuptime.example.com/dashboard/${projectRow.id!.toString()}/settings/ai-features`,
    );
  });

  test("once a day: every later refusal that day sends nothing more", async () => {
    usedTokensToday = 5000;

    for (let attempt: number = 0; attempt < 5; attempt++) {
      await expect(askAi()).rejects.toThrow(
        /reached its daily AI token limit/,
      );
    }

    expect(emailsFor(projectRow.id!)).toHaveLength(1);
  });

  test("the next UTC day, reaching the limit again tells them again", async () => {
    usedTokensToday = 5000;
    await expect(askAi()).rejects.toThrow();

    now = NEXT_DAY;
    await expect(askAi()).rejects.toThrow();

    expect(emailsFor(projectRow.id!)).toHaveLength(2);
  });

  test("work that is skipped before it starts (the pre-check) tells them too, still once", async () => {
    usedTokensToday = 7000;

    expect(
      await AIService.getReachedProjectDailyLimit({
        projectId: projectRow.id!,
      }),
    ).not.toBeNull();
    expect(
      await AIService.getReachedProjectDailyLimit({
        projectId: projectRow.id!,
      }),
    ).not.toBeNull();
    await expect(askAi()).rejects.toThrow();

    expect(emailsFor(projectRow.id!)).toHaveLength(1);
  });

  test("under the limit, or with no limit, nobody is emailed", async () => {
    usedTokensToday = 4999;
    await askAi();

    projectRow = newProject({});
    usedTokensToday = 999_999;
    await askAi();

    expect(ownerEmails).not.toHaveBeenCalled();
    expect(claimStatements).toHaveLength(0);
  });

  test("the spend limit has its own notice: a token notice that day does not stand in for it", async () => {
    setBillingEnabled(true);
    projectRow = newProject({
      aiDailyTokenLimit: 5000,
      aiDailySpendLimitInUSD: 25,
    });
    jest
      .spyOn(LlmProviderService, "getProviderForChat")
      .mockResolvedValue(billedGlobalProvider());

    // The token limit first.
    usedTokensToday = 5000;
    await expect(askAi()).rejects.toThrow(/daily AI token limit/);

    // An owner raises the token limit; then the spend limit is reached.
    projectRow = newProject({
      id: projectRow.id,
      aiDailyTokenLimit: 50_000,
      aiDailySpendLimitInUSD: 25,
    });
    spentTodayInUSDCents = 2500;
    await expect(askAi()).rejects.toThrow(/daily AI spend limit/);
    await expect(askAi()).rejects.toThrow(/daily AI spend limit/);

    const subjects: Array<string> = emailsFor(projectRow.id!).map(
      (call: Array<unknown>): string => {
        return call[1] as string;
      },
    );

    expect(subjects).toEqual([
      "Daily AI token limit reached for Acme Production",
      "Daily AI spend limit reached for Acme Production",
    ]);
    expect(emailsFor(projectRow.id!)[1]![2]).toContain(
      "This project has reached its daily AI spend limit: $25 of $25 spent today.",
    );
  });

  test("two servers refusing at the same moment send one email between them", async () => {
    usedTokensToday = 5000;

    const results: Array<PromiseSettledResult<unknown>> =
      await Promise.allSettled([askAi(), askAi(), askAi()]);

    expect(
      results.every((result: PromiseSettledResult<unknown>): boolean => {
        return result.status === "rejected";
      }),
    ).toBe(true);
    expect(emailsFor(projectRow.id!)).toHaveLength(1);
  });

  test("the refusal is never held up or changed by the notice: a failing email still refuses with the sentence", async () => {
    usedTokensToday = 5000;
    ownerEmails.mockRejectedValue(new Error("mail server down"));

    await expect(askAi()).rejects.toThrow(
      /reached its daily AI token limit: 5,000 of 5,000 tokens used today/,
    );
  });
});
