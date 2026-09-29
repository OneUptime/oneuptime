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
import {
  describe,
  expect,
  beforeAll,
  beforeEach,
  it,
  jest,
} from "@jest/globals";
import SubscriptionPlan from "../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../Types/ObjectID";

/*
 * Changing plan must never leave the customer paying for a subscription that
 * OneUptime has stopped pointing at.
 *
 * changePlan can give a project a brand new subscription, and the caller then
 * writes the new id over the old one on the project row. The old subscription
 * is cancelled just before that, leniently - cancelSubscription logs whatever
 * the payment provider throws and returns as though the cancel had worked. A
 * cancel lost to a rate limit, a dropped connection or a transient 5xx
 * therefore left a subscription that no longer appeared anywhere in OneUptime.
 *
 * Two things keep that from being a double charge, and both are asserted here:
 *
 *   1. Nothing that still bills is replaced. The flat-fee and the metered
 *      subscription are decided separately, so a project billing happily on
 *      one of them does not have it cancelled because the other died.
 *   2. A subscription cannot be mistaken for dead. Only the payment provider
 *      saying it does not have the subscription counts; a transient error
 *      fails the plan change instead of routing it onto the replace path.
 *
 * What is left - cancelling a subscription that was already not billing - is
 * retried, and whatever is still there afterwards is reported to the caller so
 * it can be raised rather than logged and forgotten.
 */
describe("BillingService.changePlan - replacing and cancelling subscriptions", () => {
  let billingService: BillingService;

  const PROJECT_ID: ObjectID = new ObjectID(
    "11111111-1111-4111-8111-111111111111",
  );
  const CUSTOMER_ID: string = "cus_cancel_123";
  const SUBSCRIPTION_ID: string = "sub_main_123";
  const METERED_SUBSCRIPTION_ID: string = "sub_metered_456";
  const SUBSCRIPTION_ITEM_ID: string = "si_flat_fee_123";

  const scalePlan: SubscriptionPlan = getSubscriptionPlanWithTrialPeriod(0, {
    name: "Scale",
    monthlyPlanId: "price_monthly_scale",
    yearlyPlanId: "price_yearly_scale",
  });

  /*
   * Payment provider errors as the caller actually sees them: plain objects
   * carrying the fields the stripe library sets. They are not built with
   * `new Stripe.errors.X` because the stripe module is mocked wholesale here,
   * which is the same reason the service matches them by shape.
   */
  type ProviderErrorFunction = (fields: {
    type: string;
    rawType: string;
    code?: string | undefined;
  }) => Error;

  const providerError: ProviderErrorFunction = (fields: {
    type: string;
    rawType: string;
    code?: string | undefined;
  }): Error => {
    return Object.assign(new Error(fields.type), fields);
  };

  type ErrorFunction = () => Error;

  const resourceMissingError: ErrorFunction = (): Error => {
    return providerError({
      type: "StripeInvalidRequestError",
      rawType: "invalid_request_error",
      code: "resource_missing",
    });
  };

  const rateLimitError: ErrorFunction = (): Error => {
    return providerError({
      type: "StripeRateLimitError",
      rawType: "rate_limit_error",
    });
  };

  const connectionError: ErrorFunction = (): Error => {
    return providerError({
      type: "StripeConnectionError",
      rawType: "api_connection_error",
    });
  };

  interface SetupOptions {
    status?: Stripe.Subscription.Status | undefined;
    meteredStatus?: Stripe.Subscription.Status | undefined;

    // Thrown instead of returning the metered subscription, when given.
    meteredRetrieveError?: Error | undefined;
  }

  type SetupFunction = (options?: SetupOptions) => void;

  const setup: SetupFunction = (options?: SetupOptions): void => {
    mockStripe.subscriptions.retrieve =
      getJestMockFunction().mockImplementation(
        (subscriptionId: string): Promise<Stripe.Subscription> => {
          if (subscriptionId === METERED_SUBSCRIPTION_ID) {
            if (options?.meteredRetrieveError) {
              return Promise.reject(options.meteredRetrieveError);
            }

            return Promise.resolve(
              getStripeSubscription({
                id: METERED_SUBSCRIPTION_ID,
                status: options?.meteredStatus || options?.status || "active",
                customer: CUSTOMER_ID,
              }),
            );
          }

          return Promise.resolve(
            getStripeSubscription({
              id: SUBSCRIPTION_ID,
              status: options?.status || "active",
              customer: CUSTOMER_ID,
              itemId: SUBSCRIPTION_ITEM_ID,
            }),
          );
        },
      );

    mockStripe.subscriptions.update = getJestMockFunction().mockResolvedValue(
      {},
    );

    mockStripe.subscriptions.del = getJestMockFunction().mockResolvedValue({});

    mockStripe.subscriptions.create = getJestMockFunction()
      .mockResolvedValueOnce(getStripeSubscription({ id: "sub_main_new" }))
      .mockResolvedValueOnce(getStripeSubscription({ id: "sub_metered_new" }));

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

  type ChangePlanFunction = () => Promise<{
    subscriptionId: string;
    meteredSubscriptionId: string;
    trialEndsAt?: Date | undefined;
    subscriptionIdsPendingCancellation: Array<string>;
  }>;

  const changePlan: ChangePlanFunction = (): Promise<{
    subscriptionId: string;
    meteredSubscriptionId: string;
    trialEndsAt?: Date | undefined;
    subscriptionIdsPendingCancellation: Array<string>;
  }> => {
    return billingService.changePlan({
      projectId: PROJECT_ID,
      subscriptionId: SUBSCRIPTION_ID,
      meteredSubscriptionId: METERED_SUBSCRIPTION_ID,
      serverMeteredPlans: [],
      newPlan: scalePlan,
      quantity: 3,
      isYearly: false,
      endTrialAt: undefined,
    });
  };

  type CancelledIdsFunction = () => Array<string>;

  const cancelledIds: CancelledIdsFunction = (): Array<string> => {
    return (
      mockStripe.subscriptions.del as unknown as {
        mock: { calls: Array<Array<unknown>> };
      }
    ).mock.calls.map((call: Array<unknown>) => {
      return call[0] as string;
    });
  };

  type CreateCallParamsFunction = (
    nthCall: number,
  ) => Stripe.SubscriptionCreateParams | undefined;

  const createCallParams: CreateCallParamsFunction = (
    nthCall: number,
  ): Stripe.SubscriptionCreateParams | undefined => {
    const call: Array<unknown> | undefined = (
      mockStripe.subscriptions.create as unknown as {
        mock: { calls: Array<Array<unknown>> };
      }
    ).mock.calls[nthCall - 1];

    return call?.[0] as Stripe.SubscriptionCreateParams | undefined;
  };

  beforeAll(async () => {
    billingService = await mockIsBillingEnabled(true);
  }, 30 * 1000);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  /*
   * The scenario the fix exists for. The flat-fee subscription is active and
   * billing; only the metered one has died. Replacing the pair cancelled the
   * live one to make way for a duplicate of itself, and the customer paid for
   * both from the moment the cancel was lost.
   */
  describe("a subscription that still bills is never replaced", () => {
    /*
     * "unpaid" is the status used throughout for a dead subscription that
     * still has to be cancelled: it bills nothing and an update cannot revive
     * it, but it is still open at the payment provider. A "canceled" one is
     * already over and is never sent back to be cancelled again - that case
     * has its own tests below.
     */
    it("should keep an active flat-fee subscription when the metered one is dead", async () => {
      setup({ status: "active", meteredStatus: "unpaid" });

      const result: {
        subscriptionId: string;
        meteredSubscriptionId: string;
      } = await changePlan();

      expect(cancelledIds()).toEqual([METERED_SUBSCRIPTION_ID]);
      expect(cancelledIds()).not.toContain(SUBSCRIPTION_ID);
      expect(result.subscriptionId).toBe(SUBSCRIPTION_ID);
    });

    it("should keep an active metered subscription when the flat-fee one is dead", async () => {
      /*
       * The same bug the other way round, and worse in one respect: the
       * metered subscription carries the usage already reported for the
       * period, which a replacement starts over from zero.
       */
      setup({ status: "unpaid", meteredStatus: "active" });

      const result: {
        subscriptionId: string;
        meteredSubscriptionId: string;
      } = await changePlan();

      expect(cancelledIds()).toEqual([SUBSCRIPTION_ID]);
      expect(cancelledIds()).not.toContain(METERED_SUBSCRIPTION_ID);
      expect(result.meteredSubscriptionId).toBe(METERED_SUBSCRIPTION_ID);
      expect(result.subscriptionId).toBe("sub_main_new");
    });

    it("should cancel nothing at all when both subscriptions still bill", async () => {
      setup({ status: "active" });

      await changePlan();

      expect(mockStripe.subscriptions.del).not.toHaveBeenCalled();
      expect(mockStripe.subscriptions.create).not.toHaveBeenCalled();
    });

    it("should replace both when neither subscription bills", async () => {
      setup({ status: "unpaid" });

      await changePlan();

      expect(cancelledIds()).toEqual([
        SUBSCRIPTION_ID,
        METERED_SUBSCRIPTION_ID,
      ]);
    });

    /*
     * Stripe is still collecting on a past_due subscription and the customer
     * still owes on it, so it is not dead - and a price swap applies to it
     * perfectly well. The rest of the product already counts past_due as
     * active; routing agrees with it.
     */
    it("should swap the price onto a past_due subscription rather than replace it", async () => {
      setup({ status: "past_due" });

      const result: {
        subscriptionId: string;
        meteredSubscriptionId: string;
      } = await changePlan();

      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
        SUBSCRIPTION_ID,
        expect.objectContaining({
          items: [
            {
              id: SUBSCRIPTION_ITEM_ID,
              price: "price_monthly_scale",
              quantity: 3,
            },
          ],
        }),
      );
      expect(mockStripe.subscriptions.del).not.toHaveBeenCalled();
      expect(result.subscriptionId).toBe(SUBSCRIPTION_ID);
    });

    it("should not abandon a past_due metered subscription", async () => {
      setup({ status: "active", meteredStatus: "past_due" });

      const result: {
        meteredSubscriptionId: string;
      } = await changePlan();

      expect(mockStripe.subscriptions.del).not.toHaveBeenCalled();
      expect(result.meteredSubscriptionId).toBe(METERED_SUBSCRIPTION_ID);
    });

    /*
     * Every status an update cannot revive is replaced. Whether the old
     * subscription is then cancelled is a separate question, answered by
     * whether it is still open - see "subscriptions that are already over".
     */
    it.each([
      ["unpaid"],
      ["incomplete"],
      ["incomplete_expired"],
      ["paused"],
      ["canceled"],
    ] as Array<[Stripe.Subscription.Status]>)(
      "should replace a %s subscription, which an update cannot revive",
      async (status: Stripe.Subscription.Status) => {
        setup({ status: status });

        const result: {
          subscriptionId: string;
        } = await changePlan();

        expect(mockStripe.subscriptions.create).toHaveBeenCalled();
        expect(result.subscriptionId).toBe("sub_main_new");
        expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
      },
    );
  });

  /*
   * Reading the metered subscription is how changePlan decides whether to
   * replace it. Treating every failure of that read as "it is not there" meant
   * a rate limit was enough to cancel and recreate the subscriptions of a
   * project that had nothing wrong with it.
   */
  describe("telling a missing subscription from an unreadable one", () => {
    it.each([
      ["a rate limit", rateLimitError],
      ["a connection error", connectionError],
    ])(
      "should fail the plan change on %s rather than replace anything",
      async (_name: string, buildError: ErrorFunction) => {
        setup({ status: "active", meteredRetrieveError: buildError() });

        await expect(changePlan()).rejects.toThrow();

        expect(mockStripe.subscriptions.create).not.toHaveBeenCalled();
        expect(mockStripe.subscriptions.del).not.toHaveBeenCalled();
        expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
      },
    );

    it("should replace the metered subscription when the provider really does not have it", async () => {
      setup({ status: "active", meteredRetrieveError: resourceMissingError() });

      const result: {
        subscriptionId: string;
        meteredSubscriptionId: string;
      } = await changePlan();

      expect(mockStripe.subscriptions.create).toHaveBeenCalledTimes(1);
      expect(result.subscriptionId).toBe(SUBSCRIPTION_ID);
      expect(result.meteredSubscriptionId).toBe("sub_main_new");

      // Nothing to cancel: the provider does not have it in the first place.
      expect(mockStripe.subscriptions.del).not.toHaveBeenCalled();
    });
  });

  describe("cancelling what has been replaced", () => {
    it("should create the replacements before cancelling anything", async () => {
      /*
       * The two are not atomic. Creating first means a failure in between
       * leaves the project on the subscriptions it had; cancelling first left
       * it with none at all.
       */
      setup({ status: "unpaid" });

      await changePlan();

      const firstCreate: number = (
        mockStripe.subscriptions.create as unknown as {
          mock: { invocationCallOrder: Array<number> };
        }
      ).mock.invocationCallOrder[0]!;

      const firstDelete: number = (
        mockStripe.subscriptions.del as unknown as {
          mock: { invocationCallOrder: Array<number> };
        }
      ).mock.invocationCallOrder[0]!;

      expect(firstCreate).toBeLessThan(firstDelete);
    });

    it(
      "should retry a cancel that fails and report nothing when it lands",
      async () => {
        setup({ status: "unpaid", meteredStatus: "active" });

        mockStripe.subscriptions.del = getJestMockFunction()
          .mockRejectedValueOnce(rateLimitError())
          .mockResolvedValueOnce({});

        const result: {
          subscriptionIdsPendingCancellation: Array<string>;
        } = await changePlan();

        expect(mockStripe.subscriptions.del).toHaveBeenCalledTimes(2);
        expect(result.subscriptionIdsPendingCancellation).toEqual([]);
      },
      30 * 1000,
    );

    it(
      "should report a cancel that fails every time",
      async () => {
        setup({ status: "unpaid", meteredStatus: "active" });

        mockStripe.subscriptions.del =
          getJestMockFunction().mockRejectedValue(rateLimitError());

        const result: {
          subscriptionId: string;
          subscriptionIdsPendingCancellation: Array<string>;
        } = await changePlan();

        expect(result.subscriptionIdsPendingCancellation).toEqual([
          SUBSCRIPTION_ID,
        ]);

        /*
         * And the replacement is still reported. Throwing here would leave the
         * caller never recording the new subscription, which makes the LIVE
         * replacement the abandoned one - strictly worse than the dead
         * subscription this is complaining about.
         */
        expect(result.subscriptionId).toBe("sub_main_new");
      },
      30 * 1000,
    );

    it("should treat a subscription the provider no longer has as cancelled", async () => {
      setup({ status: "unpaid", meteredStatus: "active" });

      mockStripe.subscriptions.del = getJestMockFunction().mockRejectedValue(
        resourceMissingError(),
      );

      const result: {
        subscriptionIdsPendingCancellation: Array<string>;
      } = await changePlan();

      // Gone is the state being asked for, so it is not retried or reported.
      expect(mockStripe.subscriptions.del).toHaveBeenCalledTimes(1);
      expect(result.subscriptionIdsPendingCancellation).toEqual([]);
    });

    it(
      "should report both subscriptions when neither cancel lands",
      async () => {
        setup({ status: "unpaid" });

        mockStripe.subscriptions.del =
          getJestMockFunction().mockRejectedValue(connectionError());

        const result: {
          subscriptionIdsPendingCancellation: Array<string>;
        } = await changePlan();

        expect(result.subscriptionIdsPendingCancellation).toEqual([
          SUBSCRIPTION_ID,
          METERED_SUBSCRIPTION_ID,
        ]);
      },
      30 * 1000,
    );

    it("should report nothing when there was nothing to replace", async () => {
      setup({ status: "active" });

      const result: {
        subscriptionIdsPendingCancellation: Array<string>;
      } = await changePlan();

      expect(result.subscriptionIdsPendingCancellation).toEqual([]);
    });
  });

  /*
   * A subscription that has already finished is replaced but not cancelled.
   * Asking the payment provider to cancel one again is rejected, and to the
   * retry loop that rejection is indistinguishable from a cancel that did not
   * land: it would burn seconds retrying and then raise an alert asking an
   * operator to cancel by hand something that is already cancelled. This is
   * the common case - it is how reactivation reaches this path at all.
   */
  describe("subscriptions that are already over", () => {
    it.each([["canceled"], ["incomplete_expired"]] as Array<
      [Stripe.Subscription.Status]
    >)(
      "should replace a %s subscription without asking for it to be cancelled",
      async (status: Stripe.Subscription.Status) => {
        setup({ status: status, meteredStatus: "active" });

        const result: {
          subscriptionId: string;
          subscriptionIdsPendingCancellation: Array<string>;
        } = await changePlan();

        // Replaced...
        expect(result.subscriptionId).toBe("sub_main_new");

        // ...but never sent to be cancelled, and so never reported.
        expect(mockStripe.subscriptions.del).not.toHaveBeenCalled();
        expect(result.subscriptionIdsPendingCancellation).toEqual([]);
      },
    );

    it("should not raise a false alert when the provider refuses to cancel an already cancelled subscription", async () => {
      setup({ status: "canceled" });

      /*
       * What a provider does with a cancel for a subscription that is already
       * cancelled. It is not resource_missing - the subscription is still
       * there, it is just finished - so nothing downstream can tell it apart
       * from a cancel that failed.
       */
      mockStripe.subscriptions.del = getJestMockFunction().mockRejectedValue(
        providerError({
          type: "StripeInvalidRequestError",
          rawType: "invalid_request_error",
        }),
      );

      const result: {
        subscriptionIdsPendingCancellation: Array<string>;
      } = await changePlan();

      expect(mockStripe.subscriptions.del).not.toHaveBeenCalled();
      expect(result.subscriptionIdsPendingCancellation).toEqual([]);
    });

    it("should not treat a subscription the provider does not have as one to cancel", async () => {
      setup({ status: "active", meteredRetrieveError: resourceMissingError() });

      const result: {
        subscriptionIdsPendingCancellation: Array<string>;
      } = await changePlan();

      expect(mockStripe.subscriptions.create).toHaveBeenCalledTimes(1);
      expect(mockStripe.subscriptions.del).not.toHaveBeenCalled();
      expect(result.subscriptionIdsPendingCancellation).toEqual([]);
    });

    it("should still cancel a subscription that bills nothing but is not over", async () => {
      // The counterpart: unpaid, incomplete and paused are all still open.
      setup({ status: "unpaid", meteredStatus: "incomplete" });

      await changePlan();

      expect(cancelledIds()).toEqual([
        SUBSCRIPTION_ID,
        METERED_SUBSCRIPTION_ID,
      ]);
    });
  });

  /*
   * The last line of defence. Whatever happens to the cancel, the replacement
   * carries the id it replaced and the project it belongs to, recorded at the
   * payment provider before anything was cancelled or overwritten.
   */
  describe("the breadcrumb left on a replacement", () => {
    it("should record the project and the subscription each replacement replaces", async () => {
      setup({ status: "unpaid" });

      await changePlan();

      expect(createCallParams(1)?.metadata).toEqual({
        projectId: PROJECT_ID.toString(),
        replacedSubscriptionId: SUBSCRIPTION_ID,
      });

      expect(createCallParams(2)?.metadata).toEqual({
        projectId: PROJECT_ID.toString(),
        replacedSubscriptionId: METERED_SUBSCRIPTION_ID,
      });
    });

    it(
      "should record it before the subscription it replaces is cancelled",
      async () => {
        setup({ status: "unpaid", meteredStatus: "active" });

        mockStripe.subscriptions.del =
          getJestMockFunction().mockRejectedValue(rateLimitError());

        await changePlan();

        // A cancel that never lands still leaves the trail behind.
        expect(createCallParams(1)?.metadata).toEqual({
          projectId: PROJECT_ID.toString(),
          replacedSubscriptionId: SUBSCRIPTION_ID,
        });
      },
      30 * 1000,
    );
  });
});
