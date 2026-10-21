import ProjectService, {
  ProjectBalanceAdjustmentResult,
} from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import FindBy from "../../../Server/Types/Database/FindBy";
import logger from "../../../Server/Utils/Logger";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import BalanceAdjustmentType from "../../../Types/Billing/BalanceAdjustmentType";
import ProjectBalanceType from "../../../Types/Billing/ProjectBalanceType";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import {
  SlackWebhookMessage,
  SlackWebhookMessages,
  captureSlackWebhookMessages,
  flushBackgroundWork,
  shownLines,
} from "../TestingUtils/SlackWebhookMessages";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A master admin adjusting a project's balance - adding to it, deducting from
 * it or setting it, on the Admin Dashboard - hands out or claws back paid
 * service with no payment behind it. The operator's Slack channel, which
 * hears of every refill of both balances (NOTIFICATION_SLACK_WEBHOOK_ON
 * _SUBSCRIPTION_UPDATE), hears of every adjustment too:
 *
 * - by how much, the balance before and after, who made it and why, for
 *   AI credits as for the SMS and call balance;
 * - only once the balance has moved: a refused adjustment tells nobody;
 * - in the background: the admin's answer waits neither on Slack nor on the
 *   reads the message makes, and nothing about the message can fail the
 *   adjustment - a project or admin that cannot be read is left out of it.
 *
 * Everything below the service boundary is a fake: no database, no Slack.
 */

type MockWebhookGlobal = typeof globalThis & {
  __balanceAdjustedSlackTestWebhook: string;
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: MockWebhookGlobal = globalThis as MockWebhookGlobal;
  mockGlobal.__balanceAdjustedSlackTestWebhook =
    "https://hooks.slack.com/services/T000/B000/subscription-updates";

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return true;
    },
  });

  Object.defineProperty(
    mocked,
    "NotificationSlackWebhookOnSubscriptionUpdate",
    {
      configurable: true,
      enumerable: true,
      get: (): string => {
        return mockGlobal.__balanceAdjustedSlackTestWebhook;
      },
    },
  );

  return mocked;
});

const WEBHOOK_URL: string =
  "https://hooks.slack.com/services/T000/B000/subscription-updates";

function setWebhook(value: string): void {
  (globalThis as MockWebhookGlobal).__balanceAdjustedSlackTestWebhook = value;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ADMIN_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

// A message's lines as Slack shows them (TestingUtils/SlackWebhookMessages).
function linesOf(message: SlackWebhookMessage | undefined): Array<string> {
  return shownLines(message?.text);
}

async function withinTwoSeconds<T>(promise: Promise<T>): Promise<T | "held"> {
  let timer: ReturnType<typeof setTimeout> | undefined = undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<"held">((resolve: (value: "held") => void) => {
        timer = setTimeout(() => {
          resolve("held");
        }, 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

type AdjustArgs = Parameters<typeof ProjectService.adjustBalance>[0];

function adjustArgs(overrides: Partial<AdjustArgs> = {}): AdjustArgs {
  return {
    projectId: PROJECT_ID,
    balanceType: ProjectBalanceType.AI,
    adjustmentType: BalanceAdjustmentType.Add,
    amountInUSDCents: 1000,
    reason: "Goodwill credit agreed on ticket 4821",
    adjustedByUserId: ADMIN_ID,
    ...overrides,
  };
}

let slack: SlackWebhookMessages;
let findOneById: jest.SpyInstance;
let findAdmin: jest.SpyInstance;
let atomicAdd: jest.SpyInstance;
let errorLog: jest.SpyInstance;

// The name read for the message selects the project's name.
function isNameRead(findBy: FindBy<Project>): boolean {
  return Boolean((findBy.select as Record<string, unknown>)?.["name"]);
}

beforeEach(() => {
  setWebhook(WEBHOOK_URL);

  findOneById = jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation((async () => {
      const project: Project = new Project();
      project.id = PROJECT_ID;
      project.name = "Kerberos Compliance Platform";
      project.smsOrCallCurrentBalanceInUSDCents = 5000;
      project.aiCurrentBalanceInUSDCents = 2500;
      return project;
    }) as never);

  atomicAdd = jest
    .spyOn(ProjectService, "atomicAddToColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);

  findAdmin = jest
    .spyOn(UserService, "findOneById")
    .mockImplementation((async () => {
      const admin: User = new User();
      admin.id = ADMIN_ID;
      admin.name = new Name("Ops Admin");
      admin.email = new Email("ops@oneuptime.example");
      return admin;
    }) as never);

  slack = captureSlackWebhookMessages();

  jest.spyOn(logger, "info").mockImplementation((): void => {});
  errorLog = jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  setWebhook(WEBHOOK_URL);
});

describe("ProjectService.adjustBalance tells the operator's Slack channel", () => {
  test("AI credits added: by how much, from what to what, who and why", async () => {
    const result: ProjectBalanceAdjustmentResult =
      await ProjectService.adjustBalance(adjustArgs());
    await flushBackgroundWork();

    expect(result).toEqual({
      previousBalanceInUSDCents: 2500,
      newBalanceInUSDCents: 3500,
    });
    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0]?.url).toBe(WEBHOOK_URL);
    expect(linesOf(slack.messages[0])).toEqual([
      "*AI Balance Adjusted:*",
      "*Project Name:* Kerberos Compliance Platform",
      `*Project ID:* ${PROJECT_ID.toString()}`,
      "*Adjustment:* Added $10 USD",
      "*Previous Balance:* $25 USD",
      "*New Balance:* $35 USD",
      "*Adjusted By:* Ops Admin (ops@oneuptime.example)",
      "*Reason:* Goodwill credit agreed on ticket 4821",
    ]);
  });

  test("SMS and call balance deducted, in the same words", async () => {
    await ProjectService.adjustBalance(
      adjustArgs({
        balanceType: ProjectBalanceType.SmsOrCall,
        adjustmentType: BalanceAdjustmentType.Deduct,
        amountInUSDCents: 1050,
        reason: "Clawback of a duplicated goodwill credit",
      }),
    );
    await flushBackgroundWork();

    expect(linesOf(slack.messages[0])).toEqual([
      "*SMS and Call Balance Adjusted:*",
      "*Project Name:* Kerberos Compliance Platform",
      `*Project ID:* ${PROJECT_ID.toString()}`,
      "*Adjustment:* Deducted $10.50 USD",
      "*Previous Balance:* $50 USD",
      "*New Balance:* $39.50 USD",
      "*Adjusted By:* Ops Admin (ops@oneuptime.example)",
      "*Reason:* Clawback of a duplicated goodwill credit",
    ]);
  });

  test("a balance set outright reads as set, from what to what", async () => {
    await ProjectService.adjustBalance(
      adjustArgs({
        adjustmentType: BalanceAdjustmentType.Set,
        amountInUSDCents: 0,
        reason: "Trial abuse",
      }),
    );
    await flushBackgroundWork();

    const lines: Array<string> = linesOf(slack.messages[0]);

    expect(lines).toContain("*Adjustment:* Set to $0 USD");
    expect(lines).toContain("*Previous Balance:* $25 USD");
    expect(lines).toContain("*New Balance:* $0 USD");
  });

  test("is posted once the balance has moved", async () => {
    await ProjectService.adjustBalance(adjustArgs());
    await flushBackgroundWork();

    const post: jest.Mock =
      SlackUtil.sendMessageToChannelViaIncomingWebhook as unknown as jest.Mock;

    expect(atomicAdd).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.invocationCallOrder[0]).toBeGreaterThan(
      atomicAdd.mock.invocationCallOrder[0]!,
    );
  });

  test("reads the project's name and the admin's, as root, for it", async () => {
    await ProjectService.adjustBalance(adjustArgs());
    await flushBackgroundWork();

    const nameRead: FindBy<Project> | undefined = findOneById.mock.calls
      .map((call: Array<unknown>) => {
        return call[0] as FindBy<Project>;
      })
      .find(isNameRead);

    expect(nameRead).toEqual({
      id: PROJECT_ID,
      select: { _id: true, name: true },
      props: { isRoot: true },
    });
    expect(findAdmin).toHaveBeenCalledWith({
      id: ADMIN_ID,
      select: { _id: true, name: true, email: true },
      props: { isRoot: true },
    });
  });

  test("an adjustment with no admin to name says so, and reads no user", async () => {
    await ProjectService.adjustBalance(
      adjustArgs({ adjustedByUserId: undefined }),
    );
    await flushBackgroundWork();

    expect(findAdmin).not.toHaveBeenCalled();
    expect(linesOf(slack.messages[0])).toContain("*Adjusted By:* Unknown");
  });

  test("an admin who cannot be read is named by their user ID, and the message still goes", async () => {
    findAdmin.mockRejectedValue(new Error("database is down"));

    await ProjectService.adjustBalance(adjustArgs());
    await flushBackgroundWork();

    expect(slack.messages).toHaveLength(1);
    expect(linesOf(slack.messages[0])).toContain(
      `*Adjusted By:* ${ADMIN_ID.toString()}`,
    );
    expect(errorLog).toHaveBeenCalled();
  });

  test("a project whose name cannot be read is named by its ID, and the message still goes", async () => {
    const answerBalance: (findBy: FindBy<Project>) => Promise<Project> =
      findOneById.getMockImplementation() as (
        findBy: FindBy<Project>,
      ) => Promise<Project>;

    findOneById.mockImplementation((async (findBy: FindBy<Project>) => {
      if (isNameRead(findBy)) {
        throw new Error("database is down");
      }

      return await answerBalance(findBy);
    }) as never);

    await ProjectService.adjustBalance(adjustArgs());
    await flushBackgroundWork();

    const lines: Array<string> = linesOf(slack.messages[0]);

    expect(lines).toContain("*Project Name:* N/A");
    expect(lines).toContain(`*Project ID:* ${PROJECT_ID.toString()}`);
  });

  test("the reason is shown as the admin typed it, trimmed, and as text", async () => {
    await ProjectService.adjustBalance(
      adjustArgs({ reason: "   <!channel> refund for INV-42 & INV-43   " }),
    );
    await flushBackgroundWork();

    // No "<" of theirs reaches Slack, and the reason reads as it was typed.
    expect(slack.messages[0]?.text).not.toContain("<!channel>");
    expect(linesOf(slack.messages[0])).toContain(
      "*Reason:* <!channel> refund for INV-42 & INV-43",
    );
  });

  test.each([
    ["nothing to add", { amountInUSDCents: 0 }],
    ["a negative amount", { amountInUSDCents: -100 }],
    ["no reason", { reason: "   " }],
    [
      "a deduction below zero",
      {
        adjustmentType: BalanceAdjustmentType.Deduct,
        amountInUSDCents: 999999,
      },
    ],
  ])(
    "an adjustment refused for %s tells nobody",
    async (_case: string, overrides: Partial<AdjustArgs>) => {
      await expect(
        ProjectService.adjustBalance(adjustArgs(overrides)),
      ).rejects.toThrow();
      await flushBackgroundWork();

      expect(atomicAdd).not.toHaveBeenCalled();
      expect(slack.messages).toHaveLength(0);
    },
  );

  test("without the webhook nothing is posted, and nothing more is read", async () => {
    setWebhook("");

    await ProjectService.adjustBalance(adjustArgs());
    await flushBackgroundWork();

    expect(slack.messages).toHaveLength(0);
    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(findAdmin).not.toHaveBeenCalled();
  });

  test("Slack failing does not fail the adjustment: it is logged", async () => {
    slack.failWith(new Error("socket hang up"));

    await expect(ProjectService.adjustBalance(adjustArgs())).resolves.toEqual({
      previousBalanceInUSDCents: 2500,
      newBalanceInUSDCents: 3500,
    });
    await flushBackgroundWork();

    expect(
      errorLog.mock.calls.some((call: Array<unknown>) => {
        return (
          String(call[0]).includes("AI balance adjustment") &&
          String(call[0]).includes("socket hang up")
        );
      }),
    ).toBe(true);
  });

  test("the admin's answer waits neither on Slack nor on the reads for the message", async () => {
    slack.holdAnswers(true);
    findAdmin.mockImplementation(() => {
      return new Promise<never>(() => {});
    });

    expect(
      await withinTwoSeconds(ProjectService.adjustBalance(adjustArgs())),
    ).toEqual({
      previousBalanceInUSDCents: 2500,
      newBalanceInUSDCents: 3500,
    });
  });
});
