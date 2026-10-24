import getJestMockFunction from "Common/Tests/MockType";
import StripeBillingProvider from "../../../Server/Billing/StripeBillingProvider";
import Errors from "Common/Server/Utils/Errors";
import {
  getStripeSubscription,
  mockIsBillingEnabled,
} from "./Helpers/StripeBillingProviderHelper";
import { Stripe, mockStripe } from "./Helpers/Stripe.mock";
import {
  describe,
  expect,
  beforeAll,
  beforeEach,
  it,
  jest,
} from "@jest/globals";
import OneUptimeDate from "Common/Types/Date";

/*
 * Inviting or removing a team member changes the seats on the project's
 * flat-fee subscription (TeamMemberService.
 * updateSubscriptionSeatsByUniqueTeamMembersInProject -> changeQuantity).
 *
 * A customer reported: "I started a trial but I was charged when I added
 * users to the team". Each invitation had raised its own invoice, charged
 * on the spot: changeQuantity updated the item - leaving its prorations
 * pending - and then sent a second, empty update with "always_invoice"
 * that invoiced them, and neither call asked whether the subscription was
 * still in its trial.
 *
 * A trialing subscription has nothing to charge for yet. Its seat changes
 * now ask for no prorations, so no invoice is raised while the trial runs:
 * the invoice that ends the trial bills the seats the subscription has
 * then. Outside a trial a seat is still prorated and invoiced straight
 * away - that is how a seat is paid for from the day it is added.
 *
 * Everything below asserts on what is handed to Stripe, because that is
 * the only thing that decides whether an invoice is raised.
 */
describe("StripeBillingProvider.changeQuantity - seats during and after a trial", () => {
  let billingService: StripeBillingProvider;

  const SUBSCRIPTION_ID: string = "sub_seats_123";
  const ITEM_ID: string = "si_seats_123";

  type UnixTimestampFunction = (days: number) => number;

  // getSomeDaysAfter goes through PositiveNumber, so it cannot count backwards.
  const daysFromNow: UnixTimestampFunction = (days: number): number => {
    return OneUptimeDate.toUnixTimestamp(
      OneUptimeDate.addRemoveDays(OneUptimeDate.getCurrentDate(), days),
    );
  };

  type GivenSubscriptionFunction = (options: {
    status: Stripe.Subscription.Status;
    trialEnd?: number | null | undefined;
    quantity?: number | undefined;
  }) => void;

  const givenSubscription: GivenSubscriptionFunction = (options: {
    status: Stripe.Subscription.Status;
    trialEnd?: number | null | undefined;
    quantity?: number | undefined;
  }): void => {
    mockStripe.subscriptions.retrieve = getJestMockFunction().mockResolvedValue(
      getStripeSubscription({
        id: SUBSCRIPTION_ID,
        itemId: ITEM_ID,
        status: options.status,
        trialEnd: options.trialEnd,
        quantity: options.quantity,
      }),
    );
  };

  type UpdateCallsFunction = () => Array<
    [string, Stripe.SubscriptionUpdateParams]
  >;

  const updateCalls: UpdateCallsFunction = (): Array<
    [string, Stripe.SubscriptionUpdateParams]
  > => {
    return (
      mockStripe.subscriptions.update as unknown as {
        mock: {
          calls: Array<[string, Stripe.SubscriptionUpdateParams]>;
        };
      }
    ).mock.calls;
  };

  type OnlyUpdateFunction = () => Stripe.SubscriptionUpdateParams;

  // The one update a seat change is allowed to make.
  const onlyUpdate: OnlyUpdateFunction =
    (): Stripe.SubscriptionUpdateParams => {
      const calls: Array<[string, Stripe.SubscriptionUpdateParams]> =
        updateCalls();

      expect(calls).toHaveLength(1);
      expect(calls[0]![0]).toBe(SUBSCRIPTION_ID);

      return calls[0]![1];
    };

  type ExpectNothingInvoicedFunction = () => void;

  /*
   * No way for a seat change to raise an invoice: no "always_invoice" on
   * any update, no invoice created by hand, and no separate item update
   * leaving prorations behind for something else to invoice.
   */
  const expectNothingInvoiced: ExpectNothingInvoicedFunction = (): void => {
    for (const call of updateCalls()) {
      expect(call[1].proration_behavior).not.toBe("always_invoice");
      expect(call[1].proration_behavior).not.toBe("create_prorations");
    }

    expect(mockStripe.invoices.create).not.toHaveBeenCalled();
    expect(mockStripe.invoices.pay).not.toHaveBeenCalled();
    expect(mockStripe.subscriptionItems.update).not.toHaveBeenCalled();
  };

  /*
   * Built once: mockIsBillingEnabled resets the module registry and re-imports
   * the whole service graph, which costs seconds. Nothing here toggles billing
   * off, so one instance serves every test - the per-test mocks are reset in
   * beforeEach instead.
   */
  beforeAll(
    async () => {
      billingService = await mockIsBillingEnabled(true);
    },
    30 * 1000, // 30 second timeout because setting up the module graph is slow
  );

  beforeEach(() => {
    jest.clearAllMocks();

    mockStripe.subscriptions.update = getJestMockFunction().mockResolvedValue(
      {},
    );
  });

  describe("while the subscription is in its trial", () => {
    it("should ask for no prorations when a seat is added", async () => {
      // This assertion is the fix: the invitation does not charge the trial.
      givenSubscription({
        status: "trialing",
        trialEnd: daysFromNow(10),
        quantity: 1,
      });

      await billingService.changeQuantity(SUBSCRIPTION_ID, 2);

      expect(onlyUpdate().proration_behavior).toBe("none");
      expectNothingInvoiced();
    });

    it("should still apply the new seat count, so the invoice that ends the trial bills it", async () => {
      givenSubscription({
        status: "trialing",
        trialEnd: daysFromNow(10),
        quantity: 1,
      });

      await billingService.changeQuantity(SUBSCRIPTION_ID, 2);

      expect(onlyUpdate().items).toEqual([{ id: ITEM_ID, quantity: 2 }]);
    });

    it("should raise no invoice for any of several invitations in a row", async () => {
      /*
       * Inviting a team is several invitations, one after another, each
       * changing the seats. During a trial none of them may charge.
       */
      for (let seats: number = 2; seats <= 6; seats++) {
        givenSubscription({
          status: "trialing",
          trialEnd: daysFromNow(13),
          quantity: seats - 1,
        });

        await billingService.changeQuantity(SUBSCRIPTION_ID, seats);
      }

      expect(updateCalls()).toHaveLength(5);

      updateCalls().forEach(
        (call: [string, Stripe.SubscriptionUpdateParams], index: number) => {
          expect(call[1].proration_behavior).toBe("none");
          expect(call[1].items).toEqual([{ id: ITEM_ID, quantity: index + 2 }]);
        },
      );

      expectNothingInvoiced();
    });

    it("should ask for no prorations when a seat is removed", async () => {
      givenSubscription({
        status: "trialing",
        trialEnd: daysFromNow(5),
        quantity: 4,
      });

      await billingService.changeQuantity(SUBSCRIPTION_ID, 3);

      expect(onlyUpdate()).toEqual(
        expect.objectContaining({
          items: [{ id: ITEM_ID, quantity: 3 }],
          proration_behavior: "none",
        }),
      );
      expectNothingInvoiced();
    });

    it("should treat a trial_end still ahead as a trial whatever the status says", async () => {
      // Either reading means the current period is free.
      givenSubscription({
        status: "active",
        trialEnd: daysFromNow(3),
        quantity: 2,
      });

      await billingService.changeQuantity(SUBSCRIPTION_ID, 3);

      expect(onlyUpdate().proration_behavior).toBe("none");
      expectNothingInvoiced();
    });

    it("should treat a trialing status as a trial even with no trial_end on it", async () => {
      givenSubscription({ status: "trialing", trialEnd: null, quantity: 2 });

      await billingService.changeQuantity(SUBSCRIPTION_ID, 3);

      expect(onlyUpdate().proration_behavior).toBe("none");
    });

    it("should still ask for no prorations when the trial date has just passed but Stripe still reports the trial", async () => {
      /*
       * The invoice that ends the trial has not been raised yet, and it bills
       * the seats the subscription has when it is - this one included.
       */
      givenSubscription({
        status: "trialing",
        trialEnd: daysFromNow(-1),
        quantity: 2,
      });

      await billingService.changeQuantity(SUBSCRIPTION_ID, 3);

      expect(onlyUpdate().proration_behavior).toBe("none");
    });

    it("should never move the trial while changing seats", async () => {
      /*
       * Sending trial_end re-anchors the billing cycle, and "now" ends the
       * trial and invoices the plan on the spot. A seat change sends neither.
       */
      givenSubscription({
        status: "trialing",
        trialEnd: daysFromNow(10),
        quantity: 1,
      });

      await billingService.changeQuantity(SUBSCRIPTION_ID, 2);

      expect(onlyUpdate()).not.toHaveProperty("trial_end");
      expect(onlyUpdate()).not.toHaveProperty("billing_cycle_anchor");
    });
  });

  describe("once the subscription is out of its trial", () => {
    it("should prorate an added seat and invoice it straight away", async () => {
      givenSubscription({ status: "active", trialEnd: null, quantity: 1 });

      await billingService.changeQuantity(SUBSCRIPTION_ID, 2);

      expect(onlyUpdate()).toEqual({
        items: [{ id: ITEM_ID, quantity: 2 }],
        proration_behavior: "always_invoice",
      });
    });

    it("should invoice straight away once the trial has lapsed", async () => {
      // A trial that ended does not keep sparing seat changes.
      givenSubscription({
        status: "active",
        trialEnd: daysFromNow(-20),
        quantity: 3,
      });

      await billingService.changeQuantity(SUBSCRIPTION_ID, 4);

      expect(onlyUpdate().proration_behavior).toBe("always_invoice");
    });

    it("should invoice the credit for a removed seat straight away", async () => {
      givenSubscription({ status: "active", trialEnd: null, quantity: 5 });

      await billingService.changeQuantity(SUBSCRIPTION_ID, 4);

      expect(onlyUpdate()).toEqual({
        items: [{ id: ITEM_ID, quantity: 4 }],
        proration_behavior: "always_invoice",
      });
    });

    it("should invoice a past_due subscription's added seat straight away", async () => {
      givenSubscription({ status: "past_due", trialEnd: null, quantity: 2 });

      await billingService.changeQuantity(SUBSCRIPTION_ID, 3);

      expect(onlyUpdate().proration_behavior).toBe("always_invoice");
    });
  });

  describe("the update a seat change makes", () => {
    it("should be a single update, never a separate item update followed by an invoicing one", async () => {
      /*
       * Two calls let the quantity and the decision to invoice it drift
       * apart: the item update left prorations pending, and the empty second
       * update invoiced them.
       */
      givenSubscription({ status: "active", trialEnd: null, quantity: 1 });

      await billingService.changeQuantity(SUBSCRIPTION_ID, 2);

      expect(mockStripe.subscriptions.update).toHaveBeenCalledTimes(1);
      expect(mockStripe.subscriptionItems.update).not.toHaveBeenCalled();
    });

    it("should change the subscription's own item and leave its price alone", async () => {
      /*
       * The item id is not optional: an item without one is ADDED to the
       * subscription, and the customer is billed for it alongside the old
       * one. No price either - the seat count changes, the plan does not.
       */
      givenSubscription({ status: "active", trialEnd: null, quantity: 1 });

      await billingService.changeQuantity(SUBSCRIPTION_ID, 2);

      const items: Array<Stripe.SubscriptionUpdateParams.Item> =
        onlyUpdate().items || [];

      expect(items).toHaveLength(1);
      expect(items[0]!.id).toBe(ITEM_ID);
      expect(items[0]!).not.toHaveProperty("price");
    });

    it("should read the subscription it changes", async () => {
      givenSubscription({ status: "active", trialEnd: null, quantity: 1 });

      await billingService.changeQuantity(SUBSCRIPTION_ID, 2);

      expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith(
        SUBSCRIPTION_ID,
      );
    });
  });

  describe("when there is nothing to change", () => {
    it("should not touch a trialing subscription that already has that many seats", async () => {
      givenSubscription({
        status: "trialing",
        trialEnd: daysFromNow(10),
        quantity: 3,
      });

      await billingService.changeQuantity(SUBSCRIPTION_ID, 3);

      expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
      expectNothingInvoiced();
    });

    it("should not touch an active subscription that already has that many seats", async () => {
      /*
       * Outside a trial an update asks Stripe to invoice now, so one that
       * changes nothing is not sent at all.
       */
      givenSubscription({ status: "active", trialEnd: null, quantity: 3 });

      await billingService.changeQuantity(SUBSCRIPTION_ID, 3);

      expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
      expectNothingInvoiced();
    });

    it("should still update when the item does not report its seats", async () => {
      // Unknown is not the same as equal: the count has to be applied.
      givenSubscription({ status: "active", trialEnd: null });

      await billingService.changeQuantity(SUBSCRIPTION_ID, 3);

      expect(onlyUpdate().items).toEqual([{ id: ITEM_ID, quantity: 3 }]);
    });

    it("should not touch a canceled subscription", async () => {
      givenSubscription({ status: "canceled", trialEnd: null, quantity: 1 });

      await billingService.changeQuantity(SUBSCRIPTION_ID, 2);

      expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
      expectNothingInvoiced();
    });
  });

  describe("refusing to change seats", () => {
    it("should throw when the subscription cannot be found", async () => {
      mockStripe.subscriptions.retrieve =
        getJestMockFunction().mockResolvedValue(null);

      await expect(
        billingService.changeQuantity(SUBSCRIPTION_ID, 2),
      ).rejects.toThrow(Errors.BillingService.SUBSCRIPTION_NOT_FOUND);

      expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it("should throw when the subscription has no item to put the seats on", async () => {
      mockStripe.subscriptions.retrieve =
        getJestMockFunction().mockResolvedValue(
          getStripeSubscription({
            id: SUBSCRIPTION_ID,
            status: "trialing",
            trialEnd: daysFromNow(10),
            items: [],
          }),
        );

      await expect(
        billingService.changeQuantity(SUBSCRIPTION_ID, 2),
      ).rejects.toThrow(Errors.BillingService.SUBSCRIPTION_ITEM_NOT_FOUND);

      expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it("should let a payment provider failure reach the caller, so the seat sync retries", async () => {
      /*
       * TeamMemberService records the seats only after this resolves, and the
       * scheduled reconciliation retries a count that was never acknowledged.
       */
      givenSubscription({
        status: "trialing",
        trialEnd: daysFromNow(10),
        quantity: 1,
      });
      mockStripe.subscriptions.update = getJestMockFunction().mockRejectedValue(
        new Error("Stripe is unavailable"),
      );

      await expect(
        billingService.changeQuantity(SUBSCRIPTION_ID, 2),
      ).rejects.toThrow("Stripe is unavailable");
    });
  });
});
