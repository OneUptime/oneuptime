import { Stripe } from 'stripe';
import { faker } from '@faker-js/faker';

import Email from 'Common/Types/Email';
import ObjectID from 'Common/Types/ObjectID';
import SubscriptionPlan from 'Common/Types/Billing/SubscriptionPlan';

import { BillingService } from '../../../Services/BillingService';

import {
    CustomerData,
    Subscription,
    MeteredSubscription,
    ChangePlan,
    CouponData,
} from '../../TestingUtils/Services/Types';

/// @dev consider modifyfing the EnvirontmentConfig to use functions instead of constants so that we can mock them
const mockIsBillingEnabled: Function = (value: boolean): BillingService => {
    jest.resetModules();
    jest.doMock('../../../EnvironmentConfig', () => {
        return {
            IsBillingEnabled: value,
        };
    });
    const { BillingService } = require('../../../Services/BillingService');
    return new BillingService();
};

const getStripeCustomer: Function = (id?: string): Stripe.Customer => {
    id = id || faker.datatype.uuid();
    return {
        id,
        object: 'customer',
        balance: faker.datatype.number(),
        created: 1,
        default_source: null,
        description: null,
        email: null,
        invoice_settings: {
            custom_fields: null,
            default_payment_method: null,
            footer: null,
            rendering_options: null,
        },
        livemode: true,
        metadata: {},
        shipping: null,
    };
};

const getStripeSubscription: Function = (): Stripe.Subscription => {
    return {
        id: faker.datatype.uuid(),
        items: {
            data: [
                {
                    id: faker.datatype.uuid(),
                    // @ts-ignore
                    price: { id: faker.datatype.uuid() },
                },
            ],
        },
        status: 'active',
        customer: getStripeCustomer(),
    };
};

const getSubscriptionPlanData: Function = (): SubscriptionPlan => {
    return new SubscriptionPlan(
        faker.datatype.uuid(), // monthlyPlanId
        faker.datatype.uuid(), // yearlyPlanId
        faker.commerce.productName(), // name
        faker.datatype.number(), // monthlySubscriptionAmountInUSD
        faker.datatype.number({ min: 1, max: 100 }), // yearlySubscriptionAmountInUSD
        faker.datatype.number({ min: 1, max: 100 }), // order
        faker.datatype.number({ min: 1, max: 100 }) // trial period days
    );
};

const getStripeInvoice: Function = (): Stripe.Invoice => {
    // @ts-ignore
    return {
        id: faker.datatype.uuid(),
        amount_due: faker.datatype.number(),
        currency: 'usd',
        customer: faker.datatype.uuid(),
        subscription: faker.datatype.uuid(),
        status: 'paid',
    };
};

const getCustomerData: Function = (id?: ObjectID): CustomerData => {
    return {
        id: id || new ObjectID('customer_id'),
        name: 'John Doe',
        email: new Email('test@example.com'),
    };
};

const getSubscriptionData: Function = (id?: ObjectID): Subscription => {
    return {
        projectId: id || new ObjectID('project_id'),
        customerId: 'cust_123',
        serverMeteredPlans: [],
        trialDate: new Date(),
    };
};

const getMeteredSubscription: Function = (
    subscriptionPlan: SubscriptionPlan,
    id?: ObjectID
): MeteredSubscription => {
    return {
        projectId: id || new ObjectID('project_id'),
        customerId: 'cust_123',
        serverMeteredPlans: [],
        plan: subscriptionPlan,
        quantity: 1,
        isYearly: false,
        trial: true,
    };
};

const getChangePlanData: Function = (
    subscriptionPlan: SubscriptionPlan,
    id?: ObjectID
): ChangePlan => {
    return {
        projectId: id || new ObjectID('project_id'),
        subscriptionId: 'sub_123',
        meteredSubscriptionId: 'sub_456',
        serverMeteredPlans: [],
        newPlan: subscriptionPlan,
        quantity: 1,
        isYearly: false,
    };
};

const getCouponData: Function = (): CouponData => {
    return {
        name: 'TESTCOUPON',
        metadata: { description: 'Test coupon' },
        percentOff: 10,
        durationInMonths: 3,
        maxRedemptions: 100,
    };
};

export {
    mockIsBillingEnabled,
    getStripeCustomer,
    getStripeSubscription,
    getSubscriptionPlanData,
    getCustomerData,
    getSubscriptionData,
    getMeteredSubscription,
    getChangePlanData,
    getCouponData,
    getStripeInvoice,
};
