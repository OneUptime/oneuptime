import { IsBillingEnabled } from "../EnvironmentConfig";
import UserMiddleware from "../Middleware/UserAuthorization";
import BillingInvoiceService, {
  Service as BillingInvoiceServiceType,
} from "../Services/BillingInvoiceService";
import BillingService, {
  Invoice,
  PaymentIntentState,
} from "../Services/BillingService";
import ProjectService from "../Services/ProjectService";
import logger, { LogAttributes } from "../Utils/Logger";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission, { UserPermission } from "../../Types/Permission";
import BillingInvoice, {
  InvoiceStatus,
} from "../../Models/DatabaseModels/BillingInvoice";
import Project from "../../Models/DatabaseModels/Project";

/*
 * What the customer should see after a pay attempt, once Stripe's view of the
 * invoice has been read back.
 */
type PayInvoiceOutcome =
  | { kind: "paid"; status: InvoiceStatus }
  | { kind: "processing" }
  | { kind: "requiresAction"; clientSecret: string };

/*
 * The only PaymentIntent states the browser can move forward: a 3-D Secure or
 * bank authentication prompt, or a confirmation Stripe.js has to send. Handing
 * out the client secret of a PaymentIntent in any other state only gets the
 * customer an opaque Stripe.js error.
 */
const PAYMENT_INTENT_STATUSES_NEEDING_CUSTOMER: Array<
  PaymentIntentState["status"]
> = ["requires_action", "requires_confirmation"];

/*
 * Stripe's refusal of invoices.pay while an earlier debit has not cleared
 * ("Invoices with pending payments waiting to clear cannot be paid, ..."). It
 * arrives as a plain invalid_request_error with no dedicated code, so the
 * message is the only signal.
 */
const PENDING_PAYMENT_REFUSAL: RegExp = /pending payments? waiting to clear/i;

const ENDS_WITH_PUNCTUATION: RegExp = /[.!?]$/;

interface PaymentProviderError {
  type: string;
  code?: string | undefined;
  message?: string | undefined;
}

type IsPaymentProviderErrorFunction = (
  err: unknown,
) => err is PaymentProviderError;

// Stripe SDK errors carry a type such as StripeCardError.
const isPaymentProviderError: IsPaymentProviderErrorFunction = (
  err: unknown,
): err is PaymentProviderError => {
  const type: unknown = (err as { type?: unknown } | null)?.type;

  return typeof type === "string" && type.startsWith("Stripe");
};

type IsPendingPaymentRefusalFunction = (err: unknown) => boolean;

const isPendingPaymentRefusal: IsPendingPaymentRefusalFunction = (
  err: unknown,
): boolean => {
  return (
    isPaymentProviderError(err) &&
    PENDING_PAYMENT_REFUSAL.test(err.message || "")
  );
};

interface ToPayInvoiceErrorData {
  paymentError: unknown;
  paymentIntent?: PaymentIntentState | null | undefined;
  suggestNewPaymentMethod?: boolean | undefined;
}

type ToPayInvoiceErrorFunction = (data: ToPayInvoiceErrorData) => unknown;

/*
 * A raw StripeError reaching the error handler becomes an opaque 500
 * "Server Error", so provider errors are turned into a message the customer
 * can act on. Anything that is not a provider error is already one of ours
 * (no payment method, provider unreachable) and is passed through untouched.
 */
const toPayInvoiceError: ToPayInvoiceErrorFunction = (
  data: ToPayInvoiceErrorData,
): unknown => {
  if (!isPaymentProviderError(data.paymentError)) {
    return data.paymentError;
  }

  const providerMessage: string =
    (
      data.paymentError.message ||
      data.paymentIntent?.lastPaymentErrorMessage ||
      ""
    ).trim() || "The payment provider did not accept this payment.";

  if (!data.suggestNewPaymentMethod) {
    return new BadDataException(providerMessage);
  }

  const sentence: string = ENDS_WITH_PUNCTUATION.test(providerMessage)
    ? providerMessage
    : `${providerMessage}.`;

  return new BadDataException(
    `Your payment could not be completed: ${sentence} Please update your payment method in Project Settings > Billing and try again.`,
  );
};

export default class UserAPI extends BaseAPI<
  BillingInvoice,
  BillingInvoiceServiceType
> {
  public constructor() {
    super(BillingInvoice, BillingInvoiceService);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/pay`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          if (!IsBillingEnabled) {
            throw new BadDataException(
              "Billing is not enabled for this server",
            );
          }

          if (req.body["projectId"]) {
            throw new BadDataException(
              "projectId should not be passed in the request body. The project is resolved from the tenantid header.",
            );
          }

          const userPermissions: Array<UserPermission> = (
            await this.getPermissionsForTenant(req)
          ).filter((permission: UserPermission) => {
            return (
              permission.permission.toString() ===
                Permission.ProjectOwner.toString() ||
              permission.permission.toString() ===
                Permission.EditInvoices.toString()
            );
          });

          if (
            userPermissions.length === 0 &&
            !(req as OneUptimeRequest).userAuthorization?.isMasterAdmin
          ) {
            throw new BadDataException(
              `You need ${Permission.ProjectOwner} or ${Permission.EditInvoices} permission to pay invoices.`,
            );
          }

          const project: Project | null = await ProjectService.findOneById({
            id: this.getTenantId(req)!,
            props: {
              isRoot: true,
            },
            select: {
              _id: true,
              paymentProviderCustomerId: true,
              paymentProviderSubscriptionId: true,
              paymentProviderMeteredSubscriptionId: true,
            },
          });

          if (!project) {
            throw new BadDataException("Project not found");
          }

          if (!project.paymentProviderCustomerId) {
            throw new BadDataException("Payment Provider customer not found");
          }

          if (!project.paymentProviderSubscriptionId) {
            throw new BadDataException(
              "Payment Provider subscription not found",
            );
          }

          const body: JSONObject = req.body;

          const item: BillingInvoice = BaseModel.fromJSON<BillingInvoice>(
            body["data"] as JSONObject,
            this.entityType,
          ) as BillingInvoice;

          if (!item.paymentProviderInvoiceId) {
            throw new BadDataException("Invoice ID not found");
          }

          /*
           * Never trust the customer id from the request body — always
           * charge the authenticated project's own Stripe customer. A
           * mismatch means the caller is trying to pay against another
           * tenant's customer.
           */
          if (
            item.paymentProviderCustomerId &&
            item.paymentProviderCustomerId !== project.paymentProviderCustomerId
          ) {
            throw new BadDataException(
              "Customer ID does not belong to this project",
            );
          }

          // the invoice must belong to this project.
          const billingInvoice: BillingInvoice | null =
            await BillingInvoiceService.findOneBy({
              query: {
                projectId: project.id!,
                paymentProviderInvoiceId: item.paymentProviderInvoiceId,
              },
              select: {
                _id: true,
              },
              props: {
                isRoot: true,
                /*
                 * skip onBeforeFind: it requires props.tenantId and would
                 * re-sync all invoices from Stripe on every pay attempt.
                 * The query above is already scoped to the project.
                 */
                ignoreHooks: true,
              },
            });

          if (!billingInvoice) {
            throw new BadDataException("Invoice not found for this project");
          }

          const customerId: string = project.paymentProviderCustomerId;
          const invoiceId: string = item.paymentProviderInvoiceId;

          let outcome: PayInvoiceOutcome;

          try {
            /*
             * The cardholder is on the other end of this request, so a card
             * that asks for authentication is answered with the client secret
             * below rather than by quietly charging one of their other cards.
             */
            const invoice: Invoice = await BillingService.payInvoice(
              customerId,
              invoiceId,
              { canSurfaceAuthenticationPrompt: true },
            );

            outcome = await this.getOutcomeOfSuccessfulPayment({
              customerId: customerId,
              invoice: invoice,
            });
          } catch (err) {
            outcome = await this.getOutcomeOfFailedPayment({
              customerId: customerId,
              invoiceId: invoiceId,
              paymentError: err,
            });
          }

          if (outcome.kind === "processing") {
            /*
             * The bank already has a payment for this invoice. Charging again
             * is either refused by Stripe or takes the money twice once the
             * first debit clears, so the browser is only told to wait.
             */
            await this.moveAutopayToCustomerDefault({
              customerId: customerId,
              projectId: project.id!,
            });

            return Response.sendJsonObjectResponse(req, res, {
              paymentProcessing: true,
            });
          }

          if (outcome.kind === "requiresAction") {
            // 3-D Secure or a bank prompt the cardholder finishes in the browser.
            return Response.sendJsonObjectResponse(req, res, {
              clientSecret: outcome.clientSecret,
            });
          }

          // save updated status.

          await this.service.updateOneBy({
            query: {
              projectId: project.id!,
              paymentProviderInvoiceId: invoiceId,
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
            data: {
              status: outcome.status,
            },
          });

          try {
            await BillingInvoiceService.refreshSubscriptionStatus({
              projectId: project.id!,
            });
          } finally {
            /*
             * After the refresh: reactivating a subscription recreates it, and
             * the new one must not keep a stale pinned card either.
             */
            if (outcome.status === InvoiceStatus.Paid) {
              await this.moveAutopayToCustomerDefault({
                customerId: customerId,
                projectId: project.id!,
              });
            }
          }

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  /*
   * invoices.pay resolving does not always mean the money arrived. A card
   * debit the bank confirms later (India e-mandate cards sit in "processing"
   * for about a day) comes back as a still-open invoice, and reporting that as
   * paid invites the customer to pay again once the page reloads.
   */
  private async getOutcomeOfSuccessfulPayment(data: {
    customerId: string;
    invoice: Invoice;
  }): Promise<PayInvoiceOutcome> {
    const settledOutcome: PayInvoiceOutcome = {
      kind: "paid",
      status: data.invoice.status as InvoiceStatus,
    };

    if (data.invoice.status !== InvoiceStatus.Open) {
      return settledOutcome;
    }

    try {
      // payInvoice does not return the PaymentIntent, so read the invoice again.
      const invoice: Invoice = await BillingService.getInvoice(
        data.customerId,
        data.invoice.id,
      );

      if (!invoice.paymentIntentId) {
        return settledOutcome;
      }

      const paymentIntent: PaymentIntentState =
        await BillingService.getPaymentIntent(invoice.paymentIntentId);

      if (paymentIntent.status === "processing") {
        return { kind: "processing" };
      }

      if (
        PAYMENT_INTENT_STATUSES_NEEDING_CUSTOMER.includes(
          paymentIntent.status,
        ) &&
        paymentIntent.clientSecret
      ) {
        return {
          kind: "requiresAction",
          clientSecret: paymentIntent.clientSecret,
        };
      }
    } catch (err) {
      /*
       * Stripe accepted the payment. Failing the request because a follow-up
       * read failed would tell the customer the payment failed when it did not.
       */
      logger.error(err, {
        paymentProviderInvoiceId: data.invoice.id,
      } as LogAttributes);
    }

    return settledOutcome;
  }

  /*
   * A failed invoices.pay call says little on its own: the same 400 can mean
   * "declined", "a payment is already on its way" or "this invoice cannot be
   * paid any more". Stripe's view of the invoice and its PaymentIntent is read
   * back before deciding what the customer sees, instead of handing the
   * browser a client secret for whatever state the PaymentIntent is in.
   */
  private async getOutcomeOfFailedPayment(data: {
    customerId: string;
    invoiceId: string;
    paymentError: unknown;
  }): Promise<PayInvoiceOutcome> {
    let invoice: Invoice;

    try {
      invoice = await BillingService.getInvoice(
        data.customerId,
        data.invoiceId,
      );
    } catch (lookupError) {
      logger.error(lookupError, {
        paymentProviderInvoiceId: data.invoiceId,
      } as LogAttributes);

      // The payment error is the one the customer needs to hear about.
      throw toPayInvoiceError({ paymentError: data.paymentError });
    }

    // Paid between the page loading and the click, or by the attempt itself.
    if (invoice.status === InvoiceStatus.Paid) {
      return { kind: "paid", status: InvoiceStatus.Paid };
    }

    if (invoice.status !== InvoiceStatus.Open) {
      // void, uncollectible, draft: nothing to confirm and nothing to wait for.
      throw toPayInvoiceError({ paymentError: data.paymentError });
    }

    let paymentIntent: PaymentIntentState | null = null;

    if (invoice.paymentIntentId) {
      try {
        paymentIntent = await BillingService.getPaymentIntent(
          invoice.paymentIntentId,
        );
      } catch (lookupError) {
        logger.error(lookupError, {
          paymentProviderInvoiceId: data.invoiceId,
        } as LogAttributes);
      }
    }

    if (paymentIntent?.status === "processing") {
      return { kind: "processing" };
    }

    if (
      paymentIntent &&
      PAYMENT_INTENT_STATUSES_NEEDING_CUSTOMER.includes(paymentIntent.status)
    ) {
      if (!paymentIntent.clientSecret) {
        throw new BadDataException(
          "This payment needs to be confirmed with your bank, but the payment provider did not return the details needed to do that. Please try again later.",
        );
      }

      return {
        kind: "requiresAction",
        clientSecret: paymentIntent.clientSecret,
      };
    }

    if (paymentIntent?.status === "succeeded") {
      // The money cleared; Stripe marks the invoice paid right behind it.
      return { kind: "paid", status: InvoiceStatus.Paid };
    }

    /*
     * Stripe refused because a payment is pending, even though the invoice's
     * PaymentIntent could not be read or is not the pending one. Stripe is
     * authoritative about that payment, so the customer is told to wait.
     */
    if (isPendingPaymentRefusal(data.paymentError)) {
      return { kind: "processing" };
    }

    throw toPayInvoiceError({
      paymentError: data.paymentError,
      paymentIntent: paymentIntent,
      suggestNewPaymentMethod: true,
    });
  }

  /*
   * A subscription pinned to an old card keeps charging that card whichever
   * card the customer pays with by hand. Existing pins are only cleaned up
   * lazily, so whenever an invoice ends paid or processing the pin is cleared
   * and the next autopay charges the customer's default card. It must never
   * fail a payment that already went through, so errors are only logged.
   */
  private async moveAutopayToCustomerDefault(data: {
    customerId: string;
    projectId: ObjectID;
  }): Promise<void> {
    try {
      await BillingService.syncSubscriptionPaymentMethodsWithCustomerDefault(
        data.customerId,
      );
    } catch (err) {
      logger.error(err, {
        projectId: data.projectId.toString(),
      } as LogAttributes);
    }
  }
}
