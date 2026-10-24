/*
 * Billing is pinned per test (CI's config.env sets BILLING_ENABLED=true), and
 * BILLING_PRIVATE_KEY is a test key, so the metered price ids are the test
 * ones.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  const mocked: Record<string, unknown> = billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );

  mocked["BillingPrivateKey"] = "sk_test_billing_facade";

  return mocked;
});

import BillingService, {
  BillingService as BillingServiceClass,
  Invoice,
  MAX_TRIAL_LENGTH_IN_DAYS,
  PaymentMethod,
} from "../../../Server/Services/BillingService";
import type BillingProvider from "../../../Server/Types/Billing/BillingProvider";
import {
  ActiveMonitoringMeteredPlan,
  LogDataIngestMeteredPlan,
  SessionReplayDataIngestMeteredPlan,
} from "../../../Server/Types/Billing/MeteredPlan/AllMeteredPlans";
import Errors from "../../../Server/Utils/Errors";
import logger from "../../../Server/Utils/Logger";
import SubscriptionPlan from "../../../Types/Billing/SubscriptionPlan";
import SubscriptionStatus, {
  SubscriptionStatusUtil,
} from "../../../Types/Billing/SubscriptionStatus";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import FakeEnterpriseModule, {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";

/*
 * Core's BillingService is a facade: OneUptime Cloud's payment provider
 * (Stripe) lives in the enterprise module, which registers it with
 * EnterpriseEdition (getBillingProvider). Every caller in core, and every core
 * test that spies on BillingService, sees the same singleton, method names
 * and signatures as before.
 *
 *   - Without a provider - the Community Edition, billing off, a module that
 *     answers null or throws - every method answers as a server without
 *     billing does: what reads or changes a payment provider's records throws
 *     BILLING_NOT_ENABLED, shouldSendInvoicesByEmail is false and
 *     handleWebhookEvent ignores the event. Nothing reaches a payment
 *     provider - not even a provider the module hands out while billing is
 *     off.
 *   - With billing on and a provider, every method hands its call to the
 *     provider with exactly its arguments and answers what the provider
 *     answers.
 *   - isBillingEnabled, isSubscriptionActive, isTestEnvironment and the
 *     metered price ids never need the provider.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OWNER_EMAIL: Email = new Email("owner@acme.example");
const TRIAL_END: Date = new Date("2030-01-31T00:00:00.000Z");

const PLAN: SubscriptionPlan = new SubscriptionPlan(
  "price_growth_monthly",
  "price_growth_yearly",
  "Growth",
  22,
  240,
  2,
  14,
);

const CARD: PaymentMethod = {
  id: "pm_card",
  type: "visa",
  last4Digits: "4242",
  isDefault: true,
};

const INVOICE: Invoice = {
  id: "in_1",
  amount: 2200,
  currencyCode: "usd",
  status: "paid",
  downloadableLink: "https://pay.stripe.example/in_1.pdf",
  customerId: "cus_1",
  invoiceDate: new Date("2030-01-01T00:00:00.000Z"),
  invoiceNumber: "OU-0001",
};

const WEBHOOK_EVENT: { id: string; type: string } = {
  id: "evt_1",
  type: "invoice.finalized",
};

/*
 * One call of every method that reaches the payment provider: its arguments,
 * and what a provider answers. The list is every method of BillingProvider
 * (ee's type-checked tests hold the provider and this facade to it).
 */
interface ProviderCall {
  method: keyof BillingProvider;
  args: Array<unknown>;
  result: unknown;
  // Answered synchronously (verifyWebhookSignature).
  isSync?: boolean | undefined;
}

const PROVIDER_CALLS: Array<ProviderCall> = [
  {
    method: "createCustomer",
    args: [{ name: "Acme", id: PROJECT_ID, email: OWNER_EMAIL }],
    result: "cus_1",
  },
  { method: "updateCustomerName", args: ["cus_1", "Acme"], result: undefined },
  {
    method: "updateCustomerBusinessDetails",
    args: [
      "cus_1",
      "Acme Inc\n1 Main Street",
      "US",
      "billing@acme.example",
      true,
    ],
    result: undefined,
  },
  { method: "deleteCustomer", args: ["cus_1"], result: undefined },
  {
    method: "subscribeToMeteredPlan",
    args: [
      {
        projectId: PROJECT_ID,
        customerId: "cus_1",
        serverMeteredPlans: [ActiveMonitoringMeteredPlan],
        trialDate: TRIAL_END,
      },
    ],
    result: { meteredSubscriptionId: "sub_metered", trialEndsAt: TRIAL_END },
  },
  {
    method: "generateCouponCode",
    args: [
      {
        name: "RESELLER",
        percentOff: 20,
        durationInMonths: 12,
        maxRedemptions: 1,
      },
    ],
    result: "coupon_1",
  },
  {
    method: "subscribeToPlan",
    args: [
      {
        projectId: PROJECT_ID,
        customerId: "cus_1",
        serverMeteredPlans: [ActiveMonitoringMeteredPlan],
        plan: PLAN,
        quantity: 3,
        isYearly: false,
        trial: true,
      },
    ],
    result: {
      subscriptionId: "sub_1",
      meteredSubscriptionId: "sub_metered",
      trialEndsAt: TRIAL_END,
    },
  },
  { method: "changeQuantity", args: ["sub_1", 4], result: undefined },
  {
    method: "addOrUpdateMeteredPricingOnSubscription",
    args: ["sub_metered", LogDataIngestMeteredPlan, 12, undefined],
    result: undefined,
  },
  { method: "isPromoCodeValid", args: ["PROMO"], result: true },
  {
    method: "removeSubscriptionItem",
    args: ["sub_metered", "si_1", true],
    result: undefined,
  },
  { method: "getSubscriptionItems", args: ["sub_1"], result: [{ id: "si_1" }] },
  {
    method: "changePlan",
    args: [
      {
        projectId: PROJECT_ID,
        subscriptionId: "sub_1",
        meteredSubscriptionId: "sub_metered",
        serverMeteredPlans: [ActiveMonitoringMeteredPlan],
        newPlan: PLAN,
        quantity: 3,
        isYearly: true,
        endTrialAt: TRIAL_END,
      },
    ],
    result: {
      subscriptionId: "sub_2",
      meteredSubscriptionId: "sub_metered",
      trialEndsAt: TRIAL_END,
      subscriptionIdsPendingCancellation: [],
    },
  },
  {
    method: "deletePaymentMethod",
    args: ["cus_1", "pm_card"],
    result: undefined,
  },
  {
    method: "makePaymentMethodDefault",
    args: ["cus_1", "pm_card"],
    result: undefined,
  },
  { method: "hasPaymentMethods", args: ["cus_1"], result: true },
  {
    method: "getMeteredBillingStartDate",
    args: ["cus_1"],
    result: new Date("2029-12-01T00:00:00.000Z"),
  },
  {
    method: "setDefaultPaymentMethod",
    args: ["cus_1", "pm_card"],
    result: undefined,
  },
  {
    method: "syncSubscriptionPaymentMethodsWithCustomerDefault",
    args: ["cus_1"],
    result: ["sub_1"],
  },
  { method: "getPaymentMethods", args: ["cus_1"], result: [CARD] },
  { method: "getSetupIntentSecret", args: ["cus_1"], result: "seti_secret" },
  { method: "getCustomerBalance", args: ["cus_1"], result: -12.5 },
  { method: "cancelSubscription", args: ["sub_1"], result: undefined },
  {
    method: "cancelSubscriptionWithFinalInvoice",
    args: ["sub_1"],
    result: undefined,
  },
  {
    method: "extendTrial",
    args: [
      {
        subscriptionId: "sub_1",
        meteredSubscriptionId: "sub_metered",
        trialEndsAt: TRIAL_END,
      },
    ],
    result: undefined,
  },
  {
    method: "getSubscriptionStatus",
    args: ["sub_1"],
    result: SubscriptionStatus.Active,
  },
  { method: "getSubscription", args: ["sub_1"], result: { id: "sub_1" } },
  { method: "getInvoice", args: ["cus_1", "in_1"], result: INVOICE },
  {
    method: "getPaymentIntentClientSecret",
    args: ["pi_1"],
    result: "pi_secret",
  },
  {
    method: "getPaymentIntent",
    args: ["pi_1"],
    result: {
      id: "pi_1",
      status: "requires_action",
      clientSecret: "pi_secret",
      paymentMethodId: "pm_card",
      lastPaymentErrorMessage: undefined,
    },
  },
  { method: "getPaymentIntentIdFromInvoice", args: ["in_1"], result: "pi_1" },
  { method: "getInvoices", args: ["cus_1"], result: [INVOICE] },
  {
    method: "sendInvoiceByEmail",
    args: ["in_1", [OWNER_EMAIL], PROJECT_ID],
    result: undefined,
  },
  { method: "shouldSendInvoicesByEmail", args: ["cus_1"], result: true },
  {
    method: "generateInvoiceAndChargeCustomer",
    args: [
      "cus_1",
      "SMS and call balance",
      20,
      { sendInvoiceByEmail: true, projectId: PROJECT_ID },
    ],
    result: undefined,
  },
  {
    method: "voidInvoice",
    args: ["in_1"],
    result: { id: "in_1", status: "void" },
  },
  {
    method: "payInvoice",
    args: ["cus_1", "in_1", { canSurfaceAuthenticationPrompt: true }],
    result: INVOICE,
  },
  {
    method: "verifyWebhookSignature",
    args: ['{"id":"evt_1"}', "t=1,v1=signature"],
    result: WEBHOOK_EVENT,
    isSync: true,
  },
  { method: "handleWebhookEvent", args: [WEBHOOK_EVENT], result: undefined },
];

// What a server without billing answers, where it is not BILLING_NOT_ENABLED.
const ANSWERS_WITHOUT_BILLING: Partial<Record<keyof BillingProvider, unknown>> =
  {
    shouldSendInvoicesByEmail: false,
    handleWebhookEvent: undefined,
  };

type MockedProvider = Record<keyof BillingProvider, jest.Mock>;

const createProvider: () => MockedProvider = (): MockedProvider => {
  const provider: Partial<MockedProvider> = {};

  for (const call of PROVIDER_CALLS) {
    provider[call.method] = call.isSync
      ? jest.fn().mockReturnValue(call.result)
      : jest.fn().mockResolvedValue(call.result as never);
  }

  return provider as MockedProvider;
};

const callFacade: (call: ProviderCall) => unknown = (
  call: ProviderCall,
): unknown => {
  return (
    BillingService as unknown as Record<
      string,
      (...args: Array<unknown>) => unknown
    >
  )[call.method]!(...call.args);
};

// The facade's answer to one call: a value, or the error it threw or rejected with.
const settle: (
  call: ProviderCall,
) => Promise<{ value?: unknown; error?: unknown }> = async (
  call: ProviderCall,
): Promise<{ value?: unknown; error?: unknown }> => {
  try {
    return { value: await callFacade(call) };
  } catch (error) {
    return { error };
  }
};

const expectBillingDisabledAnswer: (
  call: ProviderCall,
) => Promise<void> = async (call: ProviderCall): Promise<void> => {
  const answer: { value?: unknown; error?: unknown } = await settle(call);

  if (call.method in ANSWERS_WITHOUT_BILLING) {
    expect({ method: call.method, answer }).toEqual({
      method: call.method,
      answer: { value: ANSWERS_WITHOUT_BILLING[call.method] },
    });
    return;
  }

  expect({ method: call.method, error: answer.error }).toEqual({
    method: call.method,
    error: new BadDataException(Errors.BillingService.BILLING_NOT_ENABLED),
  });
  expect(answer.error).toBeInstanceOf(BadDataException);
};

beforeEach(() => {
  setTestBillingEnabled(false);
  uninstallEnterpriseModule();
  jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("BillingService keeps its shape", () => {
  it("is still the BillingService singleton every caller imports", () => {
    expect(BillingService).toBeInstanceOf(BillingServiceClass);
  });

  it.each(
    PROVIDER_CALLS.map((call: ProviderCall) => {
      return [call.method];
    }),
  )("has %s, which reaches the payment provider", (method: string) => {
    expect(
      typeof (BillingService as unknown as Record<string, unknown>)[method],
    ).toBe("function");
  });

  it("keeps the trial ceiling for its callers", () => {
    expect(MAX_TRIAL_LENGTH_IN_DAYS).toBe(730);
  });
});

describe("without a payment provider, BillingService answers as a server without billing does", () => {
  it.each(
    PROVIDER_CALLS.map((call: ProviderCall): [string, ProviderCall] => {
      return [call.method, call];
    }),
  )(
    "%s, on the Community Edition with billing on",
    async (_method: string, call: ProviderCall) => {
      setTestBillingEnabled(true);

      await expectBillingDisabledAnswer(call);
    },
  );

  it.each(
    PROVIDER_CALLS.map((call: ProviderCall): [string, ProviderCall] => {
      return [call.method, call];
    }),
  )(
    "%s, on the Community Edition with billing off",
    async (_method: string, call: ProviderCall) => {
      await expectBillingDisabledAnswer(call);
    },
  );

  it.each(
    PROVIDER_CALLS.map((call: ProviderCall): [string, ProviderCall] => {
      return [call.method, call];
    }),
  )(
    "%s, when the enterprise module has no provider for it",
    async (_method: string, call: ProviderCall) => {
      setTestBillingEnabled(true);
      installFakeEnterpriseModule({ billingProvider: null });

      await expectBillingDisabledAnswer(call);
    },
  );

  it.each(
    PROVIDER_CALLS.map((call: ProviderCall): [string, ProviderCall] => {
      return [call.method, call];
    }),
  )(
    "%s, when the enterprise module fails to hand one out",
    async (_method: string, call: ProviderCall) => {
      setTestBillingEnabled(true);
      const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
        billingProvider: createProvider() as unknown as BillingProvider,
      });
      fake.billingProviderError = new Error("Stripe would not start");

      await expectBillingDisabledAnswer(call);
    },
  );

  it.each(
    PROVIDER_CALLS.map((call: ProviderCall): [string, ProviderCall] => {
      return [call.method, call];
    }),
  )(
    "%s never reaches a provider while billing is off, even one the module hands out",
    async (_method: string, call: ProviderCall) => {
      const provider: MockedProvider = createProvider();
      installFakeEnterpriseModule({
        billingProvider: provider as unknown as BillingProvider,
      });

      await expectBillingDisabledAnswer(call);

      for (const method of Object.keys(provider)) {
        expect({
          method,
          calls: provider[method as keyof BillingProvider].mock.calls.length,
        }).toEqual({ method, calls: 0 });
      }
    },
  );
});

describe("with billing on, BillingService hands every call to the enterprise module's provider", () => {
  let provider: MockedProvider;

  beforeEach(() => {
    setTestBillingEnabled(true);
    provider = createProvider();
    installFakeEnterpriseModule({
      billingProvider: provider as unknown as BillingProvider,
    });
  });

  it.each(
    PROVIDER_CALLS.map((call: ProviderCall): [string, ProviderCall] => {
      return [call.method, call];
    }),
  )(
    "%s: with exactly its arguments, answering what the provider answers",
    async (_method: string, call: ProviderCall) => {
      const answer: unknown = call.isSync
        ? callFacade(call)
        : await callFacade(call);

      expect(answer).toEqual(call.result);
      expect(provider[call.method]).toHaveBeenCalledTimes(1);
      expect(provider[call.method]).toHaveBeenCalledWith(...call.args);

      // And nothing else at the provider.
      for (const method of Object.keys(provider)) {
        if (method !== call.method) {
          expect({
            method,
            calls: provider[method as keyof BillingProvider].mock.calls.length,
          }).toEqual({ method, calls: 0 });
        }
      }
    },
  );

  it("passes a provider's refusal on as it is", async () => {
    const refusal: Error = new Error("Your card was declined.");
    provider.payInvoice.mockRejectedValue(refusal as never);

    await expect(BillingService.payInvoice("cus_1", "in_1")).rejects.toBe(
      refusal,
    );
  });

  it("asks the enterprise module on every call, so a provider registered later is used", async () => {
    uninstallEnterpriseModule();

    await expect(BillingService.hasPaymentMethods("cus_1")).rejects.toThrow(
      Errors.BillingService.BILLING_NOT_ENABLED,
    );

    installFakeEnterpriseModule({
      billingProvider: provider as unknown as BillingProvider,
    });

    await expect(BillingService.hasPaymentMethods("cus_1")).resolves.toBe(true);
  });

  it("stops at once when billing is switched off", async () => {
    await expect(BillingService.getCustomerBalance("cus_1")).resolves.toBe(
      -12.5,
    );

    setTestBillingEnabled(false);

    await expect(BillingService.getCustomerBalance("cus_1")).rejects.toThrow(
      Errors.BillingService.BILLING_NOT_ENABLED,
    );
    expect(provider.getCustomerBalance).toHaveBeenCalledTimes(1);
  });
});

describe("what BillingService answers itself, in every edition", () => {
  it("isBillingEnabled follows BILLING_ENABLED, with or without a provider", () => {
    expect(BillingService.isBillingEnabled()).toBe(false);

    setTestBillingEnabled(true);
    expect(BillingService.isBillingEnabled()).toBe(true);

    installFakeEnterpriseModule({
      billingProvider: createProvider() as unknown as BillingProvider,
    });
    expect(BillingService.isBillingEnabled()).toBe(true);
  });

  it.each(Object.values(SubscriptionStatus))(
    "isSubscriptionActive(%s) is SubscriptionStatusUtil's answer, and never asks a provider",
    (status: SubscriptionStatus) => {
      const provider: MockedProvider = createProvider();
      setTestBillingEnabled(true);
      installFakeEnterpriseModule({
        billingProvider: provider as unknown as BillingProvider,
      });

      expect(BillingService.isSubscriptionActive(status)).toBe(
        SubscriptionStatusUtil.isSubscriptionActive(status),
      );
      expect(provider.getSubscriptionStatus).not.toHaveBeenCalled();
    },
  );

  it("isSubscriptionActive is true for the statuses that still bill and false for the rest", () => {
    for (const status of [
      SubscriptionStatus.Active,
      SubscriptionStatus.Trialing,
      SubscriptionStatus.PastDue,
    ]) {
      expect(BillingService.isSubscriptionActive(status)).toBe(true);
    }

    for (const status of [
      SubscriptionStatus.Canceled,
      SubscriptionStatus.Unpaid,
      SubscriptionStatus.Incomplete,
      SubscriptionStatus.IncompleteExpired,
      SubscriptionStatus.Expired,
      SubscriptionStatus.Paused,
    ]) {
      expect(BillingService.isSubscriptionActive(status)).toBe(false);
    }
  });

  it("isTestEnvironment reads the payment provider key, not the provider", () => {
    expect(BillingService.isTestEnvironment()).toBe(true);
  });

  it.each([
    [ProductType.ActiveMonitoring, "price_1N6CHFANuQdJ93r7qDaLmb7S"],
    [ProductType.Logs, "price_1OPnB5ANuQdJ93r7jG4NLCJG"],
    [ProductType.Traces, "price_1OQ8i9ANuQdJ93r75J3wr0PX"],
    [ProductType.Metrics, "price_1OQ8iqANuQdJ93r7wZ7gJ7Gb"],
    [ProductType.Profiles, "price_1TGwUpANuQdJ93r7b9qxa5Se"],
    [ProductType.SessionReplay, "price_1U0icaANuQdJ93r7yE4a6icc"],
    [ProductType.SecurityEvents, "price_1U7efaANuQdJ93r74hFVOgdS"],
  ])(
    "the metered price of %s is %s with a test key, without a provider",
    (productType: ProductType, priceId: string) => {
      expect(BillingService.getMeteredPlanPriceId(productType)).toBe(priceId);
      expect(BillingService.hasMeteredPlanPriceId(productType)).toBe(true);
    },
  );

  /*
   * Security Events shipped its ingest, metering and staging without a
   * Stripe price, so usage accrued in TelemetryUsageBilling and was never
   * invoiced - silently, because the callers treat a missing price as
   * "skip this plan". Enumerate the enum rather than listing types by hand
   * so the next pillar added cannot repeat that.
   */
  it("every product type has a metered price", () => {
    for (const productType of Object.values(ProductType)) {
      expect({
        productType,
        hasPrice: BillingService.hasMeteredPlanPriceId(productType),
      }).toEqual({ productType, hasPrice: true });
    }
  });

  it("an unknown product type has no metered price, and asking for one throws", () => {
    const unknown: ProductType = "NotAProduct" as ProductType;

    expect(BillingService.hasMeteredPlanPriceId(unknown)).toBe(false);
    expect(() => {
      return BillingService.getMeteredPlanPriceId(unknown);
    }).toThrow("Plan with productType NotAProduct not found");
  });

  it("the metered plans read their price from it", () => {
    expect(LogDataIngestMeteredPlan.getPriceId()).toBe(
      BillingService.getMeteredPlanPriceId(ProductType.Logs),
    );
    expect(SessionReplayDataIngestMeteredPlan.hasPriceId()).toBe(true);
  });
});
