// First, so the Stripe client the Billing area builds is the mocked one.
import { Stripe, mockStripe } from "./Helpers/Stripe.mock";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The Billing area of the enterprise module: OneUptime Cloud's payment
 * provider, Stripe, which core's BillingService hands every payment-provider
 * call to (EnterpriseEdition.getBillingProvider). Only with billing on: with
 * billing off there is no provider and no Stripe client is ever built, so a
 * self-hosted installation never talks to Stripe.
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

import BillingArea, { getBillingProvider } from "../../../Server/Billing/Index";
import StripeBillingProvider from "../../../Server/Billing/StripeBillingProvider";
import EnterpriseModule, { ENTERPRISE_AREAS } from "../../../Server/Index";
import EnterpriseArea from "../../../Server/Types/EnterpriseArea";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import BillingService from "Common/Server/Services/BillingService";
import BillingProvider from "Common/Server/Types/Billing/BillingProvider";
import Errors from "Common/Server/Utils/Errors";
import logger from "Common/Server/Utils/Logger";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

/*
 * Every method of BillingProvider. The type makes the list complete: a
 * method added to the provider's interface and missing here, or named here
 * and not on it, is a compile error.
 */
const PROVIDER_METHODS: Record<keyof BillingProvider, true> = {
  createCustomer: true,
  updateCustomerName: true,
  updateCustomerBusinessDetails: true,
  deleteCustomer: true,
  subscribeToMeteredPlan: true,
  generateCouponCode: true,
  subscribeToPlan: true,
  changeQuantity: true,
  addOrUpdateMeteredPricingOnSubscription: true,
  isPromoCodeValid: true,
  removeSubscriptionItem: true,
  getSubscriptionItems: true,
  changePlan: true,
  deletePaymentMethod: true,
  makePaymentMethodDefault: true,
  hasPaymentMethods: true,
  getMeteredBillingStartDate: true,
  setDefaultPaymentMethod: true,
  syncSubscriptionPaymentMethodsWithCustomerDefault: true,
  getPaymentMethods: true,
  getSetupIntentSecret: true,
  getCustomerBalance: true,
  cancelSubscription: true,
  cancelSubscriptionWithFinalInvoice: true,
  extendTrial: true,
  getSubscriptionStatus: true,
  getSubscription: true,
  getInvoice: true,
  getPaymentIntentClientSecret: true,
  getPaymentIntent: true,
  getPaymentIntentIdFromInvoice: true,
  getInvoices: true,
  sendInvoiceByEmail: true,
  shouldSendInvoicesByEmail: true,
  generateInvoiceAndChargeCustomer: true,
  voidInvoice: true,
  payInvoice: true,
  verifyWebhookSignature: true,
  handleWebhookEvent: true,
};

const stripeConstructions: () => number = (): number => {
  return (Stripe as unknown as { mock: { calls: Array<unknown> } }).mock.calls
    .length;
};

beforeAll(() => {
  jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });
});

afterAll(() => {
  EnterpriseEdition.resetForTests();
  jest.restoreAllMocks();
});

beforeEach(() => {
  setTestBillingEnabled(false);
});

afterEach(() => {
  setTestBillingEnabled(false);
  EnterpriseEdition.resetForTests();
});

describe("the Billing area", () => {
  test("is one of the enterprise module's areas, before CloudMarketplace", () => {
    const names: Array<string> = ENTERPRISE_AREAS.map(
      (area: EnterpriseArea): string => {
        return area.name;
      },
    );

    expect(ENTERPRISE_AREAS).toContain(BillingArea);
    expect(BillingArea.name).toBe("Billing");
    expect(names.indexOf("Billing")).toBeLessThan(
      names.indexOf("CloudMarketplace"),
    );
  });

  test("adds no route and no job: Stripe's webhook stays core's BillingAPI", () => {
    expect(BillingArea.getApiRouters).toBeUndefined();
    expect(BillingArea.getIdentityRouters).toBeUndefined();
    expect(BillingArea.registerWorkerJobs).toBeUndefined();
  });
});

/*
 * In this order: the Stripe client is built at most once per process, so the
 * billing-off case has to come first to see that it is never built.
 */
describe("the payment provider", () => {
  test("with billing off there is none, and no Stripe client is built", () => {
    expect(getBillingProvider()).toBeNull();
    expect(EnterpriseModule.getBillingProvider?.()).toBeNull();
    expect(stripeConstructions()).toBe(0);
  });

  test("with billing on it is the process's one StripeBillingProvider, built on the first ask", () => {
    setTestBillingEnabled(true);

    const provider: BillingProvider | null = getBillingProvider();

    expect(provider).toBeInstanceOf(StripeBillingProvider);
    expect(getBillingProvider()).toBe(provider);
    expect(EnterpriseModule.getBillingProvider?.()).toBe(provider);
    expect(stripeConstructions()).toBe(1);
  });

  test("goes again with billing off, without building anything", () => {
    expect(getBillingProvider()).toBeNull();
    expect(stripeConstructions()).toBe(1);
  });

  test("implements every method of BillingProvider, and core's BillingService hands each one over", () => {
    setTestBillingEnabled(true);

    const provider: BillingProvider = getBillingProvider()!;

    for (const method of Object.keys(PROVIDER_METHODS)) {
      expect({
        method,
        provider: typeof (provider as unknown as Record<string, unknown>)[
          method
        ],
        facade: typeof (BillingService as unknown as Record<string, unknown>)[
          method
        ],
      }).toEqual({ method, provider: "function", facade: "function" });
    }
  });
});

describe("core's BillingService, with the enterprise module loaded", () => {
  beforeEach(() => {
    EnterpriseEdition.resetForTests();
    EnterpriseEdition.register(EnterpriseModule);
    (
      mockStripe.customers.retrieve as unknown as {
        mockReset: () => void;
        mockResolvedValue: (value: unknown) => void;
      }
    ).mockReset();
    (
      mockStripe.customers.retrieve as unknown as {
        mockResolvedValue: (value: unknown) => void;
      }
    ).mockResolvedValue({ id: "cus_1", balance: -1250 });
  });

  const retrieveCalls: () => number = (): number => {
    return (
      mockStripe.customers.retrieve as unknown as {
        mock: { calls: Array<unknown> };
      }
    ).mock.calls.length;
  };

  test("reaches Stripe through the module's provider with billing on, as OneUptime Cloud does", async () => {
    setTestBillingEnabled(true);

    await expect(BillingService.getCustomerBalance("cus_1")).resolves.toBe(
      -12.5,
    );
    expect(retrieveCalls()).toBe(1);
  });

  test("never reaches Stripe with billing off", async () => {
    await expect(BillingService.getCustomerBalance("cus_1")).rejects.toThrow(
      Errors.BillingService.BILLING_NOT_ENABLED,
    );
    await expect(
      BillingService.shouldSendInvoicesByEmail("cus_1"),
    ).resolves.toBe(false);
    expect(retrieveCalls()).toBe(0);
  });

  test("never reaches Stripe on the Community Edition, even with billing on", async () => {
    EnterpriseEdition.resetForTests();
    setTestBillingEnabled(true);

    await expect(BillingService.getCustomerBalance("cus_1")).rejects.toThrow(
      Errors.BillingService.BILLING_NOT_ENABLED,
    );
    expect(retrieveCalls()).toBe(0);
  });
});
