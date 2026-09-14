import AIBillingService from "../../../Server/Services/AIBillingService";
import BillingService from "../../../Server/Services/BillingService";
import NotificationService from "../../../Server/Services/NotificationService";
import ProjectService from "../../../Server/Services/ProjectService";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import DatabaseNotConnectedException from "../../../Types/Exception/DatabaseNotConnectedException";
import logger from "../../../Server/Utils/Logger";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import fs from "fs";
import Path from "path";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT BREAKS IN PRODUCTION IF THIS REGRESSES.
 *
 * NotificationService.rechargeIfBalanceIsLow is called INLINE on every SMS,
 * call, WhatsApp and Telegram notification attempt (SmsService.ts:282,
 * CallService.ts:299, WhatsAppService.ts:180, TelegramService.ts:168), and
 * AIBillingService is the same shape for AI credits. So anything these two
 * rechargeBalance methods mail is multiplied by the paging rate of the very
 * incident the owner is already being paged about. Four separate defects lived
 * here, and each one turns a single billing condition into a per-attempt mail
 * storm:
 *
 *   1. The SUCCESS mail had no guard flag at all. A project auto-recharging
 *      through an outage mailed every owner once per recharge, and the same
 *      update reset lowCallAndSMSBalanceNotificationSentToOwners and
 *      notEnabledSmsOrCallNotificationSentToOwners to false, re-arming two
 *      MORE owner emails. It is now suppressed for AUTO-recharge only. The
 *      manual "Recharge" button keeps it, because Project.sendInvoicesByEmail
 *      defaults to false, so the Stripe invoice is filed rather than sent and
 *      the Slack hook is an operator webhook most installs never configure -
 *      delete it there and a person who charged their own card is told
 *      nothing. That split is the first two tests in each describe.
 *
 *   2. The catch block WROTE failedCallAndSMSBalanceChargeNotificationSentToOwners
 *      = true and then mailed without ever reading it - unlike its correctly
 *      guarded sibling twenty lines above. A declined card therefore mailed
 *      every owner once per paging attempt, forever.
 *
 *   3. The obvious fix for 2 - gate the catch on that same boolean - swaps a
 *      storm for something worse, and the suite pins that it was NOT done. The
 *      boolean is cleared only by a SUCCESSFUL recharge, so: no card -> mail
 *      once and latch -> the owner adds a card -> the card is declined -> the
 *      recharge can never succeed -> the latch never clears -> nobody is ever
 *      told the new card failed and paging silently stops. The guard is a 24h
 *      WINDOW instead (BillingFailureNoticeThrottle), and it fails OPEN.
 *
 *   4. Guarding the catch at all exposes a double-send that was invisible
 *      before it: the no-payment-method branch mails and then THROWS, and that
 *      throw lands in this method's own catch. Without the local
 *      already-told-them flag, a first no-payment-method failure sends TWO
 *      identical "ACTION REQUIRED" emails. That is the assertion below that
 *      only makes sense once you trace the throw.
 *
 *   5. AIBillingService had bugs 1-4 byte-for-byte.
 *
 * Both services are gated on IsBillingEnabled, so these are CLOUD-ONLY paths.
 * The last describe is a ratchet on the SIBLING owner emails in the four
 * notification services: those are already guarded by their own project
 * booleans, they are deliberately out of scope, and a future edit that
 * un-guards one of them would reintroduce exactly the storm this suite exists
 * to prevent.
 */

/*
 * AIBillingService.rechargeBalance throws "Billing is not enabled" before it
 * does anything else, and BILLING_ENABLED is not set when jest runs a single
 * suite directly. Mocking the tiny BillingConfig module (rather than
 * EnvironmentConfig, which reads it) is the precedent set by
 * Tests/Server/TestingUtils/Services/BillingServiceHelper.ts, and it makes the
 * suite deterministic no matter what the runner exports.
 */
jest.mock("../../../Server/BillingConfig", () => {
  return {
    __esModule: true,
    default: {
      IsBillingEnabled: true,
      BillingPublicKey: "pk_test_billing_recharge_guards",
      BillingPrivateKey: "sk_test_billing_recharge_guards",
      BillingWebhookSecret: "whsec_test_billing_recharge_guards",
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_NAME: string = "Acme Production";
const CUSTOMER_ID: string = "cus_test_recharge_guards";

/*
 * sendBalanceRefillSlackNotification is private on both services. The suite
 * has to assert it still fires after the success mail was deleted, so it is
 * reached through a structural type rather than through the class.
 */
interface SlackRefillNotifier {
  sendBalanceRefillSlackNotification: (data: {
    project: Project;
    amountInUSD: number;
    currentBalanceInUSD: number;
  }) => Promise<void>;
}

type MakeSmsProjectFunction = (data: {
  failedFlagAlreadySet: boolean;
}) => Project;

const makeSmsProject: MakeSmsProjectFunction = (data: {
  failedFlagAlreadySet: boolean;
}): Project => {
  const project: Project = new Project();
  project.id = PROJECT_ID;
  project.name = PROJECT_NAME;
  project.paymentProviderCustomerId = CUSTOMER_ID;
  project.smsOrCallCurrentBalanceInUSDCents = 100;
  project.sendInvoicesByEmail = false;
  project.failedCallAndSMSBalanceChargeNotificationSentToOwners =
    data.failedFlagAlreadySet;

  return project;
};

type MakeAiProjectFunction = (data: {
  failedFlagAlreadySet: boolean;
}) => Project;

const makeAiProject: MakeAiProjectFunction = (data: {
  failedFlagAlreadySet: boolean;
}): Project => {
  const project: Project = new Project();
  project.id = PROJECT_ID;
  project.name = PROJECT_NAME;
  project.paymentProviderCustomerId = CUSTOMER_ID;
  project.aiCurrentBalanceInUSDCents = 100;
  project.sendInvoicesByEmail = false;
  project.failedAiBalanceChargeNotificationSentToOwners =
    data.failedFlagAlreadySet;

  return project;
};

let findOneByIdSpy: jest.SpyInstance;
let updateOneByIdSpy: jest.SpyInstance;
let sendEmailSpy: jest.SpyInstance;
let hasPaymentMethodsSpy: jest.SpyInstance;
let generateInvoiceSpy: jest.SpyInstance;
let smsSlackSpy: jest.SpyInstance;
let aiSlackSpy: jest.SpyInstance;
let claimWindowSpy: jest.SpyInstance;

/* The `data` object of the nth ProjectService.updateOneById call. */
type GetUpdateDataFunction = (index: number) => Record<string, unknown>;

const getUpdateData: GetUpdateDataFunction = (
  index: number,
): Record<string, unknown> => {
  const call: Array<unknown> = updateOneByIdSpy.mock.calls[
    index
  ] as Array<unknown>;
  const argument: Record<string, unknown> = call[0] as Record<string, unknown>;

  return argument["data"] as Record<string, unknown>;
};

/* The subject line of the nth owner email the service asked to send. */
type GetSentSubjectFunction = (index: number) => string;

const getSentSubject: GetSentSubjectFunction = (index: number): string => {
  const call: Array<unknown> = sendEmailSpy.mock.calls[index] as Array<unknown>;

  return call[1] as string;
};

beforeEach(() => {
  findOneByIdSpy = jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue(null);

  updateOneByIdSpy = jest
    .spyOn(ProjectService, "updateOneById")
    .mockResolvedValue(1);

  sendEmailSpy = jest
    .spyOn(ProjectService, "sendEmailToProjectOwners")
    .mockResolvedValue(undefined);

  hasPaymentMethodsSpy = jest
    .spyOn(BillingService, "hasPaymentMethods")
    .mockResolvedValue(true);

  generateInvoiceSpy = jest
    .spyOn(BillingService, "generateInvoiceAndChargeCustomer")
    .mockResolvedValue(undefined);

  smsSlackSpy = jest
    .spyOn(
      NotificationService as unknown as SlackRefillNotifier,
      "sendBalanceRefillSlackNotification",
    )
    .mockResolvedValue(undefined);

  aiSlackSpy = jest
    .spyOn(
      AIBillingService as unknown as SlackRefillNotifier,
      "sendBalanceRefillSlackNotification",
    )
    .mockResolvedValue(undefined);

  /*
   * True means "this call owns today's window". Redis is not running under
   * jest, so without this the real setStringIfNotExists throws and every test
   * would reach the send through the fail-open catch instead of through the
   * behaviour it means to pin.
   */
  claimWindowSpy = jest
    .spyOn(GlobalCache, "setStringIfNotExists")
    .mockResolvedValue(true);

  // The catch blocks log the underlying failure; silenced, not asserted on.
  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(logger, "warn").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("NotificationService.rechargeBalance - SMS and call owner emails", () => {
  test("a successful AUTO recharge mails project owners zero times", async () => {
    findOneByIdSpy.mockResolvedValue(
      makeSmsProject({ failedFlagAlreadySet: false }),
    );

    const balance: number = await NotificationService.rechargeBalance(
      PROJECT_ID,
      20,
      { sendOwnerConfirmationEmail: false },
    );

    expect(balance).toBe(2100);
    expect(generateInvoiceSpy).toHaveBeenCalledTimes(1);

    /*
     * The whole point. rechargeIfBalanceIsLow runs on every paging attempt, so
     * one mail per successful recharge is one mail per attempt.
     */
    expect(sendEmailSpy).toHaveBeenCalledTimes(0);
  });

  test("the auto-recharge caller is the one that asks for silence", async () => {
    /*
     * Pinning the CALLER, not just the option, because the option defaults to
     * "send" and the whole reduction depends on rechargeIfBalanceIsLow being
     * the place that opts out. Reading the source is the only way to assert it
     * without standing up the four notification services that call it.
     */
    const source: string = fs.readFileSync(
      Path.resolve(
        __dirname,
        "../../../Server/Services/NotificationService.ts",
      ),
      "utf-8",
    );

    const autoRechargeBody: string = source.slice(
      source.indexOf("public async rechargeIfBalanceIsLow("),
    );

    expect(autoRechargeBody).toContain("sendOwnerConfirmationEmail: false");
  });

  test("a successful MANUAL recharge still confirms to the owners", async () => {
    findOneByIdSpy.mockResolvedValue(
      makeSmsProject({ failedFlagAlreadySet: false }),
    );

    /*
     * NotificationAPI's "Recharge" endpoint calls rechargeBalance with no
     * options. Project.sendInvoicesByEmail defaults to false, so the Stripe
     * invoice is filed and not sent, and the Slack hook is empty on most
     * installs - this email is the only thing that tells a person their card
     * was charged.
     */
    await NotificationService.rechargeBalance(PROJECT_ID, 20);

    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(getSentSubject(0)).toBe(
      "SMS and Call Recharge Successful for project - " + PROJECT_NAME,
    );
  });

  test("a successful recharge still resets all three owner-email flags", async () => {
    findOneByIdSpy.mockResolvedValue(
      makeSmsProject({ failedFlagAlreadySet: true }),
    );

    await NotificationService.rechargeBalance(PROJECT_ID, 20);

    expect(updateOneByIdSpy).toHaveBeenCalledTimes(1);

    const data: Record<string, unknown> = getUpdateData(0);

    expect(data["smsOrCallCurrentBalanceInUSDCents"]).toBe(2100);

    /*
     * These resets are correct and deliberately untouched: with the balance
     * topped up, the three conditions that armed those mails are gone, so the
     * next genuine failure must be allowed to mail once.
     */
    expect(data["failedCallAndSMSBalanceChargeNotificationSentToOwners"]).toBe(
      false,
    );
    expect(data["lowCallAndSMSBalanceNotificationSentToOwners"]).toBe(false);
    expect(data["notEnabledSmsOrCallNotificationSentToOwners"]).toBe(false);
  });

  test("a successful recharge still fires the Slack balance-refill notification", async () => {
    findOneByIdSpy.mockResolvedValue(
      makeSmsProject({ failedFlagAlreadySet: false }),
    );

    await NotificationService.rechargeBalance(PROJECT_ID, 20);

    expect(smsSlackSpy).toHaveBeenCalledTimes(1);
    expect(smsSlackSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        amountInUSD: 20,
        currentBalanceInUSD: 21,
      }),
    );
  });

  test("a first recharge failure mails owners exactly once and sets the flag", async () => {
    findOneByIdSpy.mockResolvedValue(
      makeSmsProject({ failedFlagAlreadySet: false }),
    );
    generateInvoiceSpy.mockRejectedValue(new Error("card_declined"));

    await expect(
      NotificationService.rechargeBalance(PROJECT_ID, 20),
    ).rejects.toThrow("card_declined");

    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(getSentSubject(0)).toBe(
      "ACTION REQUIRED: SMS and Call Recharge Failed for project - " +
        PROJECT_NAME,
    );

    expect(updateOneByIdSpy).toHaveBeenCalledTimes(1);
    expect(
      getUpdateData(0)["failedCallAndSMSBalanceChargeNotificationSentToOwners"],
    ).toBe(true);
  });

  test("a repeat recharge failure inside the 24h window mails owners zero times", async () => {
    findOneByIdSpy.mockResolvedValue(
      makeSmsProject({ failedFlagAlreadySet: true }),
    );
    generateInvoiceSpy.mockRejectedValue(new Error("card_declined"));

    // Somebody already holds today's window.
    claimWindowSpy.mockResolvedValue(false);

    await expect(
      NotificationService.rechargeBalance(PROJECT_ID, 20),
    ).rejects.toThrow("card_declined");

    expect(sendEmailSpy).toHaveBeenCalledTimes(0);

    /*
     * The flag write lives inside the same guard as the send. Re-writing true
     * over true is a wasted round trip on a path that runs once per paging
     * attempt, so the guard covers both.
     */
    expect(updateOneByIdSpy).toHaveBeenCalledTimes(0);
  });

  test("a NEW failure after the window expires still reaches the owners, even with the flag latched", async () => {
    /*
     * THE REGRESSION GUARD FOR PERMANENT SILENCE, and the reason the guard is
     * a window and not the project boolean.
     *
     * Sequence this stands in for: the project had no payment method, so the
     * boolean was set true and never cleared (it clears only on a SUCCESSFUL
     * recharge). The owner then adds a card and the card is declined. If the
     * catch were gated on the boolean, that owner would never be told - and
     * because the recharge can never succeed, never told again either. SMS and
     * voice paging would stop with no notice at all.
     */
    findOneByIdSpy.mockResolvedValue(
      makeSmsProject({ failedFlagAlreadySet: true }),
    );
    generateInvoiceSpy.mockRejectedValue(new Error("card_declined"));

    // Yesterday's window has expired, so this call claims a fresh one.
    claimWindowSpy.mockResolvedValue(true);

    await expect(
      NotificationService.rechargeBalance(PROJECT_ID, 20),
    ).rejects.toThrow("card_declined");

    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(getSentSubject(0)).toBe(
      "ACTION REQUIRED: SMS and Call Recharge Failed for project - " +
        PROJECT_NAME,
    );
  });

  test("the failure notice is sent when the shared cache is unreachable", async () => {
    /*
     * FAILS OPEN. A Redis blip must not be able to silence "we could not top
     * your balance up", because the consequence of that going unheard is that
     * nobody can be paged. One duplicated email is the cheaper mistake.
     */
    findOneByIdSpy.mockResolvedValue(
      makeSmsProject({ failedFlagAlreadySet: true }),
    );
    generateInvoiceSpy.mockRejectedValue(new Error("card_declined"));
    claimWindowSpy.mockRejectedValue(
      new DatabaseNotConnectedException("Cache is not connected"),
    );

    await expect(
      NotificationService.rechargeBalance(PROJECT_ID, 20),
    ).rejects.toThrow("card_declined");

    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
  });

  test("the window is claimed per project and per kind of failure", async () => {
    findOneByIdSpy.mockResolvedValue(
      makeSmsProject({ failedFlagAlreadySet: false }),
    );
    generateInvoiceSpy.mockRejectedValue(new Error("card_declined"));

    await expect(
      NotificationService.rechargeBalance(PROJECT_ID, 20),
    ).rejects.toThrow("card_declined");

    expect(claimWindowSpy).toHaveBeenCalledTimes(1);

    const call: Array<unknown> = claimWindowSpy.mock.calls[0] as Array<unknown>;

    expect(call[0]).toBe("billing-failure-notice");
    expect(call[1]).toBe(
      `${PROJECT_ID.toString()}-sms-and-call-recharge-failed`,
    );
    expect(call[3]).toEqual({ expiresInSeconds: 86400 });
  });

  test("the no-payment-method path mails owners exactly once, not twice", async () => {
    findOneByIdSpy.mockResolvedValue(
      makeSmsProject({ failedFlagAlreadySet: false }),
    );
    hasPaymentMethodsSpy.mockResolvedValue(false);

    await expect(
      NotificationService.rechargeBalance(PROJECT_ID, 20),
    ).rejects.toThrow("No payment methods found for the project");

    /*
     * The regression guard for the throw falling into this method's own catch.
     * Before the in-memory flag was set in the no-payment-method branch, the
     * catch's newly added guard still read false and sent a second copy.
     */
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(getSentSubject(0)).toBe(
      "ACTION REQUIRED: SMS and Call Recharge Failed for project - " +
        PROJECT_NAME,
    );
    expect(updateOneByIdSpy).toHaveBeenCalledTimes(1);
    expect(generateInvoiceSpy).toHaveBeenCalledTimes(0);

    /*
     * Exactly ONE window claim, taken by the branch. The catch is suppressed
     * by the local already-told-them flag rather than by a second claim, so
     * the throw cannot burn a second day's window on its way past.
     */
    expect(claimWindowSpy).toHaveBeenCalledTimes(1);
  });

  test("a repeat no-payment-method failure inside the window mails owners zero times", async () => {
    findOneByIdSpy.mockResolvedValue(
      makeSmsProject({ failedFlagAlreadySet: true }),
    );
    hasPaymentMethodsSpy.mockResolvedValue(false);
    claimWindowSpy.mockResolvedValue(false);

    await expect(
      NotificationService.rechargeBalance(PROJECT_ID, 20),
    ).rejects.toThrow("No payment methods found for the project");

    expect(sendEmailSpy).toHaveBeenCalledTimes(0);
    expect(updateOneByIdSpy).toHaveBeenCalledTimes(0);
  });

  test("a still-missing payment method is reported again the next day", async () => {
    /*
     * The no-payment-method branch is on a window too, not on the boolean.
     * Latching it would mean a project that never manages a successful
     * recharge - which is every project with no card - is told exactly once,
     * ever, that nobody can be paged for them.
     */
    findOneByIdSpy.mockResolvedValue(
      makeSmsProject({ failedFlagAlreadySet: true }),
    );
    hasPaymentMethodsSpy.mockResolvedValue(false);
    claimWindowSpy.mockResolvedValue(true);

    await expect(
      NotificationService.rechargeBalance(PROJECT_ID, 20),
    ).rejects.toThrow("No payment methods found for the project");

    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(getSentSubject(0)).toBe(
      "ACTION REQUIRED: SMS and Call Recharge Failed for project - " +
        PROJECT_NAME,
    );
  });
});

describe("AIBillingService.rechargeBalance - AI credit owner emails", () => {
  test("a successful AUTO recharge mails project owners zero times", async () => {
    findOneByIdSpy.mockResolvedValue(
      makeAiProject({ failedFlagAlreadySet: false }),
    );

    const balance: number = await AIBillingService.rechargeBalance(
      PROJECT_ID,
      20,
      { sendOwnerConfirmationEmail: false },
    );

    expect(balance).toBe(2100);
    expect(generateInvoiceSpy).toHaveBeenCalledTimes(1);
    expect(sendEmailSpy).toHaveBeenCalledTimes(0);
  });

  test("the auto-recharge caller is the one that asks for silence", () => {
    const source: string = fs.readFileSync(
      Path.resolve(__dirname, "../../../Server/Services/AIBillingService.ts"),
      "utf-8",
    );

    const autoRechargeBody: string = source.slice(
      source.indexOf("public async rechargeIfBalanceIsLow("),
    );

    expect(autoRechargeBody).toContain("sendOwnerConfirmationEmail: false");
  });

  test("a successful MANUAL recharge still confirms to the owners", async () => {
    findOneByIdSpy.mockResolvedValue(
      makeAiProject({ failedFlagAlreadySet: false }),
    );

    await AIBillingService.rechargeBalance(PROJECT_ID, 20);

    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(getSentSubject(0)).toBe(
      "AI Balance Recharge Successful for project - " + PROJECT_NAME,
    );
  });

  test("a successful recharge still resets all three owner-email flags and fires Slack", async () => {
    findOneByIdSpy.mockResolvedValue(
      makeAiProject({ failedFlagAlreadySet: true }),
    );

    await AIBillingService.rechargeBalance(PROJECT_ID, 20);

    expect(updateOneByIdSpy).toHaveBeenCalledTimes(1);

    const data: Record<string, unknown> = getUpdateData(0);

    expect(data["aiCurrentBalanceInUSDCents"]).toBe(2100);
    expect(data["failedAiBalanceChargeNotificationSentToOwners"]).toBe(false);
    expect(data["lowAiBalanceNotificationSentToOwners"]).toBe(false);
    expect(data["notEnabledAiNotificationSentToOwners"]).toBe(false);

    expect(aiSlackSpy).toHaveBeenCalledTimes(1);
  });

  test("a first recharge failure mails owners exactly once and sets the flag", async () => {
    findOneByIdSpy.mockResolvedValue(
      makeAiProject({ failedFlagAlreadySet: false }),
    );
    generateInvoiceSpy.mockRejectedValue(new Error("card_declined"));

    await expect(
      AIBillingService.rechargeBalance(PROJECT_ID, 20),
    ).rejects.toThrow("card_declined");

    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(getSentSubject(0)).toBe(
      "ACTION REQUIRED: AI Balance Recharge Failed for project - " +
        PROJECT_NAME,
    );

    expect(updateOneByIdSpy).toHaveBeenCalledTimes(1);
    expect(
      getUpdateData(0)["failedAiBalanceChargeNotificationSentToOwners"],
    ).toBe(true);
  });

  test("a repeat recharge failure inside the 24h window mails owners zero times", async () => {
    findOneByIdSpy.mockResolvedValue(
      makeAiProject({ failedFlagAlreadySet: true }),
    );
    generateInvoiceSpy.mockRejectedValue(new Error("card_declined"));
    claimWindowSpy.mockResolvedValue(false);

    await expect(
      AIBillingService.rechargeBalance(PROJECT_ID, 20),
    ).rejects.toThrow("card_declined");

    expect(sendEmailSpy).toHaveBeenCalledTimes(0);
    expect(updateOneByIdSpy).toHaveBeenCalledTimes(0);
  });

  test("a NEW failure after the window expires still reaches the owners, even with the flag latched", async () => {
    // The permanent-silence guard. See the SMS twin for the full sequence.
    findOneByIdSpy.mockResolvedValue(
      makeAiProject({ failedFlagAlreadySet: true }),
    );
    generateInvoiceSpy.mockRejectedValue(new Error("card_declined"));
    claimWindowSpy.mockResolvedValue(true);

    await expect(
      AIBillingService.rechargeBalance(PROJECT_ID, 20),
    ).rejects.toThrow("card_declined");

    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(getSentSubject(0)).toBe(
      "ACTION REQUIRED: AI Balance Recharge Failed for project - " +
        PROJECT_NAME,
    );
  });

  test("the failure notice is sent when the shared cache is unreachable", async () => {
    findOneByIdSpy.mockResolvedValue(
      makeAiProject({ failedFlagAlreadySet: true }),
    );
    generateInvoiceSpy.mockRejectedValue(new Error("card_declined"));
    claimWindowSpy.mockRejectedValue(
      new DatabaseNotConnectedException("Cache is not connected"),
    );

    await expect(
      AIBillingService.rechargeBalance(PROJECT_ID, 20),
    ).rejects.toThrow("card_declined");

    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
  });

  test("AI credits claim a different window from SMS and call", async () => {
    findOneByIdSpy.mockResolvedValue(
      makeAiProject({ failedFlagAlreadySet: false }),
    );
    generateInvoiceSpy.mockRejectedValue(new Error("card_declined"));

    await expect(
      AIBillingService.rechargeBalance(PROJECT_ID, 20),
    ).rejects.toThrow("card_declined");

    const call: Array<unknown> = claimWindowSpy.mock.calls[0] as Array<unknown>;

    /*
     * Sharing a key with the SMS/call notice would mean a declined card
     * silenced one of the two failures for the rest of the day.
     */
    expect(call[1]).toBe(`${PROJECT_ID.toString()}-ai-credit-recharge-failed`);
  });

  test("the no-payment-method path mails owners exactly once, not twice", async () => {
    findOneByIdSpy.mockResolvedValue(
      makeAiProject({ failedFlagAlreadySet: false }),
    );
    hasPaymentMethodsSpy.mockResolvedValue(false);

    await expect(
      AIBillingService.rechargeBalance(PROJECT_ID, 20),
    ).rejects.toThrow("No payment methods found for the project");

    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(updateOneByIdSpy).toHaveBeenCalledTimes(1);
    expect(generateInvoiceSpy).toHaveBeenCalledTimes(0);
    expect(claimWindowSpy).toHaveBeenCalledTimes(1);
  });

  test("a repeat no-payment-method failure inside the window mails owners zero times", async () => {
    findOneByIdSpy.mockResolvedValue(
      makeAiProject({ failedFlagAlreadySet: true }),
    );
    hasPaymentMethodsSpy.mockResolvedValue(false);
    claimWindowSpy.mockResolvedValue(false);

    await expect(
      AIBillingService.rechargeBalance(PROJECT_ID, 20),
    ).rejects.toThrow("No payment methods found for the project");

    expect(sendEmailSpy).toHaveBeenCalledTimes(0);
    expect(updateOneByIdSpy).toHaveBeenCalledTimes(0);
  });

  test("a still-missing payment method is reported again the next day", async () => {
    findOneByIdSpy.mockResolvedValue(
      makeAiProject({ failedFlagAlreadySet: true }),
    );
    hasPaymentMethodsSpy.mockResolvedValue(false);
    claimWindowSpy.mockResolvedValue(true);

    await expect(
      AIBillingService.rechargeBalance(PROJECT_ID, 20),
    ).rejects.toThrow("No payment methods found for the project");

    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
  });
});

/*
 * The sibling low-balance and not-enabled owner emails live in the four
 * notification services that call rechargeIfBalanceIsLow. Each is already
 * behind its own project boolean, and none of them was touched. They cannot be
 * exercised from here without importing the whole notification feature set, so
 * this is a source ratchet on the one invariant that matters: EVERY owner
 * email in those files sits behind one of the two flags. If a future edit adds
 * an unguarded sendEmailToProjectOwners - which is exactly how the two bugs
 * above came to exist - the counts stop matching and this fails.
 */
describe("sibling low-balance and not-enabled owner emails stay guarded", () => {
  const NOTIFICATION_SERVICES_DIRECTORY: string = Path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Notification/Services",
  );

  type CountOccurrencesFunction = (source: string, needle: string) => number;

  const countOccurrences: CountOccurrencesFunction = (
    source: string,
    needle: string,
  ): number => {
    return source.split(needle).length - 1;
  };

  const FILE_NAMES: Array<string> = [
    "SmsService.ts",
    "CallService.ts",
    "WhatsAppService.ts",
    "TelegramService.ts",
  ];

  test.each(FILE_NAMES)(
    "%s guards every owner email behind a project flag",
    (fileName: string) => {
      const source: string = fs.readFileSync(
        Path.join(NOTIFICATION_SERVICES_DIRECTORY, fileName),
        "utf-8",
      );

      const sends: number = countOccurrences(
        source,
        "await ProjectService.sendEmailToProjectOwners(",
      );

      const guards: number =
        countOccurrences(
          source,
          "if (!project.lowCallAndSMSBalanceNotificationSentToOwners) {",
        ) +
        countOccurrences(
          source,
          "if (!project.notEnabledSmsOrCallNotificationSentToOwners) {",
        );

      // Every file here has at least one, so a path typo cannot pass as 0 === 0.
      expect(sends).toBeGreaterThan(0);
      expect(guards).toBe(sends);
    },
  );
});
