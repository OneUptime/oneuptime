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

  type FirstCallOrderFunction = (mockFunction: unknown) => number;

  // Where a mock's first call sits in the global order of all mock calls.
  const firstCallOrder: FirstCallOrderFunction = (
    mockFunction: unknown,
  ): number => {
    const order: number | undefined = (
      mockFunction as { mock: { invocationCallOrder: Array<number> } }
    ).mock.invocationCallOrder[0];

    if (order === undefined) {
      throw new Error("mock was never called");
    }

    return order;
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

  /*
   * A plan change is a price swap on the subscription the project already has.
   * Cancelling it and building a replacement meant every piece of subscription
   * state - the trial above all - had to be reconstructed by hand, which is how
   * the mid-trial charge got in. Keeping the subscription keeps its trial for
   * free: the assertions below are mostly about what changePlan does NOT send.
   */
  describe("changePlan - swapping the price on the subscription the project has", () => {
    const SUBSCRIPTION_ITEM_ID: string = "si_flat_fee_123";

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

    interface SetupOptions {
      trialEndOnStripe?: number | null | undefined;
      status?: Stripe.Subscription.Status | undefined;

      /*
       * The metered subscription defaults to the same shape as the flat-fee
       * one, which is how a real project's pair looks - they are created
       * together and their trials move together.
       */
      meteredStatus?: Stripe.Subscription.Status | undefined;
      meteredTrialEndOnStripe?: number | null | undefined;

      // An empty array stands for a subscription with nothing to swap a price onto.
      subscriptionItems?: Array<{ id: string }> | undefined;
    }

    type SetupFunction = (options?: SetupOptions) => void;

    const setup: SetupFunction = (options?: SetupOptions): void => {
      mockStripe.subscriptions.retrieve =
        getJestMockFunction().mockImplementation(
          (subscriptionId: string): Promise<Stripe.Subscription> => {
            if (subscriptionId === METERED_SUBSCRIPTION_ID) {
              return Promise.resolve(
                getStripeSubscription({
                  id: METERED_SUBSCRIPTION_ID,
                  status:
                    options?.meteredStatus || options?.status || "trialing",
                  trialEnd:
                    options?.meteredTrialEndOnStripe ??
                    options?.trialEndOnStripe ??
                    null,
                  customer: CUSTOMER_ID,
                }),
              );
            }

            return Promise.resolve(
              getStripeSubscription({
                id: SUBSCRIPTION_ID,
                status: options?.status || "trialing",
                trialEnd: options?.trialEndOnStripe ?? null,
                customer: CUSTOMER_ID,
                itemId: SUBSCRIPTION_ITEM_ID,
                items: options?.subscriptionItems,
              }),
            );
          },
        );

      mockStripe.subscriptions.update = getJestMockFunction().mockResolvedValue(
        {},
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

    type UpdateCallParamsFunction = (
      subscriptionId: string,
    ) => Stripe.SubscriptionUpdateParams | undefined;

    // What was sent to update a given subscription, or undefined if it was left alone.
    const updateCallParams: UpdateCallParamsFunction = (
      subscriptionId: string,
    ): Stripe.SubscriptionUpdateParams | undefined => {
      const call: Array<unknown> | undefined = (
        mockStripe.subscriptions.update as unknown as {
          mock: { calls: Array<Array<unknown>> };
        }
      ).mock.calls.find((call: Array<unknown>) => {
        return call[0] === subscriptionId;
      });

      return call?.[1] as Stripe.SubscriptionUpdateParams | undefined;
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

    describe("changing the plan", () => {
      it("should put the new plan's price on the subscription the project already has", async () => {
        setup({ status: "active" });

        const result: {
          subscriptionId: string;
          meteredSubscriptionId: string;
          trialEndsAt?: Date | undefined;
        } = await changePlan();

        expect(updateCallParams(SUBSCRIPTION_ID)?.items).toEqual([
          {
            id: SUBSCRIPTION_ITEM_ID,
            price: "price_monthly_scale",
            quantity: 3,
          },
        ]);

        // The same subscription, so the project's ids do not move.
        expect(result.subscriptionId).toBe(SUBSCRIPTION_ID);
        expect(result.meteredSubscriptionId).toBe(METERED_SUBSCRIPTION_ID);
      });

      it("should send the id of the item it is replacing", async () => {
        /*
         * Without the existing item's id Stripe ADDS the new price alongside
         * the old one instead of swapping it, and the customer is billed for
         * both plans at once.
         */
        setup({ status: "active" });

        await changePlan();

        const items: Stripe.SubscriptionUpdateParams["items"] =
          updateCallParams(SUBSCRIPTION_ID)?.items;

        expect(items).toHaveLength(1);
        expect(items?.[0]?.id).toBe(SUBSCRIPTION_ITEM_ID);
      });

      it("should downgrade the same way it upgrades", async () => {
        const basicPlan: SubscriptionPlan = getSubscriptionPlanWithTrialPeriod(
          0,
          {
            name: "Free",
            monthlyPlanId: "price_monthly_basic",
            yearlyPlanId: "price_yearly_basic",
          },
        );
        setup({ status: "active" });

        await changePlan({ newPlan: basicPlan });

        expect(updateCallParams(SUBSCRIPTION_ID)?.items).toEqual([
          {
            id: SUBSCRIPTION_ITEM_ID,
            price: "price_monthly_basic",
            quantity: 3,
          },
        ]);
      });

      it("should not cancel or recreate anything", async () => {
        /*
         * Cancel-then-create is not atomic - a failure between the two leaves
         * the project with no subscription at all - and it throws away the
         * billing cycle anchor, discounts and reported usage on the way.
         */
        setup({ status: "active" });

        await changePlan();

        expect(mockStripe.subscriptions.del).not.toHaveBeenCalled();
        expect(mockStripe.subscriptions.create).not.toHaveBeenCalled();
      });

      it("should leave the metered subscription completely alone", async () => {
        /*
         * Its items come from the metered plans' own price ids, which have
         * nothing to do with the plan being changed. Rebuilding it would throw
         * away the usage already reported against it for the period.
         */
        const trialOnStripe: Date = stripeTrial(9);
        setup({
          trialEndOnStripe: OneUptimeDate.toUnixTimestamp(trialOnStripe),
        });

        await changePlan({ endTrialAt: trialOnStripe });

        expect(updateCallParams(METERED_SUBSCRIPTION_ID)).toBeUndefined();
      });

      it("should never raise an invoice on the spot", async () => {
        /*
         * "always_invoice" bills the change immediately. Prorations are
         * recorded and settle on the customer's next invoice instead.
         */
        setup({ status: "active" });

        await changePlan();

        expect(updateCallParams(SUBSCRIPTION_ID)?.proration_behavior).toBe(
          "create_prorations",
        );
      });
    });

    describe("keeping a running trial", () => {
      it("should not charge a project that upgrades mid-trial to a plan with no trial period", async () => {
        /*
         * The exact scenario from the bug report: trialing on Growth with nine
         * days left, owner picks Scale, which is configured with 0 trial days.
         *
         * Leaving trial_end out of the update is what keeps the subscription
         * trialing. Sending one - even the same date - re-anchors the billing
         * cycle to it, and sending "now" ends the trial and invoices the full
         * plan on the spot, which is the charge customers reported.
         */
        const trialOnStripe: Date = stripeTrial(9);
        setup({
          trialEndOnStripe: OneUptimeDate.toUnixTimestamp(trialOnStripe),
        });

        const result: {
          subscriptionId: string;
          meteredSubscriptionId: string;
          trialEndsAt?: Date | undefined;
        } = await changePlan({ endTrialAt: trialOnStripe });

        const params: Stripe.SubscriptionUpdateParams | undefined =
          updateCallParams(SUBSCRIPTION_ID);

        expect(params).toBeDefined();
        expect(params).not.toHaveProperty("trial_end");
        expect(params).not.toHaveProperty("billing_cycle_anchor");
        expect(result.trialEndsAt).toEqual(trialOnStripe);
      });

      it("should not prorate a change made during a trial", async () => {
        // There is nothing to prorate while the plan is not being billed.
        const trialOnStripe: Date = stripeTrial(9);
        setup({
          trialEndOnStripe: OneUptimeDate.toUnixTimestamp(trialOnStripe),
        });

        await changePlan({ endTrialAt: trialOnStripe });

        expect(updateCallParams(SUBSCRIPTION_ID)?.proration_behavior).toBe(
          "none",
        );
      });

      it("should report the trial the payment provider reports when the caller passes none", async () => {
        /*
         * The payment provider is the source of truth for what the customer is
         * actually trialing on. A caller that does not pass endTrialAt - or one
         * holding a project row written before an admin extended the trial -
         * must not be able to cut that trial short.
         */
        const trialOnStripe: Date = stripeTrial(6);
        setup({
          trialEndOnStripe: OneUptimeDate.toUnixTimestamp(trialOnStripe),
        });

        const result: {
          subscriptionId: string;
          meteredSubscriptionId: string;
          trialEndsAt?: Date | undefined;
        } = await changePlan({ endTrialAt: undefined });

        expect(updateCallParams(SUBSCRIPTION_ID)).not.toHaveProperty(
          "trial_end",
        );
        expect(result.trialEndsAt).toEqual(trialOnStripe);
      });

      it("should keep the trial the payment provider reports when the caller is behind it", async () => {
        const trialOnStripe: Date = stripeTrial(20);
        const staleTrialFromCaller: Date = OneUptimeDate.getSomeDaysAfter(3);
        setup({
          trialEndOnStripe: OneUptimeDate.toUnixTimestamp(trialOnStripe),
        });

        const result: {
          subscriptionId: string;
          meteredSubscriptionId: string;
          trialEndsAt?: Date | undefined;
        } = await changePlan({ endTrialAt: staleTrialFromCaller });

        expect(updateCallParams(SUBSCRIPTION_ID)).not.toHaveProperty(
          "trial_end",
        );
        expect(result.trialEndsAt).toEqual(trialOnStripe);
      });

      it("should push a trial forward when the caller is ahead of the payment provider", async () => {
        /*
         * The other direction, and the one case where trial_end is sent: an
         * extension recorded on the project but not yet pushed to the payment
         * provider is still a trial the customer was promised. The date
         * returned here is written back onto the project row, so the row and
         * the payment provider have to end up agreeing.
         */
        const trialOnStripe: Date = stripeTrial(3);
        const extendedTrial: Date = OneUptimeDate.getSomeDaysAfter(20);
        setup({
          trialEndOnStripe: OneUptimeDate.toUnixTimestamp(trialOnStripe),
        });

        const result: {
          subscriptionId: string;
          meteredSubscriptionId: string;
          trialEndsAt?: Date | undefined;
        } = await changePlan({ endTrialAt: extendedTrial });

        expect(updateCallParams(SUBSCRIPTION_ID)?.trial_end).toBe(
          OneUptimeDate.toUnixTimestamp(extendedTrial),
        );
        expect(result.trialEndsAt).toEqual(extendedTrial);
      });

      it("should push the same trial onto the metered subscription", async () => {
        /*
         * The two subscriptions bill the same customer for the same project.
         * If only one of them trials, the other starts invoicing usage while
         * the customer still believes they are on trial.
         */
        const trialOnStripe: Date = stripeTrial(3);
        const extendedTrial: Date = OneUptimeDate.getSomeDaysAfter(20);
        setup({
          trialEndOnStripe: OneUptimeDate.toUnixTimestamp(trialOnStripe),
        });

        await changePlan({ endTrialAt: extendedTrial });

        expect(updateCallParams(METERED_SUBSCRIPTION_ID)).toEqual({
          trial_end: OneUptimeDate.toUnixTimestamp(extendedTrial),
          proration_behavior: "none",
        });
      });

      it("should carry a trial that is only minutes away from ending", async () => {
        // A trial is live right up to its last second; it is not rounded away.
        const almostOver: Date = OneUptimeDate.addRemoveMinutes(
          OneUptimeDate.getCurrentDate(),
          5,
        );
        setup({
          trialEndOnStripe: OneUptimeDate.toUnixTimestamp(almostOver),
        });

        const result: {
          subscriptionId: string;
          meteredSubscriptionId: string;
          trialEndsAt?: Date | undefined;
        } = await changePlan({ endTrialAt: undefined });

        expect(updateCallParams(SUBSCRIPTION_ID)?.proration_behavior).toBe(
          "none",
        );
        expect(result.trialEndsAt).toBeDefined();
      });
    });

    describe("changing plan off a trial that is over", () => {
      it("should not revive a trial the payment provider reports as lapsed", async () => {
        setup({
          status: "active",
          trialEndOnStripe: OneUptimeDate.toUnixTimestamp(pastDate(5)),
        });

        const result: {
          subscriptionId: string;
          meteredSubscriptionId: string;
          trialEndsAt?: Date | undefined;
        } = await changePlan({ endTrialAt: undefined });

        expect(result.trialEndsAt).toBeUndefined();
        expect(updateCallParams(METERED_SUBSCRIPTION_ID)).toBeUndefined();
      });

      it("should not revive a trial the caller reports as lapsed", async () => {
        setup({ status: "active" });

        const result: {
          subscriptionId: string;
          meteredSubscriptionId: string;
          trialEndsAt?: Date | undefined;
        } = await changePlan({ endTrialAt: pastDate(5) });

        expect(result.trialEndsAt).toBeUndefined();
      });

      it("should never end a trial by sending trial_end now", async () => {
        /*
         * A lapsed trial is Stripe's to close, and it already has. Sending
         * "now" here would re-anchor the billing cycle and invoice the plan
         * immediately - the surprise charge, arriving by another route.
         */
        setup({
          status: "active",
          trialEndOnStripe: OneUptimeDate.toUnixTimestamp(pastDate(5)),
        });

        await changePlan({ endTrialAt: pastDate(1) });

        expect(updateCallParams(SUBSCRIPTION_ID)).not.toHaveProperty(
          "trial_end",
        );
      });

      it("should charge from now when there is no trial anywhere", async () => {
        setup({ status: "active" });

        const result: {
          subscriptionId: string;
          meteredSubscriptionId: string;
          trialEndsAt?: Date | undefined;
        } = await changePlan({ endTrialAt: undefined });

        expect(updateCallParams(SUBSCRIPTION_ID)?.proration_behavior).toBe(
          "create_prorations",
        );
        expect(result.trialEndsAt).toBeUndefined();
      });
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

    /*
     * A subscription an update cannot fix still has to be replaced. This is
     * how reactiveSubscription puts a project back on its plan once payment
     * recovers, and it is the only caller that lands here.
     */
    describe("subscriptions that cannot be updated", () => {
      it("should build replacements when the project's subscription is cancelled", async () => {
        setup({ status: "canceled" });

        const result: {
          subscriptionId: string;
          meteredSubscriptionId: string;
          trialEndsAt?: Date | undefined;
        } = await changePlan();

        expect(createCallParams(1).items).toEqual([
          { price: "price_monthly_scale", quantity: 3 },
        ]);
        expect(result.subscriptionId).toBe("sub_main_new");
        expect(result.meteredSubscriptionId).toBe("sub_metered_new");
        expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
      });

      it("should build replacements when only the metered subscription is dead", async () => {
        /*
         * Leaving a cancelled metered subscription in place would put the
         * project back on its plan while its usage silently stops being
         * billed, and reactivation would have to run again.
         */
        setup({ status: "active", meteredStatus: "canceled" });

        await changePlan();

        expect(mockStripe.subscriptions.create).toHaveBeenCalledTimes(2);
        expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
      });

      it("should build replacements when there is no item to swap a price onto", async () => {
        setup({ status: "active", subscriptionItems: [] });

        await changePlan();

        expect(mockStripe.subscriptions.create).toHaveBeenCalled();
        expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
      });

      it("should carry a running trial onto the replacements", async () => {
        const runningTrialEndsAt: Date = OneUptimeDate.getSomeDaysAfter(9);
        setup({ status: "canceled" });

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

      it("should create the replacements before cancelling the old subscriptions", async () => {
        /*
         * The two are not atomic. Creating first means a failure in between
         * leaves the project on the subscriptions it had; cancelling first
         * left it with none at all.
         */
        setup({ status: "canceled" });

        await changePlan();

        expect(firstCallOrder(mockStripe.subscriptions.create)).toBeLessThan(
          firstCallOrder(mockStripe.subscriptions.del),
        );
      });

      it("should still cancel both of the old subscriptions", async () => {
        setup({ status: "canceled" });

        await changePlan();

        expect(mockStripe.subscriptions.del).toHaveBeenCalledWith(
          SUBSCRIPTION_ID,
        );
        expect(mockStripe.subscriptions.del).toHaveBeenCalledWith(
          METERED_SUBSCRIPTION_ID,
        );
      });

      it("should read the trial off the old subscription before cancelling it", async () => {
        /*
         * Ordering matters: a deleted subscription cannot be asked what trial
         * it had. Retrieve has to happen first or the fallback silently reads
         * nothing.
         */
        const trialOnStripe: Date = stripeTrial(6);
        setup({
          status: "canceled",
          trialEndOnStripe: OneUptimeDate.toUnixTimestamp(trialOnStripe),
        });

        await changePlan({ endTrialAt: undefined });

        expect(firstCallOrder(mockStripe.subscriptions.retrieve)).toBeLessThan(
          firstCallOrder(mockStripe.subscriptions.del),
        );
        expect(createCallParams(1).trial_end).toBe(
          OneUptimeDate.toUnixTimestamp(trialOnStripe),
        );
      });
    });
  });
});
