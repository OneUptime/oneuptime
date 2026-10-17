import EnterpriseMarketplaceBillingUtil, {
  EnterpriseMarketplaceBillingState,
  EnterpriseMarketplaceBillingSummary,
} from "../../../Types/EnterpriseLicense/EnterpriseMarketplaceBilling";
import CloudMarketplace from "../../../Types/Marketplace/CloudMarketplace";
import { describe, expect, it } from "@jest/globals";

/*
 * The marketplace billing record of a self-hosted Enterprise installation is
 * what licenses it, so it is read back field by field: anything that is not
 * the shape the usage job writes is dropped, never trusted.
 */

const STORED: Record<string, unknown> = {
  version: 1,
  marketplace: "AWS",
  observedHour: { start: "2026-10-17T10:00:00.000Z", maxUsers: 42 },
  pendingReports: [
    {
      hourStart: "2026-10-17T09:00:00.000Z",
      quantity: 41,
      idempotencyKey: "ou-abc-494769",
      attempts: 2,
      firstAttemptAt: "2026-10-17T10:00:30.000Z",
      lastError: "ThrottlingException",
    },
    {
      hourStart: "2026-10-17T08:00:00.000Z",
      quantity: 40,
      idempotencyKey: "ou-abc-494768",
      attempts: 0,
      firstAttemptAt: null,
      lastError: null,
    },
  ],
  carriedUserHours: 7,
  lastAcceptedReport: {
    hourStart: "2026-10-17T07:00:00.000Z",
    quantity: 39,
    reportId: "record-1",
    acceptedAt: "2026-10-17T08:00:31.000Z",
  },
  verifiedAt: "2026-10-17T08:00:31.000Z",
  refusedAt: null,
  refusal: null,
  lastProblem: "ThrottlingException: Rate exceeded",
  lastProblemAt: "2026-10-17T10:00:30.000Z",
  unbilledUserHours: 3,
};

describe("EnterpriseMarketplaceBillingUtil.fromJSON", () => {
  it("reads back what the usage job stores, pending reports oldest first", () => {
    const state: EnterpriseMarketplaceBillingState | null =
      EnterpriseMarketplaceBillingUtil.fromJSON(STORED);

    expect(state).not.toBeNull();
    expect(state!.marketplace).toBe(CloudMarketplace.AWS);
    expect(state!.observedHour).toEqual({
      start: "2026-10-17T10:00:00.000Z",
      maxUsers: 42,
    });
    expect(
      state!.pendingReports.map((report: { hourStart: string }) => {
        return report.hourStart;
      }),
    ).toEqual(["2026-10-17T08:00:00.000Z", "2026-10-17T09:00:00.000Z"]);
    expect(state!.carriedUserHours).toBe(7);
    expect(state!.lastAcceptedReport!.reportId).toBe("record-1");
    expect(state!.verifiedAt).toBe("2026-10-17T08:00:31.000Z");
    expect(state!.unbilledUserHours).toBe(3);
  });

  it("round-trips through toJSON", () => {
    const state: EnterpriseMarketplaceBillingState =
      EnterpriseMarketplaceBillingUtil.fromJSON(STORED)!;

    expect(
      EnterpriseMarketplaceBillingUtil.fromJSON(
        EnterpriseMarketplaceBillingUtil.toJSON(state),
      ),
    ).toEqual(state);
  });

  it("refuses anything that is not a version-1 record of a known marketplace", () => {
    for (const value of [
      null,
      undefined,
      "AWS",
      [],
      {},
      { ...STORED, version: 2 },
      { ...STORED, marketplace: "Oracle" },
      { ...STORED, marketplace: undefined },
    ]) {
      expect(EnterpriseMarketplaceBillingUtil.fromJSON(value)).toBeNull();
    }
  });

  it("drops fields of the wrong kind instead of trusting them", () => {
    const state: EnterpriseMarketplaceBillingState | null =
      EnterpriseMarketplaceBillingUtil.fromJSON({
        version: 1,
        marketplace: "Azure",
        observedHour: { start: "not a date", maxUsers: 5 },
        pendingReports: [
          { hourStart: "2026-10-17T09:00:00.000Z", quantity: 3 },
          { idempotencyKey: "no-hour" },
          "junk",
          {
            hourStart: "2026-10-17T10:00:00.000Z",
            quantity: -4,
            idempotencyKey: "negative",
            attempts: "two",
          },
        ],
        carriedUserHours: "lots",
        lastAcceptedReport: { hourStart: "2026-10-17T09:00:00.000Z" },
        verifiedAt: "yesterday-ish",
        refusedAt: 12,
        refusal: 12,
        unbilledUserHours: Number.NaN,
      });

    expect(state).not.toBeNull();
    expect(state!.observedHour).toBeNull();
    expect(state!.pendingReports).toEqual([
      {
        hourStart: "2026-10-17T10:00:00.000Z",
        quantity: 0,
        idempotencyKey: "negative",
        attempts: 0,
        firstAttemptAt: null,
        lastError: null,
      },
    ]);
    expect(state!.carriedUserHours).toBe(0);
    expect(state!.lastAcceptedReport).toBeNull();
    expect(state!.verifiedAt).toBeNull();
    expect(state!.refusedAt).toBeNull();
    expect(state!.refusal).toBeNull();
    expect(state!.unbilledUserHours).toBe(0);
  });

  it("normalises dates to ISO strings", () => {
    const state: EnterpriseMarketplaceBillingState =
      EnterpriseMarketplaceBillingUtil.fromJSON({
        ...STORED,
        verifiedAt: "2026-10-17T08:00:31Z",
      })!;

    expect(state.verifiedAt).toBe("2026-10-17T08:00:31.000Z");
  });
});

describe("EnterpriseMarketplaceBillingUtil.summarize", () => {
  it("shows what an administrator needs, without the bookkeeping", () => {
    const summary: EnterpriseMarketplaceBillingSummary =
      EnterpriseMarketplaceBillingUtil.summarize(
        EnterpriseMarketplaceBillingUtil.fromJSON(STORED)!,
      );

    expect(summary).toEqual({
      marketplace: CloudMarketplace.AWS,
      verifiedAt: "2026-10-17T08:00:31.000Z",
      refusedAt: null,
      refusal: null,
      lastAcceptedReport: {
        hourStart: "2026-10-17T07:00:00.000Z",
        quantity: 39,
        reportId: "record-1",
        acceptedAt: "2026-10-17T08:00:31.000Z",
      },
      pendingReportCount: 2,
      // 41 + 40 pending, plus 7 carried.
      pendingUserHours: 88,
      lastProblem: "ThrottlingException: Rate exceeded",
      lastProblemAt: "2026-10-17T10:00:30.000Z",
    });
    expect(JSON.stringify(summary)).not.toContain("ou-abc");
  });

  it("starts empty for a marketplace", () => {
    expect(
      EnterpriseMarketplaceBillingUtil.summarize(
        EnterpriseMarketplaceBillingUtil.createEmpty(
          CloudMarketplace.GoogleCloud,
        ),
      ),
    ).toEqual({
      marketplace: CloudMarketplace.GoogleCloud,
      verifiedAt: null,
      refusedAt: null,
      refusal: null,
      lastAcceptedReport: null,
      pendingReportCount: 0,
      pendingUserHours: 0,
      lastProblem: null,
      lastProblemAt: null,
    });
  });
});
