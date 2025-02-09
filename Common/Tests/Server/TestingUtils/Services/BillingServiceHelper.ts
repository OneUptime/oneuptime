import { BillingService } from "../../../../Server/Services/BillingService";
import {
  ChangePlan,
  CouponData,
  CustomerData,
  MeteredSubscription,
  Subscription,
} from "./Types";
import SubscriptionPlan from "Common/Types/Billing/SubscriptionPlan";
import Email from "Common/Types/Email";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import { Stripe } from "stripe";
import Faker from "../../../../Utils/Faker";

/// @dev consider modifyfing the EnvirontmentConfig to use functions instead of constants so that we can mock them

type MockIsBillingEnabledFunction = (value: boolean) => BillingService;

const mockIsBillingEnabled: MockIsBillingEnabledFunction = (
  value: boolean,
): BillingService => {
  jest.resetModules();
  jest.doMock("../../../../Server/BillingConfig", () => {
    return {
      IsBillingEnabled: value,
    };
  });
  const {
    BillingService,
  } = require("../../../../Server/Services/BillingService");
  return new BillingService();
};

type GetStripeCustomerFunction = (id?: string) => Stripe.Customer;

const getStripeCustomer: GetStripeCustomerFunction = (
  id?: string,
): Stripe.Customer => {
  id = id || Faker.generateRandomObjectID().toString();
  return {
    id,
    object: "customer",
    balance: Faker.getRandomNumbers(3),
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

type GetStripeSubscriptionFunction = () => Stripe.Subscription;

const getStripeSubscription: GetStripeSubscriptionFunction =
  (): Stripe.Subscription => {
    return {
      id: Faker.generateRandomObjectID().toString(),
      items: {
        data: [
          {
            id: Faker.generateRandomObjectID().toString(),
            // @ts-ignore
            price: {
              id: new BillingService().getMeteredPlanPriceId(
                ProductType.ActiveMonitoring,
              ),
            },
          },
        ],
      },
      status: "active",
      customer: getStripeCustomer(),
    };
  };

type GetSubscriptionPlanDataFunction = () => SubscriptionPlan;

const getSubscriptionPlanData: GetSubscriptionPlanDataFunction =
  (): SubscriptionPlan => {
    return new SubscriptionPlan(
      Faker.generateRandomObjectID().toString(), // monthlyPlanId
      Faker.generateRandomObjectID().toString(), // yearlyPlanId
      Faker.generateRandomString(), // name
      Faker.getNumberBetweenMinAndMax({ min: 1, max: 100 }), // monthlySubscriptionAmountInUSD
      Faker.getNumberBetweenMinAndMax({ min: 1, max: 100 }), // yearlySubscriptionAmountInUSD
      Faker.getNumberBetweenMinAndMax({ min: 1, max: 100 }), // order
      Faker.getNumberBetweenMinAndMax({ min: 1, max: 100 }), // trial period days
    );
  };

type GetStripeInvoiceFunction = () => Stripe.Invoice;

const getStripeInvoice: GetStripeInvoiceFunction = (): Stripe.Invoice => {
  // @ts-ignore
  return {
    id: Faker.generateRandomObjectID().toString(),
    amount_due: Faker.getNumberBetweenMinAndMax({ min: 1, max: 100 }),
    currency: "usd",
    customer: Faker.generateRandomObjectID().toString(),
    subscription: Faker.generateRandomObjectID().toString(),
    created: new Date().getTime() / 1000,
    number: Faker.generateRandomString(),
    status: "paid",
  };
};

type GetCustomerDataFunction = (id?: ObjectID) => CustomerData;

const getCustomerData: GetCustomerDataFunction = (
  id?: ObjectID,
): CustomerData => {
  return {
    id: id || new ObjectID("customer_id"),
    name: "John Doe",
    email: new Email("test@example.com"),
  };
};

type GetSubscriptionDataFunction = (id?: ObjectID) => Subscription;

const getSubscriptionData: GetSubscriptionDataFunction = (
  id?: ObjectID,
): Subscription => {
  return {
    projectId: id || new ObjectID("project_id"),
    customerId: "cust_123",
    serverMeteredPlans: [],
    trialDate: new Date(),
  };
};

type GetMeteredSubscriptionFunction = (
  subscriptionPlan: SubscriptionPlan,
  id?: ObjectID,
) => MeteredSubscription;

const getMeteredSubscription: GetMeteredSubscriptionFunction = (
  subscriptionPlan: SubscriptionPlan,
  id?: ObjectID,
): MeteredSubscription => {
  return {
    projectId: id || new ObjectID("project_id"),
    customerId: "cust_123",
    serverMeteredPlans: [],
    plan: subscriptionPlan,
    quantity: 1,
    isYearly: false,
    trial: true,
  };
};

type GetChangePlanDataFunction = (
  subscriptionPlan: SubscriptionPlan,
  id?: ObjectID,
) => ChangePlan;

const getChangePlanData: GetChangePlanDataFunction = (
  subscriptionPlan: SubscriptionPlan,
  id?: ObjectID,
): ChangePlan => {
  return {
    projectId: id || new ObjectID("project_id"),
    subscriptionId: "sub_123",
    meteredSubscriptionId: "sub_456",
    serverMeteredPlans: [],
    newPlan: subscriptionPlan,
    quantity: 1,
    isYearly: false,
  };
};

type GetCouponDataFunction = () => CouponData;

const getCouponData: GetCouponDataFunction = (): CouponData => {
  return {
    name: "TESTCOUPON",
    metadata: { description: "Test coupon" },
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
