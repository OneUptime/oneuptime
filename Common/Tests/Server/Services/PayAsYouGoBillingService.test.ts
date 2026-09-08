import { Service } from "../../../Server/Services/PayAsYouGoBillingService";
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

jest.mock("../../../Server/Services/BillingService", () => ({
  __esModule: true,
  default: { isBillingEnabled: jest.fn(), hasPaymentMethods: jest.fn(), getSubscription: jest.fn(), getMeteredBillingStartDate: jest.fn() },
}));
jest.mock("../../../Server/Services/ProjectService", () => ({
  __esModule: true,
  default: { findOneById: jest.fn(), findOneBy: jest.fn() },
}));
jest.mock("../../../Server/Services/PromoCodeService", () => ({
  __esModule: true,
  default: { findOneBy: jest.fn() },
}));

describe("PayAsYouGoBillingService", () => {
  let service: Service;
  let project: Project;
  let findProject: jest.SpyInstance;
  let hasPaymentMethods: jest.SpyInstance;
  let getSubscription: jest.SpyInstance;
  let getPlan: jest.SpyInstance;

  beforeEach(() => {
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
    project.paymentProviderCustomerId = undefined;
    getJestSpyOn(PromoCodeService, "findOneBy").mockResolvedValue(new PromoCode());
    await expect(service.canUsePayAsYouGo(PROJECT_ID)).resolves.toBe(true);
    expect(hasPaymentMethods).not.toHaveBeenCalled();
    expect(PromoCodeService.findOneBy).toHaveBeenCalledWith(expect.objectContaining({ query: {
      projectId: PROJECT_ID,
      resellerId: project.resellerId,
      isPromoCodeUsed: true,
    } }));
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
      getSubscription.mockResolvedValue({ customer: "cus_project", status: "active", collection_method: "send_invoice" });
      const start: jest.SpyInstance = getJestSpyOn(BillingService, "getMeteredBillingStartDate");
      await expect(service.getTelemetryBillingStartDate(PROJECT_ID)).resolves.toBeUndefined();
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
    getJestSpyOn(PromoCodeService, "findOneBy").mockResolvedValue(new PromoCode());
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
    const findOwner: jest.SpyInstance = getJestSpyOn(ProjectService, "findOneBy").mockResolvedValue(owner);
    const subscription: Stripe.Subscription = { customer: { id: "cus_project" } } as Stripe.Subscription;
    await expect(service.requireMeteredSubscriptionPayment(subscription)).rejects.toBeInstanceOf(PaymentRequiredException);
    expect(findOwner).toHaveBeenCalledWith(expect.objectContaining({ query: { paymentProviderCustomerId: "cus_project" } }));
    hasPaymentMethods.mockResolvedValue(true);
    await expect(service.requireMeteredSubscriptionPayment(subscription)).resolves.toBeUndefined();
  });

  it("rejects a direct metered write for an unrecognized billing customer", async () => {
    getJestSpyOn(ProjectService, "findOneBy").mockResolvedValue(null);
    await expect(service.requireMeteredSubscriptionPayment({ customer: "cus_unknown" } as Stripe.Subscription)).rejects.toBeInstanceOf(PaymentRequiredException);
    expect(hasPaymentMethods).not.toHaveBeenCalled();
  });
});
