import {
  LiveUsageAuthorization,
  Service,
} from "../../../Server/Services/PayAsYouGoBillingService";
import BillingService from "../../../Server/Services/BillingService";
import ProjectService from "../../../Server/Services/ProjectService";
import PromoCodeService from "../../../Server/Services/PromoCodeService";
import Project from "../../../Models/DatabaseModels/Project";
import PromoCode from "../../../Models/DatabaseModels/PromoCode";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../Types/ObjectID";
import Stripe from "stripe";
import { getJestSpyOn } from "../../Spy";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();

const GROWTH_PLAN: SubscriptionPlan = new SubscriptionPlan(
  "growth",
  "growth_yearly",
  PlanType.Growth,
  20,
  200,
  1,
  14,
);

const ACTIVE_INVOICE_AGREEMENT: Partial<Stripe.Subscription> = {
  customer: "cus_project",
  status: "active",
  collection_method: "send_invoice",
};

jest.mock("../../../Server/Services/BillingService", () => {
  return {
    __esModule: true,
    default: {
      isBillingEnabled: jest.fn(),
      hasPaymentMethods: jest.fn(),
      getSubscription: jest.fn(),
      getMeteredBillingStartDate: jest.fn(),
    },
  };
});
jest.mock("../../../Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), findOneBy: jest.fn() },
  };
});
jest.mock("../../../Server/Services/PromoCodeService", () => {
  return {
    __esModule: true,
    default: { findOneBy: jest.fn() },
  };
});

describe("PayAsYouGoBillingService", () => {
  let service: Service;
  let project: Project;
  let findProject: jest.SpyInstance;
  let hasPaymentMethods: jest.SpyInstance;
  let getSubscription: jest.SpyInstance;
  let getPlan: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new Service();
    project = Object.assign(new Project(), {
      paymentProviderPlanId: "free",
      paymentProviderCustomerId: "cus_project",
      paymentProviderSubscriptionId: "sub_project",
    });
    findProject = getJestSpyOn(ProjectService, "findOneById").mockResolvedValue(
      project,
    );
    hasPaymentMethods = getJestSpyOn(
      BillingService,
      "hasPaymentMethods",
    ).mockResolvedValue(false);
    getJestSpyOn(BillingService, "isBillingEnabled").mockReturnValue(true);
    getJestSpyOn(PromoCodeService, "findOneBy").mockResolvedValue(null);
    getPlan = getJestSpyOn(
      SubscriptionPlan,
      "getSubscriptionPlanById",
    ).mockReturnValue(
      new SubscriptionPlan("free", "free_yearly", PlanType.Free, 0, 0, 0, 0),
    );
    getSubscription = getJestSpyOn(
      BillingService,
      "getSubscription",
    ).mockResolvedValue({
      customer: "cus_project",
      status: "active",
      collection_method: "charge_automatically",
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("allows self-hosted use without consulting projects or payment providers", async () => {
    getJestSpyOn(BillingService, "isBillingEnabled").mockReturnValue(false);
    await expect(
      service.requirePayAsYouGo(PROJECT_ID),
    ).resolves.toBeUndefined();
    expect(findProject).not.toHaveBeenCalled();
    expect(hasPaymentMethods).not.toHaveBeenCalled();
  });

  it("rejects a Free account with a signup subscription but no card", async () => {
    await expect(service.canUsePayAsYouGo(PROJECT_ID)).resolves.toBe(false);
    await expect(service.requirePayAsYouGo(PROJECT_ID)).rejects.toBeInstanceOf(
      PaymentRequiredException,
    );
    await expect(service.requirePayAsYouGo(PROJECT_ID)).rejects.toThrow(
      "Project Settings > Billing",
    );
    expect(getSubscription).not.toHaveBeenCalled();
    expect(findProject).toHaveBeenCalledWith(
      expect.objectContaining({
        id: PROJECT_ID,
        props: { isRoot: true, ignoreHooks: true },
      }),
    );
  });

  it("allows a Free project after a payment method has been added", async () => {
    hasPaymentMethods.mockResolvedValue(true);
    await expect(
      service.requirePayAsYouGo(PROJECT_ID),
    ).resolves.toBeUndefined();
    expect(hasPaymentMethods).toHaveBeenCalledWith("cus_project");
  });

  it("does not cache a rejection, so adding a payment method takes effect immediately", async () => {
    await expect(service.canUsePayAsYouGo(PROJECT_ID)).resolves.toBe(false);
    hasPaymentMethods.mockResolvedValue(true);
    await expect(service.canUsePayAsYouGo(PROJECT_ID)).resolves.toBe(true);
    expect(hasPaymentMethods).toHaveBeenCalledTimes(2);
  });

  /*
   * The telemetry admission path re-checks billing for every ingested batch.
   * With denials uncached that was a payment-provider read per batch for every
   * unpaid project, which is enough to hold the whole Stripe account at its
   * rate limit and take the billing page down with it.
   */
  describe("denial caching on the admission path", () => {
    it("still reads through a denial for ordinary callers", async () => {
      hasPaymentMethods.mockResolvedValue(false);
      await expect(service.canUsePayAsYouGo(PROJECT_ID)).resolves.toBe(false);
      hasPaymentMethods.mockResolvedValue(true);
      await expect(service.canUsePayAsYouGo(PROJECT_ID)).resolves.toBe(true);
      expect(hasPaymentMethods).toHaveBeenCalledTimes(2);
    });

    it("answers a repeat admission check from the cached denial", async () => {
      hasPaymentMethods.mockResolvedValue(false);
      await expect(
        service.canUsePayAsYouGo(PROJECT_ID, { allowStaleDenial: true }),
      ).resolves.toBe(false);
      await expect(
        service.canUsePayAsYouGo(PROJECT_ID, { allowStaleDenial: true }),
      ).resolves.toBe(false);
      await expect(
        service.canUsePayAsYouGo(PROJECT_ID, { allowStaleDenial: true }),
      ).resolves.toBe(false);
      // One provider read for three admission checks, not three.
      expect(hasPaymentMethods).toHaveBeenCalledTimes(1);
    });

    it("stops trusting a denial after ten seconds", async () => {
      const now: jest.SpyInstance = getJestSpyOn(Date, "now").mockReturnValue(
        100_000,
      );
      hasPaymentMethods.mockResolvedValue(false);
      await service.canUsePayAsYouGo(PROJECT_ID, { allowStaleDenial: true });
      await service.canUsePayAsYouGo(PROJECT_ID, { allowStaleDenial: true });
      expect(hasPaymentMethods).toHaveBeenCalledTimes(1);

      now.mockReturnValue(110_001);
      hasPaymentMethods.mockResolvedValue(true);
      await expect(
        service.canUsePayAsYouGo(PROJECT_ID, { allowStaleDenial: true }),
      ).resolves.toBe(true);
      expect(hasPaymentMethods).toHaveBeenCalledTimes(2);
    });

    it("honours a card added a moment ago once the payment methods are re-read", async () => {
      hasPaymentMethods.mockResolvedValue(false);
      await expect(
        service.canUsePayAsYouGo(PROJECT_ID, { allowStaleDenial: true }),
      ).resolves.toBe(false);

      /*
       * What BillingPaymentMethodService does after syncing the project's
       * payment methods from the provider - which is what the billing page
       * triggers immediately after a card is added.
       */
      service.invalidate(PROJECT_ID);
      hasPaymentMethods.mockResolvedValue(true);

      await expect(
        service.canUsePayAsYouGo(PROJECT_ID, { allowStaleDenial: true }),
      ).resolves.toBe(true);
      expect(hasPaymentMethods).toHaveBeenCalledTimes(2);
    });

    it("keeps a cached denial project-scoped", async () => {
      hasPaymentMethods.mockResolvedValue(false);
      await service.canUsePayAsYouGo(PROJECT_ID, { allowStaleDenial: true });
      await service.canUsePayAsYouGo(OTHER_PROJECT_ID, {
        allowStaleDenial: true,
      });
      expect(hasPaymentMethods).toHaveBeenCalledTimes(2);
    });

    it("still refuses admission from a cached denial", async () => {
      hasPaymentMethods.mockResolvedValue(false);
      await expect(
        service.requirePayAsYouGo(PROJECT_ID, { allowStaleDenial: true }),
      ).rejects.toBeInstanceOf(PaymentRequiredException);
      await expect(
        service.requirePayAsYouGo(PROJECT_ID, { allowStaleDenial: true }),
      ).rejects.toBeInstanceOf(PaymentRequiredException);
      expect(hasPaymentMethods).toHaveBeenCalledTimes(1);
    });
  });

  it("caches positive admission checks for at most sixty seconds", async () => {
    const now: jest.SpyInstance = getJestSpyOn(Date, "now").mockReturnValue(
      100_000,
    );
    hasPaymentMethods.mockResolvedValue(true);
    await service.canUsePayAsYouGo(PROJECT_ID);
    await service.canUsePayAsYouGo(PROJECT_ID);
    expect(findProject).toHaveBeenCalledTimes(1);
    now.mockReturnValue(160_001);
    hasPaymentMethods.mockResolvedValue(false);
    await expect(service.canUsePayAsYouGo(PROJECT_ID)).resolves.toBe(false);
    expect(findProject).toHaveBeenCalledTimes(2);
  });

  it("never shares cached eligibility between projects", async () => {
    hasPaymentMethods.mockResolvedValueOnce(true).mockResolvedValue(false);
    await service.canUsePayAsYouGo(PROJECT_ID);
    await expect(service.canUsePayAsYouGo(OTHER_PROJECT_ID)).resolves.toBe(
      false,
    );
  });

  it("fresh billing checks bypass and invalidate positive admission cache", async () => {
    hasPaymentMethods.mockResolvedValueOnce(true).mockResolvedValue(false);
    await service.canUsePayAsYouGo(PROJECT_ID);
    await expect(
      service.canUsePayAsYouGo(PROJECT_ID, { useCache: false }),
    ).resolves.toBe(false);
    await expect(service.canUsePayAsYouGo(PROJECT_ID)).resolves.toBe(false);
    expect(hasPaymentMethods).toHaveBeenCalledTimes(3);
  });

  it.each(["paymentProviderPlanId", "paymentProviderCustomerId"])(
    "denies incomplete onboarding without %s",
    async (field: string) => {
      (project as unknown as Record<string, unknown>)[field] = undefined;
      await expect(service.canUsePayAsYouGo(PROJECT_ID)).resolves.toBe(false);
      expect(hasPaymentMethods).not.toHaveBeenCalled();
    },
  );

  it("denies a missing project", async () => {
    findProject.mockResolvedValue(null);
    await expect(service.canUsePayAsYouGo(PROJECT_ID)).resolves.toBe(false);
  });

  it("denies an unrecognized plan even when the caller has a card", async () => {
    getPlan.mockReturnValue(undefined);
    hasPaymentMethods.mockResolvedValue(true);
    await expect(service.canUsePayAsYouGo(PROJECT_ID)).resolves.toBe(false);
  });

  it("preserves explicit reseller billing agreements", async () => {
    project.resellerId = ObjectID.generate();
    project.resellerPlanId = ObjectID.generate();
    delete project.paymentProviderCustomerId;
    getJestSpyOn(PromoCodeService, "findOneBy").mockResolvedValue(
      new PromoCode(),
    );
    await expect(service.canUsePayAsYouGo(PROJECT_ID)).resolves.toBe(true);
    expect(hasPaymentMethods).not.toHaveBeenCalled();
    expect(PromoCodeService.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          projectId: PROJECT_ID,
          resellerId: project.resellerId,
          isPromoCodeUsed: true,
        },
      }),
    );
  });

  it("requires a redeemed license bound to this project before granting a reseller exemption", async () => {
    project.resellerId = ObjectID.generate();
    project.resellerPlanId = ObjectID.generate();
    await expect(service.canUsePayAsYouGo(PROJECT_ID)).resolves.toBe(false);
  });

  it("does not treat an incomplete reseller reference as payment authorization", async () => {
    project.resellerId = ObjectID.generate();
    await expect(service.canUsePayAsYouGo(PROJECT_ID)).resolves.toBe(false);
  });

  describe("paid subscriptions without a stored payment method", () => {
    beforeEach(() => {
      getPlan.mockReturnValue(
        new SubscriptionPlan(
          "growth",
          "growth_yearly",
          PlanType.Growth,
          20,
          200,
          1,
          14,
        ),
      );
    });

    it("permits a verified active invoice agreement", async () => {
      getSubscription.mockResolvedValue({
        customer: { id: "cus_project" },
        status: "active",
        collection_method: "send_invoice",
      });
      await expect(service.canUsePayAsYouGo(PROJECT_ID)).resolves.toBe(true);
    });

    it("preserves already authorized invoice history without a new cutoff", async () => {
      getSubscription.mockResolvedValue({
        customer: "cus_project",
        status: "active",
        collection_method: "send_invoice",
      });
      const start: jest.SpyInstance = getJestSpyOn(
        BillingService,
        "getMeteredBillingStartDate",
      );
      await expect(
        service.getTelemetryBillingStartDate(PROJECT_ID),
      ).resolves.toBeUndefined();
      expect(start).not.toHaveBeenCalled();
    });

    it.each(["trialing", "unpaid", "canceled", "past_due", "incomplete"])(
      "does not interpret a %s subscription as a paid invoice contract",
      async (status: string) => {
        getSubscription.mockResolvedValue({
          customer: "cus_project",
          status,
          collection_method: "send_invoice",
        });
        await expect(service.canUsePayAsYouGo(PROJECT_ID)).resolves.toBe(false);
      },
    );

    it("denies automatic collection without a card", async () => {
      await expect(service.canUsePayAsYouGo(PROJECT_ID)).resolves.toBe(false);
    });

    it("does not accept another customer's invoice contract", async () => {
      getSubscription.mockResolvedValue({
        customer: "cus_other",
        status: "active",
        collection_method: "send_invoice",
      });
      await expect(service.canUsePayAsYouGo(PROJECT_ID)).resolves.toBe(false);
    });
  });

  it("propagates provider failures rather than granting usage or treating debt as waived", async () => {
    hasPaymentMethods.mockRejectedValue(
      new Error("Payment provider unavailable"),
    );
    await expect(service.canUsePayAsYouGo(PROJECT_ID)).rejects.toThrow(
      "Payment provider unavailable",
    );
  });

  it("starts telemetry on the next complete UTC day after durable authorization", async () => {
    hasPaymentMethods.mockResolvedValue(true);
    getJestSpyOn(
      BillingService,
      "getMeteredBillingStartDate",
    ).mockResolvedValue(new Date("2026-09-08T23:59:00Z"));
    await expect(
      service.getTelemetryBillingStartDate(PROJECT_ID),
    ).resolves.toEqual(new Date("2026-09-09T00:00:00Z"));
  });

  it("does not create a billing start marker before a card is added", async () => {
    const start: jest.SpyInstance = getJestSpyOn(
      BillingService,
      "getMeteredBillingStartDate",
    );
    await expect(
      service.getTelemetryBillingStartDate(PROJECT_ID),
    ).rejects.toBeInstanceOf(PaymentRequiredException);
    expect(start).not.toHaveBeenCalled();
  });

  it("leaves self-hosted and reseller telemetry without a Stripe cutoff", async () => {
    project.resellerId = ObjectID.generate();
    project.resellerPlanId = ObjectID.generate();
    getJestSpyOn(PromoCodeService, "findOneBy").mockResolvedValue(
      new PromoCode(),
    );
    const start: jest.SpyInstance = getJestSpyOn(
      BillingService,
      "getMeteredBillingStartDate",
    );
    await expect(
      service.getTelemetryBillingStartDate(PROJECT_ID),
    ).resolves.toBeUndefined();
    getJestSpyOn(BillingService, "isBillingEnabled").mockReturnValue(false);
    await expect(
      service.getTelemetryBillingStartDate(PROJECT_ID),
    ).resolves.toBeUndefined();
    expect(start).not.toHaveBeenCalled();
  });

  it("resolves the project from the Stripe customer before authorizing a direct metered write", async () => {
    const owner: Project = new Project();
    owner.id = PROJECT_ID;
    const findOwner: jest.SpyInstance = getJestSpyOn(
      ProjectService,
      "findOneBy",
    ).mockResolvedValue(owner);
    const subscription: Stripe.Subscription = {
      customer: { id: "cus_project" },
    } as Stripe.Subscription;
    await expect(
      service.requireMeteredSubscriptionPayment(subscription),
    ).rejects.toBeInstanceOf(PaymentRequiredException);
    expect(findOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { paymentProviderCustomerId: "cus_project" },
      }),
    );
    hasPaymentMethods.mockResolvedValue(true);
    await expect(
      service.requireMeteredSubscriptionPayment(subscription),
    ).resolves.toBeUndefined();
  });

  it("rejects a direct metered write for an unrecognized billing customer", async () => {
    getJestSpyOn(ProjectService, "findOneBy").mockResolvedValue(null);
    await expect(
      service.requireMeteredSubscriptionPayment({
        customer: "cus_unknown",
      } as Stripe.Subscription),
    ).rejects.toBeInstanceOf(PaymentRequiredException);
    expect(hasPaymentMethods).not.toHaveBeenCalled();
  });

  /*
   * Stripe rate-limits GET /v1/subscriptions/:id per endpoint. Reading the
   * subscription before the card put that endpoint in front of every card
   * holder's answer - three or four reads per monitor create - and CI's Stripe
   * test account, shared with every other environment running this code, was
   * held at the limit until requests failed. The card is read first now, and
   * the subscription only when there is no card.
   */
  describe("reading the card before the subscription", () => {
    beforeEach(() => {
      getPlan.mockReturnValue(GROWTH_PLAN);
    });

    it("authorizes a card holder on a paid plan without reading its subscription", async () => {
      hasPaymentMethods.mockResolvedValue(true);
      await expect(service.canUsePayAsYouGo(PROJECT_ID)).resolves.toBe(true);
      expect(hasPaymentMethods).toHaveBeenCalledWith("cus_project");
      expect(getSubscription).not.toHaveBeenCalled();
    });

    it("reads the card first, then accepts this customer's active invoice agreement", async () => {
      getSubscription.mockResolvedValue(ACTIVE_INVOICE_AGREEMENT);
      await expect(service.canUsePayAsYouGo(PROJECT_ID)).resolves.toBe(true);
      expect(getSubscription).toHaveBeenCalledWith("sub_project");
      expect(hasPaymentMethods).toHaveBeenCalledTimes(1);
      expect(hasPaymentMethods.mock.invocationCallOrder[0]).toBeLessThan(
        getSubscription.mock.invocationCallOrder[0]!,
      );
    });

    it("still refuses a no-card project an invoice agreement that belongs to another customer", async () => {
      getSubscription.mockResolvedValue({
        ...ACTIVE_INVOICE_AGREEMENT,
        customer: { id: "cus_other" },
      });
      await expect(service.canUsePayAsYouGo(PROJECT_ID)).resolves.toBe(false);
      expect(hasPaymentMethods).toHaveBeenCalledTimes(1);
      expect(getSubscription).toHaveBeenCalledTimes(1);
    });

    it.each(["trialing", "past_due", "canceled"])(
      "still refuses a no-card project whose invoice subscription is %s",
      async (status: string) => {
        getSubscription.mockResolvedValue({
          ...ACTIVE_INVOICE_AGREEMENT,
          status,
        });
        await expect(service.canUsePayAsYouGo(PROJECT_ID)).resolves.toBe(false);
        expect(hasPaymentMethods).toHaveBeenCalledTimes(1);
      },
    );

    it("refuses a no-card Free project without reading even an invoice-looking subscription", async () => {
      getPlan.mockReturnValue(
        new SubscriptionPlan("free", "free_yearly", PlanType.Free, 0, 0, 0, 0),
      );
      getSubscription.mockResolvedValue(ACTIVE_INVOICE_AGREEMENT);
      await expect(service.canUsePayAsYouGo(PROJECT_ID)).resolves.toBe(false);
      expect(hasPaymentMethods).toHaveBeenCalledTimes(1);
      expect(getSubscription).not.toHaveBeenCalled();
    });

    it("authorizes a redeemed reseller license without any payment-provider call", async () => {
      project.resellerId = ObjectID.generate();
      project.resellerPlanId = ObjectID.generate();
      getJestSpyOn(PromoCodeService, "findOneBy").mockResolvedValue(
        new PromoCode(),
      );
      await expect(service.canUsePayAsYouGo(PROJECT_ID)).resolves.toBe(true);
      expect(hasPaymentMethods).not.toHaveBeenCalled();
      expect(getSubscription).not.toHaveBeenCalled();
    });

    it("propagates a failed card read without falling through to the invoice read or caching an answer", async () => {
      hasPaymentMethods.mockRejectedValueOnce(
        new Error("Payment provider unavailable"),
      );
      await expect(
        service.canUsePayAsYouGo(PROJECT_ID, { allowStaleDenial: true }),
      ).rejects.toThrow("Payment provider unavailable");
      expect(getSubscription).not.toHaveBeenCalled();

      /*
       * Neither a denial nor an allow was recorded: even the admission path,
       * which may answer from a cached denial, has to read again.
       */
      hasPaymentMethods.mockResolvedValue(true);
      await expect(
        service.canUsePayAsYouGo(PROJECT_ID, { allowStaleDenial: true }),
      ).resolves.toBe(true);
      expect(hasPaymentMethods).toHaveBeenCalledTimes(2);
    });

    it("propagates a failed invoice read on the no-card path without caching an answer", async () => {
      getSubscription.mockRejectedValueOnce(new Error("Stripe rate limited"));
      await expect(
        service.canUsePayAsYouGo(PROJECT_ID, { allowStaleDenial: true }),
      ).rejects.toThrow("Stripe rate limited");

      getSubscription.mockResolvedValue(ACTIVE_INVOICE_AGREEMENT);
      await expect(
        service.canUsePayAsYouGo(PROJECT_ID, { allowStaleDenial: true }),
      ).resolves.toBe(true);
      expect(getSubscription).toHaveBeenCalledTimes(2);
    });
  });

  /*
   * With the card read first, an invoice customer who also keeps a card on
   * file is authorized as "payment-method". That answer must not earn them a
   * metered billing cutoff: a cutoff waives every unreported telemetry cost
   * before it, which their invoice agreement already bills.
   */
  describe("telemetry cutoff for a card holder who also has an agreement", () => {
    let meteredBillingStart: jest.SpyInstance;

    beforeEach(() => {
      getPlan.mockReturnValue(GROWTH_PLAN);
      hasPaymentMethods.mockResolvedValue(true);
      meteredBillingStart = getJestSpyOn(
        BillingService,
        "getMeteredBillingStartDate",
      ).mockResolvedValue(new Date("2026-09-08T23:59:00Z"));
    });

    it("never stamps a cutoff on an invoice customer who also has a card", async () => {
      getSubscription.mockResolvedValue(ACTIVE_INVOICE_AGREEMENT);
      await expect(
        service.getTelemetryBillingStartDate(PROJECT_ID),
      ).resolves.toBeUndefined();
      expect(meteredBillingStart).not.toHaveBeenCalled();
    });

    it("still starts a card holder without an agreement on the next complete UTC day", async () => {
      await expect(
        service.getTelemetryBillingStartDate(PROJECT_ID),
      ).resolves.toEqual(new Date("2026-09-09T00:00:00Z"));
      expect(meteredBillingStart).toHaveBeenCalledWith("cus_project");
    });

    it("asks a Free card holder for no subscription before its cutoff", async () => {
      getPlan.mockReturnValue(
        new SubscriptionPlan("free", "free_yearly", PlanType.Free, 0, 0, 0, 0),
      );
      await expect(
        service.getTelemetryBillingStartDate(PROJECT_ID),
      ).resolves.toEqual(new Date("2026-09-09T00:00:00Z"));
      expect(getSubscription).not.toHaveBeenCalled();
    });

    it("decides a reseller's exemption from the license itself, not from what authorization happened to be cached", async () => {
      project.resellerId = ObjectID.generate();
      project.resellerPlanId = ObjectID.generate();
      getJestSpyOn(PromoCodeService, "findOneBy").mockResolvedValue(
        new PromoCode(),
      );
      // Admitted without leaving an authorization behind in the cache.
      getJestSpyOn(service, "canUsePayAsYouGo").mockResolvedValue(true);
      await expect(
        service.getTelemetryBillingStartDate(PROJECT_ID),
      ).resolves.toBeUndefined();
      expect(meteredBillingStart).not.toHaveBeenCalled();
      expect(getSubscription).not.toHaveBeenCalled();
    });

    it("stamps no cutoff and caches nothing when the agreement cannot be read", async () => {
      getSubscription.mockRejectedValueOnce(new Error("Stripe rate limited"));
      await expect(
        service.getTelemetryBillingStartDate(PROJECT_ID),
      ).rejects.toThrow("Stripe rate limited");
      expect(meteredBillingStart).not.toHaveBeenCalled();

      await expect(
        service.getTelemetryBillingStartDate(PROJECT_ID),
      ).resolves.toEqual(new Date("2026-09-09T00:00:00Z"));
      expect(getSubscription).toHaveBeenCalledTimes(2);
    });

    it("reads the agreement once for a billing pass that asks fourteen times", async () => {
      // Seven product types, each asking from the report and from staging.
      for (let call: number = 0; call < 14; call++) {
        await service.getTelemetryBillingStartDate(PROJECT_ID);
      }
      expect(getSubscription).toHaveBeenCalledTimes(1);
      expect(meteredBillingStart).toHaveBeenCalledTimes(14);
    });

    it("keeps the agreement answer no longer than the positive authorization cache", async () => {
      const now: jest.SpyInstance = getJestSpyOn(Date, "now").mockReturnValue(
        100_000,
      );
      await service.getTelemetryBillingStartDate(PROJECT_ID);
      now.mockReturnValue(160_000);
      await service.getTelemetryBillingStartDate(PROJECT_ID);
      expect(getSubscription).toHaveBeenCalledTimes(1);

      now.mockReturnValue(160_001);
      await service.getTelemetryBillingStartDate(PROJECT_ID);
      expect(getSubscription).toHaveBeenCalledTimes(2);
    });

    it("forgets the agreement answer on invalidate", async () => {
      await expect(
        service.getTelemetryBillingStartDate(PROJECT_ID),
      ).resolves.toEqual(new Date("2026-09-09T00:00:00Z"));

      service.invalidate(PROJECT_ID);
      getSubscription.mockResolvedValue(ACTIVE_INVOICE_AGREEMENT);

      await expect(
        service.getTelemetryBillingStartDate(PROJECT_ID),
      ).resolves.toBeUndefined();
      expect(getSubscription).toHaveBeenCalledTimes(2);
    });
  });

  /*
   * A metered report used to check the owner's payment setup live up to three
   * times in a few seconds. It now checks once and hands the answer on; every
   * guard that receives it still refuses to trust it for anything but the
   * project it was made for, inside the positive-cache window.
   */
  describe("live usage authorization", () => {
    const subscription: Stripe.Subscription = {
      customer: { id: "cus_project" },
    } as Stripe.Subscription;
    let findOwner: jest.SpyInstance;

    const mint: (
      projectId: ObjectID,
    ) => Promise<LiveUsageAuthorization> = async (
      projectId: ObjectID,
    ): Promise<LiveUsageAuthorization> => {
      const authorization: LiveUsageAuthorization | null =
        await service.authorizeUsageNow(projectId);
      expect(authorization).not.toBeNull();
      return authorization!;
    };

    beforeEach(() => {
      const owner: Project = new Project();
      owner.id = PROJECT_ID;
      findOwner = getJestSpyOn(ProjectService, "findOneBy").mockResolvedValue(
        owner,
      );
      hasPaymentMethods.mockResolvedValue(true);
    });

    it("reads live even over a fresh positive cache, and says which project and when", async () => {
      getJestSpyOn(Date, "now").mockReturnValue(100_000);
      await service.canUsePayAsYouGo(PROJECT_ID);
      await expect(service.authorizeUsageNow(PROJECT_ID)).resolves.toEqual({
        projectId: PROJECT_ID.toString(),
        decidedAt: 100_000,
      });
      expect(hasPaymentMethods).toHaveBeenCalledTimes(2);
    });

    it("gives no authorization to a project that may not incur charges", async () => {
      hasPaymentMethods.mockResolvedValue(false);
      await expect(service.authorizeUsageNow(PROJECT_ID)).resolves.toBeNull();
    });

    it("propagates a provider failure rather than authorizing or denying", async () => {
      hasPaymentMethods.mockRejectedValue(
        new Error("Payment provider unavailable"),
      );
      await expect(service.authorizeUsageNow(PROJECT_ID)).rejects.toThrow(
        "Payment provider unavailable",
      );
    });

    it("lets the subscription owner's fresh authorization stand in for a second check", async () => {
      const liveAuthorization: LiveUsageAuthorization = await mint(PROJECT_ID);
      const canUse: jest.SpyInstance = getJestSpyOn(
        service,
        "canUsePayAsYouGo",
      );
      await expect(
        service.requireMeteredSubscriptionPayment(subscription, {
          liveAuthorization,
        }),
      ).resolves.toBeUndefined();
      expect(canUse).not.toHaveBeenCalled();
      expect(hasPaymentMethods).toHaveBeenCalledTimes(1);
      expect(findOwner).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { paymentProviderCustomerId: "cus_project" },
        }),
      );
    });

    it("checks the owner live when the authorization was made for another project", async () => {
      const liveAuthorization: LiveUsageAuthorization =
        await mint(OTHER_PROJECT_ID);
      const canUse: jest.SpyInstance = getJestSpyOn(
        service,
        "canUsePayAsYouGo",
      );
      hasPaymentMethods.mockResolvedValue(false);
      await expect(
        service.requireMeteredSubscriptionPayment(subscription, {
          liveAuthorization,
        }),
      ).rejects.toBeInstanceOf(PaymentRequiredException);
      expect(canUse).toHaveBeenCalledTimes(1);
      expect(canUse).toHaveBeenCalledWith(PROJECT_ID, { useCache: false });
    });

    it("checks live once the authorization is older than the positive cache allows", async () => {
      const now: jest.SpyInstance = getJestSpyOn(Date, "now").mockReturnValue(
        100_000,
      );
      const liveAuthorization: LiveUsageAuthorization = await mint(PROJECT_ID);
      const canUse: jest.SpyInstance = getJestSpyOn(
        service,
        "canUsePayAsYouGo",
      );

      now.mockReturnValue(160_000);
      await service.requireMeteredSubscriptionPayment(subscription, {
        liveAuthorization,
      });
      expect(canUse).not.toHaveBeenCalled();

      now.mockReturnValue(160_001);
      hasPaymentMethods.mockResolvedValue(false);
      await expect(
        service.requireMeteredSubscriptionPayment(subscription, {
          liveAuthorization,
        }),
      ).rejects.toBeInstanceOf(PaymentRequiredException);
      expect(canUse).toHaveBeenCalledWith(PROJECT_ID, { useCache: false });
    });

    it("checks live without an authorization, as it always has", async () => {
      const canUse: jest.SpyInstance = getJestSpyOn(
        service,
        "canUsePayAsYouGo",
      );
      await expect(
        service.requireMeteredSubscriptionPayment(subscription),
      ).resolves.toBeUndefined();
      expect(canUse).toHaveBeenCalledWith(PROJECT_ID, { useCache: false });
    });

    it("refuses an unrecognized billing customer even with a fresh authorization", async () => {
      const liveAuthorization: LiveUsageAuthorization = await mint(PROJECT_ID);
      findOwner.mockResolvedValue(null);
      const canUse: jest.SpyInstance = getJestSpyOn(
        service,
        "canUsePayAsYouGo",
      );
      await expect(
        service.requireMeteredSubscriptionPayment(subscription, {
          liveAuthorization,
        }),
      ).rejects.toBeInstanceOf(PaymentRequiredException);
      expect(canUse).not.toHaveBeenCalled();
    });

    it("vouches only for its own project inside the reuse window", async () => {
      const now: jest.SpyInstance = getJestSpyOn(Date, "now").mockReturnValue(
        100_000,
      );
      const liveAuthorization: LiveUsageAuthorization = await mint(PROJECT_ID);

      expect(
        service.isLiveAuthorizationFor(liveAuthorization, PROJECT_ID),
      ).toBe(true);
      expect(
        service.isLiveAuthorizationFor(liveAuthorization, OTHER_PROJECT_ID),
      ).toBe(false);
      expect(service.isLiveAuthorizationFor(undefined, PROJECT_ID)).toBe(false);

      // A clock that has stepped backwards proves nothing about the answer.
      now.mockReturnValue(99_999);
      expect(
        service.isLiveAuthorizationFor(liveAuthorization, PROJECT_ID),
      ).toBe(false);

      now.mockReturnValue(160_001);
      expect(
        service.isLiveAuthorizationFor(liveAuthorization, PROJECT_ID),
      ).toBe(false);
    });
  });
});
