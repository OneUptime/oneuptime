import MarketplaceSubscription from "../../../Models/DatabaseModels/MarketplaceSubscription";
import MarketplaceUsageReport from "../../../Models/DatabaseModels/MarketplaceUsageReport";
import Project from "../../../Models/DatabaseModels/Project";
import TelemetryUsageBilling from "../../../Models/DatabaseModels/TelemetryUsageBilling";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH } from "../../../Types/Billing/PayAsYouGoPricing";
import SubscriptionPlan from "../../../Types/Billing/SubscriptionPlan";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import Decimal from "../../../Types/Decimal";
import MarketplaceSubscriptionStatus from "../../../Types/Marketplace/MarketplaceSubscriptionStatus";
import MarketplaceUsageReportStatus from "../../../Types/Marketplace/MarketplaceUsageReportStatus";
import ObjectID from "../../../Types/ObjectID";
import { getAllEnvVars } from "../../EnvironmentConfig";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import MarketplaceSubscriptionService from "../../Services/MarketplaceSubscriptionService";
import MarketplaceUsageReportService from "../../Services/MarketplaceUsageReportService";
import ProjectService from "../../Services/ProjectService";
import TeamMemberService from "../../Services/TeamMemberService";
import TelemetryUsageBillingService from "../../Services/TelemetryUsageBillingService";
import QueryHelper from "../../Types/Database/QueryHelper";
import ActiveMonitorLimit from "../Billing/ActiveMonitorLimit";
import logger from "../Logger";
import MarketplaceAdapter, {
  MarketplaceStatus,
  MarketplaceUsageResult,
} from "./MarketplaceAdapter";
import MarketplaceAdapters from "./MarketplaceAdapters";
import MarketplaceUsageCalculator, {
  MarketplaceUsageCharge,
} from "./MarketplaceUsageCalculator";

/*
 * Reports what each marketplace-billed project owes to the marketplace that
 * bills it, every hour (Workers: Marketplace:ReportUsage), and once more when
 * a purchase ends.
 *
 * For each purchase in force, the period since the last report - normally
 * the last whole hour - is priced by MarketplaceUsageCalculator, written down
 * as a MarketplaceUsageReport, and only then sent. The record carries
 * everything the marketplace deduplicates on (the hour, the timestamp, the
 * operation ID), so a send that fails, times out, or whose answer is lost is
 * sent again as exactly the same record, and is counted once:
 *
 *   - AWS drops an identical BatchMeterUsage record;
 *   - Azure accepts one event per hour per dimension and answers a second
 *     with "Duplicate";
 *   - Google Cloud's Service Control counts an operation ID once.
 *
 * The telemetry rows a report includes are marked reported as it is written,
 * so no later report bills them again.
 *
 * A report the marketplace will not take any more (it is a day old - their
 * deadline - or refused for good) is marked Failed and logged loudly: that is
 * revenue someone has to look at.
 */

const REPORT_LOCK_NAMESPACE: string = "marketplace-usage-report";
// Every marketplace stops accepting a usage record about a day after its time.
const MAX_REPORT_AGE_IN_HOURS: number = 23;

export default class MarketplaceUsageReporter {
  /*
   * The hourly job: every purchase that bills a project now, and every
   * purchase - whatever has happened to it since - with a report still
   * waiting to be confirmed.
   */
  public static async reportAll(): Promise<void> {
    const purchases: Array<MarketplaceSubscription> =
      await MarketplaceSubscriptionService.findBy({
        query: {
          projectId: QueryHelper.notNull(),
          status: MarketplaceSubscriptionStatus.Active,
        },
        select: MarketplaceSubscriptionService.getPurchaseSelect(),
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });

    const seen: Set<string> = new Set(
      purchases.map((purchase: MarketplaceSubscription): string => {
        return purchase.id!.toString();
      }),
    );

    const pendingReports: Array<MarketplaceUsageReport> =
      await MarketplaceUsageReportService.findBy({
        query: { status: MarketplaceUsageReportStatus.Pending },
        select: { marketplaceSubscriptionId: true },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });

    for (const report of pendingReports) {
      const purchaseId: string | undefined =
        report.marketplaceSubscriptionId?.toString();

      if (!purchaseId || seen.has(purchaseId)) {
        continue;
      }

      seen.add(purchaseId);

      const purchase: MarketplaceSubscription | null =
        await MarketplaceSubscriptionService.findPurchaseById(
          new ObjectID(purchaseId),
        );

      if (purchase) {
        purchases.push(purchase);
      }
    }

    for (const purchase of purchases) {
      try {
        await MarketplaceUsageReporter.reportForPurchase(purchase);
      } catch (err) {
        logger.error(
          `Marketplace usage report failed for purchase ${purchase.id?.toString()} (${purchase.marketplace}).`,
        );
        logger.error(err);
      }
    }
  }

  /*
   * The purchase is ending: bill what was used up to now, while the
   * marketplace still accepts it (AWS gives an hour after it deprovisions a
   * license; Google takes usage stamped before the cancellation). Best
   * effort - an ending must never wait on, or fail because of, a report.
   */
  public static async reportFinalUsage(
    purchase: MarketplaceSubscription,
  ): Promise<void> {
    try {
      await MarketplaceUsageReporter.reportForPurchase(purchase, {
        isFinal: true,
      });
    } catch (err) {
      logger.error(
        `Final marketplace usage report failed for purchase ${purchase.id?.toString()} (${purchase.marketplace}).`,
      );
      logger.error(err);
    }
  }

  public static async reportForPurchase(
    purchase: MarketplaceSubscription,
    options?: { isFinal?: boolean | undefined },
  ): Promise<void> {
    const adapter: MarketplaceAdapter = MarketplaceAdapters.get(
      purchase.marketplace!,
    );

    if (!adapter.isConfigured()) {
      return;
    }

    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: purchase.id!.toString(),
        namespace: REPORT_LOCK_NAMESPACE,
        lockTimeout: 120_000,
        acquireTimeout: 30_000,
      });
    } catch (err) {
      // Another report for this purchase is running; it will cover this one.
      logger.debug(
        `Marketplace usage report for ${purchase.id?.toString()} is already running.`,
      );
      return;
    }

    try {
      // Read again under the lock: the period moves with every report.
      const current: MarketplaceSubscription | null =
        await MarketplaceSubscriptionService.findPurchaseById(purchase.id!);

      if (!current) {
        return;
      }

      await MarketplaceUsageReporter.resendPendingReports(current, adapter);

      if (
        !current.projectId ||
        current.isUsageMetered === false ||
        current.status !== MarketplaceSubscriptionStatus.Active
      ) {
        return;
      }

      const report: MarketplaceUsageReport | null =
        await MarketplaceUsageReporter.writeNextReport(current, {
          isFinal: Boolean(options?.isFinal),
        });

      if (report) {
        await MarketplaceUsageReporter.send(current, report, adapter);
      }
    } finally {
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (err) {
          logger.error(err);
        }
      }
    }
  }

  /*
   * Price the period since the last report and write it down. Returns the
   * report to send, or null when there is nothing to bill yet - a regular
   * report waits for the hour to end; the period still moves on, carrying
   * any fraction of a cent.
   */
  private static async writeNextReport(
    purchase: MarketplaceSubscription,
    options: { isFinal: boolean },
  ): Promise<MarketplaceUsageReport | null> {
    const now: Date = OneUptimeDate.getCurrentDate();
    const periodStart: Date =
      purchase.usageReportedUntil || purchase.linkedAt || now;
    const periodEnd: Date = options.isFinal
      ? now
      : MarketplaceUsageReporter.getStartOfHour(now);

    if (periodEnd.getTime() <= periodStart.getTime()) {
      return null;
    }

    const projectId: ObjectID = purchase.projectId!;

    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        _id: true,
        paymentProviderPlanId: true,
        trialEndsAt: true,
        currentActiveMonitorsCount: true,
      },
      props: { isRoot: true },
    });

    if (!project) {
      return null;
    }

    const seats: number =
      await TeamMemberService.getUniqueTeamMemberCountInProject(projectId);

    const activeMonitors: number =
      project.currentActiveMonitorsCount ??
      (await ActiveMonitorLimit.refreshCount(projectId));

    const telemetryRows: Array<TelemetryUsageBilling> =
      await TelemetryUsageBillingService.findBy({
        query: {
          projectId: projectId,
          isReportedToBillingProvider: false,
          totalCostInUSD: QueryHelper.greaterThan(0),
        },
        select: { _id: true, totalCostInUSD: true },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });

    let telemetryInUSD: number = 0;

    for (const row of telemetryRows) {
      const cost: number = Number(row.totalCostInUSD?.value || 0);

      if (Number.isFinite(cost) && cost > 0) {
        telemetryInUSD += cost;
      }
    }

    const charge: MarketplaceUsageCharge = MarketplaceUsageCalculator.calculate(
      {
        periodStart: periodStart,
        periodEnd: periodEnd,
        seats: seats,
        seatPricePerMonthInUSD: MarketplaceUsageReporter.getSeatPricePerMonth(
          project.paymentProviderPlanId,
        ),
        trialEndsAt: project.trialEndsAt || null,
        activeMonitors: activeMonitors,
        activeMonitorPricePerMonthInUSD: ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH,
        telemetryInUSD: telemetryInUSD,
        carriedInUSD: Number(purchase.unreportedUsageInUSD?.value || 0),
      },
    );

    let report: MarketplaceUsageReport | null = null;

    if (charge.quantity > 0) {
      const newReport: MarketplaceUsageReport = new MarketplaceUsageReport();
      newReport.marketplaceSubscriptionId = purchase.id!;
      newReport.projectId = projectId;
      newReport.marketplace = purchase.marketplace!;
      newReport.periodStart = periodStart;
      newReport.periodEnd = periodEnd;
      newReport.quantity = charge.quantity;
      newReport.status = MarketplaceUsageReportStatus.Pending;
      newReport.attempts = 0;
      newReport.breakdown = {
        ...charge.breakdown,
        planId: project.paymentProviderPlanId || null,
        telemetryRows: telemetryRows.length,
        isFinal: options.isFinal,
      };

      report = await MarketplaceUsageReportService.create({
        data: newReport,
        props: { isRoot: true },
      });
    }

    // The telemetry is in this report (or in the carried fraction): never bill it again.
    for (const row of telemetryRows) {
      await TelemetryUsageBillingService.updateOneById({
        id: row.id!,
        data: {
          isReportedToBillingProvider: true,
          reportedToBillingProviderAt: now,
        },
        props: { isRoot: true },
      });
    }

    await MarketplaceSubscriptionService.updateOneById({
      id: purchase.id!,
      data: {
        usageReportedUntil: periodEnd,
        unreportedUsageInUSD: new Decimal(charge.carriedOutInUSD),
      },
      props: { isRoot: true },
    });

    // What the Billing page shows as the project's seats.
    await ProjectService.updateOneById({
      id: projectId,
      data: { paymentProviderSubscriptionSeats: seats },
      props: { isRoot: true, ignoreHooks: true },
    });

    return report;
  }

  /*
   * Reports written down but not yet confirmed - a send that failed, or the
   * process stopped between writing and sending - go out again first, as
   * they are. Past the marketplace's deadline they are marked Failed.
   */
  private static async resendPendingReports(
    purchase: MarketplaceSubscription,
    adapter: MarketplaceAdapter,
  ): Promise<void> {
    const pending: Array<MarketplaceUsageReport> =
      await MarketplaceUsageReportService.findBy({
        query: {
          marketplaceSubscriptionId: purchase.id!,
          status: MarketplaceUsageReportStatus.Pending,
        },
        select: {
          _id: true,
          projectId: true,
          periodStart: true,
          periodEnd: true,
          quantity: true,
          attempts: true,
        },
        sort: { periodEnd: SortOrder.Ascending },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });

    for (const report of pending) {
      await MarketplaceUsageReporter.send(purchase, report, adapter);
    }
  }

  private static async send(
    purchase: MarketplaceSubscription,
    report: MarketplaceUsageReport,
    adapter: MarketplaceAdapter,
  ): Promise<void> {
    const ageInHours: number =
      (OneUptimeDate.getCurrentDate().getTime() - report.periodEnd!.getTime()) /
      (60 * 60 * 1000);

    if (ageInHours > MAX_REPORT_AGE_IN_HOURS) {
      await MarketplaceUsageReporter.markFailed(
        purchase,
        report,
        "Not accepted before the marketplace's 24-hour deadline.",
      );
      return;
    }

    let result: MarketplaceUsageResult;

    try {
      result = await adapter.reportUsage(purchase, {
        reportId: report.id!.toString(),
        quantity: report.quantity!,
        periodStart: report.periodStart!,
        periodEnd: report.periodEnd!,
        projectId: report.projectId!.toString(),
      });
    } catch (err) {
      result = { outcome: "retry", error: (err as Error).message };
    }

    const attempts: number = (report.attempts || 0) + 1;

    if (result.outcome === "accepted") {
      await MarketplaceUsageReportService.updateOneById({
        id: report.id!,
        data: {
          status: MarketplaceUsageReportStatus.Reported,
          reportedAt: OneUptimeDate.getCurrentDate(),
          externalReportId: result.externalReportId || null,
          attempts: attempts,
          lastError: null,
        },
        props: { isRoot: true },
      });
      return;
    }

    if (result.outcome === "retry") {
      await MarketplaceUsageReportService.updateOneById({
        id: report.id!,
        data: {
          attempts: attempts,
          lastError: MarketplaceUsageReporter.clip(result.error || ""),
        },
        props: { isRoot: true },
      });
      return;
    }

    await MarketplaceUsageReporter.markFailed(
      purchase,
      report,
      result.error || "Refused by the marketplace.",
      attempts,
    );

    if (result.isPurchaseInactive) {
      await MarketplaceUsageReporter.refreshStatus(purchase, adapter);
    }
  }

  private static async markFailed(
    purchase: MarketplaceSubscription,
    report: MarketplaceUsageReport,
    error: string,
    attempts?: number | undefined,
  ): Promise<void> {
    logger.error(
      `Marketplace usage report ${report.id?.toString()} for purchase ${purchase.id?.toString()} (${purchase.marketplace}, project ${report.projectId?.toString()}) was NOT billed: ${report.quantity} units for ${OneUptimeDate.toString(report.periodStart!)} - ${OneUptimeDate.toString(report.periodEnd!)}. ${error}`,
    );

    await MarketplaceUsageReportService.updateOneById({
      id: report.id!,
      data: {
        status: MarketplaceUsageReportStatus.Failed,
        lastError: MarketplaceUsageReporter.clip(error),
        ...(attempts !== undefined ? { attempts: attempts } : {}),
      },
      props: { isRoot: true },
    });
  }

  /*
   * The marketplace refused a report because the purchase is no longer
   * billable: read where it stands now, so the project stops being served
   * (or keeps being served) on the marketplace's word, not on a guess.
   */
  private static async refreshStatus(
    purchase: MarketplaceSubscription,
    adapter: MarketplaceAdapter,
  ): Promise<void> {
    try {
      const status: MarketplaceStatus | null =
        await adapter.fetchStatus(purchase);

      if (status) {
        await MarketplaceSubscriptionService.updatePurchase(purchase, status);
      }
    } catch (err) {
      logger.error(err);
    }
  }

  /*
   * The plan's per-user monthly price. The monthly price whatever plan ID the
   * project is on: a marketplace bills month to month, and a yearly price is
   * for a yearly commitment, which on a marketplace is a private offer. A
   * plan priced by agreement (Enterprise) has no list price, and is billed as
   * the agreement says.
   */
  public static getSeatPricePerMonth(planId: string | undefined): number {
    if (!planId) {
      return 0;
    }

    const plan: SubscriptionPlan | undefined =
      SubscriptionPlan.getSubscriptionPlanById(planId, getAllEnvVars());

    if (!plan || plan.isCustomPricing()) {
      return 0;
    }

    const price: number = plan.getMonthlySubscriptionAmountInUSD();

    return Number.isFinite(price) && price > 0 ? price : 0;
  }

  public static getStartOfHour(date: Date): Date {
    const start: Date = new Date(date.getTime());
    start.setUTCMinutes(0, 0, 0);
    return start;
  }

  private static clip(message: string): string {
    return message.length > 480 ? `${message.substring(0, 480)}...` : message;
  }
}
