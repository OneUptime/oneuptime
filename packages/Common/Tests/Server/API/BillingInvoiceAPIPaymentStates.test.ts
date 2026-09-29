import BillingInvoiceAPI from "../../../Server/API/BillingInvoiceAPI";
import BillingInvoiceService from "../../../Server/Services/BillingInvoiceService";
import BillingService, {
  Invoice,
  PaymentIntentState,
} from "../../../Server/Services/BillingService";
import ProjectService from "../../../Server/Services/ProjectService";
import {
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import { getJestSpyOn } from "../../Spy";
import { beforeEach, describe, expect, it } from "@jest/globals";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import BillingInvoice, {
  InvoiceStatus,
} from "../../../Models/DatabaseModels/BillingInvoice";
import Project from "../../../Models/DatabaseModels/Project";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
  };
});

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    IsBillingEnabled: true,
  };
});

jest.mock("../../../Server/Services/BillingInvoiceService");
jest.mock("../../../Server/Services/BillingService");
jest.mock("../../../Server/Services/ProjectService");

/*
 * The stale-card incident, as it reached this route: the September invoice's
 * automatic charge on an India-issued card sat in "processing" for ~26 hours
 * (e-mandate pre-debit) while the customer added a new card and pressed
 * "Pay Invoice" ten times. Stripe refused every invoices.pay with the error
 * below, the route answered with the client secret of the processing
 * PaymentIntent anyway, and the browser's confirmCardPayment on it failed with
 * "A processing error occurred."
 */
const CUSTOMER_ID: string = "cus_stale_card_customer";
const INVOICE_ID: string = "in_stale_card_invoice";
const PAYMENT_INTENT_ID: string = "pi_stale_card_invoice";
const OLD_INDIA_CARD: string = "pm_replaced_card";
const CLIENT_SECRET: string = "pi_stale_card_invoice_secret_abc";
const PENDING_PAYMENTS_MESSAGE: string =
  "Invoices with pending payments waiting to clear cannot be paid, voided, or marked uncollectible.";
const UPDATE_PAYMENT_METHOD_SUFFIX: string =
  " Please update your payment method in Project Settings > Billing and try again.";

type StripeLikeErrorFunction = (data: {
  type: string;
  message: string;
  code?: string;
  declineCode?: string;
  statusCode?: number;
}) => Error;

// The fields BillingInvoiceAPI reads off a Stripe SDK error.
const stripeLikeError: StripeLikeErrorFunction = (data: {
  type: string;
  message: string;
  code?: string;
  declineCode?: string;
  statusCode?: number;
}): Error => {
  return Object.assign(new Error(data.message), {
    type: data.type,
    code: data.code,
    decline_code: data.declineCode,
    statusCode: data.statusCode,
  });
};

type ErrorFactory = () => Error;

const pendingPaymentsError: ErrorFactory = (): Error => {
  return stripeLikeError({
    type: "StripeInvalidRequestError",
    message: PENDING_PAYMENTS_MESSAGE,
    statusCode: 400,
  });
};

const cardDeclinedError: ErrorFactory = (): Error => {
  return stripeLikeError({
    type: "StripeCardError",
    message: "Your card was declined.",
    code: "card_declined",
    declineCode: "do_not_honor",
    statusCode: 402,
  });
};

type OpenInvoiceFunction = (overrides?: Partial<Invoice>) => Invoice;

const invoiceWith: OpenInvoiceFunction = (
  overrides?: Partial<Invoice>,
): Invoice => {
  return {
    id: INVOICE_ID,
    amount: 101,
    currencyCode: "usd",
    status: InvoiceStatus.Open,
    downloadableLink: "",
    customerId: CUSTOMER_ID,
    invoiceDate: new Date("2026-09-12T00:00:00Z"),
    invoiceNumber: "SCAP-0009",
    paymentIntentId: PAYMENT_INTENT_ID,
    ...overrides,
  };
};

type PaymentIntentFunction = (
  overrides?: Partial<PaymentIntentState>,
) => PaymentIntentState;

const paymentIntentWith: PaymentIntentFunction = (
  overrides?: Partial<PaymentIntentState>,
): PaymentIntentState => {
  return {
    id: PAYMENT_INTENT_ID,
    status: "processing",
    clientSecret: CLIENT_SECRET,
    paymentMethodId: OLD_INDIA_CARD,
    lastPaymentErrorMessage: undefined,
    ...overrides,
  };
};

describe("BillingInvoiceAPI POST /billing-invoices/pay payment states", () => {
  let mockRequest: OneUptimeRequest;
  let mockResponse: OneUptimeResponse;
  let nextFunction: jest.Mock;

  const projectId: ObjectID = ObjectID.generate();
  let project: Project;

  let payInvoice: jest.Mock;
  let getInvoice: jest.Mock;
  let getPaymentIntent: jest.Mock;
  let getPaymentIntentClientSecret: jest.Mock;
  let syncSubscriptionPaymentMethods: jest.Mock;
  let updateOneBy: jest.Mock;
  let refreshSubscriptionStatus: jest.Mock;
  let loggerError: jest.SpyInstance;

  type CallPayFunction = () => Promise<void>;

  const callPay: CallPayFunction = async (): Promise<void> => {
    await mockRouter
      .match("post", "/billing-invoices/pay")
      .handlerFunction(mockRequest, mockResponse, nextFunction);
  };

  type ExpectNothingChargedOrSavedFunction = () => void;

  const expectNoStatusChange: ExpectNothingChargedOrSavedFunction =
    (): void => {
      expect(updateOneBy).not.toHaveBeenCalled();
      expect(refreshSubscriptionStatus).not.toHaveBeenCalled();
      expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
    };

  type ExpectRespondedFunction = (body: Record<string, unknown>) => void;

  const expectRespondedWith: ExpectRespondedFunction = (
    body: Record<string, unknown>,
  ): void => {
    expect(nextFunction).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
      mockRequest,
      mockResponse,
      body,
    );
  };

  type NextErrorFunction = () => unknown;

  const nextError: NextErrorFunction = (): unknown => {
    expect(nextFunction).toHaveBeenCalledTimes(1);
    return nextFunction.mock.calls[0]![0];
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();

    new BillingInvoiceAPI();

    project = new Project();
    project.id = projectId;
    project.paymentProviderCustomerId = CUSTOMER_ID;
    project.paymentProviderSubscriptionId = "sub_stale_card_plan";
    project.paymentProviderMeteredSubscriptionId = "sub_pinned_metered";

    jest
      .spyOn(BillingInvoiceAPI.prototype, "getPermissionsForTenant")
      .mockResolvedValue([
        {
          permission: Permission.ProjectOwner,
        } as UserPermission,
      ]);

    loggerError = getJestSpyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });

    ProjectService.findOneById = jest.fn().mockResolvedValue(project);
    BillingInvoiceService.findOneBy = jest
      .fn()
      .mockResolvedValue(new BillingInvoice());

    updateOneBy = jest.fn().mockResolvedValue(undefined);
    BillingInvoiceService.updateOneBy = updateOneBy;
    refreshSubscriptionStatus = jest.fn().mockResolvedValue(undefined);
    BillingInvoiceService.refreshSubscriptionStatus = refreshSubscriptionStatus;

    payInvoice = jest
      .fn()
      .mockResolvedValue(invoiceWith({ status: InvoiceStatus.Paid }));
    BillingService.payInvoice = payInvoice;
    getInvoice = jest.fn().mockResolvedValue(invoiceWith());
    BillingService.getInvoice = getInvoice;
    getPaymentIntent = jest.fn().mockResolvedValue(paymentIntentWith());
    BillingService.getPaymentIntent = getPaymentIntent;
    getPaymentIntentClientSecret = jest.fn().mockResolvedValue(CLIENT_SECRET);
    BillingService.getPaymentIntentClientSecret = getPaymentIntentClientSecret;
    syncSubscriptionPaymentMethods = jest.fn().mockResolvedValue([]);
    BillingService.syncSubscriptionPaymentMethodsWithCustomerDefault =
      syncSubscriptionPaymentMethods;

    mockRequest = {
      tenantId: projectId,
      body: {
        data: {
          paymentProviderInvoiceId: INVOICE_ID,
          paymentProviderCustomerId: CUSTOMER_ID,
        },
      },
    } as unknown as OneUptimeRequest;
    mockResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as OneUptimeResponse;
    nextFunction = jest.fn();
  });

  describe("a payment for the invoice is still with the bank (stale-card incident)", () => {
    beforeEach(() => {
      payInvoice.mockRejectedValue(pendingPaymentsError());
      getInvoice.mockResolvedValue(invoiceWith());
      getPaymentIntent.mockResolvedValue(paymentIntentWith());
    });

    it("tells the browser the payment is processing instead of handing out the processing PaymentIntent's client secret", async () => {
      await callPay();

      expectRespondedWith({ paymentProcessing: true });
      expect(payInvoice).toHaveBeenCalledTimes(1);
      /*
       * The cardholder is waiting on this request, so the service is told it
       * may stop at a card that needs authentication - this route answers
       * that with the client secret rather than charging a backup card. The
       * unattended recharge paths leave the flag off and keep their failover.
       */
      expect(payInvoice).toHaveBeenCalledWith(CUSTOMER_ID, INVOICE_ID, {
        canSurfaceAuthenticationPrompt: true,
      });
      expect(getInvoice).toHaveBeenCalledWith(CUSTOMER_ID, INVOICE_ID);
      expect(getPaymentIntent).toHaveBeenCalledWith(PAYMENT_INTENT_ID);

      // The client secret of a processing PaymentIntent must never leave.
      expect(getPaymentIntentClientSecret).not.toHaveBeenCalled();
      expect(
        JSON.stringify(
          (Response.sendJsonObjectResponse as jest.Mock).mock.calls,
        ),
      ).not.toContain(CLIENT_SECRET);
      expectNoStatusChange();
    });

    it("moves future autopay off the stale pinned card while the old card's debit is processing", async () => {
      await callPay();

      expect(syncSubscriptionPaymentMethods).toHaveBeenCalledTimes(1);
      expect(syncSubscriptionPaymentMethods).toHaveBeenCalledWith(CUSTOMER_ID);
    });

    it("answers every one of ten repeated clicks the same way and never tries another charge per click", async () => {
      for (let click: number = 0; click < 10; click++) {
        await callPay();
      }

      expect(nextFunction).not.toHaveBeenCalled();
      expect(payInvoice).toHaveBeenCalledTimes(10);
      expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(10);
      for (const call of (Response.sendJsonObjectResponse as jest.Mock).mock
        .calls) {
        expect(call[2]).toEqual({ paymentProcessing: true });
      }
      expectNoStatusChange();
    });

    it("still reports processing when the PaymentIntent cannot be read, because Stripe said a payment is pending", async () => {
      getPaymentIntent.mockRejectedValue(
        Object.assign(new Error("Stripe HTTP 500"), { statusCode: 500 }),
      );

      await callPay();

      expectRespondedWith({ paymentProcessing: true });
      expect(loggerError).toHaveBeenCalled();
      expectNoStatusChange();
    });

    it("still reports processing when the open invoice has no PaymentIntent id", async () => {
      getInvoice.mockResolvedValue(invoiceWith({ paymentIntentId: undefined }));

      await callPay();

      expectRespondedWith({ paymentProcessing: true });
      expect(getPaymentIntent).not.toHaveBeenCalled();
    });

    it("recognises the pending-payment refusal regardless of the invoice PaymentIntent's own state", async () => {
      // The pending payment can be a different one from invoice.payment_intent.
      getPaymentIntent.mockResolvedValue(
        paymentIntentWith({ status: "requires_payment_method" }),
      );

      await callPay();

      expectRespondedWith({ paymentProcessing: true });
    });

    it("reports processing whatever error the pay call raised when the PaymentIntent is processing", async () => {
      payInvoice.mockRejectedValue(cardDeclinedError());

      await callPay();

      expectRespondedWith({ paymentProcessing: true });
    });

    it("does not fail the request when clearing the stale pinned card fails", async () => {
      const syncFailure: Error = new Error("Stripe subscription update failed");
      syncSubscriptionPaymentMethods.mockRejectedValue(syncFailure);

      await callPay();

      expectRespondedWith({ paymentProcessing: true });
      expect(loggerError).toHaveBeenCalledWith(
        syncFailure,
        expect.objectContaining({ projectId: projectId.toString() }),
      );
    });
  });

  describe("the cardholder has to authenticate", () => {
    it.each(["requires_action", "requires_confirmation"] as const)(
      "returns the client secret when the PaymentIntent is %s",
      async (status: "requires_action" | "requires_confirmation") => {
        payInvoice.mockRejectedValue(
          stripeLikeError({
            type: "StripeCardError",
            message: "This payment requires additional user action.",
            code: "invoice_payment_intent_requires_action",
          }),
        );
        getPaymentIntent.mockResolvedValue(paymentIntentWith({ status }));

        await callPay();

        expectRespondedWith({ clientSecret: CLIENT_SECRET });
        expectNoStatusChange();
        expect(syncSubscriptionPaymentMethods).not.toHaveBeenCalled();
      },
    );

    it("uses the PaymentIntent's own client secret, not a separately fetched one", async () => {
      payInvoice.mockRejectedValue(
        stripeLikeError({
          type: "StripeCardError",
          message: "Authentication required.",
          code: "authentication_required",
        }),
      );
      getPaymentIntent.mockResolvedValue(
        paymentIntentWith({
          status: "requires_action",
          clientSecret: "pi_other_secret",
        }),
      );

      await callPay();

      expectRespondedWith({ clientSecret: "pi_other_secret" });
      expect(getPaymentIntentClientSecret).not.toHaveBeenCalled();
    });

    it("explains the problem instead of sending an empty client secret", async () => {
      payInvoice.mockRejectedValue(
        stripeLikeError({
          type: "StripeCardError",
          message: "Authentication required.",
          code: "authentication_required",
        }),
      );
      getPaymentIntent.mockResolvedValue(
        paymentIntentWith({
          status: "requires_action",
          clientSecret: undefined,
        }),
      );

      await callPay();

      const error: unknown = nextError();
      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toContain(
        "needs to be confirmed with your bank",
      );
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });
  });

  describe("the payment failed", () => {
    it("reports the card decline in words the customer can act on", async () => {
      payInvoice.mockRejectedValue(cardDeclinedError());
      getPaymentIntent.mockResolvedValue(
        paymentIntentWith({
          status: "requires_payment_method",
          lastPaymentErrorMessage: "Your card was declined.",
        }),
      );

      await callPay();

      expect(nextFunction).toHaveBeenCalledWith(
        new BadDataException(
          `Your payment could not be completed: Your card was declined.${UPDATE_PAYMENT_METHOD_SUFFIX}`,
        ),
      );
      expect(nextError()).toBeInstanceOf(BadDataException);
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
      expect(getPaymentIntentClientSecret).not.toHaveBeenCalled();
      expectNoStatusChange();
      expect(syncSubscriptionPaymentMethods).not.toHaveBeenCalled();
    });

    it("prefers the pay call's own decline message over the PaymentIntent's older one", async () => {
      payInvoice.mockRejectedValue(
        stripeLikeError({
          type: "StripeCardError",
          message: "Your card has insufficient funds.",
          code: "card_declined",
        }),
      );
      getPaymentIntent.mockResolvedValue(
        paymentIntentWith({
          status: "requires_payment_method",
          lastPaymentErrorMessage: "Your card was declined.",
        }),
      );

      await callPay();

      expect((nextError() as Error).message).toBe(
        `Your payment could not be completed: Your card has insufficient funds.${UPDATE_PAYMENT_METHOD_SUFFIX}`,
      );
    });

    it("falls back to the PaymentIntent's last payment error when Stripe's error has no message", async () => {
      payInvoice.mockRejectedValue(
        stripeLikeError({ type: "StripeCardError", message: "" }),
      );
      getPaymentIntent.mockResolvedValue(
        paymentIntentWith({
          status: "requires_payment_method",
          lastPaymentErrorMessage: "Your card has expired.",
        }),
      );

      await callPay();

      expect((nextError() as Error).message).toBe(
        `Your payment could not be completed: Your card has expired.${UPDATE_PAYMENT_METHOD_SUFFIX}`,
      );
    });

    it("uses a generic provider message when neither Stripe nor the PaymentIntent explains the failure", async () => {
      payInvoice.mockRejectedValue(
        stripeLikeError({ type: "StripeCardError", message: "" }),
      );
      getPaymentIntent.mockResolvedValue(
        paymentIntentWith({ status: "requires_payment_method" }),
      );

      await callPay();

      expect((nextError() as Error).message).toBe(
        `Your payment could not be completed: The payment provider did not accept this payment.${UPDATE_PAYMENT_METHOD_SUFFIX}`,
      );
    });

    it("ends a provider message that lacks punctuation with a full stop before the advice", async () => {
      payInvoice.mockRejectedValue(
        stripeLikeError({
          type: "StripeCardError",
          message: "Your card does not support this type of purchase",
        }),
      );
      getPaymentIntent.mockResolvedValue(
        paymentIntentWith({ status: "requires_payment_method" }),
      );

      await callPay();

      expect((nextError() as Error).message).toBe(
        `Your payment could not be completed: Your card does not support this type of purchase.${UPDATE_PAYMENT_METHOD_SUFFIX}`,
      );
    });

    it("reports a canceled PaymentIntent as a failed payment", async () => {
      payInvoice.mockRejectedValue(
        stripeLikeError({
          type: "StripeInvalidRequestError",
          message: "This PaymentIntent has been canceled.",
        }),
      );
      getPaymentIntent.mockResolvedValue(
        paymentIntentWith({ status: "canceled" }),
      );

      await callPay();

      const error: unknown = nextError();
      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toContain(
        "This PaymentIntent has been canceled.",
      );
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });

    it("reports the decline after the bank finally refused the stale-card debit (do_not_honor)", async () => {
      /*
       * 26 hours later the processing debit declined. The PaymentIntent is
       * back to requires_payment_method and must not be confirmed in the
       * browser against a card the customer did not pick.
       */
      payInvoice.mockRejectedValue(cardDeclinedError());
      getPaymentIntent.mockResolvedValue(
        paymentIntentWith({
          status: "requires_payment_method",
          lastPaymentErrorMessage: "Your card was declined.",
        }),
      );

      await callPay();

      expect(nextError()).toBeInstanceOf(BadDataException);
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });

    it("reports the decline when an open invoice has no PaymentIntent", async () => {
      payInvoice.mockRejectedValue(cardDeclinedError());
      getInvoice.mockResolvedValue(invoiceWith({ paymentIntentId: undefined }));

      await callPay();

      expect((nextError() as Error).message).toBe(
        `Your payment could not be completed: Your card was declined.${UPDATE_PAYMENT_METHOD_SUFFIX}`,
      );
      expect(getPaymentIntent).not.toHaveBeenCalled();
    });

    it("reports the decline, not an opaque server error, when the PaymentIntent cannot be read", async () => {
      payInvoice.mockRejectedValue(cardDeclinedError());
      getPaymentIntent.mockRejectedValue(new Error("socket hang up"));

      await callPay();

      const error: unknown = nextError();
      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toContain("Your card was declined.");
    });

    it("reports Stripe's decline when the invoice itself cannot be read back", async () => {
      const originalError: Error = cardDeclinedError();
      payInvoice.mockRejectedValue(originalError);
      getInvoice.mockRejectedValue(new Error("Stripe HTTP 503"));

      await callPay();

      const error: unknown = nextError();
      expect(error).toBeInstanceOf(BadDataException);
      expect(error).not.toBe(originalError);
      expect((error as Error).message).toBe("Your card was declined.");
      expect(loggerError).toHaveBeenCalled();
    });
  });

  describe("the invoice settled between the page loading and the click", () => {
    it("treats an invoice Stripe already reports paid as a successful payment", async () => {
      payInvoice.mockRejectedValue(
        stripeLikeError({
          type: "StripeInvalidRequestError",
          message: "Invoice is already paid",
        }),
      );
      getInvoice.mockResolvedValue(invoiceWith({ status: InvoiceStatus.Paid }));

      await callPay();

      expect(nextFunction).not.toHaveBeenCalled();
      expect(getPaymentIntent).not.toHaveBeenCalled();
      expect(updateOneBy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: {
            projectId: projectId,
            paymentProviderInvoiceId: INVOICE_ID,
          },
          data: { status: InvoiceStatus.Paid },
        }),
      );
      expect(refreshSubscriptionStatus).toHaveBeenCalledWith({
        projectId: projectId,
      });
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
      );
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
      expect(syncSubscriptionPaymentMethods).toHaveBeenCalledWith(CUSTOMER_ID);
    });

    it("treats a succeeded PaymentIntent on a still-open invoice as paid", async () => {
      payInvoice.mockRejectedValue(pendingPaymentsError());
      getPaymentIntent.mockResolvedValue(
        paymentIntentWith({ status: "succeeded" }),
      );

      await callPay();

      expect(nextFunction).not.toHaveBeenCalled();
      expect(updateOneBy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: InvoiceStatus.Paid },
        }),
      );
      expect(refreshSubscriptionStatus).toHaveBeenCalledTimes(1);
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
      expect(syncSubscriptionPaymentMethods).toHaveBeenCalledWith(CUSTOMER_ID);
    });
  });

  describe("the invoice can no longer be paid", () => {
    it.each([
      InvoiceStatus.Void,
      InvoiceStatus.Uncollectible,
      InvoiceStatus.Draft,
    ])(
      "turns Stripe's refusal for a %s invoice into a readable error instead of a raw StripeError",
      async (status: InvoiceStatus) => {
        const providerError: Error = stripeLikeError({
          type: "StripeInvalidRequestError",
          message: `This invoice is ${status} and cannot be paid.`,
          statusCode: 400,
        });
        payInvoice.mockRejectedValue(providerError);
        getInvoice.mockResolvedValue(invoiceWith({ status }));

        await callPay();

        const error: unknown = nextError();
        expect(error).toBeInstanceOf(BadDataException);
        expect(error).not.toBe(providerError);
        expect((error as Error).message).toBe(
          `This invoice is ${status} and cannot be paid.`,
        );
        expect(getPaymentIntent).not.toHaveBeenCalled();
        expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
        expectNoStatusChange();
        expect(syncSubscriptionPaymentMethods).not.toHaveBeenCalled();
      },
    );

    it("does not report processing for a void invoice even if Stripe mentions pending payments", async () => {
      payInvoice.mockRejectedValue(pendingPaymentsError());
      getInvoice.mockResolvedValue(invoiceWith({ status: InvoiceStatus.Void }));

      await callPay();

      expect((nextError() as Error).message).toBe(PENDING_PAYMENTS_MESSAGE);
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });
  });

  describe("errors that did not come from the payment provider", () => {
    it("rethrows OneUptime's own error unchanged", async () => {
      const noPaymentMethods: BadDataException = new BadDataException(
        "No payment methods added. Please add your card to this project to pay this invoice.",
      );
      payInvoice.mockRejectedValue(noPaymentMethods);
      getPaymentIntent.mockResolvedValue(
        paymentIntentWith({ status: "requires_payment_method" }),
      );

      await callPay();

      expect(nextError()).toBe(noPaymentMethods);
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });

    it("rethrows an unknown error without a type unchanged", async () => {
      const unknownError: Error = new Error("Something unexpected");
      payInvoice.mockRejectedValue(unknownError);
      getPaymentIntent.mockResolvedValue(
        paymentIntentWith({ status: "requires_payment_method" }),
      );

      await callPay();

      expect(nextError()).toBe(unknownError);
    });

    it("rethrows an error whose type is not a Stripe error type unchanged", async () => {
      const otherError: Error = Object.assign(new Error("Not Stripe"), {
        type: "SomethingElse",
      });
      payInvoice.mockRejectedValue(otherError);
      getInvoice.mockResolvedValue(invoiceWith({ status: InvoiceStatus.Void }));

      await callPay();

      expect(nextError()).toBe(otherError);
    });

    it("rethrows the original error when the invoice cannot be read back", async () => {
      const unknownError: Error = new Error("Something unexpected");
      payInvoice.mockRejectedValue(unknownError);
      getInvoice.mockRejectedValue(new Error("Stripe HTTP 503"));

      await callPay();

      expect(nextError()).toBe(unknownError);
    });

    it("still reports a processing payment even when the pay call failed for a non-provider reason", async () => {
      payInvoice.mockRejectedValue(new Error("provider read timed out"));
      getPaymentIntent.mockResolvedValue(paymentIntentWith());

      await callPay();

      expectRespondedWith({ paymentProcessing: true });
    });
  });

  describe("invoices.pay resolved", () => {
    it("reports processing when the invoice is still open because its PaymentIntent is processing", async () => {
      payInvoice.mockResolvedValue(invoiceWith({ status: InvoiceStatus.Open }));
      getPaymentIntent.mockResolvedValue(paymentIntentWith());

      await callPay();

      expectRespondedWith({ paymentProcessing: true });
      expect(getInvoice).toHaveBeenCalledWith(CUSTOMER_ID, INVOICE_ID);
      expect(getPaymentIntent).toHaveBeenCalledWith(PAYMENT_INTENT_ID);
      expectNoStatusChange();
      expect(syncSubscriptionPaymentMethods).toHaveBeenCalledWith(CUSTOMER_ID);
    });

    it("returns the client secret when the resolved invoice is open and its PaymentIntent needs authentication", async () => {
      payInvoice.mockResolvedValue(invoiceWith({ status: InvoiceStatus.Open }));
      getPaymentIntent.mockResolvedValue(
        paymentIntentWith({ status: "requires_action" }),
      );

      await callPay();

      expectRespondedWith({ clientSecret: CLIENT_SECRET });
      expectNoStatusChange();
    });

    it("keeps the existing success path for an open invoice whose PaymentIntent is in any other state", async () => {
      payInvoice.mockResolvedValue(invoiceWith({ status: InvoiceStatus.Open }));
      getPaymentIntent.mockResolvedValue(
        paymentIntentWith({ status: "requires_payment_method" }),
      );

      await callPay();

      expect(nextFunction).not.toHaveBeenCalled();
      expect(updateOneBy).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: InvoiceStatus.Open } }),
      );
      expect(refreshSubscriptionStatus).toHaveBeenCalledTimes(1);
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
      // Not paid and not processing: nothing to move autopay onto yet.
      expect(syncSubscriptionPaymentMethods).not.toHaveBeenCalled();
    });

    it("does not fail a payment Stripe accepted because the follow-up invoice read failed", async () => {
      payInvoice.mockResolvedValue(invoiceWith({ status: InvoiceStatus.Open }));
      getInvoice.mockRejectedValue(new Error("Stripe HTTP 503"));

      await callPay();

      expect(nextFunction).not.toHaveBeenCalled();
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
      expect(loggerError).toHaveBeenCalled();
    });

    it("does not fail a payment Stripe accepted because the PaymentIntent read failed", async () => {
      payInvoice.mockResolvedValue(invoiceWith({ status: InvoiceStatus.Open }));
      getPaymentIntent.mockRejectedValue(new Error("Stripe HTTP 503"));

      await callPay();

      expect(nextFunction).not.toHaveBeenCalled();
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    });

    it("skips the PaymentIntent read when the resolved open invoice has none", async () => {
      payInvoice.mockResolvedValue(invoiceWith({ status: InvoiceStatus.Open }));
      getInvoice.mockResolvedValue(invoiceWith({ paymentIntentId: undefined }));

      await callPay();

      expect(getPaymentIntent).not.toHaveBeenCalled();
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    });

    it("does not read the invoice again when invoices.pay returned it paid", async () => {
      await callPay();

      expect(getInvoice).not.toHaveBeenCalled();
      expect(getPaymentIntent).not.toHaveBeenCalled();
      expect(updateOneBy).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: InvoiceStatus.Paid } }),
      );
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    });

    it("clears the stale pinned card after refreshing the subscription, so a recreated subscription is covered too", async () => {
      await callPay();

      expect(refreshSubscriptionStatus).toHaveBeenCalledTimes(1);
      expect(syncSubscriptionPaymentMethods).toHaveBeenCalledTimes(1);
      expect(syncSubscriptionPaymentMethods).toHaveBeenCalledWith(CUSTOMER_ID);
      expect(
        refreshSubscriptionStatus.mock.invocationCallOrder[0]!,
      ).toBeLessThan(
        syncSubscriptionPaymentMethods.mock.invocationCallOrder[0]!,
      );
    });

    it("still succeeds when clearing the stale pinned card fails after a paid invoice", async () => {
      const syncFailure: Error = new Error("Stripe subscription update failed");
      syncSubscriptionPaymentMethods.mockRejectedValue(syncFailure);

      await callPay();

      expect(nextFunction).not.toHaveBeenCalled();
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
      expect(loggerError).toHaveBeenCalledWith(
        syncFailure,
        expect.objectContaining({ projectId: projectId.toString() }),
      );
    });

    it("still clears the stale pinned card when the subscription refresh fails, and reports the refresh failure", async () => {
      const refreshFailure: Error = new Error("refresh failed");
      refreshSubscriptionStatus.mockRejectedValue(refreshFailure);

      await callPay();

      expect(syncSubscriptionPaymentMethods).toHaveBeenCalledWith(CUSTOMER_ID);
      expect(nextError()).toBe(refreshFailure);
      expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
    });
  });

  describe("security checks still run before anything is charged", () => {
    it("rejects a projectId in the body", async () => {
      mockRequest.body["projectId"] = ObjectID.generate().toString();

      await callPay();

      expect(nextError()).toBeInstanceOf(BadDataException);
      expect(payInvoice).not.toHaveBeenCalled();
      expect(getPaymentIntent).not.toHaveBeenCalled();
      expect(syncSubscriptionPaymentMethods).not.toHaveBeenCalled();
    });

    it("rejects a caller without ProjectOwner or EditInvoices", async () => {
      jest
        .spyOn(BillingInvoiceAPI.prototype, "getPermissionsForTenant")
        .mockResolvedValue([
          { permission: Permission.ProjectMember } as UserPermission,
        ]);

      await callPay();

      expect((nextError() as Error).message).toContain(
        "permission to pay invoices",
      );
      expect(payInvoice).not.toHaveBeenCalled();
      expect(syncSubscriptionPaymentMethods).not.toHaveBeenCalled();
    });

    it("lets a master admin pay without project permissions", async () => {
      jest
        .spyOn(BillingInvoiceAPI.prototype, "getPermissionsForTenant")
        .mockResolvedValue([]);
      (mockRequest as unknown as Record<string, unknown>)["userAuthorization"] =
        { isMasterAdmin: true };

      await callPay();

      expect(nextFunction).not.toHaveBeenCalled();
      expect(payInvoice).toHaveBeenCalledWith(CUSTOMER_ID, INVOICE_ID, {
        canSurfaceAuthenticationPrompt: true,
      });
    });

    it("never reads another tenant's PaymentIntent when the customer id does not match", async () => {
      mockRequest.body["data"] = {
        paymentProviderInvoiceId: INVOICE_ID,
        paymentProviderCustomerId: "cus_victim_tenant",
      };

      await callPay();

      expect(nextFunction).toHaveBeenCalledWith(
        new BadDataException("Customer ID does not belong to this project"),
      );
      expect(payInvoice).not.toHaveBeenCalled();
      expect(getInvoice).not.toHaveBeenCalled();
      expect(getPaymentIntent).not.toHaveBeenCalled();
    });

    it("never reads the PaymentIntent of an invoice outside the project", async () => {
      BillingInvoiceService.findOneBy = jest.fn().mockResolvedValue(null);

      await callPay();

      expect(nextFunction).toHaveBeenCalledWith(
        new BadDataException("Invoice not found for this project"),
      );
      expect(payInvoice).not.toHaveBeenCalled();
      expect(getInvoice).not.toHaveBeenCalled();
      expect(getPaymentIntent).not.toHaveBeenCalled();
    });
  });
});
