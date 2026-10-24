import MarketplaceUsageReport from "Common/Models/DatabaseModels/MarketplaceUsageReport";
import Project from "Common/Models/DatabaseModels/Project";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import CloudMarketplace, {
  CloudMarketplaceUtil,
} from "Common/Types/Marketplace/CloudMarketplace";
import { MARKETPLACE_USAGE_UNIT_IN_USD } from "Common/Types/Marketplace/MarketplacePurchase";
import {
  MARKETPLACE_USAGE_MONTHS,
  MarketplaceUsageMonth,
  MarketplaceUsageSummary,
} from "Common/Types/Marketplace/MarketplaceUsageSummary";
import MarketplaceUsageReportStatus from "Common/Types/Marketplace/MarketplaceUsageReportStatus";
import ObjectID from "Common/Types/ObjectID";
import MarketplaceUsageReportService from "Common/Server/Services/MarketplaceUsageReportService";
import ProjectService from "Common/Server/Services/ProjectService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";

/*
 * A marketplace-billed project's usage reports, summed by month and item for
 * its own billing page (MarketplaceUsageSummary). The reports themselves stay
 * master-admin only; a project's people see only these sums.
 *
 * A report belongs to the month its period starts in (UTC): the 23:00 hour
 * of the last day of a month is that month's, though it ends in the next.
 */

interface MonthWindow {
  month: string;
  start: Date;
  end: Date;
}

export default class MarketplaceUsageSummarizer {
  public static async getSummary(
    projectId: ObjectID,
  ): Promise<MarketplaceUsageSummary> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: { _id: true, billingMarketplace: true },
      props: { isRoot: true },
    });

    const marketplace: CloudMarketplace | null =
      project?.billingMarketplace &&
      CloudMarketplaceUtil.isCloudMarketplace(project.billingMarketplace)
        ? project.billingMarketplace
        : null;

    const now: Date = OneUptimeDate.getCurrentDate();

    if (!marketplace) {
      return MarketplaceUsageSummarizer.summarize({
        marketplace: null,
        reports: [],
        now: now,
      });
    }

    const windows: Array<MonthWindow> = MarketplaceUsageSummarizer.getMonths(
      now,
      MARKETPLACE_USAGE_MONTHS,
    );

    const reports: Array<MarketplaceUsageReport> =
      await MarketplaceUsageReportService.findBy({
        query: {
          projectId: projectId,
          periodStart: QueryHelper.greaterThanEqualTo(
            windows[windows.length - 1]!.start,
          ),
          status: QueryHelper.any([
            MarketplaceUsageReportStatus.Reported,
            MarketplaceUsageReportStatus.Pending,
          ]),
        },
        select: {
          periodStart: true,
          quantity: true,
          status: true,
          breakdown: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });

    return MarketplaceUsageSummarizer.summarize({
      marketplace: marketplace,
      reports: reports,
      now: now,
    });
  }

  public static summarize(data: {
    marketplace: CloudMarketplace | null;
    reports: Array<MarketplaceUsageReport>;
    now: Date;
  }): MarketplaceUsageSummary {
    const months: Array<MarketplaceUsageMonth> =
      MarketplaceUsageSummarizer.getMonths(
        data.now,
        MARKETPLACE_USAGE_MONTHS,
      ).map((window: MonthWindow): MarketplaceUsageMonth => {
        return {
          month: window.month,
          billedUnits: 0,
          pendingUnits: 0,
          usersInUSD: 0,
          activeMonitorsInUSD: 0,
          telemetryInUSD: 0,
          smsOrCallBalanceInUSD: 0,
          aiBalanceInUSD: 0,
        };
      });

    for (const report of data.reports) {
      if (!report.periodStart) {
        continue;
      }

      const month: MarketplaceUsageMonth | undefined = months.find(
        (each: MarketplaceUsageMonth): boolean => {
          return (
            each.month ===
            MarketplaceUsageSummarizer.getMonthKey(report.periodStart!)
          );
        },
      );

      // Failed reports were never billed; anything else is not the customer's.
      if (
        !month ||
        (report.status !== MarketplaceUsageReportStatus.Reported &&
          report.status !== MarketplaceUsageReportStatus.Pending)
      ) {
        continue;
      }

      const units: number = MarketplaceUsageSummarizer.readNumber(
        report.quantity,
      );

      if (report.status === MarketplaceUsageReportStatus.Reported) {
        month.billedUnits += units;
      } else {
        month.pendingUnits += units;
      }

      const breakdown: JSONObject = report.breakdown || {};

      month.usersInUSD += MarketplaceUsageSummarizer.readNumber(
        breakdown["seatsInUSD"],
      );
      month.activeMonitorsInUSD += MarketplaceUsageSummarizer.readNumber(
        breakdown["activeMonitorsInUSD"],
      );
      month.telemetryInUSD += MarketplaceUsageSummarizer.readNumber(
        breakdown["telemetryInUSD"],
      );
      month.smsOrCallBalanceInUSD += MarketplaceUsageSummarizer.readNumber(
        breakdown["smsOrCallBalanceInUSD"],
      );
      month.aiBalanceInUSD += MarketplaceUsageSummarizer.readNumber(
        breakdown["aiBalanceInUSD"],
      );
    }

    return {
      marketplace: data.marketplace,
      usageUnitInUSD: MARKETPLACE_USAGE_UNIT_IN_USD,
      months: months.map(
        (month: MarketplaceUsageMonth): MarketplaceUsageMonth => {
          // Sums of many small amounts: rounded to a millionth, so 0.1 + 0.2 reads 0.3.
          return {
            ...month,
            usersInUSD: MarketplaceUsageSummarizer.roundUSD(month.usersInUSD),
            activeMonitorsInUSD: MarketplaceUsageSummarizer.roundUSD(
              month.activeMonitorsInUSD,
            ),
            telemetryInUSD: MarketplaceUsageSummarizer.roundUSD(
              month.telemetryInUSD,
            ),
            smsOrCallBalanceInUSD: MarketplaceUsageSummarizer.roundUSD(
              month.smsOrCallBalanceInUSD,
            ),
            aiBalanceInUSD: MarketplaceUsageSummarizer.roundUSD(
              month.aiBalanceInUSD,
            ),
          };
        },
      ),
    };
  }

  // The `count` UTC months up to and including the one `now` is in, newest first.
  public static getMonths(now: Date, count: number): Array<MonthWindow> {
    const windows: Array<MonthWindow> = [];

    for (let index: number = 0; index < count; index++) {
      const start: Date = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1),
      );
      const end: Date = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
      );

      windows.push({
        month: MarketplaceUsageSummarizer.getMonthKey(start),
        start: start,
        end: end,
      });
    }

    return windows;
  }

  public static getMonthKey(date: Date): string {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  private static readNumber(value: unknown): number {
    const number: number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  private static roundUSD(value: number): number {
    return Math.round(value * 1_000_000) / 1_000_000;
  }
}
