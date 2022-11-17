import SubscriptionPlan from 'Common/Types/Billing/SubscriptionPlan';
import OneUptimeDate from 'Common/Types/Date';
import APIException from 'Common/Types/Exception/ApiException';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ObjectID from 'Common/Types/ObjectID';
import Stripe from 'stripe';
import { BillingPrivateKey, IsBillingEnabled } from '../Config';

export interface PaymentMethod {
    id: string;
    type: string;
    last4Digits: string;
    isDefault: boolean;
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
        hasTrial: boolean
    ): Promise<{
        id: string;
        trialEndsAt: Date;
    }> {
        if (!this.isBillingEnabled()) {
            throw new BadDataException(
                'Billing is not enabled for this server.'
            );
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
                    hasTrial && plan.getTrialPeriod() > 0
                        ? OneUptimeDate.toUnixTimestamp(
                              OneUptimeDate.getSomeDaysAfter(
                                  plan.getTrialPeriod()
                              )
                          )
                        : 'now',
            });

        return {
            id: subscription.id,
            trialEndsAt: hasTrial
                ? OneUptimeDate.getSomeDaysAfter(plan.getTrialPeriod())
                : OneUptimeDate.getCurrentDate(),
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

        const subscription = await this.stripe.subscriptions.retrieve(
            subscriptionId
        );

        if (!subscription) {
            throw new BadDataException('Subscription not found');
        }

        const subscriptionItemId = subscription.items.data[0]?.id;

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

        let subscription = await this.stripe.subscriptions.retrieve(
            subscriptionId
        );

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

        subscription = await this.stripe.subscriptions.update(subscriptionId, {
            items: [
                {
                    price: isYearly
                        ? newPlan.getYearlyPlanId()
                        : newPlan.getMonthlyPlanId(),
                    quantity: quantity,
                },
            ],
            trial_end:
                endTrialAt && OneUptimeDate.isInTheFuture(endTrialAt)
                    ? OneUptimeDate.toUnixTimestamp(endTrialAt)
                    : 'now',
        });

        const subscriptionItemId = subscription.items.data[0]?.id;

        if (!subscriptionItemId) {
            throw new BadDataException('Subscription Item not found');
        }

        await this.stripe.subscriptionItems.del(subscriptionItemId);

        return {
            id: subscription.id,
            trialEndsAt: endTrialAt,
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

        const paymenMethods = await this.getPaymentMethods(customerId);
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

        const cardPaymentMethods = await this.stripe.paymentMethods.list({
            customer: customerId,
            type: 'card',
        });

        const sepaPaymentMethods = await this.stripe.paymentMethods.list({
            customer: customerId,
            type: 'sepa_debit',
        });

        const usBankPaymentMethods = await this.stripe.paymentMethods.list({
            customer: customerId,
            type: 'us_bank_account',
        });

        const bacsPaymentMethods = await this.stripe.paymentMethods.list({
            customer: customerId,
            type: 'bacs_debit',
        });

        cardPaymentMethods.data.forEach((item) => {
            paymenMethods.push({
                type: item.card?.brand || 'Card',
                last4Digits: item.card?.last4 || 'xxxx',
                isDefault: false,
                id: item.id,
            });
        });

        bacsPaymentMethods.data.forEach((item) => {
            paymenMethods.push({
                type: 'UK Bank Account',
                last4Digits: item.bacs_debit?.last4 || 'xxxx',
                isDefault: false,
                id: item.id,
            });
        });

        usBankPaymentMethods.data.forEach((item) => {
            paymenMethods.push({
                type: 'US Bank Account',
                last4Digits: item.us_bank_account?.last4 || 'xxxx',
                isDefault: false,
                id: item.id,
            });
        });

        sepaPaymentMethods.data.forEach((item) => {
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
}

export default BillingService;
