import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import GoogleCloudMarketplaceAdapter, {
  GoogleCloudEntitlementState,
} from "../../../../Server/CloudMarketplace/GoogleCloud/GoogleCloudMarketplaceAdapter";
import GoogleCloudMarketplaceAPI, {
  GoogleCloudEntitlement,
  GoogleCloudUsageOperation,
} from "../../../../Server/CloudMarketplace/GoogleCloud/GoogleCloudMarketplaceAPI";
import {
  MarketplaceActivationError,
  MarketplaceStatus,
  MarketplaceUsageRecord,
  MarketplaceUsageResult,
} from "../../../../Server/CloudMarketplace/MarketplaceAdapter";
import MarketplaceApiError from "../../../../Server/CloudMarketplace/MarketplaceApiError";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Google Cloud Marketplace bills a procurement account through the
 * entitlement (order) in force on it. Activation approves the account's
 * sign-up and every order waiting for approval; usage is checked, then
 * reported, against the entitlement's usage reporting ID.
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...jest.requireActual("Common/Server/EnvironmentConfig"),
    GoogleCloudMarketplaceUsageMetric:
      "oneuptime.gcpmarketplace.oneuptime.com/usage_units",
  };
});

interface FakeGoogleApi {
  getAccount: jest.Mock;
  approveAccount: jest.Mock;
  listEntitlements: jest.Mock;
  getEntitlement: jest.Mock;
  approveEntitlement: jest.Mock;
  checkUsage: jest.Mock;
  reportUsage: jest.Mock;
}

const entitlement: (
  overrides: Partial<GoogleCloudEntitlement>,
) => GoogleCloudEntitlement = (
  overrides: Partial<GoogleCloudEntitlement>,
): GoogleCloudEntitlement => {
  const id: string = overrides.id || "ent-1";

  return {
    name: `providers/oneuptime-public/entitlements/${id}`,
    id: id,
    accountId: "acct-1",
    state: "ENTITLEMENT_ACTIVE",
    plan: "pay-as-you-go",
    newPendingPlan: null,
    product: "oneuptime.endpoints.oneuptime-public.cloud.goog",
    usageReportingId: `project_number:${id}`,
    createTime: "2026-10-16T09:00:00Z",
    updateTime: "2026-10-16T09:00:00Z",
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
    marketplace: CloudMarketplace.GoogleCloud,
    externalSubscriptionId: "acct-1",
    externalEntitlementId: "ent-1",
    usageReportingId: "project_number:123456789",
    ...overrides,
  });
};

const USAGE_RECORD: MarketplaceUsageRecord = {
  reportId: "8a6b7c0e-0000-4000-8000-000000000001",
  quantity: 2200,
  periodStart: new Date("2026-10-16T09:00:00.000Z"),
  periodEnd: new Date("2026-10-16T10:00:00.000Z"),
  projectId: "6720a1b2c3d4e5f6a7b8c9d0",
};

describe("GoogleCloudEntitlementState", () => {
  it("maps every entitlement state to a purchase status", () => {
    expect(
      GoogleCloudEntitlementState.toStatus("ENTITLEMENT_ACTIVATION_REQUESTED"),
    ).toBe(MarketplaceSubscriptionStatus.Pending);

    for (const inForce of [
      "ENTITLEMENT_ACTIVE",
      "ENTITLEMENT_PENDING_CANCELLATION",
      "ENTITLEMENT_PENDING_PLAN_CHANGE",
      "ENTITLEMENT_PENDING_PLAN_CHANGE_APPROVAL",
    ]) {
      expect(GoogleCloudEntitlementState.toStatus(inForce)).toBe(
        MarketplaceSubscriptionStatus.Active,
      );
      expect(GoogleCloudEntitlementState.isInForce(inForce)).toBe(true);
    }

    expect(GoogleCloudEntitlementState.toStatus("ENTITLEMENT_SUSPENDED")).toBe(
      MarketplaceSubscriptionStatus.Suspended,
    );
    expect(GoogleCloudEntitlementState.toStatus("ENTITLEMENT_CANCELLED")).toBe(
      MarketplaceSubscriptionStatus.Cancelled,
    );
    expect(
      GoogleCloudEntitlementState.toStatus("ENTITLEMENT_STATE_UNSPECIFIED"),
    ).toBeNull();
    expect(GoogleCloudEntitlementState.isInForce("ENTITLEMENT_CANCELLED")).toBe(
      false,
    );
  });

  it("bills the newest entitlement in force, even beside a newer cancelled one", () => {
    const current: GoogleCloudEntitlement | null =
      GoogleCloudEntitlementState.pickCurrent([
        entitlement({
          id: "old-active",
          createTime: "2026-01-01T00:00:00Z",
        }),
        entitlement({
          id: "new-cancelled",
          state: "ENTITLEMENT_CANCELLED",
          createTime: "2026-10-01T00:00:00Z",
        }),
        entitlement({
          id: "newer-active",
          createTime: "2026-05-01T00:00:00Z",
        }),
      ]);

    expect(current?.id).toBe("newer-active");
  });

  it("falls back to an order waiting for approval, then to the newest of all", () => {
    expect(
      GoogleCloudEntitlementState.pickCurrent([
        entitlement({ id: "cancelled", state: "ENTITLEMENT_CANCELLED" }),
        entitlement({
          id: "waiting",
          state: "ENTITLEMENT_ACTIVATION_REQUESTED",
          createTime: "2026-01-01T00:00:00Z",
        }),
      ])?.id,
    ).toBe("waiting");

    expect(
      GoogleCloudEntitlementState.pickCurrent([
        entitlement({
          id: "older",
          state: "ENTITLEMENT_CANCELLED",
          createTime: "2026-01-01T00:00:00Z",
        }),
        entitlement({
          id: "newer",
          state: "ENTITLEMENT_SUSPENDED",
          createTime: "2026-02-01T00:00:00Z",
        }),
      ])?.id,
    ).toBe("newer");

    expect(GoogleCloudEntitlementState.pickCurrent([])).toBeNull();
  });

  it("writes the entitlement's plan, product and usage reporting ID onto the purchase", () => {
    expect(
      GoogleCloudEntitlementState.toFacts(
        entitlement({ newPendingPlan: "scale" }),
      ),
    ).toEqual({
      externalCustomerId: "acct-1",
      externalEntitlementId: "ent-1",
      externalPlanId: "pay-as-you-go",
      externalOfferId: "oneuptime.endpoints.oneuptime-public.cloud.goog",
      usageReportingId: "project_number:ent-1",
      externalState: "ENTITLEMENT_ACTIVE",
      details: {
        entitlement: "providers/oneuptime-public/entitlements/ent-1",
        plan: "pay-as-you-go",
        newPendingPlan: "scale",
        product: "oneuptime.endpoints.oneuptime-public.cloud.goog",
        state: "ENTITLEMENT_ACTIVE",
        updateTime: "2026-10-16T09:00:00Z",
      },
    });
  });
});

describe("GoogleCloudMarketplaceAdapter", () => {
  let api: FakeGoogleApi;
  let adapter: GoogleCloudMarketplaceAdapter;

  beforeEach(() => {
    api = {
      getAccount: jest.fn(),
      approveAccount: jest.fn(),
      listEntitlements: jest.fn(),
      getEntitlement: jest.fn(),
      approveEntitlement: jest.fn(),
      checkUsage: jest.fn(),
      reportUsage: jest.fn(),
    };
    adapter = new GoogleCloudMarketplaceAdapter(
      api as unknown as GoogleCloudMarketplaceAPI,
    );
  });

  describe("activate", () => {
    it("approves the sign-up and every order waiting for approval, and bills the one in force", async () => {
      api.getAccount.mockResolvedValue({
        id: "acct-1",
        state: "ACCOUNT_ACTIVE",
        approvals: { signup: "PENDING" },
      });
      api.listEntitlements.mockResolvedValue([
        entitlement({
          id: "ent-1",
          state: "ENTITLEMENT_ACTIVATION_REQUESTED",
        }),
      ]);

      const status: MarketplaceStatus = await adapter.activate(purchase());

      expect(api.approveAccount).toHaveBeenCalledWith("acct-1");
      expect(api.approveEntitlement).toHaveBeenCalledWith("ent-1");
      expect(status).toMatchObject({
        status: MarketplaceSubscriptionStatus.Active,
        externalEntitlementId: "ent-1",
        externalPlanId: "pay-as-you-go",
        usageReportingId: "project_number:ent-1",
      });
    });

    it("does not approve what is already approved", async () => {
      api.getAccount.mockResolvedValue({
        id: "acct-1",
        state: "ACCOUNT_ACTIVE",
        approvals: { signup: "APPROVED" },
      });
      api.listEntitlements.mockResolvedValue([
        entitlement({ id: "ent-1", state: "ENTITLEMENT_ACTIVE" }),
      ]);

      await expect(adapter.activate(purchase())).resolves.toMatchObject({
        status: MarketplaceSubscriptionStatus.Active,
      });
      expect(api.approveAccount).not.toHaveBeenCalled();
      expect(api.approveEntitlement).not.toHaveBeenCalled();
    });

    it("tolerates losing the race to another approval of the same order", async () => {
      api.getAccount.mockResolvedValue({
        id: "acct-1",
        state: "ACCOUNT_ACTIVE",
        approvals: { signup: "APPROVED" },
      });
      api.listEntitlements.mockResolvedValue([
        entitlement({ state: "ENTITLEMENT_ACTIVATION_REQUESTED" }),
      ]);
      api.approveEntitlement.mockRejectedValue(
        new MarketplaceApiError({
          message: "Entitlement is not in ENTITLEMENT_ACTIVATION_REQUESTED",
          status: 400,
          isRetryable: false,
        }),
      );
      api.getEntitlement.mockResolvedValue(
        entitlement({ state: "ENTITLEMENT_ACTIVE" }),
      );

      await expect(adapter.activate(purchase())).resolves.toMatchObject({
        status: MarketplaceSubscriptionStatus.Active,
      });
    });

    it("fails when an order refused for approval is still waiting", async () => {
      const refusal: MarketplaceApiError = new MarketplaceApiError({
        message: "refused",
        status: 400,
        isRetryable: false,
      });

      api.getAccount.mockResolvedValue({
        id: "acct-1",
        state: "ACCOUNT_ACTIVE",
        approvals: { signup: "APPROVED" },
      });
      api.listEntitlements.mockResolvedValue([
        entitlement({ state: "ENTITLEMENT_ACTIVATION_REQUESTED" }),
      ]);
      api.approveEntitlement.mockRejectedValue(refusal);
      api.getEntitlement.mockResolvedValue(
        entitlement({ state: "ENTITLEMENT_ACTIVATION_REQUESTED" }),
      );

      await expect(adapter.activate(purchase())).rejects.toBe(refusal);
    });

    it("passes on any other failure to approve an order", async () => {
      const outage: MarketplaceApiError = new MarketplaceApiError({
        message: "unavailable",
        status: 503,
        isRetryable: true,
      });

      api.getAccount.mockResolvedValue({
        id: "acct-1",
        state: "ACCOUNT_ACTIVE",
        approvals: { signup: "APPROVED" },
      });
      api.listEntitlements.mockResolvedValue([
        entitlement({ state: "ENTITLEMENT_ACTIVATION_REQUESTED" }),
      ]);
      api.approveEntitlement.mockRejectedValue(outage);

      await expect(adapter.activate(purchase())).rejects.toBe(outage);
      expect(api.getEntitlement).not.toHaveBeenCalled();
    });

    it("tells the buyer when Google no longer has the account", async () => {
      api.getAccount.mockResolvedValue(null);

      await expect(adapter.activate(purchase())).rejects.toBeInstanceOf(
        MarketplaceActivationError,
      );
      expect(api.approveAccount).not.toHaveBeenCalled();
    });

    it("tells the buyer to wait while Google is still creating the order", async () => {
      api.getAccount.mockResolvedValue({
        id: "acct-1",
        state: "ACCOUNT_ACTIVE",
        approvals: { signup: "APPROVED" },
      });
      api.listEntitlements.mockResolvedValue([]);

      await expect(adapter.activate(purchase())).rejects.toThrow(
        /not finished creating/,
      );
    });

    it("refuses to activate an order that is no longer in force", async () => {
      api.getAccount.mockResolvedValue({
        id: "acct-1",
        state: "ACCOUNT_ACTIVE",
        approvals: { signup: "APPROVED" },
      });
      api.listEntitlements.mockResolvedValue([
        entitlement({ state: "ENTITLEMENT_CANCELLED" }),
      ]);

      await expect(adapter.activate(purchase())).rejects.toThrow(
        /no longer active/,
      );
    });
  });

  describe("fetchStatus", () => {
    it("reads the status of the entitlement in force", async () => {
      api.listEntitlements.mockResolvedValue([
        entitlement({ state: "ENTITLEMENT_SUSPENDED" }),
      ]);

      await expect(adapter.fetchStatus(purchase())).resolves.toMatchObject({
        status: MarketplaceSubscriptionStatus.Suspended,
        externalState: "ENTITLEMENT_SUSPENDED",
      });
      expect(api.listEntitlements).toHaveBeenCalledWith("acct-1");
    });

    it("is null with no entitlement, or one in a state it does not know", async () => {
      api.listEntitlements.mockResolvedValueOnce([]);
      await expect(adapter.fetchStatus(purchase())).resolves.toBeNull();

      api.listEntitlements.mockResolvedValueOnce([
        entitlement({ state: "ENTITLEMENT_STATE_UNSPECIFIED" }),
      ]);
      await expect(adapter.fetchStatus(purchase())).resolves.toBeNull();
    });
  });

  describe("reportUsage", () => {
    it("says Google Cloud counts reports by their ID, not one per hour", () => {
      expect(adapter.keepsOneReportPerHour).toBe(false);
    });

    it("checks, then reports, the record as one operation keyed by the report's ID", async () => {
      api.checkUsage.mockResolvedValue([]);
      api.reportUsage.mockResolvedValue([]);

      const result: MarketplaceUsageResult = await adapter.reportUsage(
        purchase(),
        USAGE_RECORD,
      );

      expect(result).toEqual({
        outcome: "accepted",
        externalReportId: USAGE_RECORD.reportId,
      });

      const operation: GoogleCloudUsageOperation = api.checkUsage.mock
        .calls[0]![0] as GoogleCloudUsageOperation;

      expect(operation).toMatchObject({
        operationId: USAGE_RECORD.reportId,
        consumerId: "project_number:123456789",
        metricName: "oneuptime.gcpmarketplace.oneuptime.com/usage_units",
        quantity: 2200,
        labels: {
          "cloudmarketplace.googleapis.com/resource_name":
            USAGE_RECORD.projectId,
        },
      });
      expect(new Date(operation.startTime).getTime()).toBe(
        USAGE_RECORD.periodStart.getTime(),
      );
      expect(new Date(operation.endTime).getTime()).toBe(
        USAGE_RECORD.periodEnd.getTime(),
      );
      // The same operation is reported as was checked.
      expect(api.reportUsage.mock.calls[0]![0]).toEqual(operation);
    });

    it("waits for the usage reporting ID before sending anything", async () => {
      await expect(
        adapter.reportUsage(
          purchase({ usageReportingId: undefined }),
          USAGE_RECORD,
        ),
      ).resolves.toMatchObject({ outcome: "retry" });
      expect(api.checkUsage).not.toHaveBeenCalled();
    });

    it("does not report when the check says the buyer can no longer be billed", async () => {
      api.checkUsage.mockResolvedValue([
        { code: "BILLING_DISABLED", detail: "Billing is disabled" },
      ]);

      await expect(
        adapter.reportUsage(purchase(), USAGE_RECORD),
      ).resolves.toEqual({
        outcome: "rejected",
        error: "BILLING_DISABLED: Billing is disabled",
        isPurchaseInactive: true,
      });
      expect(api.reportUsage).not.toHaveBeenCalled();
    });

    it("rejects, without calling the purchase inactive, on any other check error", async () => {
      api.checkUsage.mockResolvedValue([
        { code: "INVALID_ARGUMENT", detail: "" },
      ]);

      await expect(
        adapter.reportUsage(purchase(), USAGE_RECORD),
      ).resolves.toEqual({
        outcome: "rejected",
        error: "INVALID_ARGUMENT",
        isPurchaseInactive: false,
      });
    });

    it("rejects a report Service Control refuses", async () => {
      api.checkUsage.mockResolvedValue([]);
      api.reportUsage.mockResolvedValue([{ code: "3", detail: "bad metric" }]);

      await expect(
        adapter.reportUsage(purchase(), USAGE_RECORD),
      ).resolves.toEqual({ outcome: "rejected", error: "3: bad metric" });
    });

    it("retries what Google could not answer, and gives up on what it refused", async () => {
      api.checkUsage.mockRejectedValueOnce(
        new MarketplaceApiError({
          message: "unavailable",
          status: 503,
          isRetryable: true,
        }),
      );
      await expect(
        adapter.reportUsage(purchase(), USAGE_RECORD),
      ).resolves.toMatchObject({ outcome: "retry", error: "unavailable" });

      api.checkUsage.mockRejectedValueOnce(
        new MarketplaceApiError({
          message: "forbidden",
          status: 403,
          isRetryable: false,
        }),
      );
      await expect(
        adapter.reportUsage(purchase(), USAGE_RECORD),
      ).resolves.toMatchObject({ outcome: "rejected", error: "forbidden" });

      api.checkUsage.mockRejectedValueOnce(new Error("bug"));
      await expect(
        adapter.reportUsage(purchase(), USAGE_RECORD),
      ).resolves.toMatchObject({ outcome: "retry" });
    });
  });
});
