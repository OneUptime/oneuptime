import MarketplaceUsageReport from "Common/Models/DatabaseModels/MarketplaceUsageReport";
import Project from "Common/Models/DatabaseModels/Project";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import {
  MarketplaceUsageMonth,
  MarketplaceUsageSummary,
} from "Common/Types/Marketplace/MarketplaceUsageSummary";
import MarketplaceUsageReportStatus from "Common/Types/Marketplace/MarketplaceUsageReportStatus";
import ObjectID from "Common/Types/ObjectID";
import MarketplaceUsageReportService from "Common/Server/Services/MarketplaceUsageReportService";
import ProjectService from "Common/Server/Services/ProjectService";
import MarketplaceUsageSummarizer from "../../../Server/CloudMarketplace/MarketplaceUsageSummarizer";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * What a marketplace-billed project's people see of its marketplace bill:
 * its hourly usage reports summed by month (UTC) and item. Billed and
 * pending reports only - a report the marketplace never took was never
 * billed.
 */

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/MarketplaceUsageReportService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn() },
  };
});

const NOW: Date = new Date("2026-10-16T10:05:00.000Z");

const report: (data: {
  periodStart: string;
  quantity: number;
  status?: MarketplaceUsageReportStatus;
  breakdown?: JSONObject;
}) => MarketplaceUsageReport = (data: {
  periodStart: string;
  quantity: number;
  status?: MarketplaceUsageReportStatus;
  breakdown?: JSONObject;
}): MarketplaceUsageReport => {
  return Object.assign(new MarketplaceUsageReport(), {
    periodStart: new Date(data.periodStart),
    quantity: data.quantity,
    status: data.status || MarketplaceUsageReportStatus.Reported,
    breakdown: data.breakdown || {},
  });
};

describe("MarketplaceUsageSummarizer.getMonths", () => {
  it("is the current UTC month and the two before it, newest first", () => {
    expect(
      MarketplaceUsageSummarizer.getMonths(NOW, 3).map(
        (window: { month: string }) => {
          return window.month;
        },
      ),
    ).toEqual(["2026-10", "2026-09", "2026-08"]);
  });

  it("crosses into the year before", () => {
    const windows: Array<{ month: string; start: Date }> =
      MarketplaceUsageSummarizer.getMonths(
        new Date("2027-01-31T23:59:59.000Z"),
        3,
      );

    expect(
      windows.map((window: { month: string }) => {
        return window.month;
      }),
    ).toEqual(["2027-01", "2026-12", "2026-11"]);
    expect(windows[2]!.start).toEqual(new Date("2026-11-01T00:00:00.000Z"));
  });
});

describe("MarketplaceUsageSummarizer.summarize", () => {
  it("sums each month's units and items, billed apart from pending", () => {
    const summary: MarketplaceUsageSummary =
      MarketplaceUsageSummarizer.summarize({
        marketplace: CloudMarketplace.AWS,
        now: NOW,
        reports: [
          report({
            periodStart: "2026-10-16T08:00:00.000Z",
            quantity: 30,
            breakdown: {
              seatsInUSD: 0.2957,
              activeMonitorsInUSD: 0.004,
              telemetryInUSD: 0,
            },
          }),
          report({
            periodStart: "2026-10-16T09:00:00.000Z",
            quantity: 2030,
            status: MarketplaceUsageReportStatus.Pending,
            breakdown: {
              seatsInUSD: 0.2957,
              activeMonitorsInUSD: 0.004,
              smsOrCallBalanceInUSD: 20,
            },
          }),
          report({
            periodStart: "2026-09-30T23:00:00.000Z",
            quantity: 5030,
            breakdown: {
              seatsInUSD: 0.3,
              telemetryInUSD: 0,
              aiBalanceInUSD: 50,
            },
          }),
        ],
      });

    expect(summary.marketplace).toBe(CloudMarketplace.AWS);
    expect(summary.usageUnitInUSD).toBe(0.01);

    const october: MarketplaceUsageMonth = summary.months[0]!;
    expect(october).toEqual({
      month: "2026-10",
      billedUnits: 30,
      pendingUnits: 2030,
      usersInUSD: 0.5914,
      activeMonitorsInUSD: 0.008,
      telemetryInUSD: 0,
      smsOrCallBalanceInUSD: 20,
      aiBalanceInUSD: 0,
    });

    // The last hour of September belongs to September, though it ends in October.
    expect(summary.months[1]).toMatchObject({
      month: "2026-09",
      billedUnits: 5030,
      aiBalanceInUSD: 50,
    });

    expect(summary.months[2]).toEqual({
      month: "2026-08",
      billedUnits: 0,
      pendingUnits: 0,
      usersInUSD: 0,
      activeMonitorsInUSD: 0,
      telemetryInUSD: 0,
      smsOrCallBalanceInUSD: 0,
      aiBalanceInUSD: 0,
    });
  });

  it("leaves out what was never billed, and what is older than three months", () => {
    const summary: MarketplaceUsageSummary =
      MarketplaceUsageSummarizer.summarize({
        marketplace: CloudMarketplace.Azure,
        now: NOW,
        reports: [
          report({
            periodStart: "2026-10-01T00:00:00.000Z",
            quantity: 999,
            status: MarketplaceUsageReportStatus.Failed,
            breakdown: { seatsInUSD: 9.99 },
          }),
          report({
            periodStart: "2026-07-31T23:00:00.000Z",
            quantity: 500,
            breakdown: { seatsInUSD: 5 },
          }),
        ],
      });

    for (const month of summary.months) {
      expect(month.billedUnits + month.pendingUnits).toBe(0);
      expect(month.usersInUSD).toBe(0);
    }
  });

  it("reads breakdowns it does not recognize as nothing", () => {
    const summary: MarketplaceUsageSummary =
      MarketplaceUsageSummarizer.summarize({
        marketplace: CloudMarketplace.GoogleCloud,
        now: NOW,
        reports: [
          report({
            periodStart: "2026-10-02T00:00:00.000Z",
            quantity: 1,
            breakdown: {
              seatsInUSD: "lots",
              activeMonitorsInUSD: -5,
              telemetryInUSD: Number.NaN,
            },
          }),
        ],
      });

    expect(summary.months[0]).toMatchObject({
      billedUnits: 1,
      usersInUSD: 0,
      activeMonitorsInUSD: 0,
      telemetryInUSD: 0,
    });
  });
});

describe("MarketplaceUsageSummarizer.getSummary", () => {
  const projectId: ObjectID = ObjectID.generate();
  let findProject: jest.Mock;
  let findReports: jest.Mock;

  beforeEach(() => {
    findProject = ProjectService.findOneById as unknown as jest.Mock;
    findReports = MarketplaceUsageReportService.findBy as unknown as jest.Mock;
    findProject.mockReset();
    findReports.mockReset();
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads the project's billed and pending reports since the oldest month it shows", async () => {
    findProject.mockResolvedValue(
      Object.assign(new Project(), {
        billingMarketplace: CloudMarketplace.AWS,
      }),
    );
    findReports.mockResolvedValue([
      report({ periodStart: "2026-10-16T08:00:00.000Z", quantity: 42 }),
    ]);

    const summary: MarketplaceUsageSummary =
      await MarketplaceUsageSummarizer.getSummary(projectId);

    expect(summary.months[0]!.billedUnits).toBe(42);

    const query: Record<string, unknown> = (
      findReports.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(query["projectId"]).toEqual(projectId);
    expect(query["periodStart"]).toBeDefined();
    expect(query["status"]).toBeDefined();
  });

  it("shows nothing for a project no marketplace bills, without reading reports", async () => {
    findProject.mockResolvedValue(new Project());

    const summary: MarketplaceUsageSummary =
      await MarketplaceUsageSummarizer.getSummary(projectId);

    expect(summary.marketplace).toBeNull();
    expect(
      summary.months.every((month: MarketplaceUsageMonth): boolean => {
        return month.billedUnits === 0 && month.pendingUnits === 0;
      }),
    ).toBe(true);
    expect(findReports).not.toHaveBeenCalled();
  });
});
