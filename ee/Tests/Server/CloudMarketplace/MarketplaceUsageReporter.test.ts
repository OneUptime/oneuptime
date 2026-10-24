import MarketplaceCharge from "Common/Models/DatabaseModels/MarketplaceCharge";
import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import MarketplaceUsageReport from "Common/Models/DatabaseModels/MarketplaceUsageReport";
import Project from "Common/Models/DatabaseModels/Project";
import TelemetryUsageBilling from "Common/Models/DatabaseModels/TelemetryUsageBilling";
import ProjectBalanceType from "Common/Types/Billing/ProjectBalanceType";
import OneUptimeDate from "Common/Types/Date";
import Decimal from "Common/Types/Decimal";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import MarketplaceUsageReportStatus from "Common/Types/Marketplace/MarketplaceUsageReportStatus";
import ObjectID from "Common/Types/ObjectID";
import Semaphore from "Common/Server/Infrastructure/Semaphore";
import MarketplaceChargeService from "Common/Server/Services/MarketplaceChargeService";
import MarketplaceSubscriptionService from "Common/Server/Services/MarketplaceSubscriptionService";
import MarketplacePurchases from "../../../Server/CloudMarketplace/MarketplacePurchases";
import MarketplaceUsageReportService from "Common/Server/Services/MarketplaceUsageReportService";
import ProjectService from "Common/Server/Services/ProjectService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import TelemetryUsageBillingService from "Common/Server/Services/TelemetryUsageBillingService";
import AwsMarketplaceAdapter from "../../../Server/CloudMarketplace/AWS/AwsMarketplaceAdapter";
import AwsMarketplaceAPI from "../../../Server/CloudMarketplace/AWS/AwsMarketplaceAPI";
import AzureMarketplaceAdapter from "../../../Server/CloudMarketplace/Azure/AzureMarketplaceAdapter";
import AzureMarketplaceAPI, {
  AzureUsageEvent,
  AzureUsageEventResult,
} from "../../../Server/CloudMarketplace/Azure/AzureMarketplaceAPI";
import MarketplaceAdapter, {
  MarketplaceUsageRecord,
} from "../../../Server/CloudMarketplace/MarketplaceAdapter";
import MarketplaceAdapters from "../../../Server/CloudMarketplace/MarketplaceAdapters";
import MarketplaceUsageCalculator from "../../../Server/CloudMarketplace/MarketplaceUsageCalculator";
import MarketplaceUsageReporter from "../../../Server/CloudMarketplace/MarketplaceUsageReporter";
import logger from "Common/Server/Utils/Logger";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The hourly usage report: each linked, active purchase's last whole hour
 * is priced, written down as a report, and only then sent - so a send that
 * fails is sent again as exactly the same record, and the marketplace counts
 * it once. A report the marketplace will not take any more is marked Failed:
 * revenue someone has to look at.
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...jest.requireActual("Common/Server/EnvironmentConfig"),
    getAllEnvVars: (): Record<string, string> => {
      return {
        SUBSCRIPTION_PLAN_FREE: "Free,free_monthly,free_yearly,0,0,1,0",
        SUBSCRIPTION_PLAN_GROWTH:
          "Growth,growth_monthly,growth_yearly,22,240,2,14",
        SUBSCRIPTION_PLAN_ENTERPRISE:
          "Enterprise,enterprise_monthly,enterprise_yearly,-1,-1,4,0",
      };
    },
  };
});

jest.mock("Common/Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: { lock: jest.fn(), release: jest.fn() },
  };
});

jest.mock("Common/Server/Services/MarketplaceSubscriptionService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      findPurchaseById: jest.fn(),
      updateOneById: jest.fn(),
      getPurchaseSelect: jest.fn().mockReturnValue({ _id: true }),
    },
  };
});

jest.mock("../../../Server/CloudMarketplace/MarketplacePurchases", () => {
  return {
    __esModule: true,
    default: {
      updatePurchase: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MarketplaceChargeService", () => {
  return {
    __esModule: true,
    default: { findUnbilled: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/MarketplaceUsageReportService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), create: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: { getUniqueTeamMemberCountInProject: jest.fn() },
  };
});

jest.mock("Common/Server/Services/TelemetryUsageBillingService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Billing/ActiveMonitorLimit", () => {
  return {
    __esModule: true,
    default: { refreshCount: jest.fn() },
  };
});

const mocked: (fn: unknown) => jest.Mock = (fn: unknown): jest.Mock => {
  return fn as jest.Mock;
};

// 10:05 on 16 October 2026: the 09:00-10:00 hour is the one to report.
const NOW: Date = new Date("2026-10-16T10:05:00.000Z");
const HOUR_START: Date = new Date("2026-10-16T10:00:00.000Z");
const LAST_REPORTED: Date = new Date("2026-10-16T09:00:00.000Z");
const PROJECT_ID: ObjectID = ObjectID.generate();

// Partial<T> under exactOptionalPropertyTypes forbids an explicit undefined.
type SubscriptionOverrides = {
  [K in keyof MarketplaceSubscription]?: MarketplaceSubscription[K] | undefined;
};

const purchaseRow: (
  overrides?: SubscriptionOverrides,
) => MarketplaceSubscription = (
  overrides?: SubscriptionOverrides,
): MarketplaceSubscription => {
  return Object.assign(new MarketplaceSubscription(), {
    _id: ObjectID.generate().toString(),
    marketplace: CloudMarketplace.GoogleCloud,
    externalSubscriptionId: "acct-1",
    status: MarketplaceSubscriptionStatus.Active,
    projectId: PROJECT_ID,
    isUsageMetered: true,
    linkedAt: new Date("2026-10-01T00:00:00.000Z"),
    usageReportedUntil: LAST_REPORTED,
    unreportedUsageInUSD: new Decimal(0.004),
    ...overrides,
  });
};

const telemetryRow: (cost: number, day?: string) => TelemetryUsageBilling = (
  cost: number,
  day?: string,
): TelemetryUsageBilling => {
  return Object.assign(new TelemetryUsageBilling(), {
    _id: ObjectID.generate().toString(),
    totalCostInUSD: new Decimal(cost),
    day: day || "Oct 15, 2026",
  });
};

const balanceCharge: (
  balanceType: ProjectBalanceType,
  amountInUSD: number,
) => MarketplaceCharge = (
  balanceType: ProjectBalanceType,
  amountInUSD: number,
): MarketplaceCharge => {
  return Object.assign(new MarketplaceCharge(), {
    _id: ObjectID.generate().toString(),
    balanceType: balanceType,
    amountInUSD: new Decimal(amountInUSD),
    isAutomatic: false,
  });
};

const pendingReport: (
  overrides?: Partial<MarketplaceUsageReport>,
) => MarketplaceUsageReport = (
  overrides?: Partial<MarketplaceUsageReport>,
): MarketplaceUsageReport => {
  return Object.assign(new MarketplaceUsageReport(), {
    _id: ObjectID.generate().toString(),
    projectId: PROJECT_ID,
    periodStart: new Date("2026-10-16T08:00:00.000Z"),
    periodEnd: new Date("2026-10-16T09:00:00.000Z"),
    quantity: 40,
    attempts: 1,
    status: MarketplaceUsageReportStatus.Pending,
    ...overrides,
  });
};

// Every update the reporter made to a report, by report ID.
const reportUpdates: () => Array<{
  id: string;
  data: Record<string, unknown>;
}> = (): Array<{ id: string; data: Record<string, unknown> }> => {
  return mocked(MarketplaceUsageReportService.updateOneById).mock.calls.map(
    (call: Array<unknown>) => {
      const argument: { id: ObjectID; data: Record<string, unknown> } =
        call[0] as { id: ObjectID; data: Record<string, unknown> };
      return { id: argument.id.toString(), data: argument.data };
    },
  );
};

describe("MarketplaceUsageReporter", () => {
  let adapter: {
    marketplace: CloudMarketplace;
    isConfigured: jest.Mock;
    activate: jest.Mock;
    fetchStatus: jest.Mock;
    reportUsage: jest.Mock;
  };
  let purchase: MarketplaceSubscription;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date(NOW.getTime());
    });

    adapter = {
      marketplace: CloudMarketplace.GoogleCloud,
      isConfigured: jest.fn().mockReturnValue(true),
      activate: jest.fn(),
      fetchStatus: jest.fn(),
      reportUsage: jest.fn().mockResolvedValue({
        outcome: "accepted",
        externalReportId: "external-1",
      }),
    };
    MarketplaceAdapters.set(
      CloudMarketplace.GoogleCloud,
      adapter as unknown as MarketplaceAdapter,
    );

    purchase = purchaseRow();

    mocked(Semaphore.lock).mockResolvedValue({ key: "lock" });
    mocked(MarketplaceSubscriptionService.findPurchaseById).mockImplementation(
      async (): Promise<MarketplaceSubscription> => {
        return purchase;
      },
    );
    mocked(MarketplaceUsageReportService.findBy).mockResolvedValue([]);
    // As the database does: a report keeps the id the reporter gave it.
    mocked(MarketplaceUsageReportService.create).mockImplementation(
      async (data: {
        data: MarketplaceUsageReport;
      }): Promise<MarketplaceUsageReport> => {
        return data.data._id
          ? data.data
          : Object.assign(data.data, { _id: ObjectID.generate().toString() });
      },
    );
    mocked(MarketplaceChargeService.findUnbilled).mockResolvedValue([]);
    mocked(ProjectService.findOneById).mockResolvedValue(
      Object.assign(new Project(), {
        _id: PROJECT_ID.toString(),
        paymentProviderPlanId: "growth_monthly",
        trialEndsAt: null,
        currentActiveMonitorsCount: 3,
      }),
    );
    mocked(
      TeamMemberService.getUniqueTeamMemberCountInProject,
    ).mockResolvedValue(10);
    mocked(TelemetryUsageBillingService.findBy).mockResolvedValue([
      telemetryRow(1.25),
      telemetryRow(0.5),
    ]);
  });

  afterEach(() => {
    MarketplaceAdapters.set(CloudMarketplace.GoogleCloud, null);
    jest.restoreAllMocks();
  });

  it("prices the last whole hour, writes it down, then sends it", async () => {
    await MarketplaceUsageReporter.reportForPurchase(purchase);

    const expected: number = MarketplaceUsageCalculator.calculate({
      periodStart: LAST_REPORTED,
      periodEnd: HOUR_START,
      seats: 10,
      seatPricePerMonthInUSD: 22,
      trialEndsAt: null,
      activeMonitors: 3,
      activeMonitorPricePerMonthInUSD: 1,
      telemetryInUSD: 1.75,
      carriedInUSD: 0.004,
    }).quantity;

    expect(expected).toBeGreaterThan(175);

    const written: MarketplaceUsageReport = (
      mocked(MarketplaceUsageReportService.create).mock.calls[0]![0] as {
        data: MarketplaceUsageReport;
      }
    ).data;

    expect(written).toMatchObject({
      marketplaceSubscriptionId: purchase.id,
      projectId: PROJECT_ID,
      marketplace: CloudMarketplace.GoogleCloud,
      periodStart: LAST_REPORTED,
      periodEnd: HOUR_START,
      quantity: expected,
      status: MarketplaceUsageReportStatus.Pending,
    });

    // Sent after it was written, as the record the marketplace dedupes on.
    const sent: MarketplaceUsageRecord = adapter.reportUsage.mock
      .calls[0]![1] as MarketplaceUsageRecord;
    expect(sent).toEqual({
      reportId: written.id!.toString(),
      quantity: expected,
      periodStart: LAST_REPORTED,
      periodEnd: HOUR_START,
      projectId: PROJECT_ID.toString(),
    });
    expect(
      mocked(MarketplaceUsageReportService.create).mock.invocationCallOrder[0]!,
    ).toBeLessThan(adapter.reportUsage.mock.invocationCallOrder[0]!);

    expect(reportUpdates()).toEqual([
      {
        id: written.id!.toString(),
        data: expect.objectContaining({
          status: MarketplaceUsageReportStatus.Reported,
          externalReportId: "external-1",
          attempts: 1,
        }),
      },
    ]);
  });

  it("never bills the same telemetry twice, and moves the period on with the carried fraction", async () => {
    await MarketplaceUsageReporter.reportForPurchase(purchase);

    expect(TelemetryUsageBillingService.updateOneById).toHaveBeenCalledTimes(2);
    expect(
      mocked(TelemetryUsageBillingService.updateOneById).mock.calls[0]![0],
    ).toMatchObject({ data: { isReportedToBillingProvider: true } });

    const moved: { data: Record<string, unknown> } = mocked(
      MarketplaceSubscriptionService.updateOneById,
    ).mock.calls[0]![0] as { data: Record<string, unknown> };

    expect(moved.data["usageReportedUntil"]).toEqual(HOUR_START);

    const carried: number = Number(
      (moved.data["unreportedUsageInUSD"] as Decimal).value,
    );
    expect(carried).toBeGreaterThanOrEqual(0);
    expect(carried).toBeLessThan(0.01);

    // The Billing page's seat count follows.
    expect(ProjectService.updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: PROJECT_ID,
        data: { paymentProviderSubscriptionSeats: 10 },
      }),
    );
  });

  it("charges nothing for usage in the plan's trial, as card billing does", async () => {
    // Growth's trial runs until noon on 17 October.
    mocked(ProjectService.findOneById).mockResolvedValue(
      Object.assign(new Project(), {
        _id: PROJECT_ID.toString(),
        paymentProviderPlanId: "growth_monthly",
        trialEndsAt: new Date("2026-10-17T12:00:00.000Z"),
        currentActiveMonitorsCount: 3,
      }),
    );
    mocked(TelemetryUsageBillingService.findBy).mockResolvedValue([
      telemetryRow(1.25, "Oct 15, 2026"),
      telemetryRow(0.5, "Oct 16, 2026"),
    ]);
    purchase = purchaseRow({ unreportedUsageInUSD: new Decimal(0) });

    await MarketplaceUsageReporter.reportForPurchase(purchase);

    // Nothing to bill: no report, but the trial's telemetry is spent all the same.
    expect(MarketplaceUsageReportService.create).not.toHaveBeenCalled();
    expect(adapter.reportUsage).not.toHaveBeenCalled();
    expect(TelemetryUsageBillingService.updateOneById).toHaveBeenCalledTimes(2);
  });

  it("bills the telemetry of the days after the trial", async () => {
    mocked(ProjectService.findOneById).mockResolvedValue(
      Object.assign(new Project(), {
        _id: PROJECT_ID.toString(),
        paymentProviderPlanId: "free_monthly",
        trialEndsAt: new Date("2026-10-14T12:00:00.000Z"),
        currentActiveMonitorsCount: 0,
      }),
    );
    mocked(TelemetryUsageBillingService.findBy).mockResolvedValue([
      telemetryRow(2, "Oct 14, 2026"),
      telemetryRow(1.25, "Oct 15, 2026"),
    ]);
    purchase = purchaseRow({ unreportedUsageInUSD: new Decimal(0) });

    await MarketplaceUsageReporter.reportForPurchase(purchase);

    const written: MarketplaceUsageReport = (
      mocked(MarketplaceUsageReportService.create).mock.calls[0]![0] as {
        data: MarketplaceUsageReport;
      }
    ).data;

    // 15 October only: the 14th is the trial's last day.
    expect(written.quantity).toBe(125);
    expect(written.breakdown).toMatchObject({
      telemetryInUSD: 1.25,
      trialTelemetryWaivedInUSD: 2,
    });
  });

  it("knows which staged days fall in the trial", () => {
    const trialEndsAt: Date = new Date("2026-10-17T12:00:00.000Z");

    // As the telemetry staging writes the day (UTC).
    expect(
      MarketplaceUsageReporter.isTrialDay("Oct 16, 2026", trialEndsAt),
    ).toBe(true);
    // The day the trial ends is still a trial day.
    expect(
      MarketplaceUsageReporter.isTrialDay("Oct 17, 2026", trialEndsAt),
    ).toBe(true);
    expect(
      MarketplaceUsageReporter.isTrialDay("Oct 18, 2026", trialEndsAt),
    ).toBe(false);
    expect(
      MarketplaceUsageReporter.isTrialDay("Dec 31, 2025", trialEndsAt),
    ).toBe(true);

    // As the model's comment describes it.
    expect(MarketplaceUsageReporter.isTrialDay("16-10-2026", trialEndsAt)).toBe(
      true,
    );
    expect(MarketplaceUsageReporter.isTrialDay("18-10-2026", trialEndsAt)).toBe(
      false,
    );

    // No trial, no day, or a day that cannot be read: billed.
    expect(MarketplaceUsageReporter.isTrialDay("Oct 16, 2026", null)).toBe(
      false,
    );
    expect(MarketplaceUsageReporter.isTrialDay(undefined, trialEndsAt)).toBe(
      false,
    );
    for (const unreadable of [
      "2026-10-16",
      "not-a-day",
      "Foo 16, 2026",
      "Oct 32, 2026",
      "31-13-2026",
    ]) {
      expect(MarketplaceUsageReporter.isTrialDay(unreadable, trialEndsAt)).toBe(
        false,
      );
    }
  });

  it("reads the staged day as the start of that day in UTC", () => {
    expect(MarketplaceUsageReporter.readStagedDay("Oct 05, 2026")).toBe(
      Date.UTC(2026, 9, 5),
    );
    expect(MarketplaceUsageReporter.readStagedDay("Feb 1, 2027")).toBe(
      Date.UTC(2027, 1, 1),
    );
    expect(MarketplaceUsageReporter.readStagedDay("05-10-2026")).toBe(
      Date.UTC(2026, 9, 5),
    );
  });

  it("reports nothing twice within the same hour", async () => {
    purchase = purchaseRow({ usageReportedUntil: HOUR_START });

    await MarketplaceUsageReporter.reportForPurchase(purchase);

    expect(MarketplaceUsageReportService.create).not.toHaveBeenCalled();
    expect(adapter.reportUsage).not.toHaveBeenCalled();
    expect(MarketplaceSubscriptionService.updateOneById).not.toHaveBeenCalled();
  });

  it("bills up to this moment when the purchase is ending", async () => {
    await MarketplaceUsageReporter.reportFinalUsage(purchase);

    const written: MarketplaceUsageReport = (
      mocked(MarketplaceUsageReportService.create).mock.calls[0]![0] as {
        data: MarketplaceUsageReport;
      }
    ).data;

    expect(written.periodEnd).toEqual(NOW);
    expect(written.breakdown).toMatchObject({ isFinal: true });
  });

  it("writes no report for a period that costs nothing, but still moves the period on", async () => {
    mocked(ProjectService.findOneById).mockResolvedValue(
      Object.assign(new Project(), {
        _id: PROJECT_ID.toString(),
        paymentProviderPlanId: "free_monthly",
        currentActiveMonitorsCount: 0,
      }),
    );
    mocked(TelemetryUsageBillingService.findBy).mockResolvedValue([]);
    purchase = purchaseRow({ unreportedUsageInUSD: new Decimal(0) });

    await MarketplaceUsageReporter.reportForPurchase(purchase);

    expect(MarketplaceUsageReportService.create).not.toHaveBeenCalled();
    expect(adapter.reportUsage).not.toHaveBeenCalled();
    expect(MarketplaceSubscriptionService.updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ usageReportedUntil: HOUR_START }),
      }),
    );
  });

  it("bills the balance top-ups made since the last report in the hour's report, and gives them its id", async () => {
    const sms: MarketplaceCharge = balanceCharge(
      ProjectBalanceType.SmsOrCall,
      20,
    );
    const ai: MarketplaceCharge = balanceCharge(ProjectBalanceType.AI, 50);
    mocked(MarketplaceChargeService.findUnbilled).mockResolvedValue([sms, ai]);

    await MarketplaceUsageReporter.reportForPurchase(purchase);

    expect(MarketplaceChargeService.findUnbilled).toHaveBeenCalledWith(
      purchase.id,
    );

    const written: MarketplaceUsageReport = (
      mocked(MarketplaceUsageReportService.create).mock.calls[0]![0] as {
        data: MarketplaceUsageReport;
      }
    ).data;

    const usageOnly: number = MarketplaceUsageCalculator.calculate({
      periodStart: LAST_REPORTED,
      periodEnd: HOUR_START,
      seats: 10,
      seatPricePerMonthInUSD: 22,
      trialEndsAt: null,
      activeMonitors: 3,
      activeMonitorPricePerMonthInUSD: 1,
      telemetryInUSD: 1.75,
      carriedInUSD: 0.004,
    }).totalInUSD;

    // $70 of top-ups is 7,000 more units than the usage alone.
    expect(written.quantity).toBe(Math.floor((usageOnly + 70) * 100 + 1e-9));
    expect(written.breakdown).toMatchObject({
      chargesInUSD: 70,
      smsOrCallBalanceInUSD: 20,
      aiBalanceInUSD: 50,
      charges: 2,
    });

    // Both charges now belong to the report that bills them.
    const linked: Array<{ id: ObjectID; data: Record<string, unknown> }> =
      mocked(MarketplaceChargeService.updateOneById).mock.calls.map(
        (call: Array<unknown>) => {
          return call[0] as { id: ObjectID; data: Record<string, unknown> };
        },
      );

    expect(
      linked.map((each: { id: ObjectID }) => {
        return each.id.toString();
      }),
    ).toEqual([sms.id!.toString(), ai.id!.toString()]);

    for (const each of linked) {
      expect(String(each.data["marketplaceUsageReportId"])).toBe(
        written.id!.toString(),
      );
    }

    // And it is that report the marketplace is sent.
    expect(
      (adapter.reportUsage.mock.calls[0]![1] as MarketplaceUsageRecord)
        .reportId,
    ).toBe(written.id!.toString());
  });

  it("claims everything a report bills before writing it, so a crash cannot bill it twice", async () => {
    mocked(MarketplaceChargeService.findUnbilled).mockResolvedValue([
      balanceCharge(ProjectBalanceType.AI, 20),
    ]);

    await MarketplaceUsageReporter.reportForPurchase(purchase);

    const writtenAt: number = mocked(MarketplaceUsageReportService.create).mock
      .invocationCallOrder[0]!;

    for (const claim of [
      ...mocked(TelemetryUsageBillingService.updateOneById).mock
        .invocationCallOrder,
      ...mocked(MarketplaceChargeService.updateOneById).mock
        .invocationCallOrder,
      ...mocked(MarketplaceSubscriptionService.updateOneById).mock
        .invocationCallOrder,
    ]) {
      expect(claim).toBeLessThan(writtenAt);
    }
  });

  it("says loudly when a claimed report could not be written", async () => {
    const errorLog: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {});
    mocked(MarketplaceUsageReportService.create).mockRejectedValueOnce(
      new Error("connection lost"),
    );

    await expect(
      MarketplaceUsageReporter.reportForPurchase(purchase),
    ).rejects.toThrow("connection lost");

    // The period was claimed - the next run will not price it again.
    expect(MarketplaceSubscriptionService.updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ usageReportedUntil: HOUR_START }),
      }),
    );
    expect(
      errorLog.mock.calls.some((call: Array<unknown>) => {
        return String(call[0]).includes("was NOT billed");
      }),
    ).toBe(true);
    expect(adapter.reportUsage).not.toHaveBeenCalled();
  });

  it("bills top-ups during the plan's trial: they are bought, not used", async () => {
    mocked(ProjectService.findOneById).mockResolvedValue(
      Object.assign(new Project(), {
        _id: PROJECT_ID.toString(),
        paymentProviderPlanId: "growth_monthly",
        trialEndsAt: new Date("2026-12-01T00:00:00.000Z"),
        currentActiveMonitorsCount: 3,
      }),
    );
    mocked(TelemetryUsageBillingService.findBy).mockResolvedValue([]);
    mocked(MarketplaceChargeService.findUnbilled).mockResolvedValue([
      balanceCharge(ProjectBalanceType.SmsOrCall, 25),
    ]);
    purchase = purchaseRow({ unreportedUsageInUSD: new Decimal(0) });

    await MarketplaceUsageReporter.reportForPurchase(purchase);

    const written: MarketplaceUsageReport = (
      mocked(MarketplaceUsageReportService.create).mock.calls[0]![0] as {
        data: MarketplaceUsageReport;
      }
    ).data;

    expect(written.quantity).toBe(2500);
    expect(written.breakdown).toMatchObject({
      seatsInUSD: 0,
      activeMonitorsInUSD: 0,
      smsOrCallBalanceInUSD: 25,
    });
  });

  it("bills the top-ups of a purchase whose usage is not metered, and nothing else", async () => {
    mocked(MarketplaceChargeService.findUnbilled).mockResolvedValue([
      balanceCharge(ProjectBalanceType.AI, 20),
    ]);
    purchase = purchaseRow({
      isUsageMetered: false,
      unreportedUsageInUSD: new Decimal(0),
    });

    await MarketplaceUsageReporter.reportForPurchase(purchase);

    const written: MarketplaceUsageReport = (
      mocked(MarketplaceUsageReportService.create).mock.calls[0]![0] as {
        data: MarketplaceUsageReport;
      }
    ).data;

    expect(written.quantity).toBe(2000);
    expect(written.breakdown).toMatchObject({
      seatsInUSD: 0,
      activeMonitorsInUSD: 0,
      telemetryInUSD: 0,
      aiBalanceInUSD: 20,
      isUsageMetered: false,
    });

    // Its usage is the deal's: not counted, not claimed.
    expect(
      TeamMemberService.getUniqueTeamMemberCountInProject,
    ).not.toHaveBeenCalled();
    expect(TelemetryUsageBillingService.findBy).not.toHaveBeenCalled();
    expect(TelemetryUsageBillingService.updateOneById).not.toHaveBeenCalled();
    expect(ProjectService.updateOneById).not.toHaveBeenCalled();
  });

  it("bills nothing new for a purchase that is not linked, not active, or not metered", async () => {
    for (const row of [
      purchaseRow({ projectId: undefined }),
      purchaseRow({ status: MarketplaceSubscriptionStatus.Suspended }),
      purchaseRow({ status: MarketplaceSubscriptionStatus.Cancelled }),
      purchaseRow({ isUsageMetered: false }),
    ]) {
      purchase = row;
      await MarketplaceUsageReporter.reportForPurchase(row);
    }

    expect(MarketplaceUsageReportService.create).not.toHaveBeenCalled();
    expect(adapter.reportUsage).not.toHaveBeenCalled();
  });

  it("sends a report that is still waiting before writing a new one, even for a purchase that has ended", async () => {
    const waiting: MarketplaceUsageReport = pendingReport();
    mocked(MarketplaceUsageReportService.findBy).mockResolvedValue([waiting]);
    purchase = purchaseRow({ status: MarketplaceSubscriptionStatus.Cancelled });

    await MarketplaceUsageReporter.reportForPurchase(purchase);

    expect(adapter.reportUsage).toHaveBeenCalledTimes(1);
    expect(
      (adapter.reportUsage.mock.calls[0]![1] as MarketplaceUsageRecord)
        .reportId,
    ).toBe(waiting.id!.toString());
    expect(reportUpdates()[0]).toEqual({
      id: waiting.id!.toString(),
      data: expect.objectContaining({
        status: MarketplaceUsageReportStatus.Reported,
        attempts: 2,
      }),
    });
  });

  it("keeps a report the marketplace could not take now, to send again", async () => {
    adapter.reportUsage.mockResolvedValue({
      outcome: "retry",
      error: "Service Control is unavailable",
    });

    await MarketplaceUsageReporter.reportForPurchase(purchase);

    expect(reportUpdates()[0]!.data).toEqual({
      attempts: 1,
      lastError: "Service Control is unavailable",
    });
  });

  it("marks a report the marketplace refused as not billed, and reads the purchase again when it says it is inactive", async () => {
    adapter.reportUsage.mockResolvedValue({
      outcome: "rejected",
      error: "BILLING_DISABLED",
      isPurchaseInactive: true,
    });
    adapter.fetchStatus.mockResolvedValue({
      status: MarketplaceSubscriptionStatus.Suspended,
      externalState: "ENTITLEMENT_SUSPENDED",
    });

    await MarketplaceUsageReporter.reportForPurchase(purchase);

    expect(reportUpdates()[0]!.data).toMatchObject({
      status: MarketplaceUsageReportStatus.Failed,
      lastError: "BILLING_DISABLED",
    });
    expect(MarketplacePurchases.updatePurchase).toHaveBeenCalledWith(
      purchase,
      expect.objectContaining({
        status: MarketplaceSubscriptionStatus.Suspended,
      }),
    );
  });

  it("gives up on a report past the marketplaces' one-day deadline without sending it", async () => {
    mocked(MarketplaceUsageReportService.findBy).mockResolvedValue([
      pendingReport({
        periodStart: new Date("2026-10-15T09:00:00.000Z"),
        periodEnd: new Date("2026-10-15T10:00:00.000Z"),
      }),
    ]);
    purchase = purchaseRow({ usageReportedUntil: HOUR_START });

    await MarketplaceUsageReporter.reportForPurchase(purchase);

    expect(adapter.reportUsage).not.toHaveBeenCalled();
    expect(reportUpdates()[0]!.data).toMatchObject({
      status: MarketplaceUsageReportStatus.Failed,
    });
  });

  it("treats a thrown error from the marketplace as worth retrying", async () => {
    adapter.reportUsage.mockRejectedValue(new Error("socket hang up"));

    await MarketplaceUsageReporter.reportForPurchase(purchase);

    expect(reportUpdates()[0]!.data).toEqual({
      attempts: 1,
      lastError: "socket hang up",
    });
  });

  it("leaves a purchase alone while another report for it holds the lock", async () => {
    mocked(Semaphore.lock).mockRejectedValue(new Error("lock is held"));

    await MarketplaceUsageReporter.reportForPurchase(purchase);

    expect(
      MarketplaceSubscriptionService.findPurchaseById,
    ).not.toHaveBeenCalled();
    expect(adapter.reportUsage).not.toHaveBeenCalled();
  });

  it("does nothing for a marketplace this server is not set up for", async () => {
    adapter.isConfigured.mockReturnValue(false);

    await MarketplaceUsageReporter.reportForPurchase(purchase);

    expect(Semaphore.lock).not.toHaveBeenCalled();
  });

  it("never lets a failed final report stop the purchase from ending", async () => {
    mocked(ProjectService.findOneById).mockRejectedValue(new Error("db down"));

    await expect(
      MarketplaceUsageReporter.reportFinalUsage(purchase),
    ).resolves.toBeUndefined();
  });

  it("reports every billing purchase once an hour, and each purchase with a report still waiting", async () => {
    const billing: MarketplaceSubscription = purchaseRow();
    const endedWithWaitingReport: MarketplaceSubscription = purchaseRow({
      status: MarketplaceSubscriptionStatus.Cancelled,
    });

    mocked(MarketplaceSubscriptionService.findBy).mockResolvedValue([billing]);
    mocked(MarketplaceUsageReportService.findBy).mockImplementation(
      async (data: {
        query: Record<string, unknown>;
      }): Promise<Array<MarketplaceUsageReport>> => {
        // The hourly job's query for every waiting report.
        if (!data.query["marketplaceSubscriptionId"]) {
          return [
            pendingReport({ marketplaceSubscriptionId: billing.id! }),
            pendingReport({
              marketplaceSubscriptionId: endedWithWaitingReport.id!,
            }),
          ];
        }

        return [];
      },
    );
    mocked(MarketplaceSubscriptionService.findPurchaseById).mockImplementation(
      async (id: ObjectID): Promise<MarketplaceSubscription> => {
        return id.toString() === billing.id!.toString()
          ? billing
          : endedWithWaitingReport;
      },
    );

    const reportForPurchase: jest.SpyInstance = jest
      .spyOn(MarketplaceUsageReporter, "reportForPurchase")
      .mockRejectedValueOnce(new Error("one purchase failed"))
      .mockResolvedValue(undefined);

    await MarketplaceUsageReporter.reportAll();

    expect(
      reportForPurchase.mock.calls.map((call: Array<unknown>) => {
        return (call[0] as MarketplaceSubscription).id!.toString();
      }),
    ).toEqual([billing.id!.toString(), endedWithWaitingReport.id!.toString()]);
  });

  it("prices a seat at the plan's monthly per-user price, and plans without a list price at nothing", () => {
    expect(
      MarketplaceUsageReporter.getSeatPricePerMonth("growth_monthly"),
    ).toBe(22);
    // A project on the yearly plan ID is still billed month to month on a marketplace.
    expect(MarketplaceUsageReporter.getSeatPricePerMonth("growth_yearly")).toBe(
      22,
    );
    expect(MarketplaceUsageReporter.getSeatPricePerMonth("free_monthly")).toBe(
      0,
    );
    expect(
      MarketplaceUsageReporter.getSeatPricePerMonth("enterprise_monthly"),
    ).toBe(0);
    expect(MarketplaceUsageReporter.getSeatPricePerMonth("unknown")).toBe(0);
    expect(MarketplaceUsageReporter.getSeatPricePerMonth(undefined)).toBe(0);
  });

  it("rounds a time down to the start of its hour", () => {
    expect(
      MarketplaceUsageReporter.getStartOfHour(
        new Date("2026-10-16T10:59:59.999Z"),
      ),
    ).toEqual(HOUR_START);
  });

  /*
   * AWS and Microsoft bill the first record of a purchase in an hour. A
   * report that lands in an hour where they already have a different one is
   * lost: it must end Failed and logged as not billed - never counted as
   * sent - while the same report sent again still counts as sent. Run with
   * the real adapters, over fake API clients.
   */
  describe("a marketplace that already billed another record in the report's hour", () => {
    let errorLog: jest.SpyInstance;

    beforeEach(() => {
      errorLog = jest.spyOn(logger, "error").mockImplementation((): void => {});
    });

    afterEach(() => {
      MarketplaceAdapters.set(CloudMarketplace.AWS, null);
      MarketplaceAdapters.set(CloudMarketplace.Azure, null);
    });

    const loggedAsNotBilled: () => boolean = (): boolean => {
      return errorLog.mock.calls.some((call: Array<unknown>) => {
        return String(call[0]).includes("was NOT billed");
      });
    };

    const useAws: (status: string) => jest.Mock = (
      status: string,
    ): jest.Mock => {
      const batchMeterUsage: jest.Mock = jest
        .fn()
        .mockResolvedValue([{ status: status, meteringRecordId: "mr-1" }]);
      MarketplaceAdapters.set(
        CloudMarketplace.AWS,
        new AwsMarketplaceAdapter({
          describeAgreement: jest.fn(),
          batchMeterUsage: batchMeterUsage,
        } as unknown as AwsMarketplaceAPI),
      );
      purchase = purchaseRow({
        marketplace: CloudMarketplace.AWS,
        externalSubscriptionId: "arn:aws:license-manager::1:license:l-1",
        externalCustomerId: "123456789012",
      });
      return batchMeterUsage;
    };

    // Microsoft answers Duplicate, with the event it kept: `keptQuantity` units, or the report's own.
    const useAzure: (keptQuantity?: number | undefined) => jest.Mock = (
      keptQuantity?: number | undefined,
    ): jest.Mock => {
      const reportUsageEvents: jest.Mock = jest
        .fn()
        .mockImplementation(
          async (
            events: Array<AzureUsageEvent>,
          ): Promise<Array<AzureUsageEventResult>> => {
            return [
              {
                status: "Duplicate",
                usageEventId: null,
                errorCode: "Conflict",
                acceptedEvent: {
                  usageEventId: "ue-kept",
                  quantity: keptQuantity ?? events[0]!.quantity,
                },
              },
            ];
          },
        );
      MarketplaceAdapters.set(
        CloudMarketplace.Azure,
        new AzureMarketplaceAdapter({
          reportUsageEvents: reportUsageEvents,
        } as unknown as AzureMarketplaceAPI),
      );
      purchase = purchaseRow({
        marketplace: CloudMarketplace.Azure,
        externalSubscriptionId: "6f1a2b3c-0000-4000-8000-000000000001",
        externalPlanId: "pay-as-you-go",
      });
      return reportUsageEvents;
    };

    it("marks a report AWS answers DuplicateRecord Failed, and logs it as not billed", async () => {
      const batchMeterUsage: jest.Mock = useAws("DuplicateRecord");

      await MarketplaceUsageReporter.reportForPurchase(purchase);

      expect(batchMeterUsage).toHaveBeenCalledTimes(1);
      expect(reportUpdates()).toEqual([
        {
          id: expect.any(String),
          data: expect.objectContaining({
            status: MarketplaceUsageReportStatus.Failed,
            lastError:
              "AWS already billed another record for this license in this hour (DuplicateRecord).",
            attempts: 1,
          }),
        },
      ]);
      expect(loggedAsNotBilled()).toBe(true);
      // The buyer is still subscribed: the purchase is not read back.
      expect(MarketplacePurchases.updatePurchase).not.toHaveBeenCalled();
    });

    it("never sends a report AWS refused as a duplicate again", async () => {
      const batchMeterUsage: jest.Mock = useAws("DuplicateRecord");

      await MarketplaceUsageReporter.reportForPurchase(purchase);

      // The next run looks for Pending reports only; this one is Failed.
      expect(
        mocked(MarketplaceUsageReportService.findBy).mock.calls.every(
          (call: Array<unknown>) => {
            return (
              (call[0] as { query: Record<string, unknown> }).query[
                "status"
              ] === MarketplaceUsageReportStatus.Pending
            );
          },
        ),
      ).toBe(true);
      expect(batchMeterUsage).toHaveBeenCalledTimes(1);
    });

    it("counts a report AWS answers Success as sent", async () => {
      useAws("Success");

      await MarketplaceUsageReporter.reportForPurchase(purchase);

      expect(reportUpdates()[0]!.data).toMatchObject({
        status: MarketplaceUsageReportStatus.Reported,
        externalReportId: "mr-1",
      });
      expect(loggedAsNotBilled()).toBe(false);
    });

    it("marks a report Failed when Microsoft kept another event for its hour", async () => {
      useAzure(640);

      await MarketplaceUsageReporter.reportForPurchase(purchase);

      expect(reportUpdates()[0]!.data).toMatchObject({
        status: MarketplaceUsageReportStatus.Failed,
        lastError:
          "Microsoft already has another usage event for this hour (640 units, event ue-kept).",
      });
      expect(loggedAsNotBilled()).toBe(true);
    });

    it("counts a report sent again as sent when the event Microsoft kept is this one", async () => {
      useAzure();

      await MarketplaceUsageReporter.reportForPurchase(purchase);

      expect(reportUpdates()[0]!.data).toMatchObject({
        status: MarketplaceUsageReportStatus.Reported,
        externalReportId: "ue-kept",
      });
      expect(loggedAsNotBilled()).toBe(false);
    });
  });
});
