import getJestMockFunction from "../../MockType";
import { BillingService } from "../../../Server/Services/BillingService";
import Errors from "../../../Server/Utils/Errors";
import {
  getStripeSubscription,
  mockIsBillingEnabled,
} from "../TestingUtils/Services/BillingServiceHelper";
import { Stripe, mockStripe } from "../TestingUtils/__mocks__/Stripe.mock";
import { describe, expect, beforeEach, jest } from "@jest/globals";
import OneUptimeDate from "../../../Types/Date";

/*
 * Extending a trial is the one operation that hands out free service and moves
 * the customer's next invoice, so these tests are mostly about what must NOT
 * happen: no proration, no partial application across the two subscriptions,
 * and no write at all when the input or the subscription state is wrong.
 */
describe("BillingService.extendTrial", () => {
  let billingService: BillingService;

  const SUBSCRIPTION_ID: string = "sub_main_123";
  const METERED_SUBSCRIPTION_ID: string = "sub_metered_456";

  // Comfortably inside Stripe's 730 day ceiling and clear of "now".
  const newTrialEndDate: Date = OneUptimeDate.getSomeDaysAfter(30);

  type PastDateFunction = (daysAgo: number) => Date;

  // getSomeDaysAfter goes through PositiveNumber, so it cannot count backwards.
  const pastDate: PastDateFunction = (daysAgo: number): Date => {
    return OneUptimeDate.addRemoveDays(
      OneUptimeDate.getCurrentDate(),
      -daysAgo,
    );
  };

  type MockRetrieveFunction = (statuses: {
    main?: Stripe.Subscription.Status | undefined;
    metered?: Stripe.Subscription.Status | undefined;
    mainSubscription?: Stripe.Subscription | null | undefined;
    meteredSubscription?: Stripe.Subscription | null | undefined;
  }) => void;

  /*
   * Both subscriptions come back from the same mocked retrieve, so key the
   * response off the id the service asked for - otherwise a test cannot tell
   * "main is cancelled" from "metered is cancelled".
   */
  const mockRetrieve: MockRetrieveFunction = (statuses: {
    main?: Stripe.Subscription.Status | undefined;
    metered?: Stripe.Subscription.Status | undefined;
    mainSubscription?: Stripe.Subscription | null | undefined;
    meteredSubscription?: Stripe.Subscription | null | undefined;
  }): void => {
    mockStripe.subscriptions.retrieve =
      getJestMockFunction().mockImplementation((id: unknown): unknown => {
        if (id === METERED_SUBSCRIPTION_ID) {
          if (statuses.meteredSubscription !== undefined) {
            return Promise.resolve(statuses.meteredSubscription);
          }
          return Promise.resolve(
            getStripeSubscription({
              id: METERED_SUBSCRIPTION_ID,
              status: statuses.metered || "trialing",
            }),
          );
        }

        if (statuses.mainSubscription !== undefined) {
          return Promise.resolve(statuses.mainSubscription);
        }

        return Promise.resolve(
          getStripeSubscription({
            id: SUBSCRIPTION_ID,
            status: statuses.main || "trialing",
          }),
        );
      });
  };

  beforeEach(
    async () => {
      jest.clearAllMocks();
      billingService = await mockIsBillingEnabled(true);

      mockRetrieve({});
      mockStripe.subscriptions.update = getJestMockFunction().mockResolvedValue(
        {},
      );
    },
    10 * 1000, // 10 second timeout because setting up the DB is slow
  );

  describe("when billing is not enabled", () => {
    it("should throw BILLING_NOT_ENABLED", async () => {
      billingService = await mockIsBillingEnabled(false);

      await expect(
        billingService.extendTrial({
          subscriptionId: SUBSCRIPTION_ID,
          meteredSubscriptionId: METERED_SUBSCRIPTION_ID,
          trialEndsAt: newTrialEndDate,
        }),
      ).rejects.toThrow(Errors.BillingService.BILLING_NOT_ENABLED);
    });

    it("should check billing is enabled before validating the date", async () => {
      billingService = await mockIsBillingEnabled(false);

      /*
       * A past date would otherwise be rejected with a different error. The
       * billing guard has to win, so self-hosted installs get one consistent
       * message no matter what they submit.
       */
      await expect(
        billingService.extendTrial({
          subscriptionId: SUBSCRIPTION_ID,
          trialEndsAt: pastDate(10),
        }),
      ).rejects.toThrow(Errors.BillingService.BILLING_NOT_ENABLED);
    });

    it("should not call the payment provider at all", async () => {
      billingService = await mockIsBillingEnabled(false);

      await expect(
        billingService.extendTrial({
          subscriptionId: SUBSCRIPTION_ID,
          trialEndsAt: newTrialEndDate,
        }),
      ).rejects.toThrow(Errors.BillingService.BILLING_NOT_ENABLED);

      expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
      expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    });
  });

  describe("date validation", () => {
    it("should throw TRIAL_END_DATE_IN_PAST when the date is in the past", async () => {
      await expect(
        billingService.extendTrial({
          subscriptionId: SUBSCRIPTION_ID,
          meteredSubscriptionId: METERED_SUBSCRIPTION_ID,
          trialEndsAt: pastDate(1),
        }),
      ).rejects.toThrow(Errors.BillingService.TRIAL_END_DATE_IN_PAST);
    });

    it("should throw TRIAL_END_DATE_IN_PAST for a date one hour ago", async () => {
      const oneHourAgo: Date = OneUptimeDate.addRemoveHours(
        OneUptimeDate.getCurrentDate(),
        -1,
      );

      await expect(
        billingService.extendTrial({
          subscriptionId: SUBSCRIPTION_ID,
          trialEndsAt: oneHourAgo,
        }),
      ).rejects.toThrow(Errors.BillingService.TRIAL_END_DATE_IN_PAST);
    });

    it("should throw TRIAL_END_DATE_TOO_FAR_IN_FUTURE beyond 730 days", async () => {
      await expect(
        billingService.extendTrial({
          subscriptionId: SUBSCRIPTION_ID,
          meteredSubscriptionId: METERED_SUBSCRIPTION_ID,
          trialEndsAt: OneUptimeDate.getSomeDaysAfter(740),
        }),
      ).rejects.toThrow(Errors.BillingService.TRIAL_END_DATE_TOO_FAR_IN_FUTURE);
    });

    it("should accept a date just inside the 730 day limit", async () => {
      await billingService.extendTrial({
        subscriptionId: SUBSCRIPTION_ID,
        meteredSubscriptionId: METERED_SUBSCRIPTION_ID,
        trialEndsAt: OneUptimeDate.getSomeDaysAfter(729),
      });

      expect(mockStripe.subscriptions.update).toHaveBeenCalledTimes(2);
    });

    it("should not touch the payment provider when the date is rejected", async () => {
      await expect(
        billingService.extendTrial({
          subscriptionId: SUBSCRIPTION_ID,
          meteredSubscriptionId: METERED_SUBSCRIPTION_ID,
          trialEndsAt: pastDate(5),
        }),
      ).rejects.toThrow(Errors.BillingService.TRIAL_END_DATE_IN_PAST);

      expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
      expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    });
  });

  describe("subscription state validation", () => {
    it("should throw SUBSCRIPTION_NOT_FOUND when the main subscription is missing", async () => {
      mockRetrieve({ mainSubscription: null });

      await expect(
        billingService.extendTrial({
          subscriptionId: SUBSCRIPTION_ID,
          meteredSubscriptionId: METERED_SUBSCRIPTION_ID,
          trialEndsAt: newTrialEndDate,
        }),
      ).rejects.toThrow(Errors.BillingService.SUBSCRIPTION_NOT_FOUND);

      expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it("should throw SUBSCRIPTION_NOT_FOUND when the metered subscription is missing", async () => {
      mockRetrieve({ meteredSubscription: null });

      await expect(
        billingService.extendTrial({
          subscriptionId: SUBSCRIPTION_ID,
          meteredSubscriptionId: METERED_SUBSCRIPTION_ID,
          trialEndsAt: newTrialEndDate,
        }),
      ).rejects.toThrow(Errors.BillingService.SUBSCRIPTION_NOT_FOUND);
    });

    it("should throw when the main subscription is canceled", async () => {
      mockRetrieve({ main: "canceled" });

      await expect(
        billingService.extendTrial({
          subscriptionId: SUBSCRIPTION_ID,
          meteredSubscriptionId: METERED_SUBSCRIPTION_ID,
          trialEndsAt: newTrialEndDate,
        }),
      ).rejects.toThrow(
        Errors.BillingService.CANNOT_EXTEND_TRIAL_ON_CANCELLED_SUBSCRIPTION,
      );
    });

    it("should throw when the main subscription is incomplete_expired", async () => {
      mockRetrieve({ main: "incomplete_expired" });

      await expect(
        billingService.extendTrial({
          subscriptionId: SUBSCRIPTION_ID,
          trialEndsAt: newTrialEndDate,
        }),
      ).rejects.toThrow(
        Errors.BillingService.CANNOT_EXTEND_TRIAL_ON_CANCELLED_SUBSCRIPTION,
      );
    });

    it("should throw when the metered subscription is canceled", async () => {
      mockRetrieve({ main: "trialing", metered: "canceled" });

      await expect(
        billingService.extendTrial({
          subscriptionId: SUBSCRIPTION_ID,
          meteredSubscriptionId: METERED_SUBSCRIPTION_ID,
          trialEndsAt: newTrialEndDate,
        }),
      ).rejects.toThrow(
        Errors.BillingService.CANNOT_EXTEND_TRIAL_ON_CANCELLED_SUBSCRIPTION,
      );
    });

    it("should not move the main subscription when the metered one is canceled", async () => {
      /*
       * The whole reason validation runs as its own pass: a half-applied
       * extension leaves the two subscriptions on different trial dates and
       * bills the customer for usage during a trial they think they have.
       */
      mockRetrieve({ main: "trialing", metered: "canceled" });

      await expect(
        billingService.extendTrial({
          subscriptionId: SUBSCRIPTION_ID,
          meteredSubscriptionId: METERED_SUBSCRIPTION_ID,
          trialEndsAt: newTrialEndDate,
        }),
      ).rejects.toThrow(
        Errors.BillingService.CANNOT_EXTEND_TRIAL_ON_CANCELLED_SUBSCRIPTION,
      );

      expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it("should retrieve both subscriptions before updating either of them", async () => {
      const callOrder: Array<string> = [];

      mockStripe.subscriptions.retrieve =
        getJestMockFunction().mockImplementation((id: unknown): unknown => {
          callOrder.push(`retrieve:${String(id)}`);
          return Promise.resolve(
            getStripeSubscription({
              id: String(id),
              status: "trialing",
            }),
          );
        });

      mockStripe.subscriptions.update =
        getJestMockFunction().mockImplementation((id: unknown): unknown => {
          callOrder.push(`update:${String(id)}`);
          return Promise.resolve({});
        });

      await billingService.extendTrial({
        subscriptionId: SUBSCRIPTION_ID,
        meteredSubscriptionId: METERED_SUBSCRIPTION_ID,
        trialEndsAt: newTrialEndDate,
      });

      expect(callOrder).toEqual([
        `retrieve:${SUBSCRIPTION_ID}`,
        `retrieve:${METERED_SUBSCRIPTION_ID}`,
        `update:${SUBSCRIPTION_ID}`,
        `update:${METERED_SUBSCRIPTION_ID}`,
      ]);
    });
  });

  describe("the update sent to the payment provider", () => {
    it("should update both the main and the metered subscription", async () => {
      await billingService.extendTrial({
        subscriptionId: SUBSCRIPTION_ID,
        meteredSubscriptionId: METERED_SUBSCRIPTION_ID,
        trialEndsAt: newTrialEndDate,
      });

      expect(mockStripe.subscriptions.update).toHaveBeenCalledTimes(2);
      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
        SUBSCRIPTION_ID,
        expect.anything(),
      );
      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
        METERED_SUBSCRIPTION_ID,
        expect.anything(),
      );
    });

    it("should send trial_end as the unix timestamp of the requested date", async () => {
      await billingService.extendTrial({
        subscriptionId: SUBSCRIPTION_ID,
        meteredSubscriptionId: METERED_SUBSCRIPTION_ID,
        trialEndsAt: newTrialEndDate,
      });

      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
        SUBSCRIPTION_ID,
        expect.objectContaining({
          trial_end: OneUptimeDate.toUnixTimestamp(newTrialEndDate),
        }),
      );
      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
        METERED_SUBSCRIPTION_ID,
        expect.objectContaining({
          trial_end: OneUptimeDate.toUnixTimestamp(newTrialEndDate),
        }),
      );
    });

    it("should send proration_behavior none so no charge is raised", async () => {
      /*
       * This assertion is the feature. Moving trial_end also moves the billing
       * cycle anchor; with Stripe's default proration behaviour that raises
       * proration line items and invoices the customer mid-trial.
       */
      await billingService.extendTrial({
        subscriptionId: SUBSCRIPTION_ID,
        meteredSubscriptionId: METERED_SUBSCRIPTION_ID,
        trialEndsAt: newTrialEndDate,
      });

      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
        SUBSCRIPTION_ID,
        expect.objectContaining({ proration_behavior: "none" }),
      );
      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
        METERED_SUBSCRIPTION_ID,
        expect.objectContaining({ proration_behavior: "none" }),
      );
    });

    it("should update only the main subscription when no metered id is given", async () => {
      await billingService.extendTrial({
        subscriptionId: SUBSCRIPTION_ID,
        trialEndsAt: newTrialEndDate,
      });

      expect(mockStripe.subscriptions.update).toHaveBeenCalledTimes(1);
      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
        SUBSCRIPTION_ID,
        expect.objectContaining({ proration_behavior: "none" }),
      );
    });

    it("should extend the trial of an active subscription that is no longer trialing", async () => {
      /*
       * Stripe allows introducing a trial on an active subscription - that is
       * how a customer whose trial already lapsed gets more time.
       */
      mockRetrieve({ main: "active", metered: "active" });

      await billingService.extendTrial({
        subscriptionId: SUBSCRIPTION_ID,
        meteredSubscriptionId: METERED_SUBSCRIPTION_ID,
        trialEndsAt: newTrialEndDate,
      });

      expect(mockStripe.subscriptions.update).toHaveBeenCalledTimes(2);
    });

    it("should extend the trial of a past_due subscription", async () => {
      mockRetrieve({ main: "past_due", metered: "past_due" });

      await billingService.extendTrial({
        subscriptionId: SUBSCRIPTION_ID,
        meteredSubscriptionId: METERED_SUBSCRIPTION_ID,
        trialEndsAt: newTrialEndDate,
      });

      expect(mockStripe.subscriptions.update).toHaveBeenCalledTimes(2);
    });

    it("should propagate the error when the payment provider rejects the update", async () => {
      mockStripe.subscriptions.update = getJestMockFunction().mockRejectedValue(
        new Error("Stripe API error"),
      );

      await expect(
        billingService.extendTrial({
          subscriptionId: SUBSCRIPTION_ID,
          meteredSubscriptionId: METERED_SUBSCRIPTION_ID,
          trialEndsAt: newTrialEndDate,
        }),
      ).rejects.toThrow("Stripe API error");
    });
  });
});
