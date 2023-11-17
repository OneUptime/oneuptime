import Email from 'Common/Types/Email';
import ObjectID from 'Common/Types/ObjectID';
import ServerMeteredPlan from '../../../Types/Billing/MeteredPlan/ServerMeteredPlan';
import SubscriptionPlan from 'Common/Types/Billing/SubscriptionPlan';
import { PaymentMethod } from '../../../Services/BillingService';
import Dictionary from 'Common/Types/Dictionary';

export type CustomerData = {
    id: ObjectID;
    name: string;
    email: Email;
};

export type CouponData = {
    name: string;
    metadata?: Dictionary<string> | undefined;
    percentOff: number;
    durationInMonths: number;
    maxRedemptions: number;
};

export type Subscription = {
    projectId: ObjectID;
    customerId: string;
    serverMeteredPlans: Array<typeof ServerMeteredPlan>;
    promoCode?: string;
    defaultPaymentMethodId?: string;
    trialDate: Date;
};

export type MeteredSubscription = {
    projectId: ObjectID;
    customerId: string;
    serverMeteredPlans: Array<typeof ServerMeteredPlan>;
    plan: SubscriptionPlan;
    quantity: number;
    isYearly: boolean;
    trial: boolean | Date | undefined;
    defaultPaymentMethodId?: string | undefined;
    promoCode?: string | undefined;
};

export type ChangePlan = {
    projectId: ObjectID;
    subscriptionId: string;
    meteredSubscriptionId: string;
    serverMeteredPlans: Array<typeof ServerMeteredPlan>;
    newPlan: SubscriptionPlan;
    quantity: number;
    isYearly: boolean;
    endTrialAt?: Date | undefined;
};

export type PaymentMethodsResponse = {
    data: PaymentMethod[];
    defaultPaymentMethodId?: string | undefined;
};
