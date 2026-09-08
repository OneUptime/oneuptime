import {
  BillingService,
  METERED_BILLING_START_METADATA_KEY,
} from "../../../Server/Services/BillingService";
import PayAsYouGoBillingService from "../../../Server/Services/PayAsYouGoBillingService";
import ServerMeteredPlan from "../../../Server/Types/Billing/MeteredPlan/ServerMeteredPlan";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import OneUptimeDate from "../../../Types/Date";
import { getJestSpyOn } from "../../Spy";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

jest.mock("../../../Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {},
  };
});
jest.mock("../../../Server/Services/MailService", () => {
  return {
    __esModule: true,
    default: {},
  };
});
jest.mock("../../../Server/Services/PayAsYouGoBillingService", () => {
  return {
    __esModule: true,
    default: { requireMeteredSubscriptionPayment: jest.fn() },
  };
});
const ActiveMonitoringMeteredPlan: ServerMeteredPlan = new ServerMeteredPlan();

describe("BillingService metered payment authorization", () => {
  let service: BillingService;
  let retrieveCustomer: jest.Mock;
  let updateCustomer: jest.Mock;
  let createItem: jest.Mock;
  let createUsage: jest.Mock;
  let requirePayment: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BillingService();
    retrieveCustomer = jest.fn().mockResolvedValue({ metadata: {} });
    updateCustomer = jest.fn().mockResolvedValue({});
    createItem = jest.fn().mockResolvedValue({ id: "item_new" });
    createUsage = jest.fn().mockResolvedValue({});
    (service as unknown as { stripe: unknown }).stripe = {
      customers: { retrieve: retrieveCustomer, update: updateCustomer },
      subscriptionItems: { create: createItem, createUsageRecord: createUsage },
    };
    getJestSpyOn(service, "isBillingEnabled").mockReturnValue(true);
    getJestSpyOn(ActiveMonitoringMeteredPlan, "hasPriceId").mockReturnValue(
      true,
    );
    getJestSpyOn(ActiveMonitoringMeteredPlan, "getPriceId").mockReturnValue(
      "price_monitor",
    );
    getJestSpyOn(service, "getSubscription").mockResolvedValue({
      id: "sub_metered",
      customer: "cus_project",
      items: {
        data: [{ id: "item_existing", price: { id: "price_monitor" } }],
      },
    });
    requirePayment = getJestSpyOn(
      PayAsYouGoBillingService,
      "requireMeteredSubscriptionPayment",
    ).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([true, false])(
    "prevents any Stripe usage write without payment authorization (existing price: %s)",
    async (existingPrice: boolean) => {
      if (!existingPrice) {
        getJestSpyOn(service, "getSubscription").mockResolvedValue({
          id: "sub_metered",
          customer: "cus_project",
          items: { data: [] },
        });
      }
      requirePayment.mockRejectedValue(
        new PaymentRequiredException("Add a payment method"),
      );
      await expect(
        service.addOrUpdateMeteredPricingOnSubscription(
          "sub_metered",
          ActiveMonitoringMeteredPlan,
          1,
        ),
      ).rejects.toBeInstanceOf(PaymentRequiredException);
      expect(createItem).not.toHaveBeenCalled();
      expect(createUsage).not.toHaveBeenCalled();
    },
  );

  it("reports authorized usage to the existing subscription item", async () => {
    await service.addOrUpdateMeteredPricingOnSubscription(
      "sub_metered",
      ActiveMonitoringMeteredPlan,
      3,
    );
    expect(requirePayment).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_project" }),
    );
    expect(createUsage).toHaveBeenCalledWith("item_existing", { quantity: 3 });
  });

  it("allows zero usage without demanding a card", async () => {
    await service.addOrUpdateMeteredPricingOnSubscription(
      "sub_metered",
      ActiveMonitoringMeteredPlan,
      0,
    );
    expect(requirePayment).not.toHaveBeenCalled();
    expect(createUsage).toHaveBeenCalledWith("item_existing", { quantity: 0 });
  });

  it("preserves a durable authorization boundary across worker restarts", async () => {
    retrieveCustomer.mockResolvedValue({
      metadata: {
        [METERED_BILLING_START_METADATA_KEY]: "2026-09-08T15:04:03.000Z",
      },
    });
    await expect(
      service.getMeteredBillingStartDate("cus_project"),
    ).resolves.toEqual(new Date("2026-09-08T15:04:03Z"));
    expect(updateCustomer).not.toHaveBeenCalled();
  });

  it.each([undefined, "invalid-date"])(
    "initializes a conservative boundary for missing or invalid metadata (%s)",
    async (stored: string | undefined) => {
      const now: Date = new Date("2026-09-08T15:04:03Z");
      getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(now);
      retrieveCustomer.mockResolvedValue({
        metadata: {
          other_customer_metadata: "preserve",
          [METERED_BILLING_START_METADATA_KEY]: stored,
        },
      });
      await expect(
        service.getMeteredBillingStartDate("cus_project"),
      ).resolves.toEqual(now);
      expect(updateCustomer).toHaveBeenCalledWith("cus_project", {
        metadata: { [METERED_BILLING_START_METADATA_KEY]: now.toISOString() },
      });
    },
  );

  it("does not authorize staging when durable marker persistence fails", async () => {
    updateCustomer.mockRejectedValue(new Error("Stripe unavailable"));
    await expect(
      service.getMeteredBillingStartDate("cus_project"),
    ).rejects.toThrow("Stripe unavailable");
  });

  it("rejects a deleted billing customer without writing metadata", async () => {
    retrieveCustomer.mockResolvedValue({ deleted: true });
    await expect(
      service.getMeteredBillingStartDate("cus_project"),
    ).rejects.toThrow();
    expect(updateCustomer).not.toHaveBeenCalled();
  });

  it("does not access Stripe when billing is disabled", async () => {
    getJestSpyOn(service, "isBillingEnabled").mockReturnValue(false);
    await expect(
      service.getMeteredBillingStartDate("cus_project"),
    ).rejects.toThrow();
    expect(retrieveCustomer).not.toHaveBeenCalled();
  });
});
