import MessagingBalance from "../../../../Server/Utils/Billing/MessagingBalance";
import ProjectService from "../../../../Server/Services/ProjectService";
import logger from "../../../../Server/Utils/Logger";
import ObjectID from "../../../../Types/ObjectID";
import { ProjectNotificationChannel } from "../../../../Utils/Project/NotificationChannels";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * What an SMS, call, WhatsApp or Telegram message does to the project's
 * balance (Utils/Billing/MessagingBalance), shared by the four senders:
 *
 * - its cost, in whole cents (the senders used to turn cents into dollars
 *   and back, and floating point took a cent more or a cent less);
 * - paying for it once the provider took it: one statement, never thrown
 *   at the sender (the message went out);
 * - whether it is the message that tells the owners the balance is used
 *   up: one claim, which only one message wins.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-0000000000a1",
);

let errors: Array<string>;

beforeEach(() => {
  errors = [];
  jest.spyOn(logger, "error").mockImplementation(((message: unknown) => {
    errors.push(String(message));
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MessagingBalance.getCostInUSDCents", () => {
  test.each([1, 2, 3, 5, 7, 10, 14, 28, 29, 35, 56, 57, 58, 113])(
    "a cost of %i cents is exactly that many cents (the old dollars-and-back arithmetic was off by one for some)",
    (cents: number) => {
      expect(
        MessagingBalance.getCostInUSDCents({ costPerPartInUSDCents: cents }),
      ).toBe(cents);
    },
  );

  test("29 cents is 29: WhatsApp and Telegram used to take Math.floor(0.29 * 100) = 28", () => {
    // What the senders used to work out, in dollars and back.
    expect(Math.floor((29 / 100) * 100)).toBe(28);

    expect(
      MessagingBalance.getCostInUSDCents({ costPerPartInUSDCents: 29 }),
    ).toBe(29);
  });

  test("7 cents is 7: an SMS log used to record 7.000000000000001 cents", () => {
    expect((7 / 100) * 100).not.toBe(7);

    expect(
      MessagingBalance.getCostInUSDCents({ costPerPartInUSDCents: 7 }),
    ).toBe(7);
  });

  test("an SMS in three parts costs three times as much", () => {
    expect(
      MessagingBalance.getCostInUSDCents({
        costPerPartInUSDCents: 7,
        parts: 3,
      }),
    ).toBe(21);
  });

  test("one part, or no parts named, is one", () => {
    expect(
      MessagingBalance.getCostInUSDCents({
        costPerPartInUSDCents: 7,
        parts: 1,
      }),
    ).toBe(7);
    expect(
      MessagingBalance.getCostInUSDCents({
        costPerPartInUSDCents: 7,
        parts: 0,
      }),
    ).toBe(7);
  });

  test("a cost that is not configured (NaN) or below zero is nothing, never a refund", () => {
    expect(
      MessagingBalance.getCostInUSDCents({
        costPerPartInUSDCents: Number.NaN,
      }),
    ).toBe(0);
    expect(
      MessagingBalance.getCostInUSDCents({ costPerPartInUSDCents: -5 }),
    ).toBe(0);
  });
});

describe("MessagingBalance.payForSentMessage", () => {
  test("takes the cost in one statement and answers the balance it left", async () => {
    const deduct: jest.SpyInstance = jest
      .spyOn(ProjectService, "deductSmsOrCallBalanceInUSDCents")
      .mockResolvedValue(993);

    expect(
      await MessagingBalance.payForSentMessage({
        projectId: PROJECT_ID,
        channel: ProjectNotificationChannel.SMS,
        costInUSDCents: 7,
      }),
    ).toBe(993);
    expect(deduct).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      amountInUSDCents: 7,
    });
  });

  test("a balance that cannot be written is said in the log with what it cost, and never thrown: the message went out", async () => {
    jest
      .spyOn(ProjectService, "deductSmsOrCallBalanceInUSDCents")
      .mockRejectedValue(new Error("connection lost"));

    await expect(
      MessagingBalance.payForSentMessage({
        projectId: PROJECT_ID,
        channel: ProjectNotificationChannel.Call,
        costInUSDCents: 35,
      }),
    ).resolves.toBeNull();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(
      `a Call message of project ${PROJECT_ID.toString()} went out, and its cost (35 cents) could not be taken from the balance`,
    );
    expect(errors[0]).toContain("connection lost");
  });
});

describe("MessagingBalance.shouldTellOwnersBalanceIsLow", () => {
  test("told already (as the sender read it): no, and nothing is written", async () => {
    const claim: jest.SpyInstance = jest.spyOn(
      ProjectService,
      "claimSmsOrCallLowBalanceNotice",
    );

    expect(
      await MessagingBalance.shouldTellOwnersBalanceIsLow({
        projectId: PROJECT_ID,
        alreadyTold: true,
      }),
    ).toBe(false);
    expect(claim).not.toHaveBeenCalled();
  });

  test("not told yet: the one claim decides", async () => {
    const claim: jest.SpyInstance = jest
      .spyOn(ProjectService, "claimSmsOrCallLowBalanceNotice")
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    expect(
      await MessagingBalance.shouldTellOwnersBalanceIsLow({
        projectId: PROJECT_ID,
        alreadyTold: false,
      }),
    ).toBe(true);
    expect(
      await MessagingBalance.shouldTellOwnersBalanceIsLow({
        projectId: PROJECT_ID,
      }),
    ).toBe(false);
    expect(claim).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("messages racing: only the one that wins the claim tells the owners", async () => {
    let told: boolean = false;
    jest
      .spyOn(ProjectService, "claimSmsOrCallLowBalanceNotice")
      .mockImplementation((async () => {
        if (told) {
          return false;
        }
        told = true;
        return true;
      }) as never);

    const answers: Array<boolean> = await Promise.all(
      Array.from({ length: 6 }, () => {
        return MessagingBalance.shouldTellOwnersBalanceIsLow({
          projectId: PROJECT_ID,
          alreadyTold: false,
        });
      }),
    );

    expect(
      answers.filter((answer: boolean) => {
        return answer;
      }),
    ).toHaveLength(1);
  });
});
