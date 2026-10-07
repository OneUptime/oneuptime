import AIService, { AILogResponse } from "../../../Server/Services/AIService";
import LlmLogService from "../../../Server/Services/LlmLogService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import BillingService from "../../../Server/Services/BillingService";
import LLMService from "../../../Server/Utils/LLM/LLMService";
import logger from "../../../Server/Utils/Logger";
import LlmLog from "../../../Models/DatabaseModels/LlmLog";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import BadDataException from "../../../Types/Exception/BadDataException";
import LlmLogStatus from "../../../Types/LlmLogStatus";
import LlmType from "../../../Types/LLM/LlmType";
import ObjectID from "../../../Types/ObjectID";
import { PROJECT_AI_CREDITS_USED_UP_MESSAGE } from "../../../Utils/Project/ProjectBalance";
import {
  AiCreditsWorld,
  useAiCreditsWorld,
} from "../TestingUtils/AiCreditsWorld";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHEN A PROJECT'S AI CREDITS RUN OUT, AUTO RECHARGE REFILLS THEM.
 *
 * Every AI call billed to the project's AI credits (OneUptime AI on the
 * OneUptime-hosted provider, on OneUptime Cloud) passes
 * AIService.executeWithLogging, which refuses it when the credits are at or
 * below zero. Auto Recharge used to run only AFTER a call it had paid for -
 * so once the credits were used up, no call could run, no call could pay, and
 * the recharge never came: a project at zero with Auto Recharge on stayed at
 * zero, every AI call was refused, while the readiness checks said nothing
 * stood in the way (auto-recharge was on).
 *
 * Now a billed call that finds the credits used up, with Auto Recharge on,
 * recharges them first - once, under the same lock as every other recharge,
 * so calls arriving together charge the card once - and then runs. A charge
 * that fails refuses the call with who can add credits, and is not tried
 * again on every call: the next try comes after a while, or as soon as
 * somebody recharges by hand.
 *
 * These drive the real executeWithLogging and the real AIBillingService,
 * with the project row, the payment provider, the shared cache and the lock
 * behind fakes (TestingUtils/AiCreditsWorld).
 */

jest.mock("../../../Server/BillingConfig", () => {
  return {
    __esModule: true,
    default: {
      IsBillingEnabled: true,
      BillingPublicKey: "pk_test_ai_credits_run_out",
      BillingPrivateKey: "sk_test_ai_credits_run_out",
      BillingWebhookSecret: "whsec_test_ai_credits_run_out",
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-0000000000a1",
);

// 500 cents per million tokens: a 1,200-token call costs 1 cent (rounded up).
const CALL_COST_IN_CENTS: number = 1;

let world: AiCreditsWorld;
let completion: jest.SpyInstance;
let createLog: jest.SpyInstance;

function billedGlobalProvider(): LlmProvider {
  return {
    id: ObjectID.generate(),
    name: "OneUptime AI",
    llmType: LlmType.OpenAI,
    isGlobalLlm: true,
    costPerMillionTokensInUSDCents: 500,
  } as unknown as LlmProvider;
}

async function ask(): Promise<AILogResponse> {
  return AIService.executeWithLogging({
    projectId: PROJECT_ID,
    feature: "Observability Chat",
    messages: [{ role: "user", content: "what broke?" }],
  });
}

async function refusalOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("Expected a refusal, but the call went through.");
}

// The LlmLog rows the calls wrote, in order.
function writtenLogs(): Array<LlmLog> {
  return createLog.mock.calls.map((call: Array<unknown>): LlmLog => {
    return (call[0] as { data: LlmLog }).data;
  });
}

// Lets the fire-and-forget work after a call (the post-call check) settle.
async function settle(): Promise<void> {
  for (let i: number = 0; i < 20; i++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 5);
    });
  }
}

beforeEach(() => {
  world = useAiCreditsWorld(PROJECT_ID, {
    aiCurrentBalanceInUSDCents: 0,
    enableAutoRechargeAiBalance: true,
    autoAiRechargeByBalanceInUSD: 20,
    autoRechargeAiWhenCurrentBalanceFallsInUSD: 10,
  });

  jest
    .spyOn(LlmProviderService, "getProviderForChat")
    .mockResolvedValue(billedGlobalProvider());
  jest
    .spyOn(LlmProviderService, "getLLMProviderForProject")
    .mockResolvedValue(billedGlobalProvider());
  completion = jest.spyOn(LLMService, "getCompletion").mockResolvedValue({
    content: "the model answered",
    usage: { totalTokens: 1200 },
  } as Awaited<ReturnType<typeof LLMService.getCompletion>>);
  createLog = jest
    .spyOn(LlmLogService, "create")
    .mockResolvedValue(new LlmLog());
  jest
    .spyOn(LlmLogService, "getProjectUsageSince")
    .mockResolvedValue({ totalTokens: 0, billedCostInUSDCents: 0 });

  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(logger, "warn").mockImplementation((): void => {});
});

afterEach(async () => {
  await settle();
  jest.restoreAllMocks();
});

describe("an AI call that finds the AI credits used up, with Auto Recharge on", () => {
  test("recharges them first, then runs", async () => {
    const response: AILogResponse = await ask();

    expect(response.content).toBe("the model answered");
    expect(completion).toHaveBeenCalledTimes(1);
    expect(world.charges).toEqual([20]);
    expect(world.row.aiCurrentBalanceInUSDCents).toBe(
      2000 - CALL_COST_IN_CENTS,
    );
    expect(
      writtenLogs().map((log: LlmLog) => {
        return log.status;
      }),
    ).toEqual([LlmLogStatus.Success]);
  });

  test("a balance below zero is recharged the same way, by the set amount", async () => {
    world.row.aiCurrentBalanceInUSDCents = -40;

    await expect(ask()).resolves.toBeDefined();

    expect(world.charges).toEqual([20]);
    expect(world.row.aiCurrentBalanceInUSDCents).toBe(
      2000 - 40 - CALL_COST_IN_CENTS,
    );
  });

  test("the recharge adds the amount Auto Recharge is set to", async () => {
    world.row.autoAiRechargeByBalanceInUSD = 50;

    await ask();

    expect(world.charges).toEqual([50]);
    expect(world.row.aiCurrentBalanceInUSDCents).toBe(
      5000 - CALL_COST_IN_CENTS,
    );
  });

  test("the recharge clears the owners' notice flags, as every recharge does", async () => {
    world.row.lowAiBalanceNotificationSentToOwners = true;

    await ask();

    expect(world.row.lowAiBalanceNotificationSentToOwners).toBe(false);
  });

  test("an automatic recharge sends no 'recharge successful' email", async () => {
    await ask();
    await settle();

    expect(
      world.ownerEmails.filter((email: { subject: string }) => {
        return email.subject.startsWith("AI Balance Recharge Successful");
      }),
    ).toEqual([]);
  });

  test("five calls at once: the card is charged once, and all five run", async () => {
    const responses: Array<AILogResponse> = await Promise.all([
      ask(),
      ask(),
      ask(),
      ask(),
      ask(),
    ]);

    expect(responses).toHaveLength(5);
    expect(completion).toHaveBeenCalledTimes(5);
    expect(world.charges).toEqual([20]);
    expect(world.mostLockHoldersAtOnce()).toBe(1);
    expect(world.row.aiCurrentBalanceInUSDCents).toBe(
      2000 - 5 * CALL_COST_IN_CENTS,
    );
  });
});

describe("a recharge that fails", () => {
  test("refuses the call with who can add credits, and nothing reaches the model", async () => {
    world.failChargesWith(new Error("Your card was declined."));

    const message: string = await refusalOf(ask());

    expect(message).toBe(PROJECT_AI_CREDITS_USED_UP_MESSAGE);
    expect(completion).not.toHaveBeenCalled();
    expect(world.charges).toEqual([]);
    expect(world.row.aiCurrentBalanceInUSDCents).toBe(0);
    expect(
      writtenLogs().map((log: LlmLog) => {
        return log.status;
      }),
    ).toEqual([LlmLogStatus.InsufficientBalance]);
    expect(writtenLogs()[0]!.statusMessage).toBe(
      PROJECT_AI_CREDITS_USED_UP_MESSAGE,
    );
  });

  test("with no payment method at all, the call is refused the same way and nothing is charged", async () => {
    world.setHasPaymentMethods(false);

    expect(await refusalOf(ask())).toBe(PROJECT_AI_CREDITS_USED_UP_MESSAGE);
    expect(world.charges).toEqual([]);
    expect(
      BillingService.generateInvoiceAndChargeCustomer,
    ).not.toHaveBeenCalled();
  });

  test("the owners hear that the recharge failed", async () => {
    world.failChargesWith(new Error("Your card was declined."));

    await refusalOf(ask());

    expect(
      world.ownerEmails.filter((email: { subject: string }) => {
        return email.subject.startsWith(
          "ACTION REQUIRED: AI Balance Recharge Failed",
        );
      }),
    ).toHaveLength(1);
  });

  test("is not tried again on the next call: one charge attempt, every call refused", async () => {
    world.failChargesWith(new Error("Your card was declined."));

    await refusalOf(ask());
    await refusalOf(ask());
    await refusalOf(ask());

    expect(
      BillingService.generateInvoiceAndChargeCustomer,
    ).toHaveBeenCalledTimes(1);
    expect(completion).not.toHaveBeenCalled();
  });

  test("five calls at once, the card declined: one charge attempt", async () => {
    world.failChargesWith(new Error("Your card was declined."));

    const results: Array<PromiseSettledResult<AILogResponse>> =
      await Promise.allSettled([ask(), ask(), ask(), ask(), ask()]);

    expect(
      results.every((result: PromiseSettledResult<AILogResponse>) => {
        return result.status === "rejected";
      }),
    ).toBe(true);
    expect(
      BillingService.generateInvoiceAndChargeCustomer,
    ).toHaveBeenCalledTimes(1);
  });
});

describe("Auto Recharge that cannot run", () => {
  test("Auto Recharge off: refused at once, and the card is never charged", async () => {
    world.row.enableAutoRechargeAiBalance = false;

    expect(await refusalOf(ask())).toBe(PROJECT_AI_CREDITS_USED_UP_MESSAGE);
    expect(BillingService.hasPaymentMethods).not.toHaveBeenCalled();
    expect(
      BillingService.generateInvoiceAndChargeCustomer,
    ).not.toHaveBeenCalled();
    expect(completion).not.toHaveBeenCalled();
  });

  test("Auto Recharge on with no amount to add: refused, never charged", async () => {
    world.row.autoAiRechargeByBalanceInUSD = 0;

    expect(await refusalOf(ask())).toBe(PROJECT_AI_CREDITS_USED_UP_MESSAGE);
    expect(
      BillingService.generateInvoiceAndChargeCustomer,
    ).not.toHaveBeenCalled();
  });

  test("the lock cannot be taken: no charge without it, and the call is refused", async () => {
    world.failLocksWith(new Error("Redis client is not connected"));

    expect(await refusalOf(ask())).toBe(PROJECT_AI_CREDITS_USED_UP_MESSAGE);
    expect(
      BillingService.generateInvoiceAndChargeCustomer,
    ).not.toHaveBeenCalled();
  });
});

/*
 * THE PROJECT'S OWNERS ARE TOLD WHEN THE AI CREDITS RUN OUT.
 *
 * Nobody was: lowAiBalanceNotificationSentToOwners existed and was never
 * set, while SMS and calls email the owners once when their balance cannot
 * pay for a message. Now the owners get one email the first time AI is
 * refused (or found unable to run) for used-up credits, and another only
 * after the credits have been recharged and run out again.
 */
describe("the owners' email when the AI credits run out", () => {
  function runOutEmails(): Array<{ subject: string; body: string }> {
    return world.ownerEmails.filter((email: { subject: string }) => {
      return email.subject.startsWith("AI credits used up");
    });
  }

  test("Auto Recharge off: the first refusal emails the owners once, the next refusals do not", async () => {
    world.row.enableAutoRechargeAiBalance = false;

    await refusalOf(ask());
    await refusalOf(ask());
    await refusalOf(ask());
    await settle();

    expect(runOutEmails()).toHaveLength(1);
    expect(runOutEmails()[0]!.subject).toBe(
      "AI credits used up for Acme Production",
    );
    expect(world.row.lowAiBalanceNotificationSentToOwners).toBe(true);
  });

  test("five refusals at once still send one email", async () => {
    world.row.enableAutoRechargeAiBalance = false;

    await Promise.allSettled([ask(), ask(), ask(), ask(), ask()]);
    await settle();

    expect(runOutEmails()).toHaveLength(1);
  });

  test("owners already told about this run-out are not told again", async () => {
    world.row.enableAutoRechargeAiBalance = false;
    world.row.lowAiBalanceNotificationSentToOwners = true;

    await refusalOf(ask());
    await settle();

    expect(runOutEmails()).toEqual([]);
  });

  test("the call that spends the last credit tells the owners, before anyone is refused", async () => {
    world.row.enableAutoRechargeAiBalance = false;
    world.row.aiCurrentBalanceInUSDCents = CALL_COST_IN_CENTS;

    await expect(ask()).resolves.toBeDefined();
    await settle();

    expect(world.row.aiCurrentBalanceInUSDCents).toBe(0);
    expect(runOutEmails()).toHaveLength(1);
  });

  test("a call that leaves credits over tells nobody", async () => {
    world.row.enableAutoRechargeAiBalance = false;
    world.row.aiCurrentBalanceInUSDCents = 5000;

    await ask();
    await settle();

    expect(runOutEmails()).toEqual([]);
  });

  test("Auto Recharge refilled them: nobody is told", async () => {
    await ask();
    await settle();

    expect(runOutEmails()).toEqual([]);
  });

  test("once recharged and used up again, the owners are told again", async () => {
    world.row.enableAutoRechargeAiBalance = false;

    await refusalOf(ask());
    await settle();
    expect(runOutEmails()).toHaveLength(1);

    // An owner adds credits by hand; they are used up again.
    world.row.enableAutoRechargeAiBalance = true;
    world.row.aiCurrentBalanceInUSDCents = 0;
    await ask();
    await settle();
    expect(world.row.lowAiBalanceNotificationSentToOwners).toBe(false);

    world.row.enableAutoRechargeAiBalance = false;
    world.row.aiCurrentBalanceInUSDCents = 0;
    await refusalOf(ask());
    await settle();

    expect(runOutEmails()).toHaveLength(2);
  });
});
