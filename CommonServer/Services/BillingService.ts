import { BillingPrivateKey, IsBillingEnabled } from '../EnvironmentConfig';
import ServerMeteredPlan from '../Types/Billing/MeteredPlan/ServerMeteredPlan';
import Errors from '../Utils/Errors';
import logger from '../Utils/Logger';
import BaseService from './BaseService';
import SubscriptionPlan from 'Common/Types/Billing/SubscriptionPlan';
import SubscriptionStatus, {
    SubscriptionStatusUtil,
} from 'Common/Types/Billing/SubscriptionStatus';
import OneUptimeDate from 'Common/Types/Date';
import Dictionary from 'Common/Types/Dictionary';
import Email from 'Common/Types/Email';
import APIException from 'Common/Types/Exception/ApiException';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ProductType from 'Common/Types/MeteredPlan/ProductType';
import ObjectID from 'Common/Types/ObjectID';
import Stripe from 'stripe';

export type SubscriptionItem = Stripe.SubscriptionItem;

export type Coupon = Stripe.Coupon;

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
    public async createCustomer(data: {
        name: string;
        id: ObjectID;
        email: Email;
    }): Promise<string> {
        if (!this.isBillingEnabled()) {
            throw new BadDataException(
                Errors.BillingService.BILLING_NOT_ENABLED
            );
        }
        const customer: Stripe.Response<Stripe.Customer> =
            await this.stripe.customers.create({
                name: data.name,
                email: data.email.toString(),
                metadata: {
                    id: data.id.toString(),
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
                Errors.BillingService.BILLING_NOT_ENABLED
            );
        }

        await this.stripe.customers.update(id, { name: newName });
    }

    public async deleteCustomer(id: string): Promise<void> {
        if (!this.isBillingEnabled()) {
            throw new BadDataException(
                Errors.BillingService.BILLING_NOT_ENABLED
            );
        }

        await this.stripe.customers.del(id);
    }

    public isBillingEnabled(): boolean {
        return IsBillingEnabled;
    }

    public isSubscriptionActive(status: SubscriptionStatus): boolean {
        return SubscriptionStatusUtil.isSubscriptionActive(status);
    }

    public async subscribeToMeteredPlan(data: {
        projectId: ObjectID;
        customerId: string;
        serverMeteredPlans: Array<ServerMeteredPlan>;
        trialDate: Date | null;
        defaultPaymentMethodId?: string | undefined;
        promoCode?: string | undefined;
    }): Promise<{
        meteredSubscriptionId: string;
        trialEndsAt: Date | null;
    }> {
        const meteredPlanSubscriptionParams: Stripe.SubscriptionCreateParams = {
            customer: data.customerId,

            proration_behavior: 'always_invoice',

            items: data.serverMeteredPlans.map((item: ServerMeteredPlan) => {
                return {
                    price: item.getPriceId(),
                };
            }),

            trial_end:
                data.trialDate && OneUptimeDate.isInTheFuture(data.trialDate)
                    ? OneUptimeDate.toUnixTimestamp(data.trialDate)
                    : 'now',
        };

        if (data.promoCode) {
            meteredPlanSubscriptionParams.coupon = data.promoCode;
        }

        if (data.defaultPaymentMethodId) {
            meteredPlanSubscriptionParams.default_payment_method =
                data.defaultPaymentMethodId;
        }

        // Create metered subscriptions
        const meteredSubscription: Stripe.Response<Stripe.Subscription> =
            await this.stripe.subscriptions.create(
                meteredPlanSubscriptionParams
            );

        for (const serverMeteredPlan of data.serverMeteredPlans) {
            await serverMeteredPlan.reportQuantityToBillingProvider(
                data.projectId,
                {
                    meteredPlanSubscriptionId: meteredSubscription.id,
                }
            );
        }

        return {
            meteredSubscriptionId: meteredSubscription.id,
            trialEndsAt: data.trialDate,
        };
    }

    public isTestEnvironment(): boolean {
        return BillingPrivateKey.startsWith('sk_test');
    }

    public async generateCouponCode(data: {
        name: string;
        metadata?: Dictionary<string> | undefined;
        percentOff: number;
        durationInMonths: number;
        maxRedemptions: number;
    }): Promise<string> {
        const coupon: Coupon = await this.stripe.coupons.create({
            name: data.name,
            percent_off: data.percentOff,
            duration: 'repeating',
            duration_in_months: data.durationInMonths,
            max_redemptions: data.maxRedemptions,
            metadata: data.metadata || null,
        });

        return coupon.id;
    }

    public async subscribeToPlan(data: {
        projectId: ObjectID;
        customerId: string;
        serverMeteredPlans: Array<ServerMeteredPlan>;
        plan: SubscriptionPlan;
        quantity: number;
        isYearly: boolean;
        trial: boolean | Date | undefined;
        defaultPaymentMethodId?: string | undefined;
        promoCode?: string | undefined;
    }): Promise<{
        subscriptionId: string;
        meteredSubscriptionId: string;
        trialEndsAt: Date | null;
    }> {
        if (!this.isBillingEnabled()) {
            throw new BadDataException(
                Errors.BillingService.BILLING_NOT_ENABLED
            );
        }

        let trialDate: Date | null = null;

        if (typeof data.trial === 'boolean') {
            if (data.trial) {
                trialDate = OneUptimeDate.getSomeDaysAfter(
                    data.plan.getTrialPeriod()
                );
            } else {
                trialDate = null;
            }
        } else if (data.trial instanceof Date) {
            trialDate = data.trial;
        }

        const subscriptionParams: Stripe.SubscriptionCreateParams = {
            customer: data.customerId,

            items: [
                {
                    price: data.isYearly
                        ? data.plan.getYearlyPlanId()
                        : data.plan.getMonthlyPlanId(),
                    quantity: data.quantity,
                },
            ],

            proration_behavior: 'always_invoice',

            trial_end:
                trialDate && data.plan.getTrialPeriod() > 0
                    ? OneUptimeDate.toUnixTimestamp(trialDate)
                    : 'now',
        };

        if (data.promoCode) {
            subscriptionParams.coupon = data.promoCode;
        }

        if (data.defaultPaymentMethodId) {
            subscriptionParams.default_payment_method =
                data.defaultPaymentMethodId;
        }

        const subscription: Stripe.Response<Stripe.Subscription> =
            await this.stripe.subscriptions.create(subscriptionParams);

        // Create metered subscriptions
        const meteredSubscription: {
            meteredSubscriptionId: string;
            trialEndsAt: Date | null;
        } = await this.subscribeToMeteredPlan({
            ...data,
            trialDate,
        });

        return {
            subscriptionId: subscription.id,
            meteredSubscriptionId: meteredSubscription.meteredSubscriptionId,
            trialEndsAt:
                trialDate && data.plan.getTrialPeriod() > 0 ? trialDate : null,
        };
    }

    public async changeQuantity(
        subscriptionId: string,
        quantity: number
    ): Promise<void> {
        if (!this.isBillingEnabled()) {
            throw new BadDataException(
                Errors.BillingService.BILLING_NOT_ENABLED
            );
        }

        const subscription: Stripe.Response<Stripe.Subscription> =
            await this.stripe.subscriptions.retrieve(subscriptionId);

        if (!subscription) {
            throw new BadDataException(
                Errors.BillingService.SUBSCRIPTION_NOT_FOUND
            );
        }
        if (subscription.status === 'canceled') {
            // subscription is canceled.
            return;
        }

        const subscriptionItemId: string | undefined =
            subscription.items.data[0]?.id;

        if (!subscriptionItemId) {
            throw new BadDataException(
                Errors.BillingService.SUBSCRIPTION_ITEM_NOT_FOUND
            );
        }

        await this.stripe.subscriptionItems.update(subscriptionItemId, {
            quantity: quantity,
        });

        // add billing anchor, so that the billing cycle starts now. New quantity will be charged from now. https://stackoverflow.com/questions/44417047/immediately-charge-for-subscription-changes
        await this.stripe.subscriptions.update(subscriptionId, {
            proration_behavior: 'always_invoice',
        });
    }

    public async addOrUpdateMeteredPricingOnSubscription(
        subscriptionId: string,
        serverMeteredPlan: ServerMeteredPlan,
        quantity: number
    ): Promise<void> {
        if (!this.isBillingEnabled()) {
            throw new BadDataException(
                Errors.BillingService.BILLING_NOT_ENABLED
            );
        }

        // get subscription.
        const subscription: Stripe.Subscription = await this.getSubscription(
            subscriptionId.toString()
        );

        if (!subscription) {
            throw new BadDataException(
                Errors.BillingService.SUBSCRIPTION_NOT_FOUND
            );
        }

        // check if this pricing exists

        const pricingExists: boolean = subscription.items.data.some(
            (item: SubscriptionItem) => {
                return item.price?.id === serverMeteredPlan.getPriceId();
            }
        );

        if (pricingExists) {
            // update the quantity.
            const subscriptionItemId: string | undefined =
                subscription.items.data.find((item: SubscriptionItem) => {
                    return item.price?.id === serverMeteredPlan.getPriceId();
                })?.id;

            if (!subscriptionItemId) {
                throw new BadDataException(
                    Errors.BillingService.SUBSCRIPTION_ITEM_NOT_FOUND
                );
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
            const subscriptionItem: SubscriptionItem =
                await this.stripe.subscriptionItems.create({
                    subscription: subscriptionId,
                    price: serverMeteredPlan.getPriceId(),
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

    public async isPromoCodeValid(promoCode: string): Promise<boolean> {
        if (!this.isBillingEnabled()) {
            throw new BadDataException(
                Errors.BillingService.BILLING_NOT_ENABLED
            );
        }
        try {
            const promoCodeResponse: Stripe.Response<Stripe.Coupon> =
                await this.stripe.coupons.retrieve(promoCode);

            if (!promoCodeResponse) {
                throw new BadDataException(
                    Errors.BillingService.PROMO_CODE_NOT_FOUND
                );
            }

            return promoCodeResponse.valid;
        } catch (err) {
            throw new BadDataException(
                (err as Error).message ||
                    Errors.BillingService.PROMO_CODE_INVALID
            );
        }
    }

    public async removeSubscriptionItem(
        subscriptionId: string,
        subscriptionItemId: string,
        isMeteredSubscriptionItem: boolean
    ): Promise<void> {
        if (!this.isBillingEnabled()) {
            throw new BadDataException(
                Errors.BillingService.BILLING_NOT_ENABLED
            );
        }

        const subscription: Stripe.Response<Stripe.Subscription> =
            await this.stripe.subscriptions.retrieve(subscriptionId);

        if (!subscription) {
            throw new BadDataException(
                Errors.BillingService.SUBSCRIPTION_NOT_FOUND
            );
        }

        if (subscription.status === 'canceled') {
            // subscription is canceled.
            return;
        }

        const subscriptionItemOptions: Stripe.SubscriptionItemDeleteParams =
            isMeteredSubscriptionItem
                ? {
                      proration_behavior: 'create_prorations',
                      clear_usage: true,
                  }
                : {};

        await this.stripe.subscriptionItems.del(
            subscriptionItemId,
            subscriptionItemOptions
        );
    }

    public async getSubscriptionItems(
        subscriptionId: string
    ): Promise<Array<SubscriptionItem>> {
        if (!this.isBillingEnabled()) {
            throw new BadDataException(
                Errors.BillingService.BILLING_NOT_ENABLED
            );
        }

        const subscription: Stripe.Response<Stripe.Subscription> =
            await this.stripe.subscriptions.retrieve(subscriptionId);

        if (!subscription) {
            throw new BadDataException(
                Errors.BillingService.SUBSCRIPTION_NOT_FOUND
            );
        }

        return subscription.items.data;
    }

    public async changePlan(data: {
        projectId: ObjectID;
        subscriptionId: string;
        meteredSubscriptionId: string;
        serverMeteredPlans: Array<ServerMeteredPlan>;
        newPlan: SubscriptionPlan;
        quantity: number;
        isYearly: boolean;
        endTrialAt?: Date | undefined;
    }): Promise<{
        subscriptionId: string;
        meteredSubscriptionId: string;
        trialEndsAt?: Date | undefined;
    }> {
        logger.debug('Changing plan');
        logger.debug(data);

        if (!this.isBillingEnabled()) {
            logger.debug(Errors.BillingService.BILLING_NOT_ENABLED);

            throw new BadDataException(
                Errors.BillingService.BILLING_NOT_ENABLED
            );
        }

        const subscription: Stripe.Response<Stripe.Subscription> =
            await this.stripe.subscriptions.retrieve(data.subscriptionId);

        logger.debug('Subscription');
        logger.debug(subscription);

        if (!subscription) {
            logger.debug(Errors.BillingService.SUBSCRIPTION_NOT_FOUND);
            throw new BadDataException(
                Errors.BillingService.SUBSCRIPTION_NOT_FOUND
            );
        }

        logger.debug('Subscription status');
        logger.debug(subscription.status);

        const paymentMethods: Array<PaymentMethod> =
            await this.getPaymentMethods(subscription.customer.toString());

        logger.debug('Payment methods');
        logger.debug(paymentMethods);

        if (paymentMethods.length === 0) {
            logger.debug('No payment methods');

            throw new BadDataException(
                Errors.BillingService.NO_PAYMENTS_METHODS
            );
        }

        logger.debug('Cancelling subscriptions');
        logger.debug(data.subscriptionId);
        await this.cancelSubscription(data.subscriptionId);

        logger.debug('Cancelling metered subscriptions');
        logger.debug(data.meteredSubscriptionId);
        await this.cancelSubscription(data.meteredSubscriptionId);

        if (data.endTrialAt && !OneUptimeDate.isInTheFuture(data.endTrialAt)) {
            data.endTrialAt = undefined;
        }

        logger.debug('Subscribing to plan');

        const subscribeToPlan: {
            subscriptionId: string;
            meteredSubscriptionId: string;
            trialEndsAt: Date | null;
        } = await this.subscribeToPlan({
            projectId: data.projectId,
            customerId: subscription.customer.toString(),
            serverMeteredPlans: data.serverMeteredPlans,
            plan: data.newPlan,
            quantity: data.quantity,
            isYearly: data.isYearly,
            trial: data.endTrialAt,
            defaultPaymentMethodId: paymentMethods[0]?.id,
            promoCode: undefined,
        });

        logger.debug('Subscribed to plan');

        const value: {
            subscriptionId: string;
            meteredSubscriptionId: string;
            trialEndsAt?: Date | undefined;
        } = {
            subscriptionId: subscribeToPlan.subscriptionId,
            meteredSubscriptionId: subscribeToPlan.meteredSubscriptionId,
            trialEndsAt: subscribeToPlan.trialEndsAt || undefined,
        };

        return value;
    }

    public async deletePaymentMethod(
        customerId: string,
        paymentMethodId: string
    ): Promise<void> {
        if (!this.isBillingEnabled()) {
            throw new BadDataException(
                Errors.BillingService.BILLING_NOT_ENABLED
            );
        }

        const paymentMethods: Array<PaymentMethod> =
            await this.getPaymentMethods(customerId);

        if (paymentMethods.length === 1) {
            throw new BadDataException(
                Errors.BillingService.MIN_REQUIRED_PAYMENT_METHOD_NOT_MET
            );
        }

        await this.stripe.paymentMethods.detach(paymentMethodId);
    }

    public async hasPaymentMethods(customerId: string): Promise<boolean> {
        if ((await this.getPaymentMethods(customerId)).length > 0) {
            return true;
        }

        return false;
    }

    public async setDefaultPaymentMethod(
        customerId: string,
        paymentMethodId: string
    ): Promise<void> {
        await this.stripe.customers.update(customerId, {
            invoice_settings: {
                default_payment_method: paymentMethodId,
            },
        });
    }

    public async getPaymentMethods(
        customerId: string
    ): Promise<Array<PaymentMethod>> {
        if (!this.isBillingEnabled()) {
            throw new BadDataException(
                Errors.BillingService.BILLING_NOT_ENABLED
            );
        }
        const paymentMethods: Array<PaymentMethod> = [];

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
            paymentMethods.push({
                type: item.card?.brand || 'Card',
                last4Digits: item.card?.last4 || 'xxxx',
                isDefault: false,
                id: item.id,
            });
        });

        bacsPaymentMethods.data.forEach((item: Stripe.PaymentMethod) => {
            paymentMethods.push({
                type: 'UK Bank Account',
                last4Digits: item.bacs_debit?.last4 || 'xxxx',
                isDefault: false,
                id: item.id,
            });
        });

        usBankPaymentMethods.data.forEach((item: Stripe.PaymentMethod) => {
            paymentMethods.push({
                type: 'US Bank Account',
                last4Digits: item.us_bank_account?.last4 || 'xxxx',
                isDefault: false,
                id: item.id,
            });
        });

        sepaPaymentMethods.data.forEach((item: Stripe.PaymentMethod) => {
            paymentMethods.push({
                type: 'EU Bank Account',
                last4Digits: item.sepa_debit?.last4 || 'xxxx',
                isDefault: false,
                id: item.id,
            });
        });

        // check if there's a default payment method.

        const customer: Stripe.Response<
            Stripe.Customer | Stripe.DeletedCustomer
        > = await this.stripe.customers.retrieve(customerId);

        if (
            (customer as Stripe.Customer).invoice_settings &&
            !(customer as Stripe.Customer).invoice_settings
                ?.default_payment_method
        ) {
            // set the first payment method as default.
            if (paymentMethods.length > 0 && paymentMethods[0]?.id) {
                await this.setDefaultPaymentMethod(
                    customerId,
                    paymentMethods[0]?.id
                );
            }
        }

        return paymentMethods;
    }

    public async getSetupIntentSecret(customerId: string): Promise<string> {
        const setupIntent: Stripe.Response<Stripe.SetupIntent> =
            await this.stripe.setupIntents.create({
                customer: customerId,
            });

        if (!setupIntent.client_secret) {
            throw new APIException(Errors.BillingService.CLIENT_SECRET_MISSING);
        }

        return setupIntent.client_secret;
    }

    public async cancelSubscription(subscriptionId: string): Promise<void> {
        if (!this.isBillingEnabled()) {
            throw new BadDataException(
                Errors.BillingService.BILLING_NOT_ENABLED
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
                Errors.BillingService.BILLING_NOT_ENABLED
            );
        }

        const subscription: Stripe.Response<Stripe.Subscription> =
            await this.stripe.subscriptions.retrieve(subscriptionId);

        return subscription;
    }

    public async getInvoices(customerId: string): Promise<Array<Invoice>> {
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

    public async generateInvoiceAndChargeCustomer(
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
            throw new APIException(Errors.BillingService.INVOICE_NOT_GENERATED);
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

    public async voidInvoice(invoiceId: string): Promise<Stripe.Invoice> {
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
                Errors.BillingService.NO_PAYMENTS_METHODS
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

    public getMeteredPlanPriceId(productType: ProductType): string {
        if (productType === ProductType.ActiveMonitoring) {
            if (this.isTestEnvironment()) {
                return 'price_1N6CHFANuQdJ93r7qDaLmb7S';
            }

            return 'price_1N6B9EANuQdJ93r7fj3bhcWP';
        }

        if (productType === ProductType.Logs) {
            if (this.isTestEnvironment()) {
                return 'price_1OPnB5ANuQdJ93r7jG4NLCJG';
            }

            return 'price_1OQ8gwANuQdJ93r74Pi85UQq';
        }

        if (productType === ProductType.Traces) {
            if (this.isTestEnvironment()) {
                return 'price_1OQ8i9ANuQdJ93r75J3wr0PX';
            }

            return 'price_1OQ8ivANuQdJ93r7NAR8KbH3';
        }

        if (productType === ProductType.Metrics) {
            if (this.isTestEnvironment()) {
                return 'price_1OQ8iqANuQdJ93r7wZ7gJ7Gb';
            }

            return 'price_1OQ8j0ANuQdJ93r7WGzR0p6j';
        }

        throw new BadDataException(
            'Plan with productType ' + productType + ' not found'
        );
    }
}

export default new BillingService();
