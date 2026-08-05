import getJestMockFunction from "../../MockType";
import {
  BillingService,
  PaymentMethod,
} from "../../../Server/Services/BillingService";
import {
  getStripeSubscription,
  getSubscriptionPlanWithTrialPeriod,
  mockIsBillingEnabled,
} from "../TestingUtils/Services/BillingServiceHelper";
import { Stripe, mockStripe } from "../TestingUtils/__mocks__/Stripe.mock";
import { describe, expect, beforeAll, beforeEach, jest } from "@jest/globals";
import OneUptimeDate from "../../../Types/Date";
import SubscriptionPlan from "../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../Types/ObjectID";

/*
 * Changing plan while a trial is still running must never charge the customer.
 *
 * The bug this suite exists for: subscribeToPlan decided whether to send a
 * trial_end by asking the NEW plan how long its trial is. A project trialing on
 * Growth (14 trial days) that moved to Scale or Basic - both configured with 0
 * trial days - therefore got trial_end "now", and Stripe invoiced the full plan
 * immediately. The customer had days of trial left and was charged anyway.
 *
 * Everything below asserts on what is handed to Stripe, because that is the
 * only thing that decides whether an invoice is raised.
 */
describe("BillingService - plan changes during trial", () => {
  let billingService: BillingService;

  const PROJECT_ID: ObjectID = new ObjectID(
    "11111111-1111-4111-8111-111111111111",
  );
  const CUSTOMER_ID: string = "cus_trial_123";
  const SUBSCRIPTION_ID: string = "sub_main_123";
  const METERED_SUBSCRIPTION_ID: string = "sub_metered_456";

  // Plans as they are actually configured: Growth trials, Scale/Basic do not.
  const growthPlan: SubscriptionPlan = getSubscriptionPlanWithTrialPeriod(14, {
    name: "Growth",
    monthlyPlanId: "price_monthly_growth",
    yearlyPlanId: "price_yearly_growth",
  });

  const scalePlan: SubscriptionPlan = getSubscriptionPlanWithTrialPeriod(0, {
    name: "Scale",
    monthlyPlanId: "price_monthly_scale",
    yearlyPlanId: "price_yearly_scale",
  });

  type PastDateFunction = (daysAgo: number) => Date;

  // getSomeDaysAfter goes through PositiveNumber, so it cannot count backwards.
  const pastDate: PastDateFunction = (daysAgo: number): Date => {
    return OneUptimeDate.addRemoveDays(
      OneUptimeDate.getCurrentDate(),
      -daysAgo,
    );
  };

  type CreateCallParamsFunction = (
    nthCall: number,
  ) => Stripe.SubscriptionCreateParams;

  /*
   * subscribeToPlan creates the flat-fee subscription first and the metered one
   * second. Both have to carry the same trial, so tests read them by position.
   */
  const createCallParams: CreateCallParamsFunction = (
    nthCall: number,
  ): Stripe.SubscriptionCreateParams => {
    const call: Array<unknown> | undefined = (
      mockStripe.subscriptions.create as unknown as {
        mock: { calls: Array<Array<unknown>> };
      }
    ).mock.calls[nthCall - 1];

    if (!call) {
      throw new Error(
        `stripe.subscriptions.create was not called ${nthCall} time(s)`,
      );
    }

    return call[0] as Stripe.SubscriptionCreateParams;
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

    mockStripe.subscriptions.create = getJestMockFunction()
      .mockResolvedValueOnce(
        getStripeSubscription({ id: "sub_main_new", status: "trialing" }),
      )
      .mockResolvedValueOnce(
        getStripeSubscription({
          id: "sub_metered_new",
          status: "trialing",
        }),
      );
  });

  describe("subscribeToPlan - resolving the trial", () => {
    type SubscribeFunction = (data: {
      plan: SubscriptionPlan;
      trial: boolean | Date | undefined;
    }) => Promise<{
      subscriptionId: string;
      meteredSubscriptionId: string;
      trialEndsAt: Date | null;
    }>;

    const subscribe: SubscribeFunction = (data: {
      plan: SubscriptionPlan;
      trial: boolean | Date | undefined;
    }): Promise<{
      subscriptionId: string;
      meteredSubscriptionId: string;
      trialEndsAt: Date | null;
    }> => {
      return billingService.subscribeToPlan({
        projectId: PROJECT_ID,
        customerId: CUSTOMER_ID,
        serverMeteredPlans: [],
        plan: data.plan,
        quantity: 3,
        isYearly: false,
        trial: data.trial,
      });
    };

    it("should keep a running trial when moving to a plan that has no trial period of its own", async () => {
      /*
       * This assertion is the fix. A project nine days into its Growth trial
       * upgrades to Scale, which is configured with 0 trial days. The trial the
       * customer already has must survive the move - sending "now" here is what
       * charged them for the full plan on the spot.
       */
      const runningTrialEndsAt: Date = OneUptimeDate.getSomeDaysAfter(9);

      const result: {
        subscriptionId: string;
        meteredSubscriptionId: string;
        trialEndsAt: Date | null;
      } = await subscribe({ plan: scalePlan, trial: runningTrialEndsAt });

      expect(createCallParams(1).trial_end).toBe(
        OneUptimeDate.toUnixTimestamp(runningTrialEndsAt),
      );
      expect(createCallParams(1).trial_end).not.toBe("now");
      expect(result.trialEndsAt).toEqual(runningTrialEndsAt);
    });

    it("should keep a running trial when moving to a plan that does have a trial period", async () => {
      const runningTrialEndsAt: Date = OneUptimeDate.getSomeDaysAfter(9);

      await subscribe({ plan: growthPlan, trial: runningTrialEndsAt });

      expect(createCallParams(1).trial_end).toBe(
        OneUptimeDate.toUnixTimestamp(runningTrialEndsAt),
      );
    });

    it("should give the metered subscription the same trial as the flat-fee one", async () => {
      /*
       * The two subscriptions bill the same customer for the same project. If
       * only one of them trials, the other starts invoicing usage while the
       * customer still believes they are on trial.
       */
      const runningTrialEndsAt: Date = OneUptimeDate.getSomeDaysAfter(9);

      await subscribe({ plan: scalePlan, trial: runningTrialEndsAt });

      expect(createCallParams(2).trial_end).toBe(
        OneUptimeDate.toUnixTimestamp(runningTrialEndsAt),
      );
      expect(createCallParams(2).trial_end).toBe(createCallParams(1).trial_end);
    });

    it("should carry a trial that is only minutes away from ending", async () => {
      // A trial is live right up to its last second; it is not rounded away.
      const almostOver: Date = OneUptimeDate.addRemoveMinutes(
        OneUptimeDate.getCurrentDate(),
        5,
      );

      await subscribe({ plan: scalePlan, trial: almostOver });

      expect(createCallParams(1).trial_end).toBe(
        OneUptimeDate.toUnixTimestamp(almostOver),
      );
    });

    it("should not revive a trial that has already ended", async () => {
      /*
       * A lapsed trial means the customer is a paying customer. Changing plan
       * bills them from now - that is the correct charge, not the bug.
       */
      const result: {
        subscriptionId: string;
        meteredSubscriptionId: string;
        trialEndsAt: Date | null;
      } = await subscribe({ plan: growthPlan, trial: pastDate(3) });

      expect(createCallParams(1).trial_end).toBe("now");
      expect(createCallParams(2).trial_end).toBe("now");
      expect(result.trialEndsAt).toBeNull();
    });

    it("should start a fresh trial of the plan's own length when asked for one", async () => {
      const result: {
        subscriptionId: string;
        meteredSubscriptionId: string;
        trialEndsAt: Date | null;
      } = await subscribe({ plan: growthPlan, trial: true });

      expect(createCallParams(1).trial_end).not.toBe("now");
      expect(result.trialEndsAt).not.toBeNull();

      /*
       * 14 days out. The trial is measured from the moment subscribeToPlan ran,
       * so it lands a little before a date measured now - a minute of slack
       * covers the test's own runtime without letting a wrong plan's length
       * through.
       */
      const fourteenDaysOut: number = OneUptimeDate.toUnixTimestamp(
        OneUptimeDate.getSomeDaysAfter(14),
      );

      expect(createCallParams(1).trial_end).toBeLessThanOrEqual(
        fourteenDaysOut,
      );
      expect(createCallParams(1).trial_end).toBeGreaterThan(
        fourteenDaysOut - 60,
      );
    });

    it("should not start a trial on a plan configured with no trial period", async () => {
      /*
       * The counterpart to the fix: getTrialPeriod() still decides how long a
       * NEW trial runs. Asking for a trial on a 0-day plan is asking for
       * nothing, and the customer is billed immediately - as before.
       */
      const result: {
        subscriptionId: string;
        meteredSubscriptionId: string;
        trialEndsAt: Date | null;
      } = await subscribe({ plan: scalePlan, trial: true });

      expect(createCallParams(1).trial_end).toBe("now");
      expect(result.trialEndsAt).toBeNull();
    });

    it("should not start a trial when one is explicitly declined", async () => {
      const result: {
        subscriptionId: string;
        meteredSubscriptionId: string;
        trialEndsAt: Date | null;
      } = await subscribe({ plan: growthPlan, trial: false });

      expect(createCallParams(1).trial_end).toBe("now");
      expect(createCallParams(2).trial_end).toBe("now");
      expect(result.trialEndsAt).toBeNull();
    });

    it("should not start a trial when none is asked for at all", async () => {
      const result: {
        subscriptionId: string;
        meteredSubscriptionId: string;
        trialEndsAt: Date | null;
      } = await subscribe({ plan: growthPlan, trial: undefined });

      expect(createCallParams(1).trial_end).toBe("now");
      expect(result.trialEndsAt).toBeNull();
    });

    it("should report a trial end date that matches what it sent to the payment provider", async () => {
      /*
       * Callers persist the returned date onto the project row, and that row
       * drives the in-app trial banner and the next plan change. Reporting a
       * trial the payment provider was never given (or dropping one it was)
       * puts the two permanently out of step.
       */
      const cases: Array<{ plan: SubscriptionPlan; trial: boolean | Date }> = [
        { plan: scalePlan, trial: OneUptimeDate.getSomeDaysAfter(9) },
        { plan: growthPlan, trial: OneUptimeDate.getSomeDaysAfter(2) },
        { plan: growthPlan, trial: pastDate(1) },
        { plan: scalePlan, trial: true },
        { plan: growthPlan, trial: false },
      ];

      for (const testCase of cases) {
        jest.clearAllMocks();
        mockStripe.subscriptions.create = getJestMockFunction()
          .mockResolvedValueOnce(getStripeSubscription({ id: "sub_main_new" }))
          .mockResolvedValueOnce(
            getStripeSubscription({ id: "sub_metered_new" }),
          );

        const result: {
          subscriptionId: string;
          meteredSubscriptionId: string;
          trialEndsAt: Date | null;
        } = await subscribe(testCase);

        const sentTrialEnd: unknown = createCallParams(1).trial_end;

        if (result.trialEndsAt === null) {
          expect(sentTrialEnd).toBe("now");
        } else {
          expect(sentTrialEnd).toBe(
            OneUptimeDate.toUnixTimestamp(result.trialEndsAt),
          );
        }
      }
    });
  });

  describe("changePlan - carrying the trial onto the new subscriptions", () => {
    /*
     * Stripe reports trial_end as whole seconds, so a date that has been
     * through it has no milliseconds. Building the expected date the same way
     * keeps the assertions exact instead of off by a fraction of a second.
     */
    type StripeTrialFunction = (daysFromNow: number) => Date;

    const stripeTrial: StripeTrialFunction = (daysFromNow: number): Date => {
      return OneUptimeDate.fromUnixTimestamp(
        OneUptimeDate.toUnixTimestamp(
          OneUptimeDate.getSomeDaysAfter(daysFromNow),
        ),
      );
    };

    type SetupFunction = (options?: {
      trialEndOnStripe?: number | null | undefined;
      status?: Stripe.Subscription.Status | undefined;
    }) => void;

    const setup: SetupFunction = (options?: {
      trialEndOnStripe?: number | null | undefined;
      status?: Stripe.Subscription.Status | undefined;
    }): void => {
      mockStripe.subscriptions.retrieve =
        getJestMockFunction().mockResolvedValue(
          getStripeSubscription({
            id: SUBSCRIPTION_ID,
            status: options?.status || "trialing",
            trialEnd: options?.trialEndOnStripe ?? null,
            customer: CUSTOMER_ID,
          }),
        );

      mockStripe.subscriptions.del = getJestMockFunction().mockResolvedValue(
        {},
      );

      const paymentMethods: Array<PaymentMethod> = [
        {
          id: "pm_123",
          type: "card",
          last4Digits: "4242",
          isDefault: true,
        },
      ];

      billingService.getPaymentMethods =
        getJestMockFunction().mockResolvedValue(paymentMethods);
    };

    type ChangePlanFunction = (data?: {
      endTrialAt?: Date | undefined;
      newPlan?: SubscriptionPlan | undefined;
    }) => Promise<{
      subscriptionId: string;
      meteredSubscriptionId: string;
      trialEndsAt?: Date | undefined;
    }>;

    const changePlan: ChangePlanFunction = (data?: {
      endTrialAt?: Date | undefined;
      newPlan?: SubscriptionPlan | undefined;
    }): Promise<{
      subscriptionId: string;
      meteredSubscriptionId: string;
      trialEndsAt?: Date | undefined;
    }> => {
      return billingService.changePlan({
        projectId: PROJECT_ID,
        subscriptionId: SUBSCRIPTION_ID,
        meteredSubscriptionId: METERED_SUBSCRIPTION_ID,
        serverMeteredPlans: [],
        newPlan: data?.newPlan || scalePlan,
        quantity: 3,
        isYearly: false,
        endTrialAt: data?.endTrialAt,
      });
    };

    it("should not charge a project that upgrades mid-trial to a plan with no trial period", async () => {
      /*
       * The exact scenario from the bug report, end to end through changePlan:
       * trialing on Growth with nine days left, owner picks Scale. Both
       * replacement subscriptions must be created still trialing.
       */
      const runningTrialEndsAt: Date = OneUptimeDate.getSomeDaysAfter(9);
      setup();

      const result: {
        subscriptionId: string;
        meteredSubscriptionId: string;
        trialEndsAt?: Date | undefined;
      } = await changePlan({ endTrialAt: runningTrialEndsAt });

      expect(createCallParams(1).trial_end).toBe(
        OneUptimeDate.toUnixTimestamp(runningTrialEndsAt),
      );
      expect(createCallParams(2).trial_end).toBe(
        OneUptimeDate.toUnixTimestamp(runningTrialEndsAt),
      );
      expect(result.trialEndsAt).toEqual(runningTrialEndsAt);
    });

    it("should not charge a project that downgrades mid-trial", async () => {
      // A downgrade is the same operation; nothing about it ends the trial.
      const runningTrialEndsAt: Date = OneUptimeDate.getSomeDaysAfter(4);
      const basicPlan: SubscriptionPlan = getSubscriptionPlanWithTrialPeriod(
        0,
        {
          name: "Free",
          monthlyPlanId: "price_monthly_basic",
          yearlyPlanId: "price_yearly_basic",
        },
      );
      setup();

      await changePlan({
        endTrialAt: runningTrialEndsAt,
        newPlan: basicPlan,
      });

      expect(createCallParams(1).trial_end).toBe(
        OneUptimeDate.toUnixTimestamp(runningTrialEndsAt),
      );
      expect(createCallParams(1).items).toEqual([
        { price: "price_monthly_basic", quantity: 3 },
      ]);
    });

    it("should fall back to the trial the payment provider reports when the caller passes none", async () => {
      /*
       * The payment provider is the source of truth for what the customer is
       * actually trialing on. A caller that does not pass endTrialAt - or one
       * holding a project row written before an admin extended the trial -
       * must not be able to cut that trial short.
       */
      const trialOnStripe: Date = stripeTrial(6);
      setup({ trialEndOnStripe: OneUptimeDate.toUnixTimestamp(trialOnStripe) });

      const result: {
        subscriptionId: string;
        meteredSubscriptionId: string;
        trialEndsAt?: Date | undefined;
      } = await changePlan({ endTrialAt: undefined });

      expect(createCallParams(1).trial_end).toBe(
        OneUptimeDate.toUnixTimestamp(trialOnStripe),
      );
      expect(createCallParams(2).trial_end).toBe(
        OneUptimeDate.toUnixTimestamp(trialOnStripe),
      );
      expect(result.trialEndsAt).toEqual(trialOnStripe);
    });

    it("should keep the longer trial when the payment provider is ahead of the caller", async () => {
      const trialOnStripe: Date = stripeTrial(20);
      const staleTrialFromCaller: Date = OneUptimeDate.getSomeDaysAfter(3);
      setup({ trialEndOnStripe: OneUptimeDate.toUnixTimestamp(trialOnStripe) });

      await changePlan({ endTrialAt: staleTrialFromCaller });

      expect(createCallParams(1).trial_end).toBe(
        OneUptimeDate.toUnixTimestamp(trialOnStripe),
      );
    });

    it("should keep the longer trial when the caller is ahead of the payment provider", async () => {
      /*
       * The other direction: an extension recorded on the project but not yet
       * pushed to the payment provider is still a trial the customer was
       * promised, so it wins.
       */
      const trialOnStripe: Date = stripeTrial(3);
      const extendedTrial: Date = OneUptimeDate.getSomeDaysAfter(20);
      setup({ trialEndOnStripe: OneUptimeDate.toUnixTimestamp(trialOnStripe) });

      await changePlan({ endTrialAt: extendedTrial });

      expect(createCallParams(1).trial_end).toBe(
        OneUptimeDate.toUnixTimestamp(extendedTrial),
      );
    });

    it("should read the trial off the old subscription before cancelling it", async () => {
      /*
       * Ordering matters: the old subscription is deleted, and a deleted
       * subscription cannot be asked what trial it had. Retrieve has to happen
       * first or the fallback above silently reads nothing.
       */
      const trialOnStripe: Date = stripeTrial(6);
      setup({ trialEndOnStripe: OneUptimeDate.toUnixTimestamp(trialOnStripe) });

      await changePlan({ endTrialAt: undefined });

      const retrieveOrder: number = (
        mockStripe.subscriptions.retrieve as unknown as {
          mock: { invocationCallOrder: Array<number> };
        }
      ).mock.invocationCallOrder[0]!;

      const firstDeleteOrder: number = (
        mockStripe.subscriptions.del as unknown as {
          mock: { invocationCallOrder: Array<number> };
        }
      ).mock.invocationCallOrder[0]!;

      expect(retrieveOrder).toBeLessThan(firstDeleteOrder);
    });

    it("should charge from now when the trial reported by the payment provider has lapsed", async () => {
      setup({ trialEndOnStripe: OneUptimeDate.toUnixTimestamp(pastDate(5)) });

      const result: {
        subscriptionId: string;
        meteredSubscriptionId: string;
        trialEndsAt?: Date | undefined;
      } = await changePlan({ endTrialAt: undefined });

      expect(createCallParams(1).trial_end).toBe("now");
      expect(createCallParams(2).trial_end).toBe("now");
      expect(result.trialEndsAt).toBeUndefined();
    });

    it("should charge from now when the caller's trial has lapsed and the payment provider reports none", async () => {
      setup();

      const result: {
        subscriptionId: string;
        meteredSubscriptionId: string;
        trialEndsAt?: Date | undefined;
      } = await changePlan({ endTrialAt: pastDate(5) });

      expect(createCallParams(1).trial_end).toBe("now");
      expect(result.trialEndsAt).toBeUndefined();
    });

    it("should charge from now when there is no trial anywhere", async () => {
      setup({ status: "active" });

      const result: {
        subscriptionId: string;
        meteredSubscriptionId: string;
        trialEndsAt?: Date | undefined;
      } = await changePlan({ endTrialAt: undefined });

      expect(createCallParams(1).trial_end).toBe("now");
      expect(result.trialEndsAt).toBeUndefined();
    });

    it("should not mutate the caller's arguments while resolving the trial", async () => {
      /*
       * changePlan used to overwrite data.endTrialAt in place. Callers reuse
       * these objects (and read endTrialAt back to decide what to persist), so
       * the resolution has to stay local.
       */
      const trialOnStripe: Date = stripeTrial(20);
      setup({ trialEndOnStripe: OneUptimeDate.toUnixTimestamp(trialOnStripe) });

      const data: {
        projectId: ObjectID;
        subscriptionId: string;
        meteredSubscriptionId: string;
        serverMeteredPlans: [];
        newPlan: SubscriptionPlan;
        quantity: number;
        isYearly: boolean;
        endTrialAt: Date;
      } = {
        projectId: PROJECT_ID,
        subscriptionId: SUBSCRIPTION_ID,
        meteredSubscriptionId: METERED_SUBSCRIPTION_ID,
        serverMeteredPlans: [],
        newPlan: scalePlan,
        quantity: 3,
        isYearly: false,
        endTrialAt: pastDate(2),
      };

      const originalEndTrialAt: Date = data.endTrialAt;

      await billingService.changePlan(data);

      expect(data.endTrialAt).toBe(originalEndTrialAt);
    });

    it("should still cancel both of the old subscriptions", async () => {
      // The trial resolution moved above the cancels; they must still happen.
      setup({
        trialEndOnStripe: OneUptimeDate.toUnixTimestamp(
          OneUptimeDate.getSomeDaysAfter(6),
        ),
      });

      await changePlan({ endTrialAt: undefined });

      expect(mockStripe.subscriptions.del).toHaveBeenCalledWith(
        SUBSCRIPTION_ID,
      );
      expect(mockStripe.subscriptions.del).toHaveBeenCalledWith(
        METERED_SUBSCRIPTION_ID,
      );
    });

    it("should put the new plan's price on the replacement subscription", async () => {
      // The trial is preserved, but the plan really does change.
      const runningTrialEndsAt: Date = OneUptimeDate.getSomeDaysAfter(9);
      setup();

      await changePlan({ endTrialAt: runningTrialEndsAt });

      expect(createCallParams(1).items).toEqual([
        { price: "price_monthly_scale", quantity: 3 },
      ]);
    });
  });
});
