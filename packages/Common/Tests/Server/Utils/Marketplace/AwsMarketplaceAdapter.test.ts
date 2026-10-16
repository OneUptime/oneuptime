import MarketplaceSubscription from "../../../../Models/DatabaseModels/MarketplaceSubscription";
import CloudMarketplace from "../../../../Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "../../../../Types/Marketplace/MarketplaceSubscriptionStatus";
import AwsMarketplaceAdapter, {
  AwsAgreementStatus,
} from "../../../../Server/Utils/Marketplace/AWS/AwsMarketplaceAdapter";
import AwsMarketplaceAPI, {
  AwsAgreement,
  AwsUsageRecord,
} from "../../../../Server/Utils/Marketplace/AWS/AwsMarketplaceAPI";
import {
  MarketplaceActivationError,
  MarketplaceUsageRecord,
} from "../../../../Server/Utils/Marketplace/MarketplaceAdapter";
import MarketplaceApiError from "../../../../Server/Utils/Marketplace/MarketplaceApiError";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * AWS bills a license from the moment the buyer subscribes. OneUptime only
 * links a project once the agreement behind the license is ACTIVE, follows
 * the agreement's status afterwards, and meters usage against the license
 * and the buyer's AWS account.
 */

const LICENSE_ARN: string =
  "arn:aws:license-manager::123456789012:license:l-0123456789abcdef0123456789abcdef";

const agreement: (overrides?: Partial<AwsAgreement>) => AwsAgreement = (
  overrides?: Partial<AwsAgreement>,
): AwsAgreement => {
  return {
    agreementId: "agmt-1",
    status: "ACTIVE",
    acceptorAccountId: "123456789012",
    offerId: "offer-1",
    startTime: "2026-10-16T09:00:00.000Z",
    endTime: null,
    ...overrides,
  };
};

const purchase: (
  overrides?: Partial<MarketplaceSubscription>,
) => MarketplaceSubscription = (
  overrides?: Partial<MarketplaceSubscription>,
): MarketplaceSubscription => {
  return Object.assign(new MarketplaceSubscription(), {
    marketplace: CloudMarketplace.AWS,
    externalSubscriptionId: LICENSE_ARN,
    externalCustomerId: "123456789012",
    externalEntitlementId: "agmt-1",
    ...overrides,
  });
};

const USAGE_RECORD: MarketplaceUsageRecord = {
  reportId: "report-1",
  quantity: 2200,
  periodStart: new Date("2026-10-16T09:00:00.000Z"),
  periodEnd: new Date("2026-10-16T10:00:00.000Z"),
  projectId: "6720a1b2c3d4e5f6a7b8c9d0",
};

describe("AwsAgreementStatus", () => {
  it("maps an agreement's status to a purchase status", () => {
    expect(AwsAgreementStatus.toStatus("ACTIVE")).toBe(
      MarketplaceSubscriptionStatus.Active,
    );

    for (const ended of [
      "CANCELLED",
      "EXPIRED",
      "TERMINATED",
      "ARCHIVED",
      "ROLLED_BACK",
    ]) {
      expect(AwsAgreementStatus.toStatus(ended)).toBe(
        MarketplaceSubscriptionStatus.Cancelled,
      );
    }

    // Carried on by a successor agreement, whose own events say where it stands.
    for (const succeeded of ["RENEWED", "REPLACED", "SUPERSEDED", ""]) {
      expect(AwsAgreementStatus.toStatus(succeeded)).toBeNull();
    }
  });
});

describe("AwsMarketplaceAdapter", () => {
  let api: { describeAgreement: jest.Mock; batchMeterUsage: jest.Mock };
  let adapter: AwsMarketplaceAdapter;

  beforeEach(() => {
    api = { describeAgreement: jest.fn(), batchMeterUsage: jest.fn() };
    adapter = new AwsMarketplaceAdapter(api as unknown as AwsMarketplaceAPI);
  });

  describe("activate", () => {
    it("links a project only once the agreement is active", async () => {
      api.describeAgreement.mockResolvedValue(agreement());

      await expect(adapter.activate(purchase())).resolves.toEqual({
        status: MarketplaceSubscriptionStatus.Active,
        externalState: "ACTIVE",
        externalOfferId: "offer-1",
      });
      expect(api.describeAgreement).toHaveBeenCalledWith("agmt-1");
    });

    it("asks the buyer to wait while AWS has not named or created the agreement", async () => {
      await expect(
        adapter.activate(purchase({ externalEntitlementId: undefined })),
      ).rejects.toThrow(/still setting up/);
      expect(api.describeAgreement).not.toHaveBeenCalled();

      api.describeAgreement.mockResolvedValue(null);
      await expect(adapter.activate(purchase())).rejects.toThrow(
        /still setting up/,
      );
    });

    it("refuses an agreement that has ended, or moved on to a successor", async () => {
      for (const status of ["CANCELLED", "EXPIRED", "RENEWED"]) {
        api.describeAgreement.mockResolvedValueOnce(agreement({ status }));

        await expect(adapter.activate(purchase())).rejects.toBeInstanceOf(
          MarketplaceActivationError,
        );
      }
    });
  });

  describe("fetchStatus", () => {
    it("reads the agreement's status", async () => {
      api.describeAgreement.mockResolvedValue(
        agreement({ status: "EXPIRED", offerId: null }),
      );

      await expect(adapter.fetchStatus(purchase())).resolves.toEqual({
        status: MarketplaceSubscriptionStatus.Cancelled,
        externalState: "EXPIRED",
      });
    });

    it("is null without an agreement, or with one whose status answers nothing", async () => {
      await expect(
        adapter.fetchStatus(purchase({ externalEntitlementId: undefined })),
      ).resolves.toBeNull();

      api.describeAgreement.mockResolvedValueOnce(null);
      await expect(adapter.fetchStatus(purchase())).resolves.toBeNull();

      api.describeAgreement.mockResolvedValueOnce(
        agreement({ status: "REPLACED" }),
      );
      await expect(adapter.fetchStatus(purchase())).resolves.toBeNull();
    });
  });

  describe("reportUsage", () => {
    it("meters the record against the license, stamped with the period's end", async () => {
      api.batchMeterUsage.mockResolvedValue([
        { status: "Success", meteringRecordId: "mr-1" },
      ]);

      await expect(
        adapter.reportUsage(purchase(), USAGE_RECORD),
      ).resolves.toEqual({ outcome: "accepted", externalReportId: "mr-1" });

      const records: Array<AwsUsageRecord> = api.batchMeterUsage.mock
        .calls[0]![0] as Array<AwsUsageRecord>;

      expect(records).toEqual([
        {
          customerAwsAccountId: "123456789012",
          licenseArn: LICENSE_ARN,
          dimension: "usage_units",
          quantity: 2200,
          timestamp: USAGE_RECORD.periodEnd,
        },
      ]);
    });

    it("counts a record AWS already has as sent", async () => {
      api.batchMeterUsage.mockResolvedValue([
        { status: "DuplicateRecord", meteringRecordId: null },
      ]);

      await expect(
        adapter.reportUsage(purchase(), USAGE_RECORD),
      ).resolves.toEqual({ outcome: "accepted", externalReportId: undefined });
    });

    it("says the purchase is inactive when AWS says the buyer is not subscribed", async () => {
      api.batchMeterUsage.mockResolvedValue([
        { status: "CustomerNotSubscribed", meteringRecordId: null },
      ]);

      await expect(
        adapter.reportUsage(purchase(), USAGE_RECORD),
      ).resolves.toMatchObject({
        outcome: "rejected",
        isPurchaseInactive: true,
      });
    });

    it("retries a record AWS did not process, and on AWS's own failures", async () => {
      api.batchMeterUsage.mockResolvedValueOnce([
        { status: "Unprocessed", meteringRecordId: null },
      ]);
      await expect(
        adapter.reportUsage(purchase(), USAGE_RECORD),
      ).resolves.toMatchObject({ outcome: "retry" });

      api.batchMeterUsage.mockResolvedValueOnce([]);
      await expect(
        adapter.reportUsage(purchase(), USAGE_RECORD),
      ).resolves.toMatchObject({ outcome: "retry" });

      api.batchMeterUsage.mockRejectedValueOnce(
        new MarketplaceApiError({
          message: "ThrottlingException",
          status: 400,
          isRetryable: true,
        }),
      );
      await expect(
        adapter.reportUsage(purchase(), USAGE_RECORD),
      ).resolves.toMatchObject({ outcome: "retry" });

      api.batchMeterUsage.mockRejectedValueOnce(new Error("socket hang up"));
      await expect(
        adapter.reportUsage(purchase(), USAGE_RECORD),
      ).resolves.toMatchObject({ outcome: "retry" });
    });

    it("gives up on a record AWS refuses for good", async () => {
      api.batchMeterUsage.mockRejectedValueOnce(
        new MarketplaceApiError({
          message: "InvalidUsageDimensionException",
          status: 400,
          isRetryable: false,
        }),
      );
      await expect(
        adapter.reportUsage(purchase(), USAGE_RECORD),
      ).resolves.toMatchObject({
        outcome: "rejected",
        error: "InvalidUsageDimensionException",
      });

      api.batchMeterUsage.mockResolvedValueOnce([
        { status: "InvalidLicense", meteringRecordId: null },
      ]);
      await expect(
        adapter.reportUsage(purchase(), USAGE_RECORD),
      ).resolves.toMatchObject({
        outcome: "rejected",
        error: "AWS refused the record: InvalidLicense",
      });
    });

    it("sends nothing without the buyer's AWS account", async () => {
      await expect(
        adapter.reportUsage(
          purchase({ externalCustomerId: undefined }),
          USAGE_RECORD,
        ),
      ).resolves.toMatchObject({ outcome: "rejected" });
      expect(api.batchMeterUsage).not.toHaveBeenCalled();
    });
  });
});
