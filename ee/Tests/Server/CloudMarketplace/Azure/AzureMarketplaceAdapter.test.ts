import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import AzureMarketplaceAdapter, {
  AzureSubscriptionStatus,
} from "../../../../Server/CloudMarketplace/Azure/AzureMarketplaceAdapter";
import AzureMarketplaceAPI, {
  AzureSaasSubscription,
  AzureUsageEvent,
} from "../../../../Server/CloudMarketplace/Azure/AzureMarketplaceAPI";
import {
  MarketplaceActivationError,
  MarketplaceUsageRecord,
  MarketplaceUsageResult,
} from "../../../../Server/CloudMarketplace/MarketplaceAdapter";
import MarketplaceApiError from "../../../../Server/CloudMarketplace/MarketplaceApiError";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Microsoft starts billing a SaaS subscription when it is activated, which
 * OneUptime does once the buyer has linked a project. Usage goes out as one
 * metered event per report, in the hour the report ends in.
 */

const SUBSCRIPTION_ID: string = "37f9dea2-4345-438f-b0bd-03d40d28c7e0";

const subscription: (
  overrides?: Partial<AzureSaasSubscription>,
) => AzureSaasSubscription = (
  overrides?: Partial<AzureSaasSubscription>,
): AzureSaasSubscription => {
  return {
    id: SUBSCRIPTION_ID,
    name: "OneUptime for Contoso",
    offerId: "oneuptime-cloud",
    planId: "pay-as-you-go",
    quantity: null,
    status: "PendingFulfillmentStart",
    beneficiary: {
      emailId: "admin@contoso.com",
      tenantId: "t-beneficiary",
      objectId: "o-1",
    },
    purchaser: {
      emailId: "buyer@contoso.com",
      tenantId: "t-purchaser",
      objectId: "o-2",
    },
    isFreeTrial: false,
    isTest: false,
    termStartDate: "2026-10-16T00:00:00Z",
    termEndDate: "2026-11-15T00:00:00Z",
    termUnit: "P1M",
    autoRenew: true,
    ...overrides,
  };
};

// Partial<T> under exactOptionalPropertyTypes forbids an explicit undefined.
type SubscriptionOverrides = {
  [K in keyof MarketplaceSubscription]?: MarketplaceSubscription[K] | undefined;
};

const purchase: (
  overrides?: SubscriptionOverrides,
) => MarketplaceSubscription = (
  overrides?: SubscriptionOverrides,
): MarketplaceSubscription => {
  return Object.assign(new MarketplaceSubscription(), {
    marketplace: CloudMarketplace.Azure,
    externalSubscriptionId: SUBSCRIPTION_ID,
    externalPlanId: "pay-as-you-go",
    ...overrides,
  });
};

const record: (periodEnd: string) => MarketplaceUsageRecord = (
  periodEnd: string,
): MarketplaceUsageRecord => {
  return {
    reportId: "report-1",
    quantity: 2200,
    periodStart: new Date("2026-10-16T09:00:00.000Z"),
    periodEnd: new Date(periodEnd),
    projectId: "6720a1b2c3d4e5f6a7b8c9d0",
  };
};

describe("AzureSubscriptionStatus", () => {
  it("maps a SaaS subscription's status, padded or not", () => {
    expect(AzureSubscriptionStatus.toStatus("PendingFulfillmentStart")).toBe(
      MarketplaceSubscriptionStatus.Pending,
    );
    expect(AzureSubscriptionStatus.toStatus(" Subscribed ")).toBe(
      MarketplaceSubscriptionStatus.Active,
    );
    expect(AzureSubscriptionStatus.toStatus("Suspended")).toBe(
      MarketplaceSubscriptionStatus.Suspended,
    );
    expect(AzureSubscriptionStatus.toStatus("Unsubscribed")).toBe(
      MarketplaceSubscriptionStatus.Cancelled,
    );
    expect(AzureSubscriptionStatus.toStatus("NotStarted")).toBeNull();
  });

  it("writes the tenant, plan and purchaser onto the purchase", () => {
    expect(
      AzureSubscriptionStatus.toFacts(
        subscription({ quantity: 3, isFreeTrial: true }),
      ),
    ).toMatchObject({
      externalCustomerId: "t-beneficiary",
      externalOfferId: "oneuptime-cloud",
      externalPlanId: "pay-as-you-go",
      quantity: 3,
      purchaserEmail: "buyer@contoso.com",
      isFreeTrial: true,
      externalState: "PendingFulfillmentStart",
    });

    // Without a beneficiary tenant or purchaser email, the other party's.
    expect(
      AzureSubscriptionStatus.toFacts(
        subscription({
          beneficiary: {
            emailId: "admin@contoso.com",
            tenantId: null,
            objectId: null,
          },
          purchaser: { emailId: null, tenantId: "t-purchaser", objectId: null },
        }),
      ),
    ).toMatchObject({
      externalCustomerId: "t-purchaser",
      purchaserEmail: "admin@contoso.com",
    });
  });
});

describe("AzureMarketplaceAdapter", () => {
  let api: {
    getSubscription: jest.Mock;
    activate: jest.Mock;
    reportUsageEvents: jest.Mock;
  };
  let adapter: AzureMarketplaceAdapter;

  beforeEach(() => {
    api = {
      getSubscription: jest.fn(),
      activate: jest.fn(),
      reportUsageEvents: jest.fn(),
    };
    adapter = new AzureMarketplaceAdapter(
      api as unknown as AzureMarketplaceAPI,
    );
  });

  describe("activate", () => {
    it("activates a subscription waiting to be, on its plan", async () => {
      api.getSubscription.mockResolvedValue(subscription({ quantity: 2 }));

      await expect(adapter.activate(purchase())).resolves.toMatchObject({
        status: MarketplaceSubscriptionStatus.Active,
        externalState: "Subscribed",
        externalPlanId: "pay-as-you-go",
      });
      expect(api.activate).toHaveBeenCalledWith({
        subscriptionId: SUBSCRIPTION_ID,
        planId: "pay-as-you-go",
        quantity: 2,
      });
    });

    it("does not activate again what Microsoft already has", async () => {
      api.getSubscription.mockResolvedValue(
        subscription({ status: "Subscribed" }),
      );

      await expect(adapter.activate(purchase())).resolves.toMatchObject({
        status: MarketplaceSubscriptionStatus.Active,
      });
      expect(api.activate).not.toHaveBeenCalled();
    });

    it("refuses a suspended, cancelled or missing subscription with words for the buyer", async () => {
      for (const current of [
        subscription({ status: "Suspended" }),
        subscription({ status: "Unsubscribed" }),
        null,
      ]) {
        api.getSubscription.mockResolvedValueOnce(current);

        await expect(adapter.activate(purchase())).rejects.toBeInstanceOf(
          MarketplaceActivationError,
        );
      }

      expect(api.activate).not.toHaveBeenCalled();
    });
  });

  describe("fetchStatus", () => {
    it("reads the subscription's status", async () => {
      api.getSubscription.mockResolvedValue(
        subscription({ status: "Suspended" }),
      );

      await expect(adapter.fetchStatus(purchase())).resolves.toMatchObject({
        status: MarketplaceSubscriptionStatus.Suspended,
        externalState: "Suspended",
      });
    });

    it("is null when Microsoft has no such subscription, or a status it does not know", async () => {
      api.getSubscription.mockResolvedValueOnce(null);
      await expect(adapter.fetchStatus(purchase())).resolves.toBeNull();

      api.getSubscription.mockResolvedValueOnce(
        subscription({ status: "NotStarted" }),
      );
      await expect(adapter.fetchStatus(purchase())).resolves.toBeNull();
    });
  });

  describe("reportUsage", () => {
    it("says Microsoft keeps one event per subscription and hour", () => {
      expect(adapter.keepsOneReportPerHour).toBe(true);
    });

    it("sends one event, in the hour the report ends in", async () => {
      api.reportUsageEvents.mockResolvedValue([
        { status: "Accepted", usageEventId: "ue-1", errorCode: null },
      ]);

      await expect(
        adapter.reportUsage(purchase(), record("2026-10-16T10:00:00.000Z")),
      ).resolves.toEqual({ outcome: "accepted", externalReportId: "ue-1" });

      expect(api.reportUsageEvents).toHaveBeenCalledWith([
        {
          resourceId: SUBSCRIPTION_ID,
          quantity: 2200,
          dimension: "usage_units",
          // The report ends at 10:00, so it is the 09:00 hour's event.
          effectiveStartTime: new Date("2026-10-16T09:00:00.000Z"),
          planId: "pay-as-you-go",
        },
      ]);
    });

    it("puts a final report that ends mid-hour in that hour", async () => {
      api.reportUsageEvents.mockResolvedValue([
        { status: "Accepted", usageEventId: "ue-2", errorCode: null },
      ]);

      await adapter.reportUsage(purchase(), record("2026-10-16T10:25:13.000Z"));

      const event: AzureUsageEvent = (
        api.reportUsageEvents.mock.calls[0]![0] as Array<AzureUsageEvent>
      )[0]!;

      expect(event.effectiveStartTime).toEqual(
        new Date("2026-10-16T10:00:00.000Z"),
      );
    });

    /*
     * Microsoft answers "Duplicate" to any second event for a subscription,
     * dimension and hour, with the event it kept. The same quantity is this
     * report, sent again after an answer that was lost: Microsoft has it.
     */
    it("counts a report sent again as sent: Microsoft kept an event of the same quantity", async () => {
      api.reportUsageEvents.mockResolvedValue([
        {
          status: "Duplicate",
          usageEventId: null,
          errorCode: "Conflict",
          acceptedEvent: { usageEventId: "ue-1", quantity: 2200 },
        },
      ]);

      await expect(
        adapter.reportUsage(purchase(), record("2026-10-16T10:00:00.000Z")),
      ).resolves.toEqual({ outcome: "accepted", externalReportId: "ue-1" });
    });

    it("compares the kept event's quantity as the number Microsoft writes", async () => {
      api.reportUsageEvents.mockResolvedValue([
        {
          status: "Duplicate",
          usageEventId: null,
          errorCode: "Conflict",
          acceptedEvent: { usageEventId: "ue-1", quantity: 2200.0000000001 },
        },
      ]);

      await expect(
        adapter.reportUsage(purchase(), record("2026-10-16T10:00:00.000Z")),
      ).resolves.toMatchObject({ outcome: "accepted" });
    });

    /*
     * Another quantity is another report filed in the same hour: Microsoft
     * bills the event it kept, and this report is lost. It is refused, so
     * the reporter marks it Failed and logs it as not billed.
     */
    it("refuses a report whose hour Microsoft already billed with another event", async () => {
      api.reportUsageEvents.mockResolvedValue([
        {
          status: "Duplicate",
          usageEventId: null,
          errorCode: "Conflict",
          acceptedEvent: { usageEventId: "ue-7", quantity: 640 },
        },
      ]);

      const result: MarketplaceUsageResult = await adapter.reportUsage(
        purchase(),
        record("2026-10-16T10:00:00.000Z"),
      );

      expect(result).toEqual({
        outcome: "rejected",
        error:
          "Microsoft already has another usage event for this hour (640 units, event ue-7).",
      });
      expect(result.isPurchaseInactive).toBeUndefined();
    });

    it("names no event it was not told of", async () => {
      api.reportUsageEvents.mockResolvedValue([
        {
          status: "Duplicate",
          usageEventId: null,
          errorCode: "Conflict",
          acceptedEvent: { usageEventId: null, quantity: 640 },
        },
      ]);

      await expect(
        adapter.reportUsage(purchase(), record("2026-10-16T10:00:00.000Z")),
      ).resolves.toEqual({
        outcome: "rejected",
        error:
          "Microsoft already has another usage event for this hour (640 units).",
      });
    });

    /*
     * Without the kept event (or its quantity) there is nothing to tell the
     * two apart, and a report sent again is by far the likelier: the
     * reporter never files two of a purchase's reports in one hour.
     */
    it("counts a Duplicate as sent when Microsoft leaves out the event it kept", async () => {
      for (const duplicate of [
        { status: "Duplicate", usageEventId: null, errorCode: "Conflict" },
        {
          status: "Duplicate",
          usageEventId: null,
          errorCode: "Conflict",
          acceptedEvent: { usageEventId: "ue-1", quantity: null },
        },
      ]) {
        api.reportUsageEvents.mockResolvedValueOnce([duplicate]);

        await expect(
          adapter.reportUsage(purchase(), record("2026-10-16T10:00:00.000Z")),
        ).resolves.toMatchObject({ outcome: "accepted" });
      }
    });

    it("says the purchase is inactive when Microsoft says so", async () => {
      api.reportUsageEvents.mockResolvedValue([
        { status: "ResourceNotActive", usageEventId: null, errorCode: null },
      ]);

      await expect(
        adapter.reportUsage(purchase(), record("2026-10-16T10:00:00.000Z")),
      ).resolves.toMatchObject({
        outcome: "rejected",
        isPurchaseInactive: true,
      });
    });

    it("retries what Microsoft could not record, and gives up on what it refused", async () => {
      api.reportUsageEvents.mockResolvedValueOnce([
        { status: "Error", usageEventId: null, errorCode: "InternalError" },
      ]);
      await expect(
        adapter.reportUsage(purchase(), record("2026-10-16T10:00:00.000Z")),
      ).resolves.toEqual({
        outcome: "retry",
        error: "Microsoft could not record the event (InternalError).",
      });

      api.reportUsageEvents.mockResolvedValueOnce([]);
      await expect(
        adapter.reportUsage(purchase(), record("2026-10-16T10:00:00.000Z")),
      ).resolves.toMatchObject({ outcome: "retry" });

      api.reportUsageEvents.mockResolvedValueOnce([
        { status: "Expired", usageEventId: null, errorCode: null },
      ]);
      await expect(
        adapter.reportUsage(purchase(), record("2026-10-16T10:00:00.000Z")),
      ).resolves.toEqual({
        outcome: "rejected",
        error: "Microsoft refused the event: Expired",
      });

      api.reportUsageEvents.mockRejectedValueOnce(
        new MarketplaceApiError({
          message: "throttled",
          status: 429,
          isRetryable: true,
        }),
      );
      await expect(
        adapter.reportUsage(purchase(), record("2026-10-16T10:00:00.000Z")),
      ).resolves.toMatchObject({ outcome: "retry" });

      api.reportUsageEvents.mockRejectedValueOnce(
        new MarketplaceApiError({
          message: "bad request",
          status: 400,
          isRetryable: false,
        }),
      );
      await expect(
        adapter.reportUsage(purchase(), record("2026-10-16T10:00:00.000Z")),
      ).resolves.toMatchObject({ outcome: "rejected" });
    });

    it("waits for the subscription's plan before sending anything", async () => {
      await expect(
        adapter.reportUsage(
          purchase({ externalPlanId: undefined }),
          record("2026-10-16T10:00:00.000Z"),
        ),
      ).resolves.toMatchObject({ outcome: "retry" });
      expect(api.reportUsageEvents).not.toHaveBeenCalled();
    });
  });
});
