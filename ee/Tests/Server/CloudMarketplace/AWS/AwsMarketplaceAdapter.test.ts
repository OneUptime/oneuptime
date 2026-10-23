import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import AwsMarketplaceAdapter, {
  AwsAgreementStatus,
} from "../../../../Server/CloudMarketplace/AWS/AwsMarketplaceAdapter";
import AwsMarketplaceAPI, {
  AwsAgreement,
  AwsUsageRecord,
} from "../../../../Server/CloudMarketplace/AWS/AwsMarketplaceAPI";
import {
  MarketplaceActivationError,
  MarketplaceUsageRecord,
  MarketplaceUsageResult,
} from "../../../../Server/CloudMarketplace/MarketplaceAdapter";
import MarketplaceApiError from "../../../../Server/CloudMarketplace/MarketplaceApiError";
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
    it("meters the record against the license, stamped in the hour it covers", async () => {
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
          // The 09:00 - 10:00 report, in the 09:00 hour - not at 10:00.
          timestamp: new Date("2026-10-16T09:59:00.000Z"),
        },
      ]);
    });

    /*
     * AWS bills the first record of a license's dimension in each hour, and
     * refuses any other as a DuplicateRecord. Stamped with its period's end,
     * the 09:00 - 10:00 report sat in the 10:00 hour - the hour every final
     * report sent before 11:00 is in - so a project's last partial hour was
     * refused, unbilled.
     */
    it("stamps a final report in an hour of its own, after the hourly report before it", async () => {
      api.batchMeterUsage.mockResolvedValue([
        { status: "Success", meteringRecordId: "mr-1" },
      ]);

      await adapter.reportUsage(purchase(), USAGE_RECORD);
      await adapter.reportUsage(purchase(), {
        ...USAGE_RECORD,
        reportId: "report-2",
        quantity: 640,
        periodStart: new Date("2026-10-16T10:00:00.000Z"),
        periodEnd: new Date("2026-10-16T10:25:13.000Z"),
      });

      const hours: Array<number> = api.batchMeterUsage.mock.calls.map(
        (call: Array<unknown>): number => {
          const timestamp: Date = (call[0] as Array<AwsUsageRecord>)[0]!
            .timestamp;
          return new Date(timestamp).setUTCMinutes(0, 0, 0);
        },
      );

      expect(hours).toEqual([
        Date.UTC(2026, 9, 16, 9),
        Date.UTC(2026, 9, 16, 10),
      ]);
      // Stamped inside its own period, before the license could end.
      expect(
        (api.batchMeterUsage.mock.calls[1]![0] as Array<AwsUsageRecord>)[0]!
          .timestamp,
      ).toEqual(new Date("2026-10-16T10:24:13.000Z"));
    });

    it("stamps a report sent again exactly where it was the first time", async () => {
      api.batchMeterUsage.mockResolvedValue([
        { status: "Success", meteringRecordId: "mr-1" },
      ]);

      await adapter.reportUsage(purchase(), USAGE_RECORD);
      await adapter.reportUsage(purchase(), USAGE_RECORD);

      expect(api.batchMeterUsage.mock.calls[1]![0]).toEqual(
        api.batchMeterUsage.mock.calls[0]![0],
      );
    });

    it("says AWS keeps one record per license and hour", () => {
      expect(adapter.keepsOneReportPerHour).toBe(true);
    });

    /*
     * AWS answers the same record sent again as it did the first time, so a
     * report whose answer was lost counts as sent when AWS says Success.
     */
    it("counts the same record sent again as sent: AWS answers it Success", async () => {
      api.batchMeterUsage.mockResolvedValue([
        { status: "Success", meteringRecordId: "mr-1" },
      ]);

      await adapter.reportUsage(purchase(), USAGE_RECORD);
      await expect(
        adapter.reportUsage(purchase(), USAGE_RECORD),
      ).resolves.toEqual({ outcome: "accepted", externalReportId: "mr-1" });
    });

    /*
     * DuplicateRecord is AWS saying it already metered a record with another
     * quantity for this license, dimension and hour - and bills that one.
     * This report is lost, so it is refused, and the reporter marks it Failed
     * and logs it as not billed, rather than counting it as sent.
     */
    it("refuses a record AWS answers DuplicateRecord: another record of the hour was billed instead", async () => {
      api.batchMeterUsage.mockResolvedValue([
        { status: "DuplicateRecord", meteringRecordId: null },
      ]);

      const result: MarketplaceUsageResult = await adapter.reportUsage(
        purchase(),
        USAGE_RECORD,
      );

      expect(result).toEqual({
        outcome: "rejected",
        error:
          "AWS already billed another record for this license in this hour (DuplicateRecord).",
      });
      // The buyer is still subscribed: nothing to read back.
      expect(result.isPurchaseInactive).toBeUndefined();
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
