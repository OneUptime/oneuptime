import React, { Ref } from 'react';
import { useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js';
import Navigation from 'CommonUI/src/Utils/Navigation';

export interface ComponentProps {
    onError: (error: string) => void;
    onSuccess: () => void; 
    formRef: Ref<any>;
}

const CheckoutForm = (props: ComponentProps) => {
    const stripe = useStripe();
    const elements = useElements();


    const submitForm = async (event: Event) => {
        event.preventDefault();
        // We don't want to let default form submission happen here,
        // which would refresh the page.
        event.preventDefault();

        if (!stripe || !elements) {
            // Stripe.js has not yet loaded.
            // Make sure to disable form submission until Stripe.js has loaded.
            return;
        }
        
        const { error } = await stripe.confirmSetup({
            //`Elements` instance that was used to create the Payment Element
            elements,
            confirmParams: {
                return_url: Navigation.getCurrentURL().toString(),
            },
        });


        if (error) {
            // This point will only be reached if there is an immediate error when
            // confirming the payment. Show error to your customer (for example, payment
            // details incomplete)
            
            props.onError(error.message?.toString() || 'Unknown error with your payemnt provider.');
        } else {
            // Your customer will be redirected to your `return_url`. For some payment
            // methods like iDEAL, your customer will be redirected to an intermediate
            // site first to authorize the payment, then redirected to the `return_url`.
            props.onSuccess();
        }

    };

    return (
        <div ref={props.formRef} onClick={submitForm as any}>
            <PaymentElement />
        </div>
    )
};

export default CheckoutForm;