import BadDataException from "../../../Types/Exception/BadDataException";

/*
 * A payment the provider refused, said to the person who asked for it.
 *
 * Stripe's SDK throws errors that carry a type such as StripeCardError, with
 * a message meant for the cardholder ("Your card was declined."). One that
 * reaches the server's error handler as it came is a failure nobody
 * explained - "The server failed..." with a reference - so a route that
 * charges a card because somebody asked it to turns it into words they can
 * act on: what the provider said, and where to put the payment method
 * right. Anything that is not the provider's is already one of OneUptime's
 * (no payment method, a marketplace subscription that is not active) and is
 * passed on as it is.
 *
 * Paying an invoice (BillingInvoiceAPI) and adding to a balance by hand
 * (NotificationService and AIBillingService, #11052) say it in the same
 * words.
 */

export interface PaymentProviderError {
  type: string;
  code?: string | undefined;
  message?: string | undefined;
}

// Stripe SDK errors carry a type such as StripeCardError.
export const isPaymentProviderError: (
  err: unknown,
) => err is PaymentProviderError = (
  err: unknown,
): err is PaymentProviderError => {
  const type: unknown = (err as { type?: unknown } | null)?.type;

  return typeof type === "string" && type.startsWith("Stripe");
};

// What is said when the provider refused and gave no words of its own.
export const PAYMENT_PROVIDER_REFUSED_MESSAGE: string =
  "The payment provider did not accept this payment.";

const ENDS_WITH_PUNCTUATION: RegExp = /[.!?]$/;

/*
 * The provider's words, then what to do: update the payment method where it
 * is kept, and try again.
 */
export const getPaymentNotCompletedMessage: (
  providerMessage: string,
) => string = (providerMessage: string): string => {
  const sentence: string = ENDS_WITH_PUNCTUATION.test(providerMessage)
    ? providerMessage
    : `${providerMessage}.`;

  return `Your payment could not be completed: ${sentence} Please update your payment method in Project Settings > Billing and Invoices > Billing and try again.`;
};

/*
 * What a charge somebody asked for answers with when it fails: the
 * provider's refusal in words they can act on, and anything else as it
 * came.
 */
export const toPaymentRefusalForWhoAsked: (err: unknown) => unknown = (
  err: unknown,
): unknown => {
  if (!isPaymentProviderError(err)) {
    return err;
  }

  const providerMessage: string =
    (err.message || "").trim() || PAYMENT_PROVIDER_REFUSED_MESSAGE;

  return new BadDataException(getPaymentNotCompletedMessage(providerMessage));
};
