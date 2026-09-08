import UsagePricingSummary from "../../Components/Billing/UsagePricingSummary";
import {
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  FormEvent,
  FunctionComponent,
  ReactElement,
  Ref,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  onError: (error: string) => void;
  onSuccess: () => void;
  formRef: Ref<HTMLButtonElement>;
}

export const PAYMENT_METHOD_CONSENT_LABEL: string =
  "I understand that adding a payment method enables paid usage, billed at the published rates in addition to any subscription charges.";

export const PAYMENT_METHOD_CONSENT_ERROR: string =
  "Please confirm you understand the usage charges before adding a payment method.";

const CheckoutForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const stripe: ReturnType<typeof useStripe> = useStripe();
  const elements: ReturnType<typeof useElements> = useElements();
  const [hasAcknowledgedCharges, setHasAcknowledgedCharges] =
    useState<boolean>(false);
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

    if (!hasAcknowledgedCharges) {
      props.onError(PAYMENT_METHOD_CONSENT_ERROR);
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
      const { error } = await stripe.confirmSetup({
        elements,
        confirmParams: {
          return_url: Navigation.getCurrentURL().removeQueryString().toString(),
        },
      });

      if (error) {
        props.onError(
          error.message ||
            "Unable to save your payment method. Please try again.",
        );
      } else {
        props.onSuccess();
      }
    } catch {
      props.onError("Unable to save your payment method. Please try again.");
    } finally {
      isSubmitting.current = false;
    }
  };

  return (
    <form onSubmit={submitForm} className="space-y-5">
      <div className="space-y-3 rounded-lg border border-indigo-100 bg-indigo-50 p-4">
        <p className="text-sm font-medium text-gray-900">
          Adding a payment method enables paid usage for this project. Your
          subscription plan stays the same.
        </p>
        <UsagePricingSummary />
        <CheckboxElement
          title={PAYMENT_METHOD_CONSENT_LABEL}
          ariaLabel={PAYMENT_METHOD_CONSENT_LABEL}
          value={hasAcknowledgedCharges}
          onChange={setHasAcknowledgedCharges}
          dataTestId="payment-method-usage-consent"
        />
      </div>
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
