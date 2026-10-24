import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import MarketplaceUsageReport from "Common/Models/DatabaseModels/MarketplaceUsageReport";
import VercelMarketplaceInstallation from "Common/Models/DatabaseModels/VercelMarketplaceInstallation";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import VercelInstallationStatus from "Common/Types/Marketplace/VercelInstallationStatus";
import ObjectID from "Common/Types/ObjectID";
import Semaphore from "Common/Server/Infrastructure/Semaphore";
import MarketplaceUsageReportService from "Common/Server/Services/MarketplaceUsageReportService";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import VercelMarketplaceInstallationService from "Common/Server/Services/VercelMarketplaceInstallationService";
import MarketplaceApiError from "../../../../Server/CloudMarketplace/MarketplaceApiError";
import VercelMarketplaceAPI, {
  VercelBillingData,
  VercelBillingItem,
  VercelInvoice,
  VercelUsageItem,
} from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceAPI";
import VercelMarketplaceBilling, {
  ResourceUsage,
} from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceBilling";
import VercelMarketplaceResources from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceResources";
import logger from "Common/Server/Utils/Logger";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * A Vercel team is billed from the hourly usage reports of its resources:
 * running totals every hour, an invoice for each month once it has ended,
 * and - when it uninstalls OneUptime - a final invoice after its projects
 * are deleted. The invoice lines add up to exactly the units the reports
 * billed.
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
        SUBSCRIPTION_PLAN_SCALE: "Scale,scale_monthly,scale_yearly,44,480,3,0",
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

jest.mock("Common/Types/Sleep", () => {
  return {
    __esModule: true,
    default: { sleep: jest.fn().mockResolvedValue(undefined) },
  };
});

jest.mock("Common/Server/Services/VercelMarketplaceInstallationService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      findByInstallationId: jest.fn(),
      updateOneById: jest.fn(),
      getInstallationSelect: jest.fn().mockReturnValue({ _id: true }),
    },
  };
});

jest.mock("Common/Server/Services/MarketplaceUsageReportService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn() },
  };
});

jest.mock("Common/Server/Services/TelemetryIngestionKeyService", () => {
  return {
    __esModule: true,
    default: { updateOneById: jest.fn() },
  };
});

jest.mock(
  "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceResources",
  () => {
    return {
      __esModule: true,
      default: {
        listPurchases: jest.fn(),
        deprovision: jest.fn(),
        deleteProjectsOfEndedResources: jest.fn(),
      },
    };
  },
);

const mocked: (fn: unknown) => jest.Mock = (fn: unknown): jest.Mock => {
  return fn as jest.Mock;
};

const INSTALLATION_ID: string = "icfg_acme";

interface FakeApi {
  submitBillingData: jest.Mock;
  submitInvoice: jest.Mock;
  finalizeBilling: jest.Mock;
}

let api: FakeApi;

const installation: (
  overrides?: Partial<Record<keyof VercelMarketplaceInstallation, unknown>>,
) => VercelMarketplaceInstallation = (
  overrides?: Partial<Record<keyof VercelMarketplaceInstallation, unknown>>,
): VercelMarketplaceInstallation => {
  return Object.assign(new VercelMarketplaceInstallation(), {
    _id: "6720a1b2-0000-4000-8000-000000000001",
    installationId: INSTALLATION_ID,
    accessToken: "token",
    status: VercelInstallationStatus.Active,
    createdAt: new Date("2026-09-10T08:00:00.000Z"),
    invoicedUntil: new Date("2026-10-01T00:00:00.000Z"),
    accountName: "Acme",
    ...overrides,
  });
};

const resource: (
  resourceId: string,
  overrides?: Partial<Record<keyof MarketplaceSubscription, unknown>>,
) => MarketplaceSubscription = (
  resourceId: string,
  overrides?: Partial<Record<keyof MarketplaceSubscription, unknown>>,
): MarketplaceSubscription => {
  return Object.assign(new MarketplaceSubscription(), {
    _id: ObjectID.generate().toString(),
    marketplace: CloudMarketplace.Vercel,
    externalSubscriptionId: resourceId,
    externalCustomerId: INSTALLATION_ID,
    externalPlanId: "growth",
    status: MarketplaceSubscriptionStatus.Active,
    projectId: ObjectID.generate(),
    details: {
      name: `Resource ${resourceId}`,
      productId: "oneuptime",
      metadata: {},
    },
    ...overrides,
  });
};

const report: (data: {
  start: string;
  end: string;
  quantity: number;
  breakdown: JSONObject;
}) => MarketplaceUsageReport = (data: {
  start: string;
  end: string;
  quantity: number;
  breakdown: JSONObject;
}): MarketplaceUsageReport => {
  return Object.assign(new MarketplaceUsageReport(), {
    _id: ObjectID.generate().toString(),
    periodStart: new Date(data.start),
    periodEnd: new Date(data.end),
    quantity: data.quantity,
    breakdown: data.breakdown,
  });
};

const setNow: (iso: string) => void = (iso: string): void => {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
    return new Date(iso);
  });
};

beforeEach(() => {
  jest.clearAllMocks();

  api = {
    submitBillingData: jest.fn().mockResolvedValue(undefined),
    submitInvoice: jest
      .fn()
      .mockResolvedValue({ invoiceId: "inv_1", isDuplicate: false }),
    finalizeBilling: jest.fn().mockResolvedValue(undefined),
  };
  VercelMarketplaceBilling.setApi(api as unknown as VercelMarketplaceAPI);

  mocked(Semaphore.lock).mockResolvedValue({ key: "lock" });
  mocked(Semaphore.release).mockResolvedValue(undefined);
  mocked(VercelMarketplaceInstallationService.updateOneById).mockResolvedValue(
    undefined,
  );
  mocked(VercelMarketplaceResources.deprovision).mockResolvedValue(undefined);
  mocked(
    VercelMarketplaceResources.deleteProjectsOfEndedResources,
  ).mockResolvedValue(undefined);
  mocked(TelemetryIngestionKeyService.updateOneById).mockResolvedValue(
    undefined,
  );

  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(logger, "info").mockImplementation((): void => {});
});

afterEach(() => {
  VercelMarketplaceBilling.setApi(null);
  jest.restoreAllMocks();
});

describe("VercelMarketplaceBilling.shareUnits", () => {
  it("gives each kind of charge its whole cents, and the cents carried between hours to the largest fractions", () => {
    const reports: Array<MarketplaceUsageReport> = [
      // $10.004 of seats, $5.003 of monitors, $1.001 of telemetry: 1600 units, $0.008 carried.
      report({
        start: "2026-10-01T00:00:00Z",
        end: "2026-10-01T01:00:00Z",
        quantity: 1600,
        breakdown: {
          seatsInUSD: 10.004,
          activeMonitorsInUSD: 5.003,
          telemetryInUSD: 1.001,
        },
      }),
      // The same again, with the $0.008 carried in: 1601 units.
      report({
        start: "2026-10-01T01:00:00Z",
        end: "2026-10-01T02:00:00Z",
        quantity: 1601,
        breakdown: {
          seatsInUSD: 10.004,
          activeMonitorsInUSD: 5.003,
          telemetryInUSD: 1.001,
          carriedInUSD: 0.008,
        },
      }),
    ];

    const units: Record<string, number> =
      VercelMarketplaceBilling.shareUnits(reports);

    // $20.008 seats, $10.006 monitors, $2.002 telemetry = 3201 whole cents billed.
    expect(units).toEqual({
      users: 2001,
      monitors: 1000,
      telemetry: 200,
      topUps: 0,
    });
    expect(units["users"]! + units["monitors"]! + units["telemetry"]!).toBe(
      3201,
    );
  });

  it("always adds up to the units the reports billed", () => {
    const cases: Array<Array<MarketplaceUsageReport>> = [
      // A fraction carried in from the month before: one unit more than the costs' cents.
      [
        report({
          start: "2026-10-01T00:00:00Z",
          end: "2026-10-01T01:00:00Z",
          quantity: 3,
          breakdown: { activeMonitorsInUSD: 0.02, carriedInUSD: 0.0099 },
        }),
      ],
      // A fraction carried out to the next month: one unit less.
      [
        report({
          start: "2026-10-31T23:00:00Z",
          end: "2026-11-01T00:00:00Z",
          quantity: 1,
          breakdown: { seatsInUSD: 0.0199 },
        }),
      ],
      // Top-ups, which are whole cents already.
      [
        report({
          start: "2026-10-05T00:00:00Z",
          end: "2026-10-05T01:00:00Z",
          quantity: 2003,
          breakdown: { chargesInUSD: 20, activeMonitorsInUSD: 0.03 },
        }),
      ],
    ];

    for (const reports of cases) {
      const units: Record<string, number> =
        VercelMarketplaceBilling.shareUnits(reports);
      const billed: number = reports.reduce(
        (sum: number, each: MarketplaceUsageReport): number => {
          return sum + each.quantity!;
        },
        0,
      );

      expect(
        Object.values(units).reduce((sum: number, value: number): number => {
          return sum + value;
        }, 0),
      ).toBe(billed);

      for (const value of Object.values(units)) {
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("VercelMarketplaceBilling.buildItems", () => {
  it("bills each resource a line per kind of charge and plan, in usage units of $0.01", () => {
    const purchase: MarketplaceSubscription = resource("res_1");

    const usage: Array<ResourceUsage> = VercelMarketplaceBilling.groupByPlan(
      purchase,
      [
        report({
          start: "2026-10-01T00:00:00Z",
          end: "2026-10-10T00:00:00Z",
          quantity: 1500,
          breakdown: {
            planId: "growth_monthly",
            seatsInUSD: 10,
            activeMonitorsInUSD: 5,
          },
        }),
        // Moved to Scale on the 10th.
        report({
          start: "2026-10-10T00:00:00Z",
          end: "2026-11-01T00:00:00Z",
          quantity: 4250,
          breakdown: {
            planId: "scale_monthly",
            seatsInUSD: 40,
            telemetryInUSD: 2.5,
          },
        }),
      ],
    );

    expect(
      usage.map((entry: ResourceUsage) => {
        return entry.vercelPlanId;
      }),
    ).toEqual(["growth", "scale"]);

    const items: Array<VercelBillingItem> = VercelMarketplaceBilling.buildItems(
      usage,
      {
        periodStart: new Date("2026-10-01T00:00:00Z"),
        periodEnd: new Date("2026-11-01T00:00:00Z"),
      },
    );

    expect(items).toEqual([
      {
        billingPlanId: "growth",
        resourceId: "res_1",
        end: "2026-10-10T00:00:00.000Z",
        name: "Users (Growth plan)",
        details: "Resource res_1: $22 per user per month, by the hour",
        price: "0.01",
        quantity: 1000,
        units: "usage units ($0.01)",
        total: "10.00",
      },
      {
        billingPlanId: "growth",
        resourceId: "res_1",
        end: "2026-10-10T00:00:00.000Z",
        name: "Active monitors",
        details: "Resource res_1: $1 per active monitor per month, by the hour",
        price: "0.01",
        quantity: 500,
        units: "usage units ($0.01)",
        total: "5.00",
      },
      {
        billingPlanId: "scale",
        resourceId: "res_1",
        start: "2026-10-10T00:00:00.000Z",
        name: "Users (Scale plan)",
        details: "Resource res_1: $44 per user per month, by the hour",
        price: "0.01",
        quantity: 4000,
        units: "usage units ($0.01)",
        total: "40.00",
      },
      {
        billingPlanId: "scale",
        resourceId: "res_1",
        start: "2026-10-10T00:00:00.000Z",
        name: "Telemetry",
        details:
          "Resource res_1: logs, traces, metrics and session replay, by the GB",
        price: "0.01",
        quantity: 250,
        units: "usage units ($0.01)",
        total: "2.50",
      },
    ]);

    // Each line's price times its quantity is its total, to the cent.
    for (const item of items) {
      expect(Math.round(Number(item.price) * item.quantity * 100)).toBe(
        Math.round(Number(item.total) * 100),
      );
    }
  });

  it("falls back to the resource's plan, then the cheapest, for a report that names none", () => {
    const usage: Array<ResourceUsage> = VercelMarketplaceBilling.groupByPlan(
      resource("res_1", { externalPlanId: "scale" }),
      [
        report({
          start: "2026-10-01T00:00:00Z",
          end: "2026-10-01T01:00:00Z",
          quantity: 5,
          breakdown: { activeMonitorsInUSD: 0.05 },
        }),
        // Nothing billed: left out.
        report({
          start: "2026-10-01T01:00:00Z",
          end: "2026-10-01T02:00:00Z",
          quantity: 0,
          breakdown: {},
        }),
      ],
    );

    expect(usage).toHaveLength(1);
    expect(usage[0]!.vercelPlanId).toBe("scale");
    expect(usage[0]!.reports).toHaveLength(1);

    expect(
      VercelMarketplaceBilling.groupByPlan(
        resource("res_2", { externalPlanId: undefined }),
        [
          report({
            start: "2026-10-01T00:00:00Z",
            end: "2026-10-01T01:00:00Z",
            quantity: 5,
            breakdown: { activeMonitorsInUSD: 0.05 },
          }),
        ],
      )[0]!.vercelPlanId,
    ).toBe("free");
  });
});

describe("VercelMarketplaceBilling.buildUsage", () => {
  it("shows each resource's people and active monitors now, and its telemetry today and this month", () => {
    const usage: Array<ResourceUsage> = VercelMarketplaceBilling.groupByPlan(
      resource("res_1"),
      [
        report({
          start: "2026-10-17T10:00:00Z",
          end: "2026-10-17T11:00:00Z",
          quantity: 100,
          breakdown: { seats: 2, activeMonitors: 3, telemetryInUSD: 0.4 },
        }),
        report({
          start: "2026-10-18T09:00:00Z",
          end: "2026-10-18T10:00:00Z",
          quantity: 100,
          breakdown: { seats: 4, activeMonitors: 5, telemetryInUSD: 0.25 },
        }),
      ],
    );

    const items: Array<VercelUsageItem> = VercelMarketplaceBilling.buildUsage(
      usage,
      new Date("2026-10-18T10:15:00Z"),
    );

    expect(items).toEqual([
      {
        resourceId: "res_1",
        name: "Users",
        type: "total",
        units: "users",
        dayValue: 4,
        periodValue: 4,
      },
      {
        resourceId: "res_1",
        name: "Active monitors",
        type: "total",
        units: "monitors",
        dayValue: 5,
        periodValue: 5,
      },
      {
        resourceId: "res_1",
        name: "Telemetry",
        type: "interval",
        units: "USD",
        dayValue: 0.25,
        periodValue: 0.65,
      },
    ]);
  });
});

describe("VercelMarketplaceBilling periods", () => {
  it("bills by calendar month, and never before the installation existed", () => {
    expect(
      VercelMarketplaceBilling.getStartOfNextMonth(
        new Date("2026-12-15T10:00:00Z"),
      ).toISOString(),
    ).toBe("2027-01-01T00:00:00.000Z");
    expect(
      VercelMarketplaceBilling.getMonthKey(new Date("2026-02-01T00:00:00Z")),
    ).toBe("2026-02");
    expect(VercelMarketplaceBilling.unitsToUSD(1234)).toBe("12.34");
    expect(VercelMarketplaceBilling.unitsToUSD(5)).toBe("0.05");

    expect(
      VercelMarketplaceBilling.getUninvoicedStart(
        installation({ invoicedUntil: undefined }),
      ).toISOString(),
    ).toBe("2026-09-10T08:00:00.000Z");
    expect(
      VercelMarketplaceBilling.getUninvoicedStart(installation()).toISOString(),
    ).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("VercelMarketplaceBilling.billInstallation", () => {
  beforeEach(() => {
    mocked(
      VercelMarketplaceInstallationService.findByInstallationId,
    ).mockResolvedValue(installation());
    mocked(VercelMarketplaceResources.listPurchases).mockResolvedValue([
      resource("res_1"),
    ]);
    mocked(MarketplaceUsageReportService.findBy).mockResolvedValue([
      report({
        start: "2026-10-31T22:00:00Z",
        end: "2026-10-31T23:00:00Z",
        quantity: 300,
        breakdown: { planId: "growth_monthly", seatsInUSD: 3, seats: 1 },
      }),
      // The month's last hour, which ends on the 1st at midnight: October's.
      report({
        start: "2026-10-31T23:00:00Z",
        end: "2026-11-01T00:00:00Z",
        quantity: 300,
        breakdown: { planId: "growth_monthly", seatsInUSD: 3, seats: 1 },
      }),
      // November's first hour.
      report({
        start: "2026-11-01T00:00:00Z",
        end: "2026-11-01T01:00:00Z",
        quantity: 200,
        breakdown: { planId: "growth_monthly", seatsInUSD: 2, seats: 1 },
      }),
    ]);
  });

  it("invoices a month that has ended, then sends this month's running totals", async () => {
    setNow("2026-11-01T03:15:00.000Z");

    await VercelMarketplaceBilling.billInstallation(installation());

    expect(api.submitInvoice).toHaveBeenCalledTimes(1);

    const invoice: VercelInvoice = api.submitInvoice.mock
      .calls[0]![1] as VercelInvoice;

    expect(invoice).toMatchObject({
      externalId: "oneuptime-icfg_acme-2026-10",
      invoiceDate: "2026-10-31T23:59:59.000Z",
      period: {
        start: "2026-10-01T00:00:00.000Z",
        end: "2026-11-01T00:00:00.000Z",
      },
    });
    expect(invoice).not.toHaveProperty("final");
    // October's two hours, not November's.
    expect(invoice.items).toEqual([
      expect.objectContaining({
        billingPlanId: "growth",
        resourceId: "res_1",
        quantity: 600,
        total: "6.00",
      }),
    ]);

    expect(
      VercelMarketplaceInstallationService.updateOneById,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { invoicedUntil: new Date("2026-11-01T00:00:00.000Z") },
      }),
    );

    expect(api.submitBillingData).toHaveBeenCalledTimes(1);
    const totals: VercelBillingData = api.submitBillingData.mock
      .calls[0]![1] as VercelBillingData;

    expect(totals.period).toEqual({
      start: "2026-11-01T00:00:00.000Z",
      end: "2026-12-01T00:00:00.000Z",
    });
    expect(totals.billing).toEqual([
      expect.objectContaining({ quantity: 200, total: "2.00" }),
    ]);
    expect(totals.eod).toBe("2026-11-01T03:15:00.000Z");
  });

  it("waits for a month's last hour to be reported before invoicing it", async () => {
    setNow("2026-11-01T01:15:00.000Z");

    await VercelMarketplaceBilling.billInstallation(installation());

    expect(api.submitInvoice).not.toHaveBeenCalled();

    // The running totals are November's alone, while October waits for its invoice.
    const totals: VercelBillingData = api.submitBillingData.mock
      .calls[0]![1] as VercelBillingData;
    expect(totals.period.start).toBe("2026-11-01T00:00:00.000Z");
  });

  it("starts an installation's first invoice when it was installed", async () => {
    setNow("2026-11-01T03:15:00.000Z");

    mocked(
      VercelMarketplaceInstallationService.findByInstallationId,
    ).mockResolvedValue(
      installation({
        invoicedUntil: undefined,
        createdAt: new Date("2026-10-15T12:00:00.000Z"),
      }),
    );

    await VercelMarketplaceBilling.billInstallation(installation());

    const invoice: VercelInvoice = api.submitInvoice.mock
      .calls[0]![1] as VercelInvoice;
    expect(invoice.period).toEqual({
      start: "2026-10-15T12:00:00.000Z",
      end: "2026-11-01T00:00:00.000Z",
    });
    expect(invoice.externalId).toBe("oneuptime-icfg_acme-2026-10");
  });

  it("moves on from a month with nothing to bill without sending an empty invoice", async () => {
    setNow("2026-11-01T03:15:00.000Z");
    mocked(MarketplaceUsageReportService.findBy).mockResolvedValue([]);

    await VercelMarketplaceBilling.billInstallation(installation());

    expect(api.submitInvoice).not.toHaveBeenCalled();
    expect(
      VercelMarketplaceInstallationService.updateOneById,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { invoicedUntil: new Date("2026-11-01T00:00:00.000Z") },
      }),
    );
  });

  it("does not move on when Vercel refuses the invoice, and records why", async () => {
    setNow("2026-11-01T03:15:00.000Z");
    api.submitInvoice.mockRejectedValue(
      new MarketplaceApiError({
        message: "Vercel answered 503",
        status: 503,
        isRetryable: true,
      }),
    );

    await expect(
      VercelMarketplaceBilling.billInstallation(installation()),
    ).rejects.toThrow("503");

    expect(
      VercelMarketplaceInstallationService.updateOneById,
    ).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: { invoicedUntil: expect.anything() },
      }),
    );
    expect(
      VercelMarketplaceInstallationService.updateOneById,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { lastBillingError: "Vercel answered 503" },
      }),
    );
  });

  it("sends no running totals for a team that has added no resource yet", async () => {
    setNow("2026-11-01T03:15:00.000Z");
    mocked(VercelMarketplaceResources.listPurchases).mockResolvedValue([]);
    mocked(MarketplaceUsageReportService.findBy).mockResolvedValue([]);

    await VercelMarketplaceBilling.billInstallation(installation());

    expect(api.submitBillingData).not.toHaveBeenCalled();
    expect(api.submitInvoice).not.toHaveBeenCalled();
  });

  it("bills nobody while another run holds the installation", async () => {
    setNow("2026-11-01T03:15:00.000Z");
    mocked(Semaphore.lock).mockRejectedValue(new Error("locked"));

    await VercelMarketplaceBilling.billInstallation(installation());

    expect(api.submitInvoice).not.toHaveBeenCalled();
    expect(api.submitBillingData).not.toHaveBeenCalled();
  });
});

describe("VercelMarketplaceBilling.requestDeletion", () => {
  it("ends an installation that never had a resource at once", async () => {
    mocked(VercelMarketplaceResources.listPurchases).mockResolvedValue([]);

    expect(await VercelMarketplaceBilling.requestDeletion(installation())).toBe(
      true,
    );

    expect(
      VercelMarketplaceInstallationService.updateOneById,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: VercelInstallationStatus.Deleted,
          accessToken: null,
          lastBillingError: null,
        },
      }),
    );
  });

  it("stops the resources' telemetry at once, and leaves the rest pending", async () => {
    setNow("2026-10-18T10:00:00.000Z");

    const keyId: string = ObjectID.generate().toString();

    mocked(VercelMarketplaceResources.listPurchases).mockResolvedValue([
      resource("res_1", {
        details: {
          name: "One",
          productId: "oneuptime",
          metadata: {},
          telemetryIngestionKeyId: keyId,
        },
      }),
      resource("res_2", { status: MarketplaceSubscriptionStatus.Cancelled }),
    ]);
    // The background finish finds nothing to finish here.
    mocked(
      VercelMarketplaceInstallationService.findByInstallationId,
    ).mockResolvedValue(null);

    expect(await VercelMarketplaceBilling.requestDeletion(installation())).toBe(
      false,
    );

    expect(
      VercelMarketplaceInstallationService.updateOneById,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: VercelInstallationStatus.DeletePending,
          deleteRequestedAt: new Date("2026-10-18T10:00:00.000Z"),
        },
      }),
    );

    expect(TelemetryIngestionKeyService.updateOneById).toHaveBeenCalledTimes(1);
    expect(TelemetryIngestionKeyService.updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isEnabled: false } }),
    );
  });

  it("is done with an installation already deleted", async () => {
    expect(
      await VercelMarketplaceBilling.requestDeletion(
        installation({ status: VercelInstallationStatus.Deleted }),
      ),
    ).toBe(true);

    expect(VercelMarketplaceResources.listPurchases).not.toHaveBeenCalled();
  });
});

describe("VercelMarketplaceBilling.finishDeletion", () => {
  const pending: () => VercelMarketplaceInstallation =
    (): VercelMarketplaceInstallation => {
      return installation({
        status: VercelInstallationStatus.DeletePending,
        deleteRequestedAt: new Date("2026-10-18T10:00:00.000Z"),
      });
    };

  beforeEach(() => {
    mocked(
      VercelMarketplaceInstallationService.findByInstallationId,
    ).mockResolvedValue(pending());
    mocked(VercelMarketplaceResources.listPurchases).mockResolvedValue([
      resource("res_1"),
      resource("res_2", {
        status: MarketplaceSubscriptionStatus.Cancelled,
        projectId: undefined,
      }),
    ]);
    mocked(MarketplaceUsageReportService.findBy).mockResolvedValue([
      report({
        start: "2026-10-18T09:00:00Z",
        end: "2026-10-18T10:05:00Z",
        quantity: 120,
        breakdown: { planId: "growth_monthly", seatsInUSD: 1.2, isFinal: true },
      }),
    ]);
  });

  it("deletes the projects after their final usage, sends the final invoice and finalizes billing", async () => {
    setNow("2026-10-18T10:10:00.000Z");

    await VercelMarketplaceBilling.finishDeletion(pending());

    // The resource still in force is deprovisioned (its final usage, then its project); the ended one, with no project left, is not.
    expect(VercelMarketplaceResources.deprovision).toHaveBeenCalledTimes(1);

    expect(api.submitInvoice).toHaveBeenCalledTimes(1);
    const invoice: VercelInvoice = api.submitInvoice.mock
      .calls[0]![1] as VercelInvoice;
    expect(invoice).toMatchObject({
      externalId: "oneuptime-icfg_acme-final",
      final: true,
      period: {
        start: "2026-10-01T00:00:00.000Z",
        end: "2026-10-18T10:10:00.000Z",
      },
    });

    expect(api.finalizeBilling).toHaveBeenCalledTimes(1);

    const order: Array<number> = [
      mocked(VercelMarketplaceResources.deprovision).mock
        .invocationCallOrder[0]!,
      api.submitInvoice.mock.invocationCallOrder[0]!,
      api.finalizeBilling.mock.invocationCallOrder[0]!,
    ];
    expect(
      [...order].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual(order);

    expect(
      VercelMarketplaceInstallationService.updateOneById,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: VercelInstallationStatus.Deleted,
          accessToken: null,
          lastBillingError: null,
        },
      }),
    );
  });

  it("tries again within Vercel's 24 hours when the final invoice cannot be sent", async () => {
    setNow("2026-10-18T12:10:00.000Z");
    api.submitInvoice.mockRejectedValue(new Error("Vercel unreachable"));

    await expect(
      VercelMarketplaceBilling.finishDeletion(pending()),
    ).rejects.toThrow("Vercel unreachable");

    expect(api.finalizeBilling).not.toHaveBeenCalled();
    expect(
      VercelMarketplaceInstallationService.updateOneById,
    ).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: VercelInstallationStatus.Deleted,
        }),
      }),
    );
  });

  it("lets the installation go after 23 hours, saying loudly what was not billed", async () => {
    setNow("2026-10-19T09:30:00.000Z");
    api.submitInvoice.mockRejectedValue(new Error("Vercel unreachable"));

    await VercelMarketplaceBilling.finishDeletion(pending());

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("was NOT billed"),
    );
    expect(
      VercelMarketplaceInstallationService.updateOneById,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: VercelInstallationStatus.Deleted,
        }),
      }),
    );
  });

  it("does nothing for an installation that is not pending deletion", async () => {
    mocked(
      VercelMarketplaceInstallationService.findByInstallationId,
    ).mockResolvedValue(installation());

    await VercelMarketplaceBilling.finishDeletion(pending());

    expect(VercelMarketplaceResources.deprovision).not.toHaveBeenCalled();
    expect(api.submitInvoice).not.toHaveBeenCalled();
  });
});

describe("VercelMarketplaceBilling.runAll", () => {
  it("bills active installations, finishes uninstalled ones, and deletes ended resources' projects", async () => {
    setNow("2026-10-18T10:15:00.000Z");

    mocked(VercelMarketplaceInstallationService.findBy).mockResolvedValue([
      installation({ installationId: "icfg_active" }),
      installation({
        installationId: "icfg_pending",
        status: VercelInstallationStatus.DeletePending,
      }),
    ]);
    mocked(
      VercelMarketplaceInstallationService.findByInstallationId,
    ).mockImplementation(
      async (
        installationId: unknown,
      ): Promise<VercelMarketplaceInstallation> => {
        return installationId === "icfg_pending"
          ? installation({
              installationId: "icfg_pending",
              status: VercelInstallationStatus.DeletePending,
              deleteRequestedAt: new Date("2026-10-18T10:00:00.000Z"),
            })
          : installation({ installationId: "icfg_active" });
      },
    );
    mocked(VercelMarketplaceResources.listPurchases).mockImplementation(
      async (
        installationId: unknown,
      ): Promise<Array<MarketplaceSubscription>> => {
        return installationId === "icfg_active"
          ? [resource("res_1", { externalCustomerId: "icfg_active" })]
          : [];
      },
    );
    mocked(MarketplaceUsageReportService.findBy).mockResolvedValue([]);

    await VercelMarketplaceBilling.runAll();

    expect(api.submitBillingData).toHaveBeenCalledTimes(1);
    expect(api.finalizeBilling).toHaveBeenCalledTimes(1);
    expect(
      VercelMarketplaceResources.deleteProjectsOfEndedResources,
    ).toHaveBeenCalledTimes(1);
  });
});
