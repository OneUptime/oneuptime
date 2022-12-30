import Stripe from 'stripe';
import { BILLING_PUBLIC_KEY } from 'CommonUI/src/Config';

export class BillingProvider {
    public static getBillingProvider(): Stripe {
        return new Stripe(BILLING_PUBLIC_KEY, {
            apiVersion: '2022-11-15',
        });
    }
}
