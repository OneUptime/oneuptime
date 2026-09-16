import { BillingService } from "../../../../Server/Services/BillingService";
import {
  ChangePlan,
  CouponData,
  CustomerData,
  MeteredSubscription,
  Subscription,
} from "./Types";
import Email from "../../../../Types/Email";
import ProductType from "../../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../../Types/ObjectID";
import { Stripe } from "stripe";
import { resetStripeMock } from "../__mocks__/Stripe.mock";
import Faker from "../../../../Utils/Faker";
import SubscriptionPlan from "../../../../Types/Billing/SubscriptionPlan";

/// @dev consider modifyfing the EnvirontmentConfig to use functions instead of constants so that we can mock them

type MockIsBillingEnabledFunction = (value: boolean) => Promise<BillingService>;

type BillingServiceConstructor = new () => BillingService;

/*
 * One load of the module graph per IsBillingEnabled value, for the lifetime of
 * the test file.
 *
 * IsBillingEnabled is a const read at import time, so the only way to flip it
 * is to load BillingService against a mocked BillingConfig - but the reload
 * that gets us there drags in Project, ProjectService, MailService and the
 * model layer behind them, which is seconds of synchronous work each time.
 * BillingService.test.ts calls this in a beforeEach and again inside every
 * "billing is not enabled" test: ~120 reloads for 91 tests.
 *
 * Those reloads also do not start from nothing. TypeORM keeps its metadata on
 * globalThis (typeorm/globals.js), where jest.resetModules cannot reach it, so
 * each reload re-runs the @Entity/@Column decorators of every model and appends
 * to arrays that only ever grow. Each reload is slower than the one before it:
 * in CI the suite drifted from ~1.3s per test to ~3.6s, and on a bad run the
 * worker stopped making progress altogether and took Common Test shard 3 to its
 * 30 minute timeout with it - reliably enough to red master.
 *
 * Caching the constructor keeps what the tests actually asked for, a service
 * built against a chosen IsBillingEnabled, and pays for the graph twice instead
 * of 120 times. Each call still returns a new BillingService, and still gets an
 * untouched Stripe - the reload used to supply that as a side effect, so it is
 * now asked for directly.
 */
const billingServiceByEnabledFlag: Map<boolean, BillingServiceConstructor> =
  new Map();

const mockIsBillingEnabled: MockIsBillingEnabledFunction = async (
  value: boolean,
): Promise<BillingService> => {
  let billingServiceConstructor: BillingServiceConstructor | undefined =
    billingServiceByEnabledFlag.get(value);

  if (!billingServiceConstructor) {
    jest.resetModules();
    jest.doMock("../../../../Server/BillingConfig", () => {
      return {
        IsBillingEnabled: value,
      };
    });
    const { BillingService: LoadedBillingService } = await import(
      "../../../../Server/Services/BillingService"
    );
    billingServiceConstructor = LoadedBillingService;
    billingServiceByEnabledFlag.set(value, billingServiceConstructor);
  }

  resetStripeMock();

  return new billingServiceConstructor();
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

type GetStripeSubscriptionFunction = (options?: {
  id?: string | undefined;
  status?: Stripe.Subscription.Status | undefined;

  /*
   * The trial Stripe itself reports on the subscription, as a unix timestamp -
   * what a real subscription carries and what changePlan reads to make sure a
   * plan change cannot cut a running trial short. Omitted means no trial.
   */
  trialEnd?: number | null | undefined;
  customer?: string | undefined;

  /*
   * The id of the subscription's single item - the handle changePlan swaps the
   * new plan's price onto. An empty array stands for a subscription with no
   * items at all, which has no such handle.
   */
  itemId?: string | undefined;
  items?: Array<{ id: string }> | undefined;
}) => Stripe.Subscription;

const getStripeSubscription: GetStripeSubscriptionFunction = (options?: {
  id?: string | undefined;
  status?: Stripe.Subscription.Status | undefined;
  trialEnd?: number | null | undefined;
  customer?: string | undefined;
  itemId?: string | undefined;
  items?: Array<{ id: string }> | undefined;
}): Stripe.Subscription => {
  const items: Array<{ id: string }> = options?.items || [
    { id: options?.itemId || Faker.generateRandomObjectID().toString() },
  ];

  return {
    id: options?.id || Faker.generateRandomObjectID().toString(),
    items: {
      data: items.map((item: { id: string }) => {
        // Simplified mock item: only the fields the service actually reads.
        return {
          id: item.id,
          price: {
            id: new BillingService().getMeteredPlanPriceId(
              ProductType.ActiveMonitoring,
            ),
          },
        } as Stripe.SubscriptionItem;
      }),
    },
    status: options?.status || "active",
    trial_end: options?.trialEnd ?? null,
    customer: options?.customer || getStripeCustomer(),
  } as Stripe.Subscription;
};

/*
 * A plan with an exact trial period, for the cases where the trial length is
 * the thing under test. getSubscriptionPlanData randomises it between 1 and
 * 100, so it can never produce the 0-trial-day plans (Basic, Scale) that the
 * mid-trial plan change has to keep trialing.
 */
type GetSubscriptionPlanWithTrialPeriodFunction = (
  trialPeriodInDays: number,
  options?: {
    name?: string | undefined;
    monthlyPlanId?: string | undefined;
    yearlyPlanId?: string | undefined;
  },
) => SubscriptionPlan;

const getSubscriptionPlanWithTrialPeriod: GetSubscriptionPlanWithTrialPeriodFunction =
  (
    trialPeriodInDays: number,
    options?: {
      name?: string | undefined;
      monthlyPlanId?: string | undefined;
      yearlyPlanId?: string | undefined;
    },
  ): SubscriptionPlan => {
    return new SubscriptionPlan(
      options?.monthlyPlanId || "price_monthly_test_plan",
      options?.yearlyPlanId || "price_yearly_test_plan",
      options?.name || "Scale",
      99, // monthlySubscriptionAmountInUSD
      84, // yearlySubscriptionAmountInUSD
      3, // order
      trialPeriodInDays,
    );
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
  // @ts-expect-error - Simplified mock invoice object for testing without all required Stripe Invoice properties
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
  getSubscriptionPlanWithTrialPeriod,
  getCustomerData,
  getSubscriptionData,
  getMeteredSubscription,
  getChangePlanData,
  getCouponData,
  getStripeInvoice,
};
