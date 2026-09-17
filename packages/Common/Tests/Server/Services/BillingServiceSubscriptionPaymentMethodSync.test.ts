import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  BillingService,
  PaymentMethod,
} from "../../../Server/Services/BillingService";
import Errors from "../../../Server/Utils/Errors";
import logger from "../../../Server/Utils/Logger";
import SubscriptionPlan from "../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../Types/Exception/BadDataException";
import ServiceUnavailableException from "../../../Types/Exception/ServiceUnavailableException";
import ObjectID from "../../../Types/ObjectID";
import Sleep from "../../../Types/Sleep";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import Stripe from "stripe";

jest.mock("stripe", () => {
  return jest.fn(() => {
    return {};
  });
});
jest.mock("../../../Server/Services/ProjectService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../Server/Services/MailService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../Server/Services/PayAsYouGoBillingService", () => {
  return { __esModule: true, default: {} };
});

/*
 * Autopay has to charge the card the customer has as their default today.
 *
 * Production incident this guards against (a customer project): a plan
 * reactivation recreated the project's subscriptions with
 * default_payment_method pinned to the card that was default that day, an
 * India-issued Visa. Stripe charges subscription.default_payment_method ahead
 * of customer.invoice_settings.default_payment_method, so when that card
 * started declining and the customer added a new card that became their
 * default, every renewal kept going to the old card. Nothing in OneUptime ever
 * cleared the pin, adding a card never made it default, and there was no way
 * to choose a default - the project went past_due on a card the customer had
 * already replaced.
 *
 * The ids below are the ones from that incident.
 */
const CUSTOMER_ID: string = "cus_stale_card_customer";
const OTHER_CUSTOMER_ID: string = "cus_someone_else";
const OLD_CARD_ID: string = "pm_replaced_card";
const NEW_CARD_ID: string = "pm_new_default_card";
const METERED_SUBSCRIPTION_ID: string = "sub_pinned_metered";
const FLAT_FEE_SUBSCRIPTION_ID: string = "sub_flat_fee";

type FakeStripe = {
  customers: { retrieve: MockFunction; update: MockFunction };
  subscriptions: {
    list: MockFunction;
    update: MockFunction;
    retrieve: MockFunction;
    create: MockFunction;
    del: MockFunction;
  };
  paymentMethods: {
    list: MockFunction;
    retrieve: MockFunction;
    detach: MockFunction;
  };
};

type CustomerFunction = (
  defaultPaymentMethod: string | Partial<Stripe.PaymentMethod> | null,
) => Partial<Stripe.Customer>;

const customerWithDefault: CustomerFunction = (
  defaultPaymentMethod: string | Partial<Stripe.PaymentMethod> | null,
): Partial<Stripe.Customer> => {
  return {
    id: CUSTOMER_ID,
    object: "customer",
    invoice_settings: {
      custom_fields: null,
      default_payment_method: defaultPaymentMethod as
        | string
        | Stripe.PaymentMethod
        | null,
      footer: null,
      rendering_options: null,
    },
  };
};

type SubscriptionFunction = (options: {
  id: string;
  status?: Stripe.Subscription.Status | undefined;
  defaultPaymentMethod?: string | Partial<Stripe.PaymentMethod> | null;
  defaultSource?: string | null | undefined;
  itemId?: string | undefined;
}) => Stripe.Subscription;

const subscription: SubscriptionFunction = (options: {
  id: string;
  status?: Stripe.Subscription.Status | undefined;
  defaultPaymentMethod?: string | Partial<Stripe.PaymentMethod> | null;
  defaultSource?: string | null | undefined;
  itemId?: string | undefined;
}): Stripe.Subscription => {
  return {
    id: options.id,
    object: "subscription",
    customer: CUSTOMER_ID,
    status: options.status || "active",
    default_payment_method: (options.defaultPaymentMethod ?? null) as
      | string
      | Stripe.PaymentMethod
      | null,
    default_source: options.defaultSource ?? null,
    trial_end: null,
    items: {
      data: options.itemId ? [{ id: options.itemId }] : [],
    },
  } as unknown as Stripe.Subscription;
};

type CardFunction = (
  id: string,
  last4: string,
  customer?: string | Partial<Stripe.Customer> | null,
) => Partial<Stripe.PaymentMethod>;

const card: CardFunction = (
  id: string,
  last4: string,
  customer?: string | Partial<Stripe.Customer> | null,
): Partial<Stripe.PaymentMethod> => {
  return {
    id: id,
    object: "payment_method",
    type: "card",
    card: { brand: "visa", last4: last4 } as Stripe.PaymentMethod.Card,
    customer: (customer === undefined ? CUSTOMER_ID : customer) as
      | string
      | Stripe.Customer
      | null,
  };
};

type ProviderErrorFunction = (fields: {
  statusCode?: number | undefined;
  type?: string | undefined;
  rawType?: string | undefined;
  code?: string | undefined;
  message?: string | undefined;
}) => Error;

const providerError: ProviderErrorFunction = (fields: {
  statusCode?: number | undefined;
  type?: string | undefined;
  rawType?: string | undefined;
  code?: string | undefined;
  message?: string | undefined;
}): Error => {
  return Object.assign(new Error(fields.message || "Stripe error"), fields);
};

const resourceMissing: () => Error = (): Error => {
  return providerError({
    statusCode: 404,
    type: "StripeInvalidRequestError",
    rawType: "invalid_request_error",
    code: "resource_missing",
    message: "No such PaymentMethod",
  });
};

type UpdateCall = [string, Stripe.SubscriptionUpdateParams];

describe("BillingService - autopay follows the customer's default payment method", () => {
  let service: BillingService;
  let stripe: FakeStripe;
  let loggerError: jest.SpyInstance;

  beforeEach(() => {
    service = new BillingService();

    stripe = {
      customers: {
        retrieve: getJestMockFunction().mockResolvedValue(
          customerWithDefault(NEW_CARD_ID),
        ),
        update: getJestMockFunction().mockResolvedValue({}),
      },
      subscriptions: {
        list: getJestMockFunction().mockResolvedValue({ data: [] }),
        update: getJestMockFunction().mockResolvedValue({}),
        retrieve: getJestMockFunction(),
        create: getJestMockFunction(),
        del: getJestMockFunction().mockResolvedValue({}),
      },
      paymentMethods: {
        list: getJestMockFunction().mockResolvedValue({ data: [] }),
        retrieve: getJestMockFunction().mockResolvedValue(
          card(NEW_CARD_ID, "1111"),
        ),
        detach: getJestMockFunction().mockResolvedValue({}),
      },
    };

    (service as unknown as { stripe: unknown }).stripe = stripe;

    getJestSpyOn(service, "isBillingEnabled").mockReturnValue(true);
    getJestSpyOn(Sleep, "sleep").mockResolvedValue(undefined);
    getJestSpyOn(Math, "random").mockReturnValue(0.5);
    getJestSpyOn(logger, "info").mockImplementation(() => {
      return undefined;
    });
    getJestSpyOn(logger, "debug").mockImplementation(() => {
      return undefined;
    });
    loggerError = getJestSpyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("syncSubscriptionPaymentMethodsWithCustomerDefault", () => {
    it("unpins the pinned metered subscription from the replaced card so autopay charges the new default", async () => {
      stripe.customers.retrieve.mockResolvedValue(
        customerWithDefault(NEW_CARD_ID),
      );
      stripe.subscriptions.list.mockResolvedValue({
        data: [
          subscription({
            id: METERED_SUBSCRIPTION_ID,
            status: "past_due",
            defaultPaymentMethod: OLD_CARD_ID,
          }),
        ],
      });

      await expect(
        service.syncSubscriptionPaymentMethodsWithCustomerDefault(CUSTOMER_ID),
      ).resolves.toEqual([METERED_SUBSCRIPTION_ID]);

      expect(stripe.customers.retrieve).toHaveBeenCalledWith(CUSTOMER_ID);
      expect(stripe.subscriptions.list).toHaveBeenCalledWith({
        customer: CUSTOMER_ID,
        status: "all",
        limit: 100,
      });

      /*
       * Cleared, not overwritten with the new card: a copy on the
       * subscription is a second place that goes stale the next time the
       * customer changes cards, which is exactly what broke autopay.
       */
      expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);
      expect(stripe.subscriptions.update).toHaveBeenCalledWith(
        METERED_SUBSCRIPTION_ID,
        { default_payment_method: "" },
      );
    });

    it("leaves a subscription alone when its pin already is the customer default", async () => {
      stripe.subscriptions.list.mockResolvedValue({
        data: [
          subscription({
            id: METERED_SUBSCRIPTION_ID,
            defaultPaymentMethod: NEW_CARD_ID,
          }),
        ],
      });

      await expect(
        service.syncSubscriptionPaymentMethodsWithCustomerDefault(CUSTOMER_ID),
      ).resolves.toEqual([]);

      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it("leaves an unpinned subscription alone - it already follows the customer default", async () => {
      stripe.subscriptions.list.mockResolvedValue({
        data: [
          subscription({
            id: METERED_SUBSCRIPTION_ID,
            defaultPaymentMethod: null,
          }),
        ],
      });

      await expect(
        service.syncSubscriptionPaymentMethodsWithCustomerDefault(CUSTOMER_ID),
      ).resolves.toEqual([]);

      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it("clears a legacy default_source, which also outranks the customer default", async () => {
      stripe.subscriptions.list.mockResolvedValue({
        data: [
          subscription({
            id: METERED_SUBSCRIPTION_ID,
            defaultPaymentMethod: null,
            defaultSource: "card_legacy_source",
          }),
        ],
      });

      await expect(
        service.syncSubscriptionPaymentMethodsWithCustomerDefault(CUSTOMER_ID),
      ).resolves.toEqual([METERED_SUBSCRIPTION_ID]);

      expect(stripe.subscriptions.update).toHaveBeenCalledWith(
        METERED_SUBSCRIPTION_ID,
        { default_source: "" },
      );
    });

    it("clears a stale pin and a legacy source together in a single update", async () => {
      stripe.subscriptions.list.mockResolvedValue({
        data: [
          subscription({
            id: METERED_SUBSCRIPTION_ID,
            defaultPaymentMethod: OLD_CARD_ID,
            defaultSource: "card_legacy_source",
          }),
        ],
      });

      await service.syncSubscriptionPaymentMethodsWithCustomerDefault(
        CUSTOMER_ID,
      );

      expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);
      expect(stripe.subscriptions.update).toHaveBeenCalledWith(
        METERED_SUBSCRIPTION_ID,
        { default_payment_method: "", default_source: "" },
      );
    });

    it("clears only the legacy source when the pin already matches the default", async () => {
      stripe.subscriptions.list.mockResolvedValue({
        data: [
          subscription({
            id: METERED_SUBSCRIPTION_ID,
            defaultPaymentMethod: NEW_CARD_ID,
            defaultSource: "card_legacy_source",
          }),
        ],
      });

      await service.syncSubscriptionPaymentMethodsWithCustomerDefault(
        CUSTOMER_ID,
      );

      expect(stripe.subscriptions.update).toHaveBeenCalledWith(
        METERED_SUBSCRIPTION_ID,
        { default_source: "" },
      );
    });

    it.each([
      "canceled",
      "incomplete_expired",
    ] as Array<Stripe.Subscription.Status>)(
      "skips a %s subscription, which raises no more invoices and cannot be updated",
      async (status: Stripe.Subscription.Status) => {
        stripe.subscriptions.list.mockResolvedValue({
          data: [
            subscription({
              id: METERED_SUBSCRIPTION_ID,
              status: status,
              defaultPaymentMethod: OLD_CARD_ID,
              defaultSource: "card_legacy_source",
            }),
          ],
        });

        await expect(
          service.syncSubscriptionPaymentMethodsWithCustomerDefault(
            CUSTOMER_ID,
          ),
        ).resolves.toEqual([]);

        expect(stripe.subscriptions.update).not.toHaveBeenCalled();
      },
    );

    it.each([
      "past_due",
      "unpaid",
      "active",
      "trialing",
    ] as Array<Stripe.Subscription.Status>)(
      "unpins a %s subscription that is still pinned to a replaced card",
      async (status: Stripe.Subscription.Status) => {
        stripe.subscriptions.list.mockResolvedValue({
          data: [
            subscription({
              id: METERED_SUBSCRIPTION_ID,
              status: status,
              defaultPaymentMethod: OLD_CARD_ID,
            }),
          ],
        });

        await expect(
          service.syncSubscriptionPaymentMethodsWithCustomerDefault(
            CUSTOMER_ID,
          ),
        ).resolves.toEqual([METERED_SUBSCRIPTION_ID]);

        expect(stripe.subscriptions.update).toHaveBeenCalledWith(
          METERED_SUBSCRIPTION_ID,
          { default_payment_method: "" },
        );
      },
    );

    /*
     * Stripe refuses a default_payment_method update on an `incomplete`
     * subscription: "A subscription in this state can only have metadata and
     * default_source updated". Clearing a pin there is worth nothing (the
     * subscription's only invoice is voided within 23 hours) and asking for it
     * would fail the repair for the customer we are repairing.
     */
    describe("an incomplete subscription, which Stripe refuses to repin", () => {
      const INCOMPLETE_SUBSCRIPTION_ID: string = "sub_incomplete_first_invoice";

      type RefuseFunction = () => void;

      const refusePaymentMethodUpdateOnIncomplete: RefuseFunction =
        (): void => {
          stripe.subscriptions.update.mockImplementation(
            (id: unknown, params: unknown) => {
              const updateParams: Stripe.SubscriptionUpdateParams =
                params as Stripe.SubscriptionUpdateParams;

              if (
                id === INCOMPLETE_SUBSCRIPTION_ID &&
                updateParams.default_payment_method !== undefined
              ) {
                return Promise.reject(
                  providerError({
                    statusCode: 400,
                    type: "StripeInvalidRequestError",
                    rawType: "invalid_request_error",
                    message:
                      "This subscription can only have metadata and default_source updated.",
                  }),
                );
              }

              return Promise.resolve({});
            },
          );
        };

      beforeEach(() => {
        refusePaymentMethodUpdateOnIncomplete();
      });

      it("leaves the pin alone instead of asking for an update Stripe rejects", async () => {
        stripe.subscriptions.list.mockResolvedValue({
          data: [
            subscription({
              id: INCOMPLETE_SUBSCRIPTION_ID,
              status: "incomplete",
              defaultPaymentMethod: OLD_CARD_ID,
            }),
          ],
        });

        await expect(
          service.syncSubscriptionPaymentMethodsWithCustomerDefault(
            CUSTOMER_ID,
          ),
        ).resolves.toEqual([]);

        expect(stripe.subscriptions.update).not.toHaveBeenCalled();
      });

      it("still clears its legacy default_source, the one field Stripe does allow", async () => {
        stripe.subscriptions.list.mockResolvedValue({
          data: [
            subscription({
              id: INCOMPLETE_SUBSCRIPTION_ID,
              status: "incomplete",
              defaultPaymentMethod: OLD_CARD_ID,
              defaultSource: "card_legacy_source",
            }),
          ],
        });

        await expect(
          service.syncSubscriptionPaymentMethodsWithCustomerDefault(
            CUSTOMER_ID,
          ),
        ).resolves.toEqual([INCOMPLETE_SUBSCRIPTION_ID]);

        expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);
        expect(stripe.subscriptions.update).toHaveBeenCalledWith(
          INCOMPLETE_SUBSCRIPTION_ID,
          { default_source: "" },
        );
      });

      it("does not stop the repair of the live subscription next to it", async () => {
        /*
         * The shape that would have broken the fix for the affected customer: a leftover
         * incomplete subscription from a failed first charge sits beside the
         * metered subscription that is actually charging the replaced card.
         */
        stripe.subscriptions.list.mockResolvedValue({
          data: [
            subscription({
              id: INCOMPLETE_SUBSCRIPTION_ID,
              status: "incomplete",
              defaultPaymentMethod: OLD_CARD_ID,
            }),
            subscription({
              id: METERED_SUBSCRIPTION_ID,
              status: "past_due",
              defaultPaymentMethod: OLD_CARD_ID,
            }),
          ],
        });

        await expect(
          service.syncSubscriptionPaymentMethodsWithCustomerDefault(
            CUSTOMER_ID,
          ),
        ).resolves.toEqual([METERED_SUBSCRIPTION_ID]);

        expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);
        expect(stripe.subscriptions.update).toHaveBeenCalledWith(
          METERED_SUBSCRIPTION_ID,
          { default_payment_method: "" },
        );
      });

      it("lets makePaymentMethodDefault succeed with one beside the live subscription", async () => {
        stripe.paymentMethods.retrieve.mockResolvedValue(
          card(NEW_CARD_ID, "1111"),
        );
        stripe.subscriptions.list.mockResolvedValue({
          data: [
            subscription({
              id: INCOMPLETE_SUBSCRIPTION_ID,
              status: "incomplete",
              defaultPaymentMethod: OLD_CARD_ID,
            }),
            subscription({
              id: METERED_SUBSCRIPTION_ID,
              status: "past_due",
              defaultPaymentMethod: OLD_CARD_ID,
            }),
          ],
        });

        await expect(
          service.makePaymentMethodDefault(CUSTOMER_ID, NEW_CARD_ID),
        ).resolves.toBeUndefined();

        expect(stripe.customers.update).toHaveBeenCalledWith(CUSTOMER_ID, {
          invoice_settings: { default_payment_method: NEW_CARD_ID },
        });
        expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);
        expect(stripe.subscriptions.update).toHaveBeenCalledWith(
          METERED_SUBSCRIPTION_ID,
          { default_payment_method: "" },
        );
      });
    });

    it("changes nothing while the customer has no default - an unpinned subscription would have no card at all", async () => {
      stripe.customers.retrieve.mockResolvedValue(customerWithDefault(null));

      await expect(
        service.syncSubscriptionPaymentMethodsWithCustomerDefault(CUSTOMER_ID),
      ).resolves.toEqual([]);

      expect(stripe.subscriptions.list).not.toHaveBeenCalled();
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it("changes nothing when the customer carries no invoice settings at all", async () => {
      stripe.customers.retrieve.mockResolvedValue({ id: CUSTOMER_ID });

      await expect(
        service.syncSubscriptionPaymentMethodsWithCustomerDefault(CUSTOMER_ID),
      ).resolves.toEqual([]);

      expect(stripe.subscriptions.list).not.toHaveBeenCalled();
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it("returns nothing for a deleted customer", async () => {
      stripe.customers.retrieve.mockResolvedValue({
        id: CUSTOMER_ID,
        deleted: true,
      });

      await expect(
        service.syncSubscriptionPaymentMethodsWithCustomerDefault(CUSTOMER_ID),
      ).resolves.toEqual([]);

      expect(stripe.subscriptions.list).not.toHaveBeenCalled();
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it("reads a customer default that arrives expanded as an object", async () => {
      stripe.customers.retrieve.mockResolvedValue(
        customerWithDefault({ id: NEW_CARD_ID }),
      );
      stripe.subscriptions.list.mockResolvedValue({
        data: [
          subscription({
            id: FLAT_FEE_SUBSCRIPTION_ID,
            defaultPaymentMethod: NEW_CARD_ID,
          }),
          subscription({
            id: METERED_SUBSCRIPTION_ID,
            defaultPaymentMethod: OLD_CARD_ID,
          }),
        ],
      });

      await expect(
        service.syncSubscriptionPaymentMethodsWithCustomerDefault(CUSTOMER_ID),
      ).resolves.toEqual([METERED_SUBSCRIPTION_ID]);

      expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);
      expect(stripe.subscriptions.update).toHaveBeenCalledWith(
        METERED_SUBSCRIPTION_ID,
        { default_payment_method: "" },
      );
    });

    it("reads a subscription pin that arrives expanded as an object", async () => {
      stripe.subscriptions.list.mockResolvedValue({
        data: [
          subscription({
            id: FLAT_FEE_SUBSCRIPTION_ID,
            defaultPaymentMethod: { id: NEW_CARD_ID },
          }),
          subscription({
            id: METERED_SUBSCRIPTION_ID,
            defaultPaymentMethod: { id: OLD_CARD_ID },
          }),
        ],
      });

      await expect(
        service.syncSubscriptionPaymentMethodsWithCustomerDefault(CUSTOMER_ID),
      ).resolves.toEqual([METERED_SUBSCRIPTION_ID]);

      expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    });

    it("walks every subscription of the customer and updates only the stale ones", async () => {
      stripe.subscriptions.list.mockResolvedValue({
        data: [
          subscription({
            id: FLAT_FEE_SUBSCRIPTION_ID,
            status: "active",
            defaultPaymentMethod: OLD_CARD_ID,
          }),
          subscription({
            id: METERED_SUBSCRIPTION_ID,
            status: "past_due",
            defaultPaymentMethod: OLD_CARD_ID,
          }),
          subscription({
            id: "sub_replaced_long_ago",
            status: "canceled",
            defaultPaymentMethod: OLD_CARD_ID,
          }),
          subscription({
            id: "sub_already_following",
            status: "active",
            defaultPaymentMethod: null,
          }),
          subscription({
            id: "sub_pinned_to_default",
            status: "trialing",
            defaultPaymentMethod: NEW_CARD_ID,
          }),
        ],
      });

      await expect(
        service.syncSubscriptionPaymentMethodsWithCustomerDefault(CUSTOMER_ID),
      ).resolves.toEqual([FLAT_FEE_SUBSCRIPTION_ID, METERED_SUBSCRIPTION_ID]);

      expect(
        stripe.subscriptions.update.mock.calls.map((call: unknown) => {
          return (call as UpdateCall)[0];
        }),
      ).toEqual([FLAT_FEE_SUBSCRIPTION_ID, METERED_SUBSCRIPTION_ID]);
    });

    it("refuses when billing is disabled, before any provider request", async () => {
      getJestSpyOn(service, "isBillingEnabled").mockReturnValue(false);

      await expect(
        service.syncSubscriptionPaymentMethodsWithCustomerDefault(CUSTOMER_ID),
      ).rejects.toThrow(Errors.BillingService.BILLING_NOT_ENABLED);

      expect(stripe.customers.retrieve).not.toHaveBeenCalled();
      expect(stripe.subscriptions.list).not.toHaveBeenCalled();
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    });

    /*
     * A raw StripeError is not an OneUptime Exception, so it reaches the
     * express handler's fallback branch and is answered as an opaque
     * 500 {"error":"Server Error"}. On the route that repairs autopay that is
     * the worst possible answer: the customer cannot tell a rate limit worth
     * retrying from a card the provider refused. Provider writes are named
     * the way provider reads already are.
     */
    it("reports a rejected subscription update as bad data, carrying the provider's own words", async () => {
      const failure: Error = providerError({
        statusCode: 400,
        type: "StripeInvalidRequestError",
        message: "This subscription cannot be updated",
      });
      stripe.subscriptions.list.mockResolvedValue({
        data: [
          subscription({
            id: FLAT_FEE_SUBSCRIPTION_ID,
            defaultPaymentMethod: OLD_CARD_ID,
          }),
          subscription({
            id: METERED_SUBSCRIPTION_ID,
            defaultPaymentMethod: OLD_CARD_ID,
          }),
        ],
      });
      stripe.subscriptions.update.mockRejectedValueOnce(failure);

      const thrown: unknown = await service
        .syncSubscriptionPaymentMethodsWithCustomerDefault(CUSTOMER_ID)
        .catch((err: unknown) => {
          return err;
        });

      expect(thrown).toBeInstanceOf(BadDataException);
      expect((thrown as BadDataException).message).toBe(
        "This subscription cannot be updated",
      );
      expect(thrown).not.toBe(failure);
      expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    });

    it("never retries the subscription write, and reports a rate limit as the provider being unreachable", async () => {
      const failure: Error = providerError({ statusCode: 429 });
      stripe.subscriptions.list.mockResolvedValue({
        data: [
          subscription({
            id: METERED_SUBSCRIPTION_ID,
            defaultPaymentMethod: OLD_CARD_ID,
          }),
        ],
      });
      stripe.subscriptions.update.mockRejectedValue(failure);

      const thrown: unknown = await service
        .syncSubscriptionPaymentMethodsWithCustomerDefault(CUSTOMER_ID)
        .catch((err: unknown) => {
          return err;
        });

      // Retrying a write can apply the change twice, so it stays a single call.
      expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);
      expect(thrown).toBeInstanceOf(ServiceUnavailableException);
      expect((thrown as ServiceUnavailableException).message).toMatch(
        /payment provider/i,
      );
      // 500 answers "Server Error"; this one says what the customer can do.
      expect((thrown as ServiceUnavailableException).message).toMatch(
        /try again/i,
      );
    });

    it("leaves an error that is not the provider talking exactly as it is", async () => {
      // A bug of ours must not be dressed up as a payment failure.
      const bug: Error = new TypeError(
        "stripe.subscriptions.update is not a function",
      );
      stripe.subscriptions.list.mockResolvedValue({
        data: [
          subscription({
            id: METERED_SUBSCRIPTION_ID,
            defaultPaymentMethod: OLD_CARD_ID,
          }),
        ],
      });
      stripe.subscriptions.update.mockRejectedValue(bug);

      await expect(
        service.syncSubscriptionPaymentMethodsWithCustomerDefault(CUSTOMER_ID),
      ).rejects.toBe(bug);
    });

    it("retries a rate-limited customer read and still clears the pin", async () => {
      stripe.customers.retrieve
        .mockRejectedValueOnce(providerError({ statusCode: 429 }))
        .mockResolvedValue(customerWithDefault(NEW_CARD_ID));
      stripe.subscriptions.list.mockResolvedValue({
        data: [
          subscription({
            id: METERED_SUBSCRIPTION_ID,
            defaultPaymentMethod: OLD_CARD_ID,
          }),
        ],
      });

      await expect(
        service.syncSubscriptionPaymentMethodsWithCustomerDefault(CUSTOMER_ID),
      ).resolves.toEqual([METERED_SUBSCRIPTION_ID]);

      expect(stripe.customers.retrieve).toHaveBeenCalledTimes(2);
    });

    it("propagates a subscription list that cannot be read, and writes nothing", async () => {
      const failure: Error = providerError({ statusCode: 401 });
      stripe.subscriptions.list.mockRejectedValue(failure);

      await expect(
        service.syncSubscriptionPaymentMethodsWithCustomerDefault(CUSTOMER_ID),
      ).rejects.toBe(failure);

      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    });
  });

  describe("makePaymentMethodDefault", () => {
    beforeEach(() => {
      stripe.paymentMethods.retrieve.mockResolvedValue(
        card(NEW_CARD_ID, "1111"),
      );
      stripe.subscriptions.list.mockResolvedValue({
        data: [
          subscription({
            id: METERED_SUBSCRIPTION_ID,
            status: "past_due",
            defaultPaymentMethod: OLD_CARD_ID,
          }),
        ],
      });
    });

    it("makes the replacement card the default and moves autopay onto it", async () => {
      // What the sync reads back once the new default has been written.
      stripe.customers.retrieve.mockResolvedValue(
        customerWithDefault(NEW_CARD_ID),
      );

      await expect(
        service.makePaymentMethodDefault(CUSTOMER_ID, NEW_CARD_ID),
      ).resolves.toBeUndefined();

      expect(stripe.paymentMethods.retrieve).toHaveBeenCalledWith(NEW_CARD_ID);
      expect(stripe.customers.update).toHaveBeenCalledWith(CUSTOMER_ID, {
        invoice_settings: { default_payment_method: NEW_CARD_ID },
      });
      expect(stripe.subscriptions.update).toHaveBeenCalledWith(
        METERED_SUBSCRIPTION_ID,
        { default_payment_method: "" },
      );
    });

    it("checks ownership first, sets the default next, and only then syncs the subscriptions", async () => {
      await service.makePaymentMethodDefault(CUSTOMER_ID, NEW_CARD_ID);

      const ownershipCheck: number = stripe.paymentMethods.retrieve.mock
        .invocationCallOrder[0] as number;
      const setDefault: number = stripe.customers.update.mock
        .invocationCallOrder[0] as number;
      const customerRead: number = stripe.customers.retrieve.mock
        .invocationCallOrder[0] as number;
      const subscriptionRead: number = stripe.subscriptions.list.mock
        .invocationCallOrder[0] as number;
      const subscriptionWrite: number = stripe.subscriptions.update.mock
        .invocationCallOrder[0] as number;

      /*
       * The sync reads the customer default back, so it has to run after the
       * default is written - otherwise it would compare the pins against the
       * card being replaced and leave them where they are.
       */
      expect(ownershipCheck).toBeLessThan(setDefault);
      expect(setDefault).toBeLessThan(customerRead);
      expect(customerRead).toBeLessThan(subscriptionRead);
      expect(subscriptionRead).toBeLessThan(subscriptionWrite);
    });

    it("refuses a payment method attached to another customer and changes nothing", async () => {
      stripe.paymentMethods.retrieve.mockResolvedValue(
        card(NEW_CARD_ID, "1111", OTHER_CUSTOMER_ID),
      );

      await expect(
        service.makePaymentMethodDefault(CUSTOMER_ID, NEW_CARD_ID),
      ).rejects.toThrow(
        new BadDataException("Payment method does not belong to this project"),
      );

      expect(stripe.customers.update).not.toHaveBeenCalled();
      expect(stripe.subscriptions.list).not.toHaveBeenCalled();
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it("refuses a payment method that is no longer attached to any customer", async () => {
      stripe.paymentMethods.retrieve.mockResolvedValue(
        card(OLD_CARD_ID, "4242", null),
      );

      await expect(
        service.makePaymentMethodDefault(CUSTOMER_ID, OLD_CARD_ID),
      ).rejects.toThrow("Payment method does not belong to this project");

      expect(stripe.customers.update).not.toHaveBeenCalled();
    });

    it("accepts an owner that arrives expanded as a customer object", async () => {
      stripe.paymentMethods.retrieve.mockResolvedValue(
        card(NEW_CARD_ID, "1111", { id: CUSTOMER_ID }),
      );

      await expect(
        service.makePaymentMethodDefault(CUSTOMER_ID, NEW_CARD_ID),
      ).resolves.toBeUndefined();

      expect(stripe.customers.update).toHaveBeenCalledTimes(1);
    });

    it("refuses an expanded owner object that is another customer", async () => {
      stripe.paymentMethods.retrieve.mockResolvedValue(
        card(NEW_CARD_ID, "1111", { id: OTHER_CUSTOMER_ID }),
      );

      await expect(
        service.makePaymentMethodDefault(CUSTOMER_ID, NEW_CARD_ID),
      ).rejects.toThrow("Payment method does not belong to this project");

      expect(stripe.customers.update).not.toHaveBeenCalled();
    });

    it("answers a payment method Stripe does not know exactly like one owned by someone else", async () => {
      stripe.paymentMethods.retrieve.mockRejectedValue(resourceMissing());

      await expect(
        service.makePaymentMethodDefault(CUSTOMER_ID, "pm_does_not_exist"),
      ).rejects.toThrow(
        new BadDataException("Payment method does not belong to this project"),
      );

      expect(stripe.customers.update).not.toHaveBeenCalled();
    });

    it("propagates any other failure to read the payment method", async () => {
      const failure: Error = providerError({
        statusCode: 401,
        type: "StripeAuthenticationError",
      });
      stripe.paymentMethods.retrieve.mockRejectedValue(failure);

      await expect(
        service.makePaymentMethodDefault(CUSTOMER_ID, NEW_CARD_ID),
      ).rejects.toBe(failure);

      expect(stripe.customers.update).not.toHaveBeenCalled();
    });

    it("refuses an empty payment method id without asking the provider", async () => {
      await expect(
        service.makePaymentMethodDefault(CUSTOMER_ID, ""),
      ).rejects.toThrow(BadDataException);

      expect(stripe.paymentMethods.retrieve).not.toHaveBeenCalled();
      expect(stripe.customers.update).not.toHaveBeenCalled();
    });

    it("does not sync the subscriptions when the default could not be set", async () => {
      const failure: Error = providerError({ statusCode: 500 });
      stripe.customers.update.mockRejectedValue(failure);

      const thrown: unknown = await service
        .makePaymentMethodDefault(CUSTOMER_ID, NEW_CARD_ID)
        .catch((err: unknown) => {
          return err;
        });

      /*
       * The route hands whatever is thrown here to next(). A raw StripeError
       * is not an Exception, so it would be answered as
       * 500 {"error":"Server Error"} and the page would tell the customer
       * "Reason: Server Error" on the one flow that repairs autopay.
       */
      expect(thrown).toBeInstanceOf(ServiceUnavailableException);
      expect((thrown as ServiceUnavailableException).message).toMatch(
        /payment provider/i,
      );
      expect(stripe.customers.update).toHaveBeenCalledTimes(1);
      expect(stripe.subscriptions.list).not.toHaveBeenCalled();
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it("reports a rate-limited default write as the provider being unreachable, not as Server Error", async () => {
      stripe.customers.update.mockRejectedValue(
        providerError({ statusCode: 429, message: "Too many requests" }),
      );

      const thrown: unknown = await service
        .makePaymentMethodDefault(CUSTOMER_ID, NEW_CARD_ID)
        .catch((err: unknown) => {
          return err;
        });

      expect(thrown).toBeInstanceOf(ServiceUnavailableException);
      expect((thrown as ServiceUnavailableException).message).toMatch(
        /try again/i,
      );
      expect(stripe.customers.update).toHaveBeenCalledTimes(1);
    });

    it("reports a failed subscription sync instead of telling the customer autopay moved", async () => {
      const failure: Error = providerError({
        statusCode: 400,
        type: "StripeInvalidRequestError",
        message: "This subscription cannot be updated right now.",
      });
      stripe.subscriptions.update.mockRejectedValue(failure);

      const thrown: unknown = await service
        .makePaymentMethodDefault(CUSTOMER_ID, NEW_CARD_ID)
        .catch((err: unknown) => {
          return err;
        });

      expect(thrown).toBeInstanceOf(BadDataException);
      expect((thrown as BadDataException).message).toBe(
        "This subscription cannot be updated right now.",
      );
      expect(stripe.customers.update).toHaveBeenCalledTimes(1);
    });

    it("still clears stale pins when the card is already the customer default", async () => {
      /*
       * The existing production state: the new card is already the customer
       * default, but the subscription is still pinned to the old one. Choosing
       * the same default again is how that pin gets cleared without a data
       * migration.
       */
      stripe.customers.retrieve.mockResolvedValue(
        customerWithDefault(NEW_CARD_ID),
      );

      await service.makePaymentMethodDefault(CUSTOMER_ID, NEW_CARD_ID);

      expect(stripe.customers.update).toHaveBeenCalledTimes(1);
      expect(stripe.subscriptions.update).toHaveBeenCalledWith(
        METERED_SUBSCRIPTION_ID,
        { default_payment_method: "" },
      );
    });

    it("refuses when billing is disabled, before any provider request", async () => {
      getJestSpyOn(service, "isBillingEnabled").mockReturnValue(false);

      await expect(
        service.makePaymentMethodDefault(CUSTOMER_ID, NEW_CARD_ID),
      ).rejects.toThrow(Errors.BillingService.BILLING_NOT_ENABLED);

      expect(stripe.paymentMethods.retrieve).not.toHaveBeenCalled();
      expect(stripe.customers.update).not.toHaveBeenCalled();
      expect(stripe.subscriptions.list).not.toHaveBeenCalled();
    });
  });

  describe("changePlan - replacement subscriptions are not pinned to a card", () => {
    const PROJECT_ID: ObjectID = ObjectID.generate();
    const plan: SubscriptionPlan = new SubscriptionPlan(
      "price_monthly_scale",
      "price_yearly_scale",
      "Scale",
      99,
      84,
      3,
      0,
    );

    type ChangePlanFunction = () => ReturnType<BillingService["changePlan"]>;

    const changePlan: ChangePlanFunction = (): ReturnType<
      BillingService["changePlan"]
    > => {
      return service.changePlan({
        projectId: PROJECT_ID,
        subscriptionId: FLAT_FEE_SUBSCRIPTION_ID,
        meteredSubscriptionId: METERED_SUBSCRIPTION_ID,
        serverMeteredPlans: [],
        newPlan: plan,
        quantity: 1,
        isYearly: false,
      });
    };

    type GivenSubscriptionsFunction = (statuses: {
      flatFee: Stripe.Subscription.Status;
      metered: Stripe.Subscription.Status;
    }) => void;

    const givenSubscriptions: GivenSubscriptionsFunction = (statuses: {
      flatFee: Stripe.Subscription.Status;
      metered: Stripe.Subscription.Status;
    }): void => {
      stripe.subscriptions.retrieve.mockImplementation((id: unknown) => {
        return Promise.resolve(
          id === FLAT_FEE_SUBSCRIPTION_ID
            ? subscription({
                id: FLAT_FEE_SUBSCRIPTION_ID,
                status: statuses.flatFee,
                itemId: "si_flat_fee",
              })
            : subscription({
                id: METERED_SUBSCRIPTION_ID,
                status: statuses.metered,
                itemId: "si_metered",
              }),
        );
      });
    };

    let paymentMethods: Array<PaymentMethod>;

    beforeEach(() => {
      /*
       * The day of the reactivation: the old card was the customer
       * default, and so first in this list. That first entry is what used to
       * be pinned onto the replacement subscriptions.
       */
      paymentMethods = [
        {
          id: OLD_CARD_ID,
          type: "visa",
          last4Digits: "4242",
          isDefault: true,
        },
      ];
      getJestSpyOn(service, "getPaymentMethods").mockImplementation(() => {
        return Promise.resolve(paymentMethods);
      });

      let created: number = 0;
      stripe.subscriptions.create.mockImplementation(() => {
        created++;
        return Promise.resolve({ id: `sub_replacement_${created}` });
      });
    });

    type CreateParams = Stripe.SubscriptionCreateParams;

    const createdParams: () => Array<CreateParams> =
      (): Array<CreateParams> => {
        return stripe.subscriptions.create.mock.calls.map((call: unknown) => {
          return (call as [CreateParams])[0];
        });
      };

    it("recreates both halves of a reactivated project without default_payment_method", async () => {
      givenSubscriptions({ flatFee: "canceled", metered: "canceled" });

      const result: Awaited<ReturnType<BillingService["changePlan"]>> =
        await changePlan();

      expect(result.subscriptionId).toBe("sub_replacement_1");
      expect(result.meteredSubscriptionId).toBe("sub_replacement_2");

      const params: Array<CreateParams> = createdParams();
      expect(params).toHaveLength(2);

      for (const createParams of params) {
        expect(createParams.customer).toBe(CUSTOMER_ID);
        expect(createParams).not.toHaveProperty("default_payment_method");
      }

      // The flat fee carries the plan's price; the metered one does not.
      expect(params[0]?.items).toEqual([
        { price: "price_monthly_scale", quantity: 1 },
      ]);
    });

    it("does not pin the flat-fee replacement when only the flat-fee subscription is dead", async () => {
      givenSubscriptions({ flatFee: "unpaid", metered: "active" });

      await changePlan();

      const params: Array<CreateParams> = createdParams();
      expect(params).toHaveLength(1);
      expect(params[0]).not.toHaveProperty("default_payment_method");
      expect(params[0]?.items).toEqual([
        { price: "price_monthly_scale", quantity: 1 },
      ]);
    });

    it("does not pin the metered replacement when only the metered subscription is dead", async () => {
      givenSubscriptions({ flatFee: "active", metered: "incomplete_expired" });

      await changePlan();

      const params: Array<CreateParams> = createdParams();
      expect(params).toHaveLength(1);
      expect(params[0]).not.toHaveProperty("default_payment_method");
      expect(params[0]?.metadata).toEqual({
        projectId: PROJECT_ID.toString(),
        replacedSubscriptionId: METERED_SUBSCRIPTION_ID,
      });
    });

    it("does not pin even when the customer has several cards", async () => {
      paymentMethods = [
        { id: NEW_CARD_ID, type: "visa", last4Digits: "1111", isDefault: true },
        {
          id: OLD_CARD_ID,
          type: "visa",
          last4Digits: "4242",
          isDefault: false,
        },
      ];
      givenSubscriptions({ flatFee: "canceled", metered: "canceled" });

      await changePlan();

      for (const createParams of createdParams()) {
        expect(createParams).not.toHaveProperty("default_payment_method");
      }
    });

    it("still refuses to create subscriptions for a customer with no payment method", async () => {
      paymentMethods = [];
      givenSubscriptions({ flatFee: "canceled", metered: "canceled" });

      await expect(changePlan()).rejects.toThrow(
        Errors.BillingService.NO_PAYMENTS_METHODS,
      );

      expect(stripe.subscriptions.create).not.toHaveBeenCalled();
      expect(stripe.subscriptions.del).not.toHaveBeenCalled();
    });

    it("leaves an explicitly requested pin working for direct subscribeToPlan callers", async () => {
      await service.subscribeToPlan({
        projectId: PROJECT_ID,
        customerId: CUSTOMER_ID,
        serverMeteredPlans: [],
        plan: plan,
        quantity: 1,
        isYearly: false,
        trial: false,
        defaultPaymentMethodId: NEW_CARD_ID,
      });

      for (const createParams of createdParams()) {
        expect(createParams.default_payment_method).toBe(NEW_CARD_ID);
      }
    });
  });

  describe("getPaymentMethods - promoting a first default syncs the subscriptions", () => {
    beforeEach(() => {
      stripe.paymentMethods.list.mockImplementation((params: unknown) => {
        return Promise.resolve({
          data:
            (params as Stripe.PaymentMethodListParams).type === "card"
              ? [card(NEW_CARD_ID, "1111")]
              : [],
        });
      });
      stripe.subscriptions.list.mockResolvedValue({
        data: [
          subscription({
            id: METERED_SUBSCRIPTION_ID,
            status: "past_due",
            defaultPaymentMethod: OLD_CARD_ID,
          }),
        ],
      });
    });

    it("points subscriptions pinned to another card at the default it just promoted", async () => {
      // First read: no default. The sync then reads the default just written.
      stripe.customers.retrieve
        .mockResolvedValueOnce(customerWithDefault(null))
        .mockResolvedValue(customerWithDefault(NEW_CARD_ID));

      await expect(service.getPaymentMethods(CUSTOMER_ID)).resolves.toEqual([
        { id: NEW_CARD_ID, type: "visa", last4Digits: "1111", isDefault: true },
      ]);

      expect(stripe.customers.update).toHaveBeenCalledWith(CUSTOMER_ID, {
        invoice_settings: { default_payment_method: NEW_CARD_ID },
      });
      expect(stripe.subscriptions.update).toHaveBeenCalledWith(
        METERED_SUBSCRIPTION_ID,
        { default_payment_method: "" },
      );
      expect(
        stripe.customers.update.mock.invocationCallOrder[0] as number,
      ).toBeLessThan(
        stripe.subscriptions.list.mock.invocationCallOrder[0] as number,
      );
    });

    it.each([
      [
        "the subscription list cannot be read",
        (fake: FakeStripe): void => {
          fake.subscriptions.list.mockRejectedValue(
            providerError({ statusCode: 400 }),
          );
        },
      ],
      [
        "a subscription cannot be updated",
        (fake: FakeStripe): void => {
          fake.subscriptions.update.mockRejectedValue(
            providerError({ statusCode: 400 }),
          );
        },
      ],
      [
        "the customer cannot be read back",
        (fake: FakeStripe): void => {
          fake.customers.retrieve
            .mockReset()
            .mockResolvedValueOnce(customerWithDefault(null))
            .mockRejectedValue(providerError({ statusCode: 401 }));
        },
      ],
    ])(
      "still answers the read when %s",
      async (_case: string, breakSync: (fake: FakeStripe) => void) => {
        stripe.customers.retrieve
          .mockResolvedValueOnce(customerWithDefault(null))
          .mockResolvedValue(customerWithDefault(NEW_CARD_ID));
        breakSync(stripe);

        await expect(service.getPaymentMethods(CUSTOMER_ID)).resolves.toEqual([
          {
            id: NEW_CARD_ID,
            type: "visa",
            last4Digits: "1111",
            isDefault: true,
          },
        ]);

        expect(stripe.customers.update).toHaveBeenCalledTimes(1);
        expect(loggerError).toHaveBeenCalled();
      },
    );

    it("keeps the common path free of subscription reads when a default already exists", async () => {
      stripe.customers.retrieve.mockResolvedValue(
        customerWithDefault(NEW_CARD_ID),
      );

      await service.getPaymentMethods(CUSTOMER_ID);

      /*
       * Every billing page render reads payment methods. A subscription read
       * per render is the kind of provider traffic that held the account at
       * its rate limit before.
       */
      expect(stripe.customers.retrieve).toHaveBeenCalledTimes(1);
      expect(stripe.customers.update).not.toHaveBeenCalled();
      expect(stripe.subscriptions.list).not.toHaveBeenCalled();
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it("does not sync when the stored default is a card that is not in the list", async () => {
      stripe.customers.retrieve.mockResolvedValue(
        customerWithDefault("pm_detached"),
      );

      await service.getPaymentMethods(CUSTOMER_ID);

      expect(stripe.customers.update).not.toHaveBeenCalled();
      expect(stripe.subscriptions.list).not.toHaveBeenCalled();
    });

    it("promotes nothing and syncs nothing when the customer has no payment method", async () => {
      stripe.paymentMethods.list.mockResolvedValue({ data: [] });
      stripe.customers.retrieve.mockResolvedValue(customerWithDefault(null));

      await expect(service.getPaymentMethods(CUSTOMER_ID)).resolves.toEqual([]);

      expect(stripe.customers.update).not.toHaveBeenCalled();
      expect(stripe.subscriptions.list).not.toHaveBeenCalled();
    });

    it("still fails the read when the default itself cannot be written, and syncs nothing", async () => {
      const failure: Error = providerError({ statusCode: 500 });
      stripe.customers.retrieve.mockResolvedValue(customerWithDefault(null));
      stripe.customers.update.mockRejectedValue(failure);

      // Named, rather than the raw StripeError's opaque 500 "Server Error".
      await expect(service.getPaymentMethods(CUSTOMER_ID)).rejects.toThrow(
        ServiceUnavailableException,
      );

      expect(stripe.subscriptions.list).not.toHaveBeenCalled();
    });
  });

  describe("deletePaymentMethod - keeps a default and re-syncs the subscriptions", () => {
    let paymentMethods: Array<PaymentMethod>;

    beforeEach(() => {
      paymentMethods = [
        { id: OLD_CARD_ID, type: "visa", last4Digits: "4242", isDefault: true },
        {
          id: NEW_CARD_ID,
          type: "visa",
          last4Digits: "1111",
          isDefault: false,
        },
      ];
      getJestSpyOn(service, "getPaymentMethods").mockImplementation(() => {
        return Promise.resolve(paymentMethods);
      });
      stripe.paymentMethods.retrieve.mockImplementation((id: unknown) => {
        return Promise.resolve(card(id as string, "0000"));
      });
      stripe.subscriptions.list.mockResolvedValue({
        data: [
          subscription({
            id: METERED_SUBSCRIPTION_ID,
            status: "past_due",
            defaultPaymentMethod: OLD_CARD_ID,
          }),
        ],
      });
    });

    it("promotes the remaining card when the affected customer deletes the old default card, and unpins autopay from it", async () => {
      // Stripe clears the customer default when the default card is detached.
      stripe.customers.retrieve.mockResolvedValue(
        customerWithDefault(NEW_CARD_ID),
      );

      await expect(
        service.deletePaymentMethod(CUSTOMER_ID, OLD_CARD_ID),
      ).resolves.toBeUndefined();

      expect(stripe.paymentMethods.detach).toHaveBeenCalledWith(OLD_CARD_ID);
      expect(stripe.customers.update).toHaveBeenCalledWith(CUSTOMER_ID, {
        invoice_settings: { default_payment_method: NEW_CARD_ID },
      });
      expect(stripe.subscriptions.update).toHaveBeenCalledWith(
        METERED_SUBSCRIPTION_ID,
        { default_payment_method: "" },
      );

      const detach: number = stripe.paymentMethods.detach.mock
        .invocationCallOrder[0] as number;
      const promote: number = stripe.customers.update.mock
        .invocationCallOrder[0] as number;
      const sync: number = stripe.subscriptions.update.mock
        .invocationCallOrder[0] as number;
      expect(detach).toBeLessThan(promote);
      expect(promote).toBeLessThan(sync);
    });

    it("keeps the existing default when a non-default card is deleted, and still syncs", async () => {
      stripe.customers.retrieve.mockResolvedValue(
        customerWithDefault(OLD_CARD_ID),
      );
      stripe.subscriptions.list.mockResolvedValue({
        data: [
          subscription({
            id: METERED_SUBSCRIPTION_ID,
            defaultPaymentMethod: NEW_CARD_ID,
          }),
        ],
      });

      await service.deletePaymentMethod(CUSTOMER_ID, NEW_CARD_ID);

      expect(stripe.paymentMethods.detach).toHaveBeenCalledWith(NEW_CARD_ID);
      expect(stripe.customers.update).not.toHaveBeenCalled();
      // The subscription was pinned to the card just deleted.
      expect(stripe.subscriptions.update).toHaveBeenCalledWith(
        METERED_SUBSCRIPTION_ID,
        { default_payment_method: "" },
      );
    });

    it("promotes the first remaining card when no listed card is the default", async () => {
      paymentMethods = [
        {
          id: OLD_CARD_ID,
          type: "visa",
          last4Digits: "4242",
          isDefault: false,
        },
        {
          id: NEW_CARD_ID,
          type: "visa",
          last4Digits: "1111",
          isDefault: false,
        },
        {
          id: "pm_third",
          type: "visa",
          last4Digits: "9999",
          isDefault: false,
        },
      ];

      await service.deletePaymentMethod(CUSTOMER_ID, OLD_CARD_ID);

      expect(stripe.customers.update).toHaveBeenCalledTimes(1);
      expect(stripe.customers.update).toHaveBeenCalledWith(CUSTOMER_ID, {
        invoice_settings: { default_payment_method: NEW_CARD_ID },
      });
    });

    it("refuses to detach a payment method attached to another customer", async () => {
      stripe.paymentMethods.retrieve.mockResolvedValue(
        card(NEW_CARD_ID, "1111", OTHER_CUSTOMER_ID),
      );

      await expect(
        service.deletePaymentMethod(CUSTOMER_ID, NEW_CARD_ID),
      ).rejects.toThrow(
        new BadDataException("Payment method does not belong to this project"),
      );

      expect(stripe.paymentMethods.detach).not.toHaveBeenCalled();
      expect(service.getPaymentMethods).not.toHaveBeenCalled();
      expect(stripe.customers.update).not.toHaveBeenCalled();
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it("refuses to detach a payment method Stripe does not know", async () => {
      stripe.paymentMethods.retrieve.mockRejectedValue(resourceMissing());

      await expect(
        service.deletePaymentMethod(CUSTOMER_ID, "pm_does_not_exist"),
      ).rejects.toThrow("Payment method does not belong to this project");

      expect(stripe.paymentMethods.detach).not.toHaveBeenCalled();
    });

    it("still refuses to delete the only payment method", async () => {
      paymentMethods = [
        { id: OLD_CARD_ID, type: "visa", last4Digits: "4242", isDefault: true },
      ];

      await expect(
        service.deletePaymentMethod(CUSTOMER_ID, OLD_CARD_ID),
      ).rejects.toThrow(
        Errors.BillingService.MIN_REQUIRED_PAYMENT_METHOD_NOT_MET,
      );

      expect(stripe.paymentMethods.detach).not.toHaveBeenCalled();
      expect(stripe.customers.update).not.toHaveBeenCalled();
    });

    it("repairs nothing when the detach itself fails", async () => {
      const failure: Error = providerError({ statusCode: 500 });
      stripe.paymentMethods.detach.mockRejectedValue(failure);

      await expect(
        service.deletePaymentMethod(CUSTOMER_ID, OLD_CARD_ID),
      ).rejects.toBe(failure);

      expect(stripe.customers.update).not.toHaveBeenCalled();
      expect(stripe.subscriptions.list).not.toHaveBeenCalled();
    });

    it("does not fail a completed delete when the new default cannot be set", async () => {
      stripe.customers.update.mockRejectedValue(
        providerError({ statusCode: 500 }),
      );

      await expect(
        service.deletePaymentMethod(CUSTOMER_ID, OLD_CARD_ID),
      ).resolves.toBeUndefined();

      expect(stripe.paymentMethods.detach).toHaveBeenCalledWith(OLD_CARD_ID);
      expect(loggerError).toHaveBeenCalled();
    });

    it("does not fail a completed delete when the subscriptions cannot be synced", async () => {
      stripe.subscriptions.update.mockRejectedValue(
        providerError({ statusCode: 400 }),
      );

      await expect(
        service.deletePaymentMethod(CUSTOMER_ID, OLD_CARD_ID),
      ).resolves.toBeUndefined();

      expect(stripe.paymentMethods.detach).toHaveBeenCalledWith(OLD_CARD_ID);
      expect(stripe.customers.update).toHaveBeenCalledTimes(1);
      expect(loggerError).toHaveBeenCalled();
    });

    it("refuses when billing is disabled, before any provider request", async () => {
      getJestSpyOn(service, "isBillingEnabled").mockReturnValue(false);

      await expect(
        service.deletePaymentMethod(CUSTOMER_ID, OLD_CARD_ID),
      ).rejects.toThrow(Errors.BillingService.BILLING_NOT_ENABLED);

      expect(stripe.paymentMethods.retrieve).not.toHaveBeenCalled();
      expect(stripe.paymentMethods.detach).not.toHaveBeenCalled();
    });
  });
});
