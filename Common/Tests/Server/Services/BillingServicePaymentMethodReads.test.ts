import { BillingService } from "../../../Server/Services/BillingService";
import Errors from "../../../Server/Utils/Errors";
import Sleep from "../../../Types/Sleep";
import { getJestSpyOn } from "../../Spy";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
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

const CUSTOMER_ID: string = "cus_read_test";
const PAYMENT_TYPES: Array<Stripe.PaymentMethodListParams.Type> = [
  "card",
  "sepa_debit",
  "us_bank_account",
  "bacs_debit",
];
const CARD: Partial<Stripe.PaymentMethod> = {
  id: "pm_card",
  type: "card",
  card: { brand: "visa", last4: "4242" } as Stripe.PaymentMethod.Card,
};

function providerError(statusCode: number): Error {
  return Object.assign(new Error(`Stripe HTTP ${statusCode}`), { statusCode });
}

describe("BillingService payment-method reads", () => {
  let service: BillingService;
  let list: jest.Mock;
  let retrieveCustomer: jest.Mock;
  let retrieveSubscription: jest.Mock;
  let updateCustomer: jest.Mock;
  let sleep: jest.SpyInstance;

  beforeEach(() => {
    service = new BillingService();
    list = jest
      .fn()
      .mockImplementation((params: Stripe.PaymentMethodListParams) => {
        return Promise.resolve({ data: params.type === "card" ? [CARD] : [] });
      });
    retrieveCustomer = jest.fn().mockResolvedValue({
      invoice_settings: { default_payment_method: "pm_card" },
    });
    retrieveSubscription = jest.fn().mockResolvedValue({ id: "sub_test" });
    updateCustomer = jest.fn().mockResolvedValue({});
    (service as unknown as { stripe: unknown }).stripe = {
      paymentMethods: { list },
      customers: { retrieve: retrieveCustomer, update: updateCustomer },
      subscriptions: { retrieve: retrieveSubscription },
    };
    getJestSpyOn(service, "isBillingEnabled").mockReturnValue(true);
    sleep = getJestSpyOn(Sleep, "sleep").mockResolvedValue(undefined);
    getJestSpyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    "hasPaymentMethods",
    "getPaymentMethods",
    "getSubscription",
  ] as const)(
    "%s refuses billing-disabled access before any Stripe request",
    async (
      method: "hasPaymentMethods" | "getPaymentMethods" | "getSubscription",
    ) => {
      getJestSpyOn(service, "isBillingEnabled").mockReturnValue(false);
      await expect(service[method](CUSTOMER_ID)).rejects.toThrow(
        Errors.BillingService.BILLING_NOT_ENABLED,
      );
      expect(list).not.toHaveBeenCalled();
      expect(retrieveCustomer).not.toHaveBeenCalled();
      expect(retrieveSubscription).not.toHaveBeenCalled();
    },
  );

  it.each(PAYMENT_TYPES)(
    "accepts an attached %s method and stops requesting other types",
    async (type: Stripe.PaymentMethodListParams.Type) => {
      list.mockImplementation((params: Stripe.PaymentMethodListParams) => {
        return Promise.resolve({
          data: params.type === type ? [{ id: "pm_attached" }] : [],
        });
      });
      await expect(service.hasPaymentMethods(CUSTOMER_ID)).resolves.toBe(true);
      expect(list.mock.calls).toEqual(
        PAYMENT_TYPES.slice(0, PAYMENT_TYPES.indexOf(type) + 1).map(
          (requestedType: Stripe.PaymentMethodListParams.Type) => {
            return [{ customer: CUSTOMER_ID, type: requestedType, limit: 1 }];
          },
        ),
      );
      expect(retrieveCustomer).not.toHaveBeenCalled();
      expect(updateCustomer).not.toHaveBeenCalled();
    },
  );

  it("returns false only after every supported type has been checked", async () => {
    list.mockResolvedValue({ data: [] });
    await expect(service.hasPaymentMethods(CUSTOMER_ID)).resolves.toBe(false);
    expect(list.mock.calls).toEqual(
      PAYMENT_TYPES.map((type: Stripe.PaymentMethodListParams.Type) => {
        return [{ customer: CUSTOMER_ID, type, limit: 1 }];
      }),
    );
    expect(retrieveCustomer).not.toHaveBeenCalled();
    expect(updateCustomer).not.toHaveBeenCalled();
  });

  it("observes a newly attached card and its subsequent removal without caching", async () => {
    list.mockResolvedValue({ data: [] });
    await expect(service.hasPaymentMethods(CUSTOMER_ID)).resolves.toBe(false);
    list.mockResolvedValue({ data: [CARD] });
    await expect(service.hasPaymentMethods(CUSTOMER_ID)).resolves.toBe(true);
    list.mockResolvedValue({ data: [] });
    await expect(service.hasPaymentMethods(CUSTOMER_ID)).resolves.toBe(false);
    expect(list).toHaveBeenCalledTimes(9);
  });

  it("does not turn an unreadable bank-method list into missing payment authorization", async () => {
    const failure: Error = providerError(429);
    list.mockResolvedValueOnce({ data: [] }).mockRejectedValue(failure);
    await expect(service.hasPaymentMethods(CUSTOMER_ID)).rejects.toBe(failure);
    expect(list).toHaveBeenCalledTimes(5);
    expect(list.mock.calls.slice(1)).toEqual(
      Array.from({ length: 4 }, () => {
        return [{ customer: CUSTOMER_ID, type: "sepa_debit", limit: 1 }];
      }),
    );
  });

  describe.each(["list", "customer", "subscription"] as const)(
    "%s read retries",
    (readType: "list" | "customer" | "subscription") => {
      let request: jest.Mock;
      let run: () => Promise<unknown>;

      beforeEach(() => {
        request =
          readType === "list"
            ? list
            : readType === "customer"
              ? retrieveCustomer
              : retrieveSubscription;
        run = (): Promise<unknown> => {
          return readType === "list"
            ? service.hasPaymentMethods(CUSTOMER_ID)
            : readType === "customer"
              ? service.getPaymentMethods(CUSTOMER_ID)
              : service.getSubscription("sub_test");
        };
      });

      it("recovers from 429 with bounded exponential backoff and jitter", async () => {
        const failure: Error = providerError(429);
        request
          .mockRejectedValueOnce(failure)
          .mockRejectedValueOnce(failure)
          .mockRejectedValueOnce(failure);
        await expect(run()).resolves.toBeDefined();
        expect(request).toHaveBeenCalledTimes(4);
        expect(sleep.mock.calls).toEqual([[1250], [2500], [5000]]);
      });

      it("propagates the exact error after exhausting 429 retries", async () => {
        const failure: Error = providerError(429);
        request.mockRejectedValue(failure);
        await expect(run()).rejects.toBe(failure);
        expect(request).toHaveBeenCalledTimes(4);
        expect(sleep).toHaveBeenCalledTimes(3);
        expect(updateCustomer).not.toHaveBeenCalled();
      });

      it.each([400, 401, 404, 500])(
        "does not retry HTTP %s",
        async (status: number) => {
          const failure: Error = providerError(status);
          request.mockRejectedValue(failure);
          await expect(run()).rejects.toBe(failure);
          expect(request).toHaveBeenCalledTimes(1);
          expect(sleep).not.toHaveBeenCalled();
        },
      );

      it("keeps the next lookup fresh after a previous failure", async () => {
        const failure: Error = providerError(500);
        request.mockRejectedValueOnce(failure);
        await expect(run()).rejects.toBe(failure);
        await expect(run()).resolves.toBeDefined();
        expect(request).toHaveBeenCalledTimes(2);
      });
    },
  );

  it("retries only the failed list without repeating earlier successful reads", async () => {
    const failure: Error = providerError(429);
    list.mockResolvedValueOnce({ data: [CARD] }).mockRejectedValueOnce(failure);
    await expect(service.getPaymentMethods(CUSTOMER_ID)).resolves.toEqual([
      { id: "pm_card", type: "visa", last4Digits: "4242", isDefault: true },
    ]);
    expect(
      list.mock.calls.map((call: [Stripe.PaymentMethodListParams]) => {
        return call[0].type;
      }),
    ).toEqual([
      "card",
      "sepa_debit",
      "sepa_debit",
      "us_bank_account",
      "bacs_debit",
    ]);
    expect(
      list.mock.calls.every((call: [Stripe.PaymentMethodListParams]) => {
        return call[0].limit === undefined;
      }),
    ).toBe(true);
  });

  it("sets the default once after a retried customer read", async () => {
    retrieveCustomer
      .mockRejectedValueOnce(providerError(429))
      .mockResolvedValue({
        invoice_settings: { default_payment_method: null },
      });
    await expect(service.getPaymentMethods(CUSTOMER_ID)).resolves.toEqual([
      { id: "pm_card", type: "visa", last4Digits: "4242", isDefault: true },
    ]);
    expect(list).toHaveBeenCalledTimes(4);
    expect(retrieveCustomer).toHaveBeenCalledTimes(2);
    expect(updateCustomer).toHaveBeenCalledTimes(1);
    expect(updateCustomer).toHaveBeenCalledWith(CUSTOMER_ID, {
      invoice_settings: { default_payment_method: "pm_card" },
    });
  });

  it("never retries a default-payment-method mutation, even on 429", async () => {
    const failure: Error = providerError(429);
    retrieveCustomer.mockResolvedValue({
      invoice_settings: { default_payment_method: null },
    });
    updateCustomer.mockRejectedValue(failure);
    await expect(service.getPaymentMethods(CUSTOMER_ID)).rejects.toBe(failure);
    expect(updateCustomer).toHaveBeenCalledTimes(1);
    expect(retrieveCustomer).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(4);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not reuse a partially fetched pre-confirmation payment-method list", async () => {
    let cardAttached: boolean = false;
    let firstSepaRead: boolean = true;
    let finishSepa: (value: { data: [] }) => void = () => {
      return;
    };
    let signalSepaStarted: () => void = () => {
      return;
    };
    const sepaPending: Promise<{ data: [] }> = new Promise(
      (resolve: (value: { data: [] }) => void) => {
        finishSepa = resolve;
      },
    );
    const sepaStarted: Promise<void> = new Promise((resolve: () => void) => {
      signalSepaStarted = resolve;
    });
    list.mockImplementation((params: Stripe.PaymentMethodListParams) => {
      if (params.type === "sepa_debit" && firstSepaRead) {
        firstSepaRead = false;
        signalSepaStarted();
        return sepaPending;
      }
      return Promise.resolve({
        data: params.type === "card" && cardAttached ? [CARD] : [],
      });
    });

    const beforeConfirmation: ReturnType<BillingService["getPaymentMethods"]> =
      service.getPaymentMethods(CUSTOMER_ID);
    await sepaStarted;
    cardAttached = true;
    await expect(service.getPaymentMethods(CUSTOMER_ID)).resolves.toHaveLength(
      1,
    );
    finishSepa({ data: [] });
    await expect(beforeConfirmation).resolves.toEqual([]);
    cardAttached = false;
    await expect(service.getPaymentMethods(CUSTOMER_ID)).resolves.toEqual([]);
    expect(list).toHaveBeenCalledTimes(12);
  });
});
