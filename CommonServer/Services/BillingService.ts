import type SubscriptionPlan from 'Common/Types/Billing/SubscriptionPlan';
import OneUptimeDate from 'Common/Types/Date';
import APIException from 'Common/Types/Exception/ApiException';
import BadDataException from 'Common/Types/Exception/BadDataException';
import type ObjectID from 'Common/Types/ObjectID';
import Typeof from 'Common/Types/Typeof';
import Stripe from 'stripe';
import { BillingPrivateKey, IsBillingEnabled } from '../Config';

export interface PaymentMethod {
    id: string;
    type: string;
    last4Digits: string;
    isDefault: boolean;
}

export interface Invoice {
    id: string;
    amount: number;
    currencyCode: string;
    subscriptionId?: string | undefined;
    status: string;
    downloadableLink: string;
    customerId: string | undefined;
}

export class BillingService {
    private static stripe: Stripe = new Stripe(BillingPrivateKey, {
        apiVersion: '2022-08-01',
    });

    // returns billing id of the customer.
    public static async createCustomer(
        name: string,
        id: ObjectID
    ): Promise<string> {
        if (!this.isBillingEnabled()) {
            throw new BadDataException(
                'Billing is not enabled for this server.'
            );
        }

        const customer: Stripe.Response<Stripe.Customer> =
            await this.stripe.customers.create({
                name,
                metadata: {
                    id: id.toString(),
                },
            });

        return customer.id;
    }

    public static async updateCustomerName(
        id: string,
        newName: string
    ): Promise<void> {
        if (!this.isBillingEnabled()) {
            throw new BadDataException(
                'Billing is not enabled for this server.'
            );
        }

        await this.stripe.customers.update(id, { name: newName });
    }

    public static async deleteCustomer(id: string): Promise<void> {
        if (!this.isBillingEnabled()) {
            throw new BadDataException(
                'Billing is not enabled for this server.'
            );
        }

        await this.stripe.customers.del(id);
    }

    public static isBillingEnabled(): boolean {
        return IsBillingEnabled;
    }

    public static async subscribeToPlan(
        customerId: string,
        plan: SubscriptionPlan,
        quantity: number,
        isYearly: boolean,
        trial: boolean | Date | undefined
    ): Promise<{
        id: string;
        trialEndsAt: Date | null;
    }> {
        if (!this.isBillingEnabled()) {
            throw new BadDataException(
                'Billing is not enabled for this server.'
            );
        }

        let trialDate: Date | null = null;

        if (typeof trial === Typeof.Boolean) {
            trialDate = OneUptimeDate.getSomeDaysAfter(plan.getTrialPeriod());
        }

        if (trial instanceof Date) {
            trialDate = trial;
        }

        const subscription: Stripe.Response<Stripe.Subscription> =
            await this.stripe.subscriptions.create({
                customer: customerId,
                items: [
                    {
                        price: isYearly
                            ? plan.getYearlyPlanId()
                            : plan.getMonthlyPlanId(),
                        quantity: quantity,
                    },
                ],
                trial_end:
                    trialDate && plan.getTrialPeriod() > 0
                        ? OneUptimeDate.toUnixTimestamp(trialDate)
                        : 'now',
            });

        return {
            id: subscription.id,
            trialEndsAt:
                trialDate && plan.getTrialPeriod() > 0 ? trialDate : null,
        };
    }

    public static async changeQuantity(
        subscriptionId: string,
        quantity: number
    ): Promise<void> {
        if (!this.isBillingEnabled()) {
            throw new BadDataException(
                'Billing is not enabled for this server.'
            );
        }

        const subscription: Stripe.Response<Stripe.Subscription> =
            await this.stripe.subscriptions.retrieve(subscriptionId);

        if (!subscription) {
            throw new BadDataException('Subscription not found');
        }

        const subscriptionItemId: string | undefined =
            subscription.items.data[0]?.id;

        if (!subscriptionItemId) {
            throw new BadDataException('Subscription Item not found');
        }

        await this.stripe.subscriptionItems.update(subscriptionItemId, {
            quantity: quantity,
        });
    }

    public static async changePlan(
        subscriptionId: string,
        newPlan: SubscriptionPlan,
        quantity: number,
        isYearly: boolean,
        endTrialAt?: Date | undefined
    ): Promise<{
        id: string;
        trialEndsAt?: Date | undefined;
    }> {
        if (!this.isBillingEnabled()) {
            throw new BadDataException(
                'Billing is not enabled for this server.'
            );
        }

        const subscription: Stripe.Response<Stripe.Subscription> =
            await this.stripe.subscriptions.retrieve(subscriptionId);

        if (!subscription) {
            throw new BadDataException('Subscription not found');
        }

        if (
            (await this.getPaymentMethods(subscription.customer.toString()))
                .length === 0
        ) {
            throw new BadDataException(
                'No payment methods added. Please add your card to this project to change your plan'
            );
        }

        await this.cancelSubscription(subscriptionId);

        const subscribetoPlan: {
            id: string;
            trialEndsAt: Date | null;
        } = await this.subscribeToPlan(
            subscription.customer.toString(),
            newPlan,
            quantity,
            isYearly,
            endTrialAt
        );

        return {
            id: subscribetoPlan.id,
            trialEndsAt: subscribetoPlan.trialEndsAt || undefined,
        };
    }

    public static async deletePaymentMethod(
        customerId: string,
        paymentMethodId: string
    ): Promise<void> {
        if (!this.isBillingEnabled()) {
            throw new BadDataException(
                'Billing is not enabled for this server.'
            );
        }

        const paymenMethods: Array<PaymentMethod> =
            await this.getPaymentMethods(customerId);

        if (paymenMethods.length === 1) {
            throw new BadDataException(
                "There's only one payment method associated with this account. It cannot be deleted. To delete this payment method please add more payment methods to your account."
            );
        }

        await this.stripe.paymentMethods.detach(paymentMethodId);
    }

    public static async getPaymentMethods(
        customerId: string
    ): Promise<Array<PaymentMethod>> {
        if (!this.isBillingEnabled()) {
            throw new BadDataException(
                'Billing is not enabled for this server.'
            );
        }
        const paymenMethods: Array<PaymentMethod> = [];

        const cardPaymentMethods: Stripe.ApiList<Stripe.PaymentMethod> =
            await this.stripe.paymentMethods.list({
                customer: customerId,
                type: 'card',
            });

        const sepaPaymentMethods: Stripe.ApiList<Stripe.PaymentMethod> =
            await this.stripe.paymentMethods.list({
                customer: customerId,
                type: 'sepa_debit',
            });

        const usBankPaymentMethods: Stripe.ApiList<Stripe.PaymentMethod> =
            await this.stripe.paymentMethods.list({
                customer: customerId,
                type: 'us_bank_account',
            });

        const bacsPaymentMethods: Stripe.ApiList<Stripe.PaymentMethod> =
            await this.stripe.paymentMethods.list({
                customer: customerId,
                type: 'bacs_debit',
            });

        cardPaymentMethods.data.forEach((item: Stripe.PaymentMethod) => {
            paymenMethods.push({
                type: item.card?.brand || 'Card',
                last4Digits: item.card?.last4 || 'xxxx',
                isDefault: false,
                id: item.id,
            });
        });

        bacsPaymentMethods.data.forEach((item: Stripe.PaymentMethod) => {
            paymenMethods.push({
                type: 'UK Bank Account',
                last4Digits: item.bacs_debit?.last4 || 'xxxx',
                isDefault: false,
                id: item.id,
            });
        });

        usBankPaymentMethods.data.forEach((item: Stripe.PaymentMethod) => {
            paymenMethods.push({
                type: 'US Bank Account',
                last4Digits: item.us_bank_account?.last4 || 'xxxx',
                isDefault: false,
                id: item.id,
            });
        });

        sepaPaymentMethods.data.forEach((item: Stripe.PaymentMethod) => {
            paymenMethods.push({
                type: 'EU Bank Account',
                last4Digits: item.sepa_debit?.last4 || 'xxxx',
                isDefault: false,
                id: item.id,
            });
        });

        return paymenMethods;
    }

    public static async getSetupIntentSecret(
        customerId: string
    ): Promise<string> {
        const setupIntent: Stripe.Response<Stripe.SetupIntent> =
            await this.stripe.setupIntents.create({
                customer: customerId,
            });

        if (!setupIntent.client_secret) {
            throw new APIException(
                'client_secret not returned by payment provider.'
            );
        }

        return setupIntent.client_secret;
    }

    public static async cancelSubscription(
        subscriptionId: string
    ): Promise<void> {
        if (!this.isBillingEnabled()) {
            throw new BadDataException(
                'Billing is not enabled for this server.'
            );
        }

        await this.stripe.subscriptions.del(subscriptionId);
    }

    public static async getSubscriptionStatus(
        subscriptionId: string
    ): Promise<string> {
        if (!this.isBillingEnabled()) {
            throw new BadDataException(
                'Billing is not enabled for this server.'
            );
        }

        const subscription: Stripe.Response<Stripe.Subscription> =
            await this.stripe.subscriptions.retrieve(subscriptionId);

        return subscription.status;
    }

    public static async getInvoices(
        customerId: string
    ): Promise<Array<Invoice>> {
        const invoices: Stripe.ApiList<Stripe.Invoice> =
            await this.stripe.invoices.list({
                customer: customerId,
                limit: 100,
            });

        return invoices.data.map((invoice: Stripe.Invoice) => {
            return {
                id: invoice.id!,
                amount: invoice.amount_due,
                currencyCode: invoice.currency,
                subscriptionId: invoice.subscription?.toString() || undefined,
                status: invoice.status?.toString() || 'Unknown',
                downloadableLink: invoice.invoice_pdf?.toString() || '',
                customerId: invoice.customer?.toString() || '',
            };
        });
    }

    public static async payInvoice(
        customerId: string,
        invoiceId: string
    ): Promise<Invoice> {
        // after the invoice is paid, // please fetch subscription and check the status.
        const paymentMethods: Array<PaymentMethod> =
            await this.getPaymentMethods(customerId);

        if (paymentMethods.length === 0) {
            throw new BadDataException(
                'Payment Method not added. Please go to Project Settings > Billing and add a payment method.'
            );
        }

        const invoice: Stripe.Invoice = await this.stripe.invoices.pay(
            invoiceId,
            {
                payment_method: paymentMethods[0]?.id || '',
            }
        );

        return {
            id: invoice.id!,
            amount: invoice.amount_due,
            currencyCode: invoice.currency,
            subscriptionId: invoice.subscription?.toString() || undefined,
            status: invoice.status?.toString() || 'Unknown',
            downloadableLink: invoice.invoice_pdf?.toString() || '',
            customerId: invoice.customer?.toString() || '',
        };
    }
}

export default BillingService;
