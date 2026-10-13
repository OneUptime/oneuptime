import AIBillingService from "../../../Server/Services/AIBillingService";
import NotificationService from "../../../Server/Services/NotificationService";
import ProjectService from "../../../Server/Services/ProjectService";
import FindBy from "../../../Server/Types/Database/FindBy";
import logger from "../../../Server/Utils/Logger";
import Project from "../../../Models/DatabaseModels/Project";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import {
  AiCreditsRow,
  useAiCreditsWorld,
} from "../TestingUtils/AiCreditsWorld";
import {
  MessagingBalanceRow,
  useMessagingBalanceWorld,
} from "../TestingUtils/MessagingBalanceWorld";
import {
  SlackWebhookMessage,
  SlackWebhookMessages,
  flushBackgroundWork,
  shownLines,
} from "../TestingUtils/SlackWebhookMessages";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The operator's Slack channel (NOTIFICATION_SLACK_WEBHOOK_ON_SUBSCRIPTION
 * _UPDATE) hears of every refill of a project's balance - its AI credits
 * (AIBillingService) exactly as its SMS and call balance
 * (NotificationService), on the same webhook, in the same words:
 *
 * - a recharge by hand, an Auto Recharge, and the charge Auto Recharge makes
 *   the moment somebody turns it on, each say which they were;
 * - the message names the project, what was added, the balance now, and who
 *   created the project - the creator is read with the project for it (the
 *   message named them, and the read left them out, so it never did);
 * - a charge that fails, or a balance that needs none, tells nobody;
 * - callers that find the balance low together charge once, and tell once;
 * - Slack failing, or never answering, neither fails nor holds the
 *   recharge: it is posted in the background.
 *
 * The real recharge paths run, on fakes of the project row, the payment
 * provider, the shared cache, the lock and Slack (TestingUtils).
 */

type MockWebhookGlobal = typeof globalThis & {
  __balanceRefillSlackTestWebhook: string;
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: MockWebhookGlobal = globalThis as MockWebhookGlobal;
  mockGlobal.__balanceRefillSlackTestWebhook =
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
        return mockGlobal.__balanceRefillSlackTestWebhook;
      },
    },
  );

  return mocked;
});

const WEBHOOK_URL: string =
  "https://hooks.slack.com/services/T000/B000/subscription-updates";

function setWebhook(value: string): void {
  (globalThis as MockWebhookGlobal).__balanceRefillSlackTestWebhook = value;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-0000000000f1",
);

/*
 * What the call answered within two seconds, or "held" - a recharge that
 * waited on Slack would be held for as long as Slack did not answer.
 */
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

// A message's lines as Slack shows them (TestingUtils/SlackWebhookMessages).
function linesOf(message: SlackWebhookMessage | undefined): Array<string> {
  return shownLines(message?.text);
}

/*
 * One balance, driven through its own service: what both worlds share, and
 * how each balance is recharged.
 */
interface WorldUnderTest {
  row: Record<string, unknown>;
  charges: Array<number>;
  slack: SlackWebhookMessages;
  failChargesWith: (error: Error | null) => void;
  setHasPaymentMethods: (value: boolean) => void;
}

interface BalanceUnderTest {
  name: string;
  title: string;
  balanceColumn: string;
  setUp: (values: Record<string, unknown>) => WorldUnderTest;
  // Auto Recharge's settings on the row: on, adding 20 USD below 10 USD.
  autoRechargeOn: Record<string, unknown>;
  autoRechargeOff: Record<string, unknown>;
  rechargeByHand: (amountInUSD: number) => Promise<number>;
  rechargeIfLow: () => Promise<number>;
  // Somebody turns Auto Recharge on, adding 25 USD below 10 USD: the card is tried at once.
  turnAutoRechargeOn: () => Promise<number>;
}

const BALANCES: Array<BalanceUnderTest> = [
  {
    name: "AI credits",
    title: "*AI Balance Refilled:*",
    balanceColumn: "aiCurrentBalanceInUSDCents",
    setUp: (values: Record<string, unknown>): WorldUnderTest => {
      return useAiCreditsWorld(
        PROJECT_ID,
        values as Partial<AiCreditsRow>,
      ) as unknown as WorldUnderTest;
    },
    autoRechargeOn: {
      enableAutoRechargeAiBalance: true,
      autoAiRechargeByBalanceInUSD: 20,
      autoRechargeAiWhenCurrentBalanceFallsInUSD: 10,
    },
    autoRechargeOff: {
      enableAutoRechargeAiBalance: false,
      autoAiRechargeByBalanceInUSD: 20,
      autoRechargeAiWhenCurrentBalanceFallsInUSD: 10,
    },
    rechargeByHand: (amountInUSD: number): Promise<number> => {
      return AIBillingService.rechargeBalance(PROJECT_ID, amountInUSD);
    },
    rechargeIfLow: (): Promise<number> => {
      return AIBillingService.rechargeIfBalanceIsLow(PROJECT_ID);
    },
    turnAutoRechargeOn: (): Promise<number> => {
      return AIBillingService.rechargeIfBalanceIsLow(PROJECT_ID, {
        enableAutoRechargeAiBalance: true,
        autoAiRechargeByBalanceInUSD: 25,
        autoRechargeAiWhenCurrentBalanceFallsInUSD: 10,
        ignoreRecentFailure: true,
      });
    },
  },
  {
    name: "SMS and call balance",
    title: "*SMS and Call Balance Refilled:*",
    balanceColumn: "smsOrCallCurrentBalanceInUSDCents",
    setUp: (values: Record<string, unknown>): WorldUnderTest => {
      return useMessagingBalanceWorld(
        PROJECT_ID,
        values as Partial<MessagingBalanceRow>,
      ) as unknown as WorldUnderTest;
    },
    autoRechargeOn: {
      enableAutoRechargeSmsOrCallBalance: true,
      autoRechargeSmsOrCallByBalanceInUSD: 20,
      autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 10,
    },
    autoRechargeOff: {
      enableAutoRechargeSmsOrCallBalance: false,
      autoRechargeSmsOrCallByBalanceInUSD: 20,
      autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 10,
    },
    rechargeByHand: (amountInUSD: number): Promise<number> => {
      return NotificationService.rechargeBalance(PROJECT_ID, amountInUSD);
    },
    rechargeIfLow: (): Promise<number> => {
      return NotificationService.rechargeIfBalanceIsLow(PROJECT_ID);
    },
    turnAutoRechargeOn: (): Promise<number> => {
      return NotificationService.rechargeIfBalanceIsLow(PROJECT_ID, {
        enableAutoRechargeSmsOrCallBalance: true,
        autoRechargeSmsOrCallByBalanceInUSD: 25,
        autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 10,
        ignoreRecentFailure: true,
      });
    },
  },
];

// The project as it was created: its name, and who created it.
const PROJECT_VALUES: Record<string, unknown> = {
  name: "Kerberos Compliance Platform",
  createdOwnerName: new Name("Jane Doe"),
  createdOwnerEmail: new Email("jane@acme.example"),
};

let errorLog: jest.SpyInstance;

beforeEach(() => {
  setWebhook(WEBHOOK_URL);
  errorLog = jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(logger, "warn").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  setWebhook(WEBHOOK_URL);
});

describe.each(BALANCES)("a refill of $name", (balance: BalanceUnderTest) => {
  function setUp(values: Record<string, unknown> = {}): WorldUnderTest {
    return balance.setUp({
      ...PROJECT_VALUES,
      ...balance.autoRechargeOn,
      [balance.balanceColumn]: 150,
      ...values,
    });
  }

  test("by hand: the channel is told what was added, the balance now, and that somebody pressed Recharge", async () => {
    const world: WorldUnderTest = setUp();

    expect(await balance.rechargeByHand(20)).toBe(2150);
    await flushBackgroundWork();

    expect(world.slack.messages).toHaveLength(1);
    expect(world.slack.messages[0]?.url).toBe(WEBHOOK_URL);
    expect(linesOf(world.slack.messages[0])).toEqual([
      balance.title,
      "*Project Name:* Kerberos Compliance Platform",
      `*Project ID:* ${PROJECT_ID.toString()}`,
      "*Refill Amount:* $20 USD",
      "*Current Balance:* $21.50 USD",
      "*Recharge Type:* Manual",
      "*Project Created By:* Jane Doe (jane@acme.example)",
    ]);
  });

  test("by Auto Recharge, when the balance is low: the channel is told it was Auto Recharge", async () => {
    const world: WorldUnderTest = setUp();

    expect(await balance.rechargeIfLow()).toBe(2150);
    await flushBackgroundWork();

    expect(world.charges).toEqual([20]);
    expect(world.slack.messages).toHaveLength(1);

    const lines: Array<string> = linesOf(world.slack.messages[0]);

    expect(lines[0]).toBe(balance.title);
    expect(lines).toContain("*Refill Amount:* $20 USD");
    expect(lines).toContain("*Current Balance:* $21.50 USD");
    expect(lines).toContain("*Recharge Type:* Auto Recharge");
  });

  test("turning Auto Recharge on charges at once, and the channel hears of it as Auto Recharge", async () => {
    const world: WorldUnderTest = setUp(balance.autoRechargeOff);

    expect(await balance.turnAutoRechargeOn()).toBe(2650);
    await flushBackgroundWork();

    expect(world.charges).toEqual([25]);
    expect(world.slack.messages).toHaveLength(1);

    const lines: Array<string> = linesOf(world.slack.messages[0]);

    expect(lines).toContain("*Refill Amount:* $25 USD");
    expect(lines).toContain("*Current Balance:* $26.50 USD");
    expect(lines).toContain("*Recharge Type:* Auto Recharge");
  });

  test("a balance that needs no recharge charges nothing and tells nobody", async () => {
    const world: WorldUnderTest = setUp({ [balance.balanceColumn]: 5000 });

    expect(await balance.rechargeIfLow()).toBe(5000);
    await flushBackgroundWork();

    expect(world.charges).toEqual([]);
    expect(world.slack.messages).toHaveLength(0);
  });

  test("a declined card tells the channel nothing: nothing was added", async () => {
    const world: WorldUnderTest = setUp();
    world.failChargesWith(new Error("card_declined"));

    await expect(balance.rechargeByHand(20)).rejects.toThrow("card_declined");
    await flushBackgroundWork();

    expect(world.row[balance.balanceColumn]).toBe(150);
    expect(world.slack.messages).toHaveLength(0);
  });

  test("no payment method tells the channel nothing either", async () => {
    const world: WorldUnderTest = setUp();
    world.setHasPaymentMethods(false);

    await expect(balance.rechargeByHand(20)).rejects.toThrow(
      "No payment methods found",
    );
    await flushBackgroundWork();

    expect(world.slack.messages).toHaveLength(0);
  });

  test("without the webhook nothing is posted, and the recharge is as it always was", async () => {
    setWebhook("");
    const world: WorldUnderTest = setUp();

    expect(await balance.rechargeByHand(20)).toBe(2150);
    await flushBackgroundWork();

    expect(world.charges).toEqual([20]);
    expect(world.slack.messages).toHaveLength(0);
  });

  test("callers that find the balance low together charge the card once and tell the channel once", async () => {
    const world: WorldUnderTest = setUp();

    const balances: Array<number> = await Promise.all(
      Array.from({ length: 6 }, () => {
        return balance.rechargeIfLow();
      }),
    );
    await flushBackgroundWork();

    expect(world.charges).toEqual([20]);
    expect(
      balances.every((value: number) => {
        return value === 2150;
      }),
    ).toBe(true);
    expect(world.slack.messages).toHaveLength(1);
  });

  test("Slack failing neither fails the recharge nor loses the credit: it is logged", async () => {
    const world: WorldUnderTest = setUp();
    world.slack.failWith(new Error("socket hang up"));

    expect(await balance.rechargeByHand(20)).toBe(2150);
    await flushBackgroundWork();

    expect(world.row[balance.balanceColumn]).toBe(2150);
    expect(world.slack.messages).toHaveLength(1);
    expect(
      errorLog.mock.calls.some((call: Array<unknown>) => {
        return (
          String(call[0]).includes("balance refill") &&
          String(call[0]).includes("socket hang up")
        );
      }),
    ).toBe(true);
  });

  test("Slack never answering does not hold the recharge", async () => {
    const world: WorldUnderTest = setUp();
    world.slack.holdAnswers(true);

    expect(await withinTwoSeconds(balance.rechargeByHand(20))).toBe(2150);
    expect(world.slack.messages).toHaveLength(1);
  });

  test("who created the project is read with it, for the message", async () => {
    setUp();

    await balance.rechargeByHand(20);
    await flushBackgroundWork();

    // The read the charge is made from: the one that selects the payment customer.
    const chargeRead: FindBy<Project> | undefined = (
      ProjectService.findOneById as unknown as jest.Mock
    ).mock.calls
      .map((call: Array<unknown>) => {
        return call[0] as FindBy<Project>;
      })
      .find((findBy: FindBy<Project>) => {
        return Boolean(
          (findBy.select as Record<string, unknown>)?.[
            "paymentProviderCustomerId"
          ],
        );
      });

    expect(chargeRead?.select).toEqual(
      expect.objectContaining({
        name: true,
        createdOwnerName: true,
        createdOwnerEmail: true,
      }),
    );
    expect(chargeRead?.props).toEqual({ isRoot: true });
  });

  test("a project with no recorded creator leaves the line out", async () => {
    const world: WorldUnderTest = setUp({
      createdOwnerName: undefined,
      createdOwnerEmail: undefined,
    });

    await balance.rechargeByHand(20);
    await flushBackgroundWork();

    expect(world.slack.messages[0]?.text).not.toContain("Created By");
  });

  test("the project's name is text: a name that mentions the channel notifies nobody", async () => {
    const world: WorldUnderTest = setUp({ name: "<!channel> & friends" });

    await balance.rechargeByHand(20);
    await flushBackgroundWork();

    // No "<" of theirs reaches Slack, and the name reads as it was typed.
    expect(world.slack.messages[0]?.text).not.toContain("<!channel>");
    expect(linesOf(world.slack.messages[0])).toContain(
      "*Project Name:* <!channel> & friends",
    );
  });
});

describe("AI credits and the SMS and call balance", () => {
  test("are refilled in the same words, on the same webhook, title apart", async () => {
    const values: Record<string, unknown> = { ...PROJECT_VALUES };

    const ai: WorldUnderTest = BALANCES[0]!.setUp({
      ...values,
      ...BALANCES[0]!.autoRechargeOn,
      aiCurrentBalanceInUSDCents: 150,
    });
    await BALANCES[0]!.rechargeByHand(20);
    await flushBackgroundWork();
    const aiMessage: SlackWebhookMessage | undefined = ai.slack.messages[0];
    jest.restoreAllMocks();
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    const sms: WorldUnderTest = BALANCES[1]!.setUp({
      ...values,
      ...BALANCES[1]!.autoRechargeOn,
      smsOrCallCurrentBalanceInUSDCents: 150,
    });
    await BALANCES[1]!.rechargeByHand(20);
    await flushBackgroundWork();
    const smsMessage: SlackWebhookMessage | undefined = sms.slack.messages[0];

    expect(aiMessage?.url).toBe(WEBHOOK_URL);
    expect(smsMessage?.url).toBe(WEBHOOK_URL);
    expect(linesOf(aiMessage)[0]).toBe("*AI Balance Refilled:*");
    expect(linesOf(smsMessage)[0]).toBe("*SMS and Call Balance Refilled:*");
    expect(linesOf(aiMessage).slice(1)).toEqual(linesOf(smsMessage).slice(1));
  });
});
