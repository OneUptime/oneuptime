import {
  BillingService,
  Invoice,
  PaymentIntentState,
} from "../../../Server/Services/BillingService";
import Errors from "../../../Server/Utils/Errors";
import logger from "../../../Server/Utils/Logger";
import BadDataException from "../../../Types/Exception/BadDataException";
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

/*
 * The cards of the affected customer. The old India-issued Visa was the one
 * pinned on the subscription; the new card was added while the old card's
 * debit was processing and is the customer default now.
 */
const CUSTOMER_ID: string = "cus_stale_card_customer";
const INVOICE_ID: string = "in_stale_card_invoice";
const PAYMENT_INTENT_ID: string = "pi_stale_card_invoice";
const NEW_DEFAULT_CARD: string = "pm_new_default_card";
const OLD_INDIA_CARD: string = "pm_replaced_card";
const THIRD_CARD: string = "pm_third";
const FOURTH_CARD: string = "pm_fourth";

type CardFunction = (
  id: string,
  last4: string,
) => Partial<Stripe.PaymentMethod>;

const card: CardFunction = (
  id: string,
  last4: string,
): Partial<Stripe.PaymentMethod> => {
  return {
    id,
    type: "card",
    card: { brand: "visa", last4 } as Stripe.PaymentMethod.Card,
  };
};

type StripeLikeErrorFunction = (data: {
  type: string;
  message: string;
  code?: string;
  statusCode?: number;
}) => Error;

const stripeLikeError: StripeLikeErrorFunction = (data: {
  type: string;
  message: string;
  code?: string;
  statusCode?: number;
}): Error => {
  return Object.assign(new Error(data.message), {
    type: data.type,
    code: data.code,
    statusCode: data.statusCode,
  });
};

type StripeInvoiceFunction = (
  overrides?: Partial<Stripe.Invoice>,
) => Stripe.Invoice;

const stripeInvoice: StripeInvoiceFunction = (
  overrides?: Partial<Stripe.Invoice>,
): Stripe.Invoice => {
  return {
    id: INVOICE_ID,
    amount_due: 101,
    currency: "usd",
    status: "paid",
    customer: CUSTOMER_ID,
    created: 1757635200,
    number: "SCAP-0009",
    subscription: "sub_pinned_metered",
    invoice_pdf: null,
    ...overrides,
  } as unknown as Stripe.Invoice;
};

describe("BillingService PaymentIntent state and invoice payment failover", () => {
  let service: BillingService;
  let retrievePaymentIntent: jest.Mock;
  let listPaymentMethods: jest.Mock;
  let retrieveCustomer: jest.Mock;
  let payStripeInvoice: jest.Mock;
  let createInvoice: jest.Mock;
  let createInvoiceItem: jest.Mock;
  let finalizeInvoice: jest.Mock;
  let voidInvoice: jest.Mock;
  let sleep: jest.SpyInstance;

  beforeEach(() => {
    service = new BillingService();

    retrievePaymentIntent = jest.fn();
    listPaymentMethods = jest
      .fn()
      .mockImplementation((params: Stripe.PaymentMethodListParams) => {
        return Promise.resolve({
          data:
            params.type === "card"
              ? [
                  card(OLD_INDIA_CARD, "1111"),
                  card(NEW_DEFAULT_CARD, "4242"),
                  card(THIRD_CARD, "3333"),
                  card(FOURTH_CARD, "4444"),
                ]
              : [],
        });
      });
    retrieveCustomer = jest.fn().mockResolvedValue({
      invoice_settings: { default_payment_method: NEW_DEFAULT_CARD },
    });
    payStripeInvoice = jest.fn().mockResolvedValue(stripeInvoice());
    createInvoice = jest.fn().mockResolvedValue(stripeInvoice());
    createInvoiceItem = jest.fn().mockResolvedValue({});
    finalizeInvoice = jest.fn().mockResolvedValue(stripeInvoice());
    voidInvoice = jest
      .fn()
      .mockResolvedValue(stripeInvoice({ status: "void" }));

    (service as unknown as { stripe: unknown }).stripe = {
      paymentIntents: { retrieve: retrievePaymentIntent },
      paymentMethods: { list: listPaymentMethods },
      customers: { retrieve: retrieveCustomer, update: jest.fn() },
      invoices: {
        pay: payStripeInvoice,
        create: createInvoice,
        finalizeInvoice: finalizeInvoice,
        voidInvoice: voidInvoice,
      },
      invoiceItems: { create: createInvoiceItem },
    };

    getJestSpyOn(service, "isBillingEnabled").mockReturnValue(true);
    sleep = getJestSpyOn(Sleep, "sleep").mockResolvedValue(undefined);
    getJestSpyOn(Math, "random").mockReturnValue(0.5);
    getJestSpyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getPaymentIntent", () => {
    it("reports the PaymentIntent that sat processing on the old India card", async () => {
      retrievePaymentIntent.mockResolvedValue({
        id: PAYMENT_INTENT_ID,
        status: "processing",
        client_secret: "pi_secret",
        payment_method: OLD_INDIA_CARD,
        last_payment_error: null,
      });

      const state: PaymentIntentState =
        await service.getPaymentIntent(PAYMENT_INTENT_ID);

      expect(retrievePaymentIntent).toHaveBeenCalledTimes(1);
      expect(retrievePaymentIntent).toHaveBeenCalledWith(PAYMENT_INTENT_ID);
      expect(state).toEqual({
        id: PAYMENT_INTENT_ID,
        status: "processing",
        clientSecret: "pi_secret",
        paymentMethodId: OLD_INDIA_CARD,
        lastPaymentErrorMessage: undefined,
      });
    });

    it("reads the id of an expanded payment method", async () => {
      retrievePaymentIntent.mockResolvedValue({
        id: PAYMENT_INTENT_ID,
        status: "requires_action",
        client_secret: "pi_secret",
        payment_method: { id: NEW_DEFAULT_CARD, object: "payment_method" },
        last_payment_error: null,
      });

      const state: PaymentIntentState =
        await service.getPaymentIntent(PAYMENT_INTENT_ID);

      expect(state.paymentMethodId).toBe(NEW_DEFAULT_CARD);
      expect(state.status).toBe("requires_action");
    });

    it.each([null, undefined])(
      "reports no payment method when Stripe returns %s",
      async (paymentMethod: null | undefined) => {
        retrievePaymentIntent.mockResolvedValue({
          id: PAYMENT_INTENT_ID,
          status: "requires_payment_method",
          client_secret: "pi_secret",
          payment_method: paymentMethod,
        });

        const state: PaymentIntentState =
          await service.getPaymentIntent(PAYMENT_INTENT_ID);

        expect(state.paymentMethodId).toBeUndefined();
      },
    );

    it.each([null, ""])(
      "turns a missing client secret (%p) into undefined rather than throwing",
      async (clientSecret: null | string) => {
        retrievePaymentIntent.mockResolvedValue({
          id: PAYMENT_INTENT_ID,
          status: "requires_action",
          client_secret: clientSecret,
          payment_method: OLD_INDIA_CARD,
        });

        const state: PaymentIntentState =
          await service.getPaymentIntent(PAYMENT_INTENT_ID);

        expect(state.clientSecret).toBeUndefined();
      },
    );

    it("carries the decline message the bank gave for the last attempt", async () => {
      retrievePaymentIntent.mockResolvedValue({
        id: PAYMENT_INTENT_ID,
        status: "requires_payment_method",
        client_secret: "pi_secret",
        payment_method: null,
        last_payment_error: {
          type: "card_error",
          code: "card_declined",
          decline_code: "do_not_honor",
          message: "Your card was declined.",
        },
      });

      const state: PaymentIntentState =
        await service.getPaymentIntent(PAYMENT_INTENT_ID);

      expect(state.lastPaymentErrorMessage).toBe("Your card was declined.");
      expect(state.status).toBe("requires_payment_method");
    });

    it("reports no decline message when the last error has none", async () => {
      retrievePaymentIntent.mockResolvedValue({
        id: PAYMENT_INTENT_ID,
        status: "requires_payment_method",
        client_secret: "pi_secret",
        payment_method: null,
        last_payment_error: { type: "card_error" },
      });

      const state: PaymentIntentState =
        await service.getPaymentIntent(PAYMENT_INTENT_ID);

      expect(state.lastPaymentErrorMessage).toBeUndefined();
    });

    it.each([
      "requires_payment_method",
      "requires_confirmation",
      "requires_action",
      "processing",
      "requires_capture",
      "canceled",
      "succeeded",
    ] as Array<Stripe.PaymentIntent.Status>)(
      "passes the %s status through unchanged",
      async (status: Stripe.PaymentIntent.Status) => {
        retrievePaymentIntent.mockResolvedValue({
          id: PAYMENT_INTENT_ID,
          status,
          client_secret: "pi_secret",
          payment_method: null,
        });

        await expect(
          service.getPaymentIntent(PAYMENT_INTENT_ID),
        ).resolves.toEqual(expect.objectContaining({ status }));
      },
    );

    it("retries a rate-limited read instead of failing the pay flow", async () => {
      retrievePaymentIntent
        .mockRejectedValueOnce(
          Object.assign(new Error("Stripe HTTP 429"), { statusCode: 429 }),
        )
        .mockResolvedValue({
          id: PAYMENT_INTENT_ID,
          status: "processing",
          client_secret: "pi_secret",
          payment_method: OLD_INDIA_CARD,
        });

      const state: PaymentIntentState =
        await service.getPaymentIntent(PAYMENT_INTENT_ID);

      expect(state.status).toBe("processing");
      expect(retrievePaymentIntent).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledTimes(1);
    });

    it("does not retry a request Stripe rejected as invalid", async () => {
      const notFound: Error = Object.assign(
        new Error("No such payment_intent"),
        { statusCode: 404, type: "StripeInvalidRequestError" },
      );
      retrievePaymentIntent.mockRejectedValue(notFound);

      await expect(service.getPaymentIntent(PAYMENT_INTENT_ID)).rejects.toBe(
        notFound,
      );
      expect(retrievePaymentIntent).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    });
  });

  describe("payInvoice", () => {
    it("charges the customer's default card first, not the card that was listed first", async () => {
      const invoice: Invoice = await service.payInvoice(
        CUSTOMER_ID,
        INVOICE_ID,
      );

      expect(invoice.status).toBe("paid");
      expect(payStripeInvoice).toHaveBeenCalledTimes(1);
      expect(payStripeInvoice).toHaveBeenCalledWith(INVOICE_ID, {
        payment_method: NEW_DEFAULT_CARD,
      });
    });

    /*
     * The interactive route (/billing-invoices/pay) asks for this: the
     * cardholder is waiting, and it answers an authentication decline with the
     * PaymentIntent's client secret so they can finish it on the card they
     * chose. Charging a backup card behind their back would move the invoice
     * to a different card and leave the prompt unanswered.
     */
    const interactive: { canSurfaceAuthenticationPrompt: boolean } = {
      canSurfaceAuthenticationPrompt: true,
    };

    it.each([
      "invoice_payment_intent_requires_action",
      "authentication_required",
    ])(
      "does not charge another card when the default card needs authentication (StripeCardError %s)",
      async (code: string) => {
        const authenticationError: Error = stripeLikeError({
          type: "StripeCardError",
          message: "This payment requires additional user action.",
          code,
          statusCode: 402,
        });
        payStripeInvoice.mockRejectedValue(authenticationError);

        await expect(
          service.payInvoice(CUSTOMER_ID, INVOICE_ID, interactive),
        ).rejects.toBe(authenticationError);
        expect(payStripeInvoice).toHaveBeenCalledTimes(1);
        expect(payStripeInvoice).toHaveBeenCalledWith(INVOICE_ID, {
          payment_method: NEW_DEFAULT_CARD,
        });
      },
    );

    it.each([
      "invoice_payment_intent_requires_action",
      "authentication_required",
    ])(
      "does not charge another card for %s when the error carries no type",
      async (code: string) => {
        const authenticationError: Error = Object.assign(
          new Error("Authentication required."),
          { code },
        );
        payStripeInvoice.mockRejectedValue(authenticationError);

        await expect(
          service.payInvoice(CUSTOMER_ID, INVOICE_ID, interactive),
        ).rejects.toBe(authenticationError);
        expect(payStripeInvoice).toHaveBeenCalledTimes(1);
      },
    );

    it("stops failing over as soon as a backup card needs authentication", async () => {
      const declined: Error = stripeLikeError({
        type: "StripeCardError",
        message: "Your card was declined.",
        code: "card_declined",
      });
      const authentication: Error = stripeLikeError({
        type: "StripeCardError",
        message: "Authentication required.",
        code: "authentication_required",
      });
      payStripeInvoice
        .mockRejectedValueOnce(declined)
        .mockRejectedValueOnce(authentication);

      await expect(
        service.payInvoice(CUSTOMER_ID, INVOICE_ID, interactive),
      ).rejects.toBe(authentication);
      expect(payStripeInvoice).toHaveBeenCalledTimes(2);
    });

    /*
     * The unattended callers - generateInvoiceAndChargeCustomer, behind the
     * SMS/call balance recharge and the AI one - have no browser to show an
     * authentication prompt in, and they void the invoice as soon as the
     * payment fails. Refusing to try the customer's other cards there would
     * leave the balance untopped with the authentication impossible to
     * complete anywhere in the product, and paging notifications stop.
     */
    describe("an unattended charge, where no authentication prompt can be shown", () => {
      type AuthenticationDeclineFunction = () => Error;

      const offSessionAuthenticationDecline: AuthenticationDeclineFunction =
        (): Error => {
          return stripeLikeError({
            type: "StripeCardError",
            message:
              "Your card was declined. This payment requires authentication.",
            code: "authentication_required",
            statusCode: 402,
          });
        };

      it.each([
        ["no options at all", undefined],
        [
          "an explicit canSurfaceAuthenticationPrompt: false",
          { canSurfaceAuthenticationPrompt: false },
        ],
      ])(
        "charges the next card on an off-session authentication decline (%s)",
        async (
          _case: string,
          options: { canSurfaceAuthenticationPrompt: boolean } | undefined,
        ) => {
          payStripeInvoice
            .mockRejectedValueOnce(offSessionAuthenticationDecline())
            .mockResolvedValue(stripeInvoice());

          const invoice: Invoice = await service.payInvoice(
            CUSTOMER_ID,
            INVOICE_ID,
            options,
          );

          expect(invoice.id).toBe(INVOICE_ID);
          expect(payStripeInvoice).toHaveBeenCalledTimes(2);
          expect(payStripeInvoice).toHaveBeenNthCalledWith(2, INVOICE_ID, {
            payment_method: OLD_INDIA_CARD,
          });
        },
      );

      it("still refuses to charge a second card when a payment is already waiting on the cardholder", async () => {
        /*
         * invoice_payment_intent_requires_action is not a decline: the invoice
         * has a payment in flight. A second card would be a second debit,
         * unattended or not.
         */
        const requiresAction: Error = stripeLikeError({
          type: "StripeInvalidRequestError",
          message: "This invoice's payment intent requires user action.",
          code: "invoice_payment_intent_requires_action",
          statusCode: 400,
        });
        payStripeInvoice.mockRejectedValue(requiresAction);

        await expect(service.payInvoice(CUSTOMER_ID, INVOICE_ID)).rejects.toBe(
          requiresAction,
        );
        expect(payStripeInvoice).toHaveBeenCalledTimes(1);
      });

      it("reports the last decline when every card asks for authentication", async () => {
        const declines: Array<Error> = [1, 2, 3].map(() => {
          return offSessionAuthenticationDecline();
        });
        payStripeInvoice
          .mockRejectedValueOnce(declines[0])
          .mockRejectedValueOnce(declines[1])
          .mockRejectedValueOnce(declines[2]);

        await expect(service.payInvoice(CUSTOMER_ID, INVOICE_ID)).rejects.toBe(
          declines[2],
        );
        expect(payStripeInvoice).toHaveBeenCalledTimes(3);
      });
    });

    it("still falls back to the next card when the default card is declined", async () => {
      payStripeInvoice
        .mockRejectedValueOnce(
          stripeLikeError({
            type: "StripeCardError",
            message: "Your card was declined.",
            code: "card_declined",
            statusCode: 402,
          }),
        )
        .mockResolvedValue(stripeInvoice());

      const invoice: Invoice = await service.payInvoice(
        CUSTOMER_ID,
        INVOICE_ID,
      );

      expect(invoice.id).toBe(INVOICE_ID);
      expect(payStripeInvoice).toHaveBeenCalledTimes(2);
      expect(payStripeInvoice).toHaveBeenNthCalledWith(1, INVOICE_ID, {
        payment_method: NEW_DEFAULT_CARD,
      });
      expect(payStripeInvoice).toHaveBeenNthCalledWith(2, INVOICE_ID, {
        payment_method: OLD_INDIA_CARD,
      });
    });

    it("still falls back for a declined card that carries a bank decline code", async () => {
      payStripeInvoice
        .mockRejectedValueOnce(
          Object.assign(
            stripeLikeError({
              type: "StripeCardError",
              message: "Your card was declined.",
              code: "card_declined",
            }),
            { decline_code: "do_not_honor" },
          ),
        )
        .mockResolvedValue(stripeInvoice());

      await expect(
        service.payInvoice(CUSTOMER_ID, INVOICE_ID),
      ).resolves.toEqual(expect.objectContaining({ id: INVOICE_ID }));
      expect(payStripeInvoice).toHaveBeenCalledTimes(2);
    });

    it("still falls back for an unusable payment method error", async () => {
      payStripeInvoice
        .mockRejectedValueOnce(
          stripeLikeError({
            type: "StripeInvalidRequestError",
            message: "The payment method is not activated.",
            code: "payment_method_unactivated",
          }),
        )
        .mockResolvedValue(stripeInvoice());

      await service.payInvoice(CUSTOMER_ID, INVOICE_ID);

      expect(payStripeInvoice).toHaveBeenCalledTimes(2);
    });

    it("stops after three declined cards and reports the last decline", async () => {
      const declines: Array<Error> = [1, 2, 3].map((attempt: number) => {
        return stripeLikeError({
          type: "StripeCardError",
          message: `Decline ${attempt}`,
          code: "card_declined",
        });
      });
      payStripeInvoice
        .mockRejectedValueOnce(declines[0])
        .mockRejectedValueOnce(declines[1])
        .mockRejectedValueOnce(declines[2])
        .mockResolvedValue(stripeInvoice());

      await expect(service.payInvoice(CUSTOMER_ID, INVOICE_ID)).rejects.toBe(
        declines[2],
      );
      expect(payStripeInvoice).toHaveBeenCalledTimes(3);
      expect(
        payStripeInvoice.mock.calls.map((call: Array<unknown>) => {
          return (call[1] as { payment_method: string }).payment_method;
        }),
      ).not.toContain(FOURTH_CARD);
    });

    it("rethrows Stripe's pending-payment refusal (stale-card incident) without trying another card", async () => {
      const pendingPayments: Error = stripeLikeError({
        type: "StripeInvalidRequestError",
        message:
          "Invoices with pending payments waiting to clear cannot be paid, voided, or marked uncollectible.",
        statusCode: 400,
      });
      payStripeInvoice.mockRejectedValue(pendingPayments);

      await expect(service.payInvoice(CUSTOMER_ID, INVOICE_ID)).rejects.toBe(
        pendingPayments,
      );
      /*
       * A second card here would be a second charge for an invoice the bank
       * may still settle on the first card.
       */
      expect(payStripeInvoice).toHaveBeenCalledTimes(1);
      expect(payStripeInvoice).toHaveBeenCalledWith(INVOICE_ID, {
        payment_method: NEW_DEFAULT_CARD,
      });
    });

    it("rethrows a connection error without trying another card", async () => {
      const connectionError: Error = stripeLikeError({
        type: "StripeConnectionError",
        message: "An error occurred with our connection to Stripe.",
      });
      payStripeInvoice.mockRejectedValue(connectionError);

      await expect(service.payInvoice(CUSTOMER_ID, INVOICE_ID)).rejects.toBe(
        connectionError,
      );
      expect(payStripeInvoice).toHaveBeenCalledTimes(1);
    });

    it("refuses to pay when the customer has no payment method", async () => {
      listPaymentMethods.mockResolvedValue({ data: [] });

      await expect(service.payInvoice(CUSTOMER_ID, INVOICE_ID)).rejects.toThrow(
        BadDataException,
      );
      await expect(service.payInvoice(CUSTOMER_ID, INVOICE_ID)).rejects.toThrow(
        Errors.BillingService.NO_PAYMENTS_METHODS,
      );
      expect(payStripeInvoice).not.toHaveBeenCalled();
    });

    it("returns an invoice that is still open when the bank has not confirmed the debit", async () => {
      payStripeInvoice.mockResolvedValue(stripeInvoice({ status: "open" }));

      const invoice: Invoice = await service.payInvoice(
        CUSTOMER_ID,
        INVOICE_ID,
      );

      // BillingInvoiceAPI reads the PaymentIntent for this case.
      expect(invoice.status).toBe("open");
      expect(payStripeInvoice).toHaveBeenCalledTimes(1);
    });
  });

  /*
   * The unattended charge behind the SMS/call balance recharge
   * (NotificationService) and the AI one (AIBillingService). Nobody is
   * watching it, and a failure voids the invoice - so a card that asks for
   * authentication must not end the attempt: the top-up would never happen
   * and, the invoice being void, the customer would have nowhere in the
   * product to authenticate it either. Paging stops until somebody reads the
   * "recharge failed" email.
   */
  describe("generateInvoiceAndChargeCustomer", () => {
    it("charges the customer's next card when the default one asks for authentication off-session", async () => {
      payStripeInvoice
        .mockRejectedValueOnce(
          stripeLikeError({
            type: "StripeCardError",
            message: "Your card was declined. Authentication is required.",
            code: "authentication_required",
            statusCode: 402,
          }),
        )
        .mockResolvedValue(stripeInvoice());

      await expect(
        service.generateInvoiceAndChargeCustomer(
          CUSTOMER_ID,
          "SMS and Call Balance Recharge",
          20,
        ),
      ).resolves.toBeUndefined();

      expect(payStripeInvoice).toHaveBeenCalledTimes(2);
      expect(payStripeInvoice).toHaveBeenNthCalledWith(1, INVOICE_ID, {
        payment_method: NEW_DEFAULT_CARD,
      });
      expect(payStripeInvoice).toHaveBeenNthCalledWith(2, INVOICE_ID, {
        payment_method: OLD_INDIA_CARD,
      });
      // The balance was topped up, so nothing is voided.
      expect(voidInvoice).not.toHaveBeenCalled();
    });

    it("voids the invoice only after every card has been tried", async () => {
      const decline: Error = stripeLikeError({
        type: "StripeCardError",
        message: "Your card was declined. Authentication is required.",
        code: "authentication_required",
        statusCode: 402,
      });
      payStripeInvoice.mockRejectedValue(decline);

      await expect(
        service.generateInvoiceAndChargeCustomer(
          CUSTOMER_ID,
          "SMS and Call Balance Recharge",
          20,
        ),
      ).rejects.toBe(decline);

      expect(payStripeInvoice).toHaveBeenCalledTimes(3);
      expect(voidInvoice).toHaveBeenCalledWith(INVOICE_ID);
    });
  });
});
