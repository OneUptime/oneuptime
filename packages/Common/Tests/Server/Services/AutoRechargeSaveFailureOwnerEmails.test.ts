import AIBillingService from "../../../Server/Services/AIBillingService";
import NotificationService from "../../../Server/Services/NotificationService";
import ProjectService from "../../../Server/Services/ProjectService";
import { getPaymentNotCompletedMessage } from "../../../Server/Utils/Billing/PaymentProviderRefusal";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ProjectBalanceType from "../../../Types/Billing/ProjectBalanceType";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../Types/Exception/BadDataException";
import CloudMarketplace from "../../../Types/Marketplace/CloudMarketplace";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import {
  AutoRechargeSaveWorld,
  useAutoRechargeSaveWorld,
} from "../TestingUtils/AutoRechargeSaveWorld";
import {
  flushBackgroundWork,
  shownLines,
} from "../TestingUtils/SlackWebhookMessages";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * Billing on, as on OneUptime Cloud. The operator's Slack channel is a
 * webhook the world catches (TestingUtils/SlackWebhookMessages).
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: true,
    NotificationSlackWebhookOnCreateProject: "",
    NotificationSlackWebhookOnSubscriptionUpdate:
      "https://hooks.slack.com/services/T000/B000/auto-recharge-save",
  };
});

/*
 * SAVING AUTO RECHARGE THAT CANNOT CHARGE THE CARD IS THE SAVER'S TO HEAR OF
 * (#11090).
 *
 * Turning Auto Recharge on while the balance is below its threshold tries
 * the card at once (ProjectService.chargeAutoRechargeTurnedOn), and a charge
 * that fails - no payment method, a declined card, a cloud marketplace
 * subscription that is not active - refuses the save: the person who
 * pressed Save reads why in the dialog, and Auto Recharge stays as it was.
 *
 * The try ran as Auto Recharge's own, though, so every owner was also
 * emailed "ACTION REQUIRED: ... Recharge Failed" about an Auto Recharge that
 * was never turned on, the day's owner-notice window was claimed
 * (BillingFailureNoticeThrottle), and Auto Recharge's hour of waiting
 * started (BalanceRechargeGuard) for a setting that was still off.
 *
 * Now the try is the saver's, as Add to Balance's is (#11052): refused with
 * why, no owner emailed, no notice window claimed, no wait started. Auto
 * Recharge's own try - a message or an AI call that finds the balance low -
 * is unchanged: a failure emails the owners, once a day, and waits an hour.
 * A save that charges the card charges it once, with the amount being
 * saved, as before.
 *
 * Driven through the real ProjectService.updateOneById with the Auto
 * Recharge columns, as the Dashboard, the API and Terraform save them, into
 * the real recharge services (TestingUtils/AutoRechargeSaveWorld).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11090000-0000-4000-8000-0000000000a1",
);
const USER_ID: ObjectID = new ObjectID("11090000-0000-4000-8000-0000000000b1");

const NO_PAYMENT_METHOD_MESSAGE: string =
  "No payment methods found for the project. Please add a payment method in Project Settings to continue.";
const INACTIVE_MESSAGE: string =
  "This project is billed through AWS Marketplace, and its subscription there is not active. Resolve it on AWS Marketplace, then try again.";

// A declined card, as the payment provider's SDK throws it.
function cardDeclined(message: string): Error {
  return Object.assign(new Error(message), {
    type: "StripeCardError",
    code: "card_declined",
  });
}

// Somebody in the project who holds `permission`, on the highest plan.
function propsOf(permission: Permission): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: [
      Permission.CurrentUser,
      Permission.ProjectUser,
      permission,
    ].map((held: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: held,
        labelIds: [],
        isBlockPermission: false,
        scope: PermissionScope.All,
      };
    }),
  };

  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
    currentPlan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  };
}

// Who may change Auto Recharge: the columns' own update permissions.
const WHO_MAY_SAVE: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ManageProjectBilling,
];

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return undefined;
}

// What the person who saved is told: the refusal's words.
function wordsOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface BalanceUnderTest {
  name: string;
  balance: ProjectBalanceType;
  balanceColumn: string;
  enableColumn: string;
  amountColumn: string;
  thresholdColumn: string;
  failedFlagColumn: string;
  failedSubject: string;
  slackTitle: string;
  // Auto Recharge's own try: a message, or an AI call, finds the balance low.
  autoRechargeOwnTry: () => Promise<number>;
}

const BALANCES: Array<BalanceUnderTest> = [
  {
    name: "the SMS and call balance",
    balance: ProjectBalanceType.SmsOrCall,
    balanceColumn: "smsOrCallCurrentBalanceInUSDCents",
    enableColumn: "enableAutoRechargeSmsOrCallBalance",
    amountColumn: "autoRechargeSmsOrCallByBalanceInUSD",
    thresholdColumn: "autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD",
    failedFlagColumn: "failedCallAndSMSBalanceChargeNotificationSentToOwners",
    failedSubject:
      "ACTION REQUIRED: SMS and Call Recharge Failed for project - Acme Production",
    slackTitle: "*SMS and Call Balance Refilled:*",
    autoRechargeOwnTry: (): Promise<number> => {
      return NotificationService.rechargeIfBalanceIsLow(PROJECT_ID);
    },
  },
  {
    name: "the AI credits",
    balance: ProjectBalanceType.AI,
    balanceColumn: "aiCurrentBalanceInUSDCents",
    enableColumn: "enableAutoRechargeAiBalance",
    amountColumn: "autoAiRechargeByBalanceInUSD",
    thresholdColumn: "autoRechargeAiWhenCurrentBalanceFallsInUSD",
    failedFlagColumn: "failedAiBalanceChargeNotificationSentToOwners",
    failedSubject:
      "ACTION REQUIRED: AI Balance Recharge Failed for project - Acme Production",
    slackTitle: "*AI Balance Refilled:*",
    autoRechargeOwnTry: (): Promise<number> => {
      return AIBillingService.rechargeIfBalanceIsLow(PROJECT_ID);
    },
  },
];

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(BALANCES)(
  "saving Auto Recharge of $name through ProjectService.updateOneById",
  (balance: BalanceUnderTest) => {
    // The columns a save of Auto Recharge writes: on, how much to add, and when.
    function autoRechargeOn(data: {
      rechargeByInUSD: number;
      whenBalanceFallsToInUSD: number;
    }): Record<string, unknown> {
      return {
        [balance.enableColumn]: true,
        [balance.amountColumn]: data.rechargeByInUSD,
        [balance.thresholdColumn]: data.whenBalanceFallsToInUSD,
      };
    }

    function save(
      data: Record<string, unknown>,
      permission: Permission = Permission.ProjectOwner,
    ): Promise<number> {
      return ProjectService.updateOneById({
        id: PROJECT_ID,
        data: data as never,
        props: propsOf(permission),
      });
    }

    // A project whose balance is 1 USD, with Auto Recharge off unless a test says otherwise.
    function setUp(
      values: Record<string, unknown> = {},
    ): AutoRechargeSaveWorld {
      return useAutoRechargeSaveWorld(PROJECT_ID, {
        [balance.balanceColumn]: 100,
        ...values,
      });
    }

    // Nobody but the person who saved heard of the failure, and nothing waits for it.
    function expectNobodyElseTold(world: AutoRechargeSaveWorld): void {
      expect(world.ownerEmails).toEqual([]);
      expect(world.row()[balance.failedFlagColumn]).toBe(false);
      expect(world.noticeWindowsClaimed()).toEqual([]);
      expect(world.isAutoRechargeWaiting(balance.balance)).toBe(false);
    }

    // The save was refused: Auto Recharge and the balance are as they were.
    function expectAutoRechargeOffAsItWas(world: AutoRechargeSaveWorld): void {
      expect(world.row()[balance.enableColumn]).toBe(false);
      expect(world.row()[balance.amountColumn]).toBe(20);
      expect(world.row()[balance.thresholdColumn]).toBe(10);
      expect(world.row()[balance.balanceColumn]).toBe(100);
      expect(world.projects.updates).toEqual([]);
    }

    test("a declined card: the save is refused in the payment provider's words, Auto Recharge stays off, and no owner is emailed", async () => {
      const world: AutoRechargeSaveWorld = setUp();
      world.failChargesWith(cardDeclined("Your card was declined."));

      const error: unknown = await rejectionOf(
        save(
          autoRechargeOn({ rechargeByInUSD: 20, whenBalanceFallsToInUSD: 10 }),
        ),
      );

      expectNobodyElseTold(world);

      // A refusal the dialog shows as it is, not a failure nobody explained.
      expect(error).toBeInstanceOf(BadDataException);
      expect(wordsOf(error)).toBe(
        getPaymentNotCompletedMessage("Your card was declined."),
      );

      // The card was tried once, with the amount being saved, and charged nothing.
      expect(world.chargesAsked).toEqual([20]);
      expect(world.charges).toEqual([]);

      expectAutoRechargeOffAsItWas(world);
    });

    test("no payment method: the save is refused with why, nothing is charged, and no owner is emailed", async () => {
      const world: AutoRechargeSaveWorld = setUp();
      world.setHasPaymentMethods(false);

      const error: unknown = await rejectionOf(
        save(
          autoRechargeOn({ rechargeByInUSD: 20, whenBalanceFallsToInUSD: 10 }),
        ),
      );

      expectNobodyElseTold(world);

      expect(error).toBeInstanceOf(BadDataException);
      expect(wordsOf(error)).toBe(NO_PAYMENT_METHOD_MESSAGE);
      expect(world.chargesAsked).toEqual([]);

      expectAutoRechargeOffAsItWas(world);
    });

    test("a cloud marketplace subscription that is not active: the save is refused with what to put right there, and no owner is emailed", async () => {
      const world: AutoRechargeSaveWorld = setUp({
        billingMarketplace: CloudMarketplace.AWS,
      });
      world.refuseMarketplaceTopUpsWith(new BadDataException(INACTIVE_MESSAGE));

      const error: unknown = await rejectionOf(
        save(
          autoRechargeOn({ rechargeByInUSD: 20, whenBalanceFallsToInUSD: 10 }),
        ),
      );

      expectNobodyElseTold(world);

      expect(wordsOf(error)).toBe(INACTIVE_MESSAGE);
      // Never the card, and nothing recorded for the marketplace to bill.
      expect(world.chargesAsked).toEqual([]);
      expect(world.marketplaceTopUps).toEqual([]);

      expectAutoRechargeOffAsItWas(world);
    });

    test("whatever is saved, by whoever may save it, and however the charge fails, the refused save emails nobody and leaves Auto Recharge as it was", async () => {
      const random: SeededRandom = seededRandom(
        balance.balance === ProjectBalanceType.AI ? 110902 : 110901,
      );
      const world: AutoRechargeSaveWorld = setUp();

      // The ways a charge fails, and what the person who saved reads.
      const failures: Array<{
        name: string;
        arrange: () => void;
        answer: string;
        triesTheCard: boolean;
      }> = [
        {
          name: "a declined card",
          arrange: (): void => {
            world.setHasPaymentMethods(true);
            world.failChargesWith(cardDeclined("Your card has expired."));
          },
          answer: getPaymentNotCompletedMessage("Your card has expired."),
          triesTheCard: true,
        },
        {
          name: "a failure the payment provider did not explain",
          arrange: (): void => {
            world.setHasPaymentMethods(true);
            world.failChargesWith(new Error("Payment provider unavailable"));
          },
          answer: "Payment provider unavailable",
          triesTheCard: true,
        },
        {
          name: "no payment method",
          arrange: (): void => {
            world.setHasPaymentMethods(false);
            world.failChargesWith(null);
          },
          answer: NO_PAYMENT_METHOD_MESSAGE,
          triesTheCard: false,
        },
      ];

      const amountsTried: Array<number> = [];

      for (let attempt: number = 0; attempt < 24; attempt++) {
        // What the API takes: an amount to add, and a balance to add it at.
        const rechargeByInUSD: number = 20 + random(981);
        const whenBalanceFallsToInUSD: number = 10 + random(991);
        // Below the balance it recharges at, so the card is tried.
        const balanceInUSDCents: number = random(whenBalanceFallsToInUSD * 100);
        // Auto Recharge already on - saved again, with new amounts - or off.
        const wasOn: boolean = random(2) === 0;
        const permission: Permission =
          WHO_MAY_SAVE[random(WHO_MAY_SAVE.length)]!;
        const failure: (typeof failures)[number] =
          failures[random(failures.length)]!;

        Object.assign(world.row(), {
          [balance.balanceColumn]: balanceInUSDCents,
          [balance.enableColumn]: wasOn,
          [balance.amountColumn]: 20,
          [balance.thresholdColumn]: 10,
        });
        failure.arrange();

        const error: unknown = await rejectionOf(
          save(
            autoRechargeOn({ rechargeByInUSD, whenBalanceFallsToInUSD }),
            permission,
          ),
        );

        expect(world.ownerEmails).toEqual([]);
        expect(`${failure.name}: ${wordsOf(error)}`).toBe(
          `${failure.name}: ${failure.answer}`,
        );

        if (failure.triesTheCard) {
          amountsTried.push(rechargeByInUSD);
        }

        // Refused: Auto Recharge and the balance as they were.
        expect(world.row()[balance.enableColumn]).toBe(wasOn);
        expect(world.row()[balance.amountColumn]).toBe(20);
        expect(world.row()[balance.thresholdColumn]).toBe(10);
        expect(world.row()[balance.balanceColumn]).toBe(balanceInUSDCents);
      }

      // Each card tried once, with the amount being saved; none charged.
      expect(world.chargesAsked).toEqual(amountsTried);
      expect(world.charges).toEqual([]);
      expect(world.projects.updates).toEqual([]);
      expectNobodyElseTold(world);
    });

    test("Auto Recharge's own failure afterwards still emails the owners once a day, and waits an hour, as before", async () => {
      // Auto Recharge is on, adding 20 USD below 10 USD; somebody saves new amounts.
      const world: AutoRechargeSaveWorld = setUp({
        [balance.enableColumn]: true,
      });
      world.failChargesWith(cardDeclined("Your card was declined."));

      const refused: unknown = await rejectionOf(
        save(
          autoRechargeOn({ rechargeByInUSD: 50, whenBalanceFallsToInUSD: 25 }),
        ),
      );

      expect(wordsOf(refused)).toBe(
        getPaymentNotCompletedMessage("Your card was declined."),
      );
      // Auto Recharge as it was: on, with its own amounts.
      expect(world.row()[balance.enableColumn]).toBe(true);
      expect(world.row()[balance.amountColumn]).toBe(20);
      expectNobodyElseTold(world);

      /*
       * A message or an AI call then finds the balance low. Nothing held
       * Auto Recharge back: it tries the card at once, with its own amount,
       * and its failure reaches the owners.
       */
      await expect(balance.autoRechargeOwnTry()).rejects.toThrow(
        "Your card was declined.",
      );

      expect(world.chargesAsked).toEqual([50, 20]);
      expect(
        world.ownerEmails.map((email: { subject: string }) => {
          return email.subject;
        }),
      ).toEqual([balance.failedSubject]);
      expect(world.ownerEmails[0]!.body).toContain(
        "and failed. Please make sure your payment method is up to date and has sufficient balance.",
      );
      expect(world.row()[balance.failedFlagColumn]).toBe(true);
      expect(world.noticeWindowsClaimed()).toHaveLength(1);
      expect(world.isAutoRechargeWaiting(balance.balance)).toBe(true);

      // The storm goes on: Auto Recharge waits its hour, and tells nobody again.
      expect(await balance.autoRechargeOwnTry()).toBe(100);
      expect(world.chargesAsked).toEqual([50, 20]);
      expect(world.ownerEmails).toHaveLength(1);

      /*
       * Somebody saves again: tried at once, whatever failed before, and
       * refused again - with no second email, and Auto Recharge's wait left
       * as its own failure set it.
       */
      await expect(
        save(
          autoRechargeOn({ rechargeByInUSD: 50, whenBalanceFallsToInUSD: 25 }),
        ),
      ).rejects.toThrow(
        getPaymentNotCompletedMessage("Your card was declined."),
      );

      expect(world.chargesAsked).toEqual([50, 20, 50]);
      expect(world.ownerEmails).toHaveLength(1);
      expect(world.isAutoRechargeWaiting(balance.balance)).toBe(true);
    });

    test("a card that works: the save charges the amount being saved once, credits it, turns Auto Recharge on, and emails no owner, as before", async () => {
      const world: AutoRechargeSaveWorld = setUp();

      // Auto Recharge's own last try failed: saving tries at once anyway.
      world.cache.set(
        `${
          balance.balance === ProjectBalanceType.AI
            ? "ai-auto-recharge-failed"
            : "sms-or-call-auto-recharge-failed"
        }-${PROJECT_ID.toString()}`,
        "2026-11-24T08:00:00.000Z",
      );

      expect(
        await save(
          autoRechargeOn({ rechargeByInUSD: 50, whenBalanceFallsToInUSD: 25 }),
        ),
      ).toBe(1);
      await flushBackgroundWork();

      expect(world.chargesAsked).toEqual([50]);
      expect(world.charges).toEqual([50]);
      expect(world.row()[balance.balanceColumn]).toBe(5100);
      expect(world.row()[balance.enableColumn]).toBe(true);
      expect(world.row()[balance.amountColumn]).toBe(50);
      expect(world.row()[balance.thresholdColumn]).toBe(25);

      // No email, as before; the card works, so Auto Recharge waits no more.
      expect(world.ownerEmails).toEqual([]);
      expect(world.isAutoRechargeWaiting(balance.balance)).toBe(false);

      // The operator's channel hears of it as the person's charge.
      expect(world.slack.messages).toHaveLength(1);
      const lines: Array<string> = shownLines(world.slack.messages[0]?.text);
      expect(lines[0]).toBe(balance.slackTitle);
      expect(lines).toContain("*Refill Amount:* $50 USD");
      expect(lines).toContain("*Recharge Type:* Manual");
    });

    test("a balance at or above its threshold: saving charges nothing, as before", async () => {
      const world: AutoRechargeSaveWorld = setUp({
        [balance.balanceColumn]: 2500,
      });

      expect(
        await save(
          autoRechargeOn({ rechargeByInUSD: 50, whenBalanceFallsToInUSD: 25 }),
        ),
      ).toBe(1);

      expect(world.chargesAsked).toEqual([]);
      expect(world.row()[balance.enableColumn]).toBe(true);
      expect(world.row()[balance.balanceColumn]).toBe(2500);
      expect(world.ownerEmails).toEqual([]);
    });

    test("billed through a cloud marketplace: the save's top-up is recorded as the person's, and Auto Recharge's own as automatic", async () => {
      const world: AutoRechargeSaveWorld = setUp({
        billingMarketplace: CloudMarketplace.AWS,
      });

      expect(
        await save(
          autoRechargeOn({ rechargeByInUSD: 20, whenBalanceFallsToInUSD: 10 }),
        ),
      ).toBe(1);

      // Credited, billed through the marketplace, and never the card.
      expect(world.row()[balance.balanceColumn]).toBe(2100);
      expect(world.chargesAsked).toEqual([]);

      // Messages or AI calls use the balance up; Auto Recharge adds it again.
      world.row()[balance.balanceColumn] = 0;
      expect(await balance.autoRechargeOwnTry()).toBe(2000);

      expect(world.marketplaceTopUps).toEqual([
        { balanceType: balance.balance, amountInUSD: 20, isAutomatic: false },
        { balanceType: balance.balance, amountInUSD: 20, isAutomatic: true },
      ]);
      expect(world.ownerEmails).toEqual([]);
    });
  },
);
