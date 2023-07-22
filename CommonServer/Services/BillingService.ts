import SubscriptionPlan from 'Common/Types/Billing/SubscriptionPlan';
import MeteredPlan from 'Common/Types/Billing/MeteredPlan';
import OneUptimeDate from 'Common/Types/Date';
import APIException from 'Common/Types/Exception/ApiException';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ObjectID from 'Common/Types/ObjectID';
import Typeof from 'Common/Types/Typeof';
import logger from '../Utils/Logger';
import Stripe from 'stripe';
import { BillingPrivateKey, IsBillingEnabled } from '../Config';
import ServerMeteredPlan from '../Types/Billing/MeteredPlan/ServerMeteredPlan';
import SubscriptionStatus from 'Common/Types/Billing/SubscriptionStatus';
import BaseService from './BaseService';

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

export class BillingService extends BaseService {

    public constructor() {
        super();
    }

    private stripe: Stripe = new Stripe(BillingPrivateKey, {
        apiVersion: '2022-08-01',
    });

    // returns billing id of the customer.
    public async createCustomer(
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

    public async updateCustomerName(
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

    public async deleteCustomer(id: string): Promise<void> {
        if (!this.isBillingEnabled()) {
            throw new BadDataException(
                'Billing is not enabled for this server.'
            );
        }

        await this.stripe.customers.del(id);
    }

    public isBillingEnabled(): boolean {
        return IsBillingEnabled;
    }

    public async subscribeToPlan(
        projectId: ObjectID,
        customerId: string,
        serverMeteredPlans: Array<typeof ServerMeteredPlan>,
        plan: SubscriptionPlan,
        quantity: number,
        isYearly: boolean,
        trial: boolean | Date | undefined,
        defaultPaymentMethodId?: string | undefined
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

        const subscriptionParams: Stripe.SubscriptionCreateParams = {
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
        };

        if (defaultPaymentMethodId) {
            subscriptionParams.default_payment_method = defaultPaymentMethodId;
        }

        const subscription: Stripe.Response<Stripe.Subscription> =
            await this.stripe.subscriptions.create(subscriptionParams);

        for (const serverMeteredPlan of serverMeteredPlans) {
            await serverMeteredPlan.updateCurrentQuantity(projectId, {
                subscriptionId: subscription.id,
                isYearlyPlan: isYearly,
            });
        }

        return {
            id: subscription.id,
            trialEndsAt:
                trialDate && plan.getTrialPeriod() > 0 ? trialDate : null,
        };
    }

    public async changeQuantity(
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

        if (subscription.status === 'canceled') {
            // subscription is canceled.
            return;
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

    public async addOrUpdateMeteredPricingOnSubscription(
        subscriptionId: string,
        meteredPlan: MeteredPlan,
        quantity: number,
        isYearly: boolean
    ): Promise<void> {
        if (!this.isBillingEnabled()) {
            throw new BadDataException(
                'Billing is not enabled for this server.'
            );
        }

        // get subscription.
        const subscription: Stripe.Subscription = await this.getSubscription(
            subscriptionId.toString()
        );

        if (!subscription) {
            throw new BadDataException('Subscription not found');
        }

        // check if this pricing exists

        const pricingExists: boolean = subscription.items.data.some(
            (item: Stripe.SubscriptionItem) => {
                return (
                    item.price?.id ===
                    (isYearly
                        ? meteredPlan.getYearlyPriceId()
                        : meteredPlan.getMonthlyPriceId())
                );
            }
        );

        if (pricingExists) {
            // update the quantity.
            const subscriptionItemId: string | undefined =
                subscription.items.data.find(
                    (item: Stripe.SubscriptionItem) => {
                        return (
                            item.price?.id ===
                            (isYearly
                                ? meteredPlan.getYearlyPriceId()
                                : meteredPlan.getMonthlyPriceId())
                        );
                    }
                )?.id;

            if (!subscriptionItemId) {
                throw new BadDataException('Subscription Item not found');
            }

            // use stripe usage based api to update the quantity.
            await this.stripe.subscriptionItems.createUsageRecord(
                subscriptionItemId,
                {
                    quantity: quantity,
                }
            );
        } else {
            // add the pricing.
            const subscriptionItem: Stripe.SubscriptionItem =
                await this.stripe.subscriptionItems.create({
                    subscription: subscriptionId,
                    price: isYearly
                        ? meteredPlan.getYearlyPriceId()
                        : meteredPlan.getMonthlyPriceId(),
                });

            // use stripe usage based api to update the quantity.
            await this.stripe.subscriptionItems.createUsageRecord(
                subscriptionItem.id,
                {
                    quantity: quantity,
                }
            );
        }

        // complete.
    }

    public async changePlan(
        projectId: ObjectID,
        subscriptionId: string,
        serverMeteredPlans: Array<typeof ServerMeteredPlan>,
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

        const paymentMethods: Array<PaymentMethod> =
            await this.getPaymentMethods(subscription.customer.toString());

        if (paymentMethods.length === 0) {
            throw new BadDataException(
                'No payment methods added. Please add your card to this project to change your plan'
            );
        }

        await this.cancelSubscription(subscriptionId);

        if (endTrialAt && !OneUptimeDate.isInTheFuture(endTrialAt)) {
            endTrialAt = undefined;
        }

        const subscribetoPlan: {
            id: string;
            trialEndsAt: Date | null;
        } = await this.subscribeToPlan(
            projectId,
            subscription.customer.toString(),
            serverMeteredPlans,
            newPlan,
            quantity,
            isYearly,
            endTrialAt,
            paymentMethods[0]?.id
        );

        return {
            id: subscribetoPlan.id,
            trialEndsAt: subscribetoPlan.trialEndsAt || undefined,
        };
    }

    public async deletePaymentMethod(
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

    public async hasPaymentMethods(
        customerId: string
    ): Promise<boolean> {
        if ((await this.getPaymentMethods(customerId)).length > 0) {
            return true;
        }

        return false;
    }

    public async getPaymentMethods(
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

    public async getSetupIntentSecret(
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

    public async cancelSubscription(
        subscriptionId: string
    ): Promise<void> {
        if (!this.isBillingEnabled()) {
            throw new BadDataException(
                'Billing is not enabled for this server.'
            );
        }
        try {
            await this.stripe.subscriptions.del(subscriptionId);
        } catch (err) {
            logger.error(err);
        }
    }

    public async getSubscriptionStatus(
        subscriptionId: string
    ): Promise<SubscriptionStatus> {
        const subscription: Stripe.Subscription = await this.getSubscription(
            subscriptionId
        );
        return subscription.status as SubscriptionStatus;
    }

    public async getSubscription(
        subscriptionId: string
    ): Promise<Stripe.Subscription> {
        if (!this.isBillingEnabled()) {
            throw new BadDataException(
                'Billing is not enabled for this server.'
            );
        }

        const subscription: Stripe.Response<Stripe.Subscription> =
            await this.stripe.subscriptions.retrieve(subscriptionId);

        return subscription;
    }

    public async getInvoices(
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

    public async genrateInvoiceAndChargeCustomer(
        customerId: string,
        itemText: string,
        amountInUsd: number
    ): Promise<void> {
        const invoice: Stripe.Invoice = await this.stripe.invoices.create({
            customer: customerId,
            auto_advance: true, // do not automatically charge.
            collection_method: 'charge_automatically',
        });

        if (!invoice || !invoice.id) {
            throw new APIException('Invoice not generated.');
        }

        await this.stripe.invoiceItems.create({
            invoice: invoice.id,
            amount: amountInUsd * 100,
            description: itemText,
            customer: customerId,
        });

        await this.stripe.invoices.finalizeInvoice(invoice.id!);

        try {
            await this.payInvoice(customerId, invoice.id!);
        } catch (err) {
            // mark invoice as failed and do not collect payment.
            await this.voidInvoice(invoice.id!);
            throw err;
        }
    }

    public async voidInvoice(
        invoiceId: string
    ): Promise<Stripe.Invoice> {
        const invoice: Stripe.Invoice = await this.stripe.invoices.voidInvoice(
            invoiceId
        );

        return invoice;
    }

    public async payInvoice(
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


export default new BillingService(); 
