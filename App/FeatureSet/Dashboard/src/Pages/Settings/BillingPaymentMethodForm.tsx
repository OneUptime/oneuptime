import {
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
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
  onSuccess: () => void;
  formRef: Ref<HTMLButtonElement>;
}

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
