import {
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { SetupIntent, SetupIntentResult } from "@stripe/stripe-js";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  FormEvent,
  FunctionComponent,
  ReactElement,
  Ref,
  useRef,
} from "react";

export interface ComponentProps {
  onError: (error: string) => void;
  /*
   * paymentMethodId is the provider id of the card that was just saved, or
   * null when the provider did not hand one back (for example a bank debit
   * that is still processing). The billing page makes a non-null id the
   * default so autopay charges the card the customer just added.
   */
  onSuccess: (paymentMethodId: string | null) => void;
  formRef: Ref<HTMLButtonElement>;
}

export const DEFAULT_SETUP_ERROR_MESSAGE: string =
  "Unable to save your payment method. Please try again.";

export const SETUP_NOT_COMPLETED_ERROR_MESSAGE: string =
  "Your payment method could not be verified. Please try again or use a different payment method.";

type GetPaymentMethodIdFunction = (setupIntent: SetupIntent) => string | null;

export const getSetupIntentPaymentMethodId: GetPaymentMethodIdFunction = (
  setupIntent: SetupIntent,
): string | null => {
  const paymentMethod: SetupIntent["payment_method"] =
    setupIntent.payment_method;

  if (!paymentMethod) {
    return null;
  }

  if (typeof paymentMethod === "string") {
    return paymentMethod;
  }

  return paymentMethod.id || null;
};

const CheckoutForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const stripe: ReturnType<typeof useStripe> = useStripe();
  const elements: ReturnType<typeof useElements> = useElements();
  const isSubmitting: React.MutableRefObject<boolean> = useRef<boolean>(false);

  const submitForm: (
    event: FormEvent<HTMLFormElement>,
  ) => Promise<void> = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();

    if (isSubmitting.current) {
      return;
    }

    if (!stripe || !elements) {
      props.onError(
        "The payment form is still loading. Please try again in a moment.",
      );
      return;
    }

    isSubmitting.current = true;

    try {
      /*
       * redirect: "if_required" keeps card setups (including 3DS, which Stripe
       * shows in a modal) on this page so the resulting SetupIntent comes back
       * here. Without it Stripe always redirected to return_url and the page
       * never learned which card was added, so it could not make that card the
       * default - and autopay kept charging whichever card was default before,
       * which is how a customer who replaced a declining card still saw every
       * invoice charged to the old one. Redirect-based methods still use
       * return_url; the billing page picks those up from the query string.
       */
      const result: SetupIntentResult = await stripe.confirmSetup({
        elements,
        confirmParams: {
          return_url: Navigation.getCurrentURL().removeQueryString().toString(),
        },
        redirect: "if_required",
      });

      if (result.error) {
        props.onError(result.error.message || DEFAULT_SETUP_ERROR_MESSAGE);
        return;
      }

      const setupIntent: SetupIntent | undefined = result.setupIntent;

      if (!setupIntent) {
        /*
         * No error and no SetupIntent: nothing to make default, but nothing
         * failed either, so let the page refresh its list as it always did.
         */
        props.onSuccess(null);
        return;
      }

      if (setupIntent.status === "succeeded") {
        props.onSuccess(getSetupIntentPaymentMethodId(setupIntent));
        return;
      }

      if (setupIntent.status === "processing") {
        /*
         * Stripe attaches the payment method to the customer only once the
         * setup succeeds, so a processing method cannot be made the default
         * yet (the server would reject it as not belonging to this project).
         * Report success without an id; the customer can set it as default
         * from the table once it has cleared.
         */
        props.onSuccess(null);
        return;
      }

      props.onError(
        setupIntent.last_setup_error?.message ||
          SETUP_NOT_COMPLETED_ERROR_MESSAGE,
      );
    } catch {
      props.onError(DEFAULT_SETUP_ERROR_MESSAGE);
    } finally {
      isSubmitting.current = false;
    }
  };

  return (
    <form onSubmit={submitForm}>
      <PaymentElement />
      <button
        ref={props.formRef}
        type="submit"
        hidden={true}
        aria-label="Save payment method"
      />
    </form>
  );
};

export default CheckoutForm;
