import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import MarketplaceUsageReport from "Common/Models/DatabaseModels/MarketplaceUsageReport";
import VercelMarketplaceInstallation from "Common/Models/DatabaseModels/VercelMarketplaceInstallation";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH,
  formatPriceInUSD,
} from "Common/Types/Billing/PayAsYouGoPricing";
import SubscriptionPlan from "Common/Types/Billing/SubscriptionPlan";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import MarketplaceUsageReportStatus from "Common/Types/Marketplace/MarketplaceUsageReportStatus";
import VercelInstallationStatus from "Common/Types/Marketplace/VercelInstallationStatus";
import ObjectID from "Common/Types/ObjectID";
import Sleep from "Common/Types/Sleep";
import Semaphore, {
  SemaphoreMutex,
} from "Common/Server/Infrastructure/Semaphore";
import MarketplaceUsageReportService from "Common/Server/Services/MarketplaceUsageReportService";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import VercelMarketplaceInstallationService from "Common/Server/Services/VercelMarketplaceInstallationService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger from "Common/Server/Utils/Logger";
import QueryDeepPartialEntity from "Common/Types/Database/PartialEntity";
import MarketplaceApiError from "../MarketplaceApiError";
import VercelMarketplaceAPI, {
  VercelBillingItem,
  VercelInstallationCredentials,
  VercelPeriod,
  VercelUsageItem,
} from "./VercelMarketplaceAPI";
import VercelMarketplacePlans from "./VercelMarketplacePlans";
import VercelMarketplaceResources from "./VercelMarketplaceResources";
import VercelResource, { VercelResourceDetails } from "./VercelResource";

/*
 * Billing a Vercel team for its OneUptime resources (Workers:
 * Marketplace:VercelBilling, every hour).
 *
 * The hourly usage report prices each resource's project as it does for
 * every marketplace - its plan's per-user price, its active monitors, its
 * telemetry, its balance top-ups - and writes each hour down as a
 * MarketplaceUsageReport, in usage units of one cent. From those reports,
 * for each installation:
 *
 *   - every hour, the running totals of the current month go to Vercel
 *     (Submit Billing Data), which shows them to the team and charges
 *     nothing;
 *   - once a month has ended - and its last hour has been reported - its
 *     invoice goes to Vercel (Submit Invoice), which charges the team's card
 *     and handles the tax. The invoice's ID is the installation and the
 *     month, so one sent again (its answer lost) is recognised, not charged
 *     twice;
 *   - when the team uninstalls OneUptime, its projects are deleted - each
 *     billed first for what it used since its last hourly report - and the
 *     final invoice, for the month so far, is sent before Vercel is told
 *     billing is finalized.
 *
 * Each resource is a line on the invoice per kind of charge and plan, in
 * usage units ($0.01 each) - the same units, at the same prices, as on AWS,
 * Microsoft and Google Cloud. A resource whose plan changed during the
 * month has lines for each plan it was on.
 */

const BILLING_LOCK_NAMESPACE: string = "vercel-marketplace-billing";
// A month's last hour is reported a minute after it ends; its invoice waits a little longer than that.
const INVOICE_DELAY_IN_HOURS: number = 2;
// Vercel waits 24 hours for the final invoice of an uninstalled team.
const FINAL_INVOICE_DEADLINE_IN_HOURS: number = 23;
const USAGE_UNIT_IN_MICROS: number = 10_000;
const MICROS_PER_USD: number = 1_000_000;

type ChargeKind = "users" | "monitors" | "telemetry" | "topUps";

const CHARGE_KINDS: Array<ChargeKind> = [
  "users",
  "monitors",
  "telemetry",
  "topUps",
];

export interface ResourceUsage {
  purchase: MarketplaceSubscription;
  vercelPlanId: string;
  plan: SubscriptionPlan | undefined;
  reports: Array<MarketplaceUsageReport>;
}

export default class VercelMarketplaceBilling {
  private static api: VercelMarketplaceAPI | null = null;

  // For tests: the client every call uses from now on.
  public static setApi(api: VercelMarketplaceAPI | null): void {
    VercelMarketplaceBilling.api = api;
  }

  private static getApi(): VercelMarketplaceAPI {
    if (!VercelMarketplaceBilling.api) {
      VercelMarketplaceBilling.api = new VercelMarketplaceAPI();
    }

    return VercelMarketplaceBilling.api;
  }

  // The hourly job.
  public static async runAll(): Promise<void> {
    const installations: Array<VercelMarketplaceInstallation> =
      await VercelMarketplaceInstallationService.findBy({
        query: {
          status: QueryHelper.any([
            VercelInstallationStatus.Active,
            VercelInstallationStatus.DeletePending,
          ]),
        },
        select: VercelMarketplaceInstallationService.getInstallationSelect(),
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });

    for (const installation of installations) {
      try {
        if (installation.status === VercelInstallationStatus.DeletePending) {
          await VercelMarketplaceBilling.finishDeletion(installation);
        } else {
          await VercelMarketplaceBilling.billInstallation(installation);
        }
      } catch (err) {
        logger.error(
          `Vercel billing failed for installation ${installation.installationId}.`,
        );
        logger.error(err);
      }

      // Vercel takes 10 billing calls a minute.
      await Sleep.sleep(500);
    }

    await VercelMarketplaceResources.deleteProjectsOfEndedResources();
  }

  /*
   * Send the invoices of the months that have ended, then the running
   * totals of this one. Under a lock per installation, so the hourly job
   * and an uninstall never bill the same month at once.
   */
  public static async billInstallation(
    installation: VercelMarketplaceInstallation,
  ): Promise<void> {
    await VercelMarketplaceBilling.underLock(
      installation,
      async (current: VercelMarketplaceInstallation): Promise<void> => {
        if (current.status !== VercelInstallationStatus.Active) {
          return;
        }

        const now: Date = OneUptimeDate.getCurrentDate();

        try {
          await VercelMarketplaceBilling.sendDueInvoices(current, now);
          await VercelMarketplaceBilling.sendRunningTotals(current, now);
          await VercelMarketplaceBilling.recordError(current, null);
        } catch (err) {
          await VercelMarketplaceBilling.recordError(current, err);
          throw err;
        }
      },
    );
  }

  /*
   * DELETE /v1/installations/{id} (or the integration-configuration.removed
   * webhook): the team uninstalled OneUptime. The resources' telemetry stops
   * at once; deleting their projects and the final invoice are done by
   * finishDeletion, now in the background and every hour after until it is
   * done. Returns whether the installation is done with already - nothing
   * was ever provisioned - which is Vercel's "finalized".
   */
  public static async requestDeletion(
    installation: VercelMarketplaceInstallation,
  ): Promise<boolean> {
    if (installation.status === VercelInstallationStatus.Deleted) {
      return true;
    }

    const purchases: Array<MarketplaceSubscription> =
      await VercelMarketplaceResources.listPurchases(
        installation.installationId!,
      );

    if (purchases.length === 0) {
      await VercelMarketplaceBilling.markDeleted(installation);
      return true;
    }

    if (installation.status !== VercelInstallationStatus.DeletePending) {
      await VercelMarketplaceInstallationService.updateOneById({
        id: installation.id!,
        data: {
          status: VercelInstallationStatus.DeletePending,
          deleteRequestedAt: OneUptimeDate.getCurrentDate(),
        },
        props: { isRoot: true },
      });
    }

    for (const purchase of purchases) {
      const details: VercelResourceDetails =
        VercelResource.readDetails(purchase);

      if (
        purchase.status !== MarketplaceSubscriptionStatus.Cancelled &&
        details.telemetryIngestionKeyId
      ) {
        try {
          await TelemetryIngestionKeyService.updateOneById({
            id: new ObjectID(details.telemetryIngestionKeyId),
            data: { isEnabled: false },
            props: { isRoot: true },
          });
        } catch (err) {
          logger.debug(err);
        }
      }
    }

    // Not awaited: Vercel is answered now; the hourly job finishes what this does not.
    void (async (): Promise<void> => {
      try {
        const pending: VercelMarketplaceInstallation | null =
          await VercelMarketplaceInstallationService.findByInstallationId(
            installation.installationId!,
          );

        if (pending) {
          await VercelMarketplaceBilling.finishDeletion(pending);
        }
      } catch (err) {
        logger.error(
          `Uninstalling Vercel installation ${installation.installationId} did not finish now; the hourly billing job carries on.`,
        );
        logger.error(err);
      }
    })();

    return false;
  }

  /*
   * An uninstalled team: delete each resource's project after billing what
   * it used since its last hourly report, send the invoices still owed -
   * the final one for the month so far - and tell Vercel billing is
   * finalized. Then the installation is Deleted and its token forgotten.
   */
  public static async finishDeletion(
    installation: VercelMarketplaceInstallation,
  ): Promise<void> {
    await VercelMarketplaceBilling.underLock(
      installation,
      async (current: VercelMarketplaceInstallation): Promise<void> => {
        if (current.status !== VercelInstallationStatus.DeletePending) {
          return;
        }

        const purchases: Array<MarketplaceSubscription> =
          await VercelMarketplaceResources.listPurchases(
            current.installationId!,
          );

        for (const purchase of purchases) {
          if (
            purchase.status !== MarketplaceSubscriptionStatus.Cancelled ||
            purchase.projectId
          ) {
            await VercelMarketplaceResources.deprovision(purchase);
          }
        }

        const now: Date = OneUptimeDate.getCurrentDate();

        try {
          await VercelMarketplaceBilling.sendDueInvoices(current, now);
          await VercelMarketplaceBilling.sendFinalInvoice(current, now);
          await VercelMarketplaceBilling.getApi().finalizeBilling(
            VercelMarketplaceBilling.getCredentials(current),
          );
        } catch (err) {
          const requestedAt: Date = current.deleteRequestedAt || now;
          const hoursSince: number =
            (now.getTime() - requestedAt.getTime()) / (60 * 60 * 1000);

          if (hoursSince < FINAL_INVOICE_DEADLINE_IN_HOURS) {
            await VercelMarketplaceBilling.recordError(current, err);
            throw err;
          }

          logger.error(
            `The final invoice of Vercel installation ${current.installationId} (${current.accountName || current.vercelAccountId}) could not be sent within Vercel's 24 hours: its usage since ${OneUptimeDate.toString(current.invoicedUntil || requestedAt)} was NOT billed. ${(err as Error).message}`,
          );
        }

        await VercelMarketplaceBilling.markDeleted(current);

        logger.info(
          `Vercel installation ${current.installationId} is uninstalled and its billing finalized.`,
        );
      },
    );
  }

  // The invoice of every whole month since the last one, once its last hour is reported.
  private static async sendDueInvoices(
    installation: VercelMarketplaceInstallation,
    now: Date,
  ): Promise<void> {
    let periodStart: Date =
      VercelMarketplaceBilling.getUninvoicedStart(installation);

    for (;;) {
      const periodEnd: Date =
        VercelMarketplaceBilling.getStartOfNextMonth(periodStart);

      if (
        OneUptimeDate.addRemoveHours(
          periodEnd,
          INVOICE_DELAY_IN_HOURS,
        ).getTime() > now.getTime()
      ) {
        return;
      }

      await VercelMarketplaceBilling.sendInvoice(installation, {
        periodStart: periodStart,
        periodEnd: periodEnd,
        externalId: `oneuptime-${installation.installationId}-${VercelMarketplaceBilling.getMonthKey(periodStart)}`,
        isFinal: false,
      });

      periodStart = periodEnd;
    }
  }

  private static async sendFinalInvoice(
    installation: VercelMarketplaceInstallation,
    now: Date,
  ): Promise<void> {
    const current: VercelMarketplaceInstallation =
      (await VercelMarketplaceInstallationService.findByInstallationId(
        installation.installationId!,
      )) || installation;

    const periodStart: Date =
      VercelMarketplaceBilling.getUninvoicedStart(current);

    if (now.getTime() <= periodStart.getTime()) {
      return;
    }

    await VercelMarketplaceBilling.sendInvoice(current, {
      periodStart: periodStart,
      periodEnd: now,
      externalId: `oneuptime-${current.installationId}-final`,
      isFinal: true,
    });
  }

  private static async sendInvoice(
    installation: VercelMarketplaceInstallation,
    data: {
      periodStart: Date;
      periodEnd: Date;
      externalId: string;
      isFinal: boolean;
    },
  ): Promise<void> {
    const usage: Array<ResourceUsage> =
      await VercelMarketplaceBilling.getResourceUsage(installation, {
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
      });

    const items: Array<VercelBillingItem> = VercelMarketplaceBilling.buildItems(
      usage,
      { periodStart: data.periodStart, periodEnd: data.periodEnd },
    );

    if (items.length > 0) {
      const period: VercelPeriod = {
        start: OneUptimeDate.toString(data.periodStart),
        end: OneUptimeDate.toString(data.periodEnd),
      };

      const result: { invoiceId: string | null; isDuplicate: boolean } =
        await VercelMarketplaceBilling.getApi().submitInvoice(
          VercelMarketplaceBilling.getCredentials(installation),
          {
            externalId: data.externalId,
            // Inside the period, as Vercel requires: its last second.
            invoiceDate: OneUptimeDate.toString(
              OneUptimeDate.addRemoveSeconds(data.periodEnd, -1),
            ),
            memo: `OneUptime usage, ${OneUptimeDate.toString(data.periodStart)} to ${OneUptimeDate.toString(data.periodEnd)}.`,
            period: period,
            items: items,
            ...(data.isFinal ? { final: true } : {}),
          },
        );

      logger.info(
        `Vercel installation ${installation.installationId}: invoice ${data.externalId} ${result.isDuplicate ? "was sent before" : `sent (${result.invoiceId || "no ID"})`}, ${VercelMarketplaceBilling.sumItems(items)} USD.`,
      );
    }

    await VercelMarketplaceInstallationService.updateOneById({
      id: installation.id!,
      data: { invoicedUntil: data.periodEnd },
      props: { isRoot: true },
    });

    installation.invoicedUntil = data.periodEnd;
  }

  // This month's totals so far, for the team to see in Vercel.
  private static async sendRunningTotals(
    installation: VercelMarketplaceInstallation,
    now: Date,
  ): Promise<void> {
    const monthStart: Date = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const uninvoicedStart: Date =
      VercelMarketplaceBilling.getUninvoicedStart(installation);

    // This month only: the month before may still be waiting for its invoice.
    const periodStart: Date =
      uninvoicedStart.getTime() > monthStart.getTime()
        ? uninvoicedStart
        : monthStart;
    const periodEnd: Date = VercelMarketplaceBilling.getStartOfNextMonth(now);

    // A team that has added no resource yet has nothing to show.
    if (
      (
        await VercelMarketplaceResources.listPurchases(
          installation.installationId!,
        )
      ).length === 0
    ) {
      return;
    }

    const usage: Array<ResourceUsage> =
      await VercelMarketplaceBilling.getResourceUsage(installation, {
        periodStart: periodStart,
        periodEnd: now,
      });

    await VercelMarketplaceBilling.getApi().submitBillingData(
      VercelMarketplaceBilling.getCredentials(installation),
      {
        timestamp: OneUptimeDate.toString(now),
        eod: OneUptimeDate.toString(now),
        period: {
          start: OneUptimeDate.toString(periodStart),
          end: OneUptimeDate.toString(periodEnd),
        },
        billing: VercelMarketplaceBilling.buildItems(usage, {
          periodStart: periodStart,
          periodEnd: periodEnd,
        }),
        usage: VercelMarketplaceBilling.buildUsage(usage, now),
      },
    );

    await VercelMarketplaceInstallationService.updateOneById({
      id: installation.id!,
      data: { billingDataSentAt: now },
      props: { isRoot: true },
    });
  }

  /*
   * Each resource's reports that end in the period, by the plan each was
   * priced on. Only reports written down as accepted: the Vercel adapter
   * accepts a report as soon as it is written.
   */
  public static async getResourceUsage(
    installation: VercelMarketplaceInstallation,
    period: { periodStart: Date; periodEnd: Date },
  ): Promise<Array<ResourceUsage>> {
    const purchases: Array<MarketplaceSubscription> =
      await VercelMarketplaceResources.listPurchases(
        installation.installationId!,
      );

    const usage: Array<ResourceUsage> = [];

    for (const purchase of purchases) {
      const reports: Array<MarketplaceUsageReport> =
        await MarketplaceUsageReportService.findBy({
          query: {
            marketplaceSubscriptionId: purchase.id!,
            status: MarketplaceUsageReportStatus.Reported,
            // A report belongs to the period its usage ends in: (start, end].
            periodEnd: QueryHelper.greaterThan(period.periodStart),
          },
          select: {
            _id: true,
            periodStart: true,
            periodEnd: true,
            quantity: true,
            breakdown: true,
          },
          sort: { periodEnd: SortOrder.Ascending },
          skip: 0,
          limit: LIMIT_MAX,
          props: { isRoot: true },
        });

      usage.push(
        ...VercelMarketplaceBilling.groupByPlan(
          purchase,
          reports.filter((report: MarketplaceUsageReport): boolean => {
            return (
              report.periodEnd!.getTime() > period.periodStart.getTime() &&
              report.periodEnd!.getTime() <= period.periodEnd.getTime()
            );
          }),
        ),
      );
    }

    return usage;
  }

  public static groupByPlan(
    purchase: MarketplaceSubscription,
    reports: Array<MarketplaceUsageReport>,
  ): Array<ResourceUsage> {
    const byPlan: Map<string, ResourceUsage> = new Map();

    for (const report of reports) {
      if (!report.quantity || report.quantity <= 0) {
        continue;
      }

      const planId: unknown = report.breakdown?.["planId"];
      const vercelPlanId: string =
        VercelMarketplacePlans.getVercelPlanIdOfPlanId(
          typeof planId === "string" ? planId : null,
        ) ||
        purchase.externalPlanId ||
        VercelMarketplaceBilling.getFallbackPlanId();

      let entry: ResourceUsage | undefined = byPlan.get(vercelPlanId);

      if (!entry) {
        entry = {
          purchase: purchase,
          vercelPlanId: vercelPlanId,
          plan: VercelMarketplacePlans.findPlan(vercelPlanId),
          reports: [],
        };
        byPlan.set(vercelPlanId, entry);
      }

      entry.reports.push(report);
    }

    return Array.from(byPlan.values());
  }

  /*
   * The invoice lines: per resource and plan, one line per kind of charge,
   * in usage units. The units billed are the reports' own - each hour's
   * whole cents, with the fraction carried to the next hour - and are
   * shared out to the kinds of charge by what each cost, so the lines add
   * up to exactly what the reports billed.
   */
  public static buildItems(
    usage: Array<ResourceUsage>,
    period: { periodStart: Date; periodEnd: Date },
  ): Array<VercelBillingItem> {
    const items: Array<VercelBillingItem> = [];

    for (const entry of usage) {
      const units: Record<ChargeKind, number> =
        VercelMarketplaceBilling.shareUnits(entry.reports);

      const first: MarketplaceUsageReport | undefined = entry.reports[0];
      const last: MarketplaceUsageReport | undefined =
        entry.reports[entry.reports.length - 1];

      const start: Date | undefined =
        first?.periodStart &&
        first.periodStart.getTime() > period.periodStart.getTime()
          ? first.periodStart
          : undefined;
      const end: Date | undefined =
        last?.periodEnd && last.periodEnd.getTime() < period.periodEnd.getTime()
          ? last.periodEnd
          : undefined;

      const resourceName: string = VercelResource.readDetails(
        entry.purchase,
      ).name;

      for (const kind of CHARGE_KINDS) {
        if (units[kind] <= 0) {
          continue;
        }

        items.push({
          billingPlanId: entry.vercelPlanId,
          resourceId: entry.purchase.externalSubscriptionId!,
          ...(start ? { start: OneUptimeDate.toString(start) } : {}),
          ...(end ? { end: OneUptimeDate.toString(end) } : {}),
          name: VercelMarketplaceBilling.getItemName(kind, entry.plan),
          details: `${resourceName}: ${VercelMarketplaceBilling.getItemDetails(kind, entry.plan)}`,
          price: "0.01",
          quantity: units[kind],
          units: "usage units ($0.01)",
          total: VercelMarketplaceBilling.unitsToUSD(units[kind]),
        });
      }
    }

    return items;
  }

  /*
   * The latest count of people and active monitors of each resource, and
   * its telemetry spend today and this period, for the usage Vercel shows
   * on the resource's page.
   */
  public static buildUsage(
    usage: Array<ResourceUsage>,
    now: Date,
  ): Array<VercelUsageItem> {
    const byResource: Map<string, Array<MarketplaceUsageReport>> = new Map();

    for (const entry of usage) {
      const resourceId: string = entry.purchase.externalSubscriptionId!;
      byResource.set(resourceId, [
        ...(byResource.get(resourceId) || []),
        ...entry.reports,
      ]);
    }

    const dayStart: Date = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    const items: Array<VercelUsageItem> = [];

    for (const [resourceId, reports] of byResource.entries()) {
      const sorted: Array<MarketplaceUsageReport> = [...reports].sort(
        (a: MarketplaceUsageReport, b: MarketplaceUsageReport): number => {
          return a.periodEnd!.getTime() - b.periodEnd!.getTime();
        },
      );
      const latest: JSONObject = sorted[sorted.length - 1]?.breakdown || {};

      let telemetryToday: number = 0;
      let telemetryInPeriod: number = 0;

      for (const report of sorted) {
        const telemetry: number = VercelMarketplaceBilling.readUSD(
          report.breakdown,
          "telemetryInUSD",
        );
        telemetryInPeriod += telemetry;

        if (report.periodEnd!.getTime() > dayStart.getTime()) {
          telemetryToday += telemetry;
        }
      }

      const seats: number = VercelMarketplaceBilling.readCount(latest, "seats");
      const monitors: number = VercelMarketplaceBilling.readCount(
        latest,
        "activeMonitors",
      );

      items.push(
        {
          resourceId: resourceId,
          name: "Users",
          type: "total",
          units: "users",
          dayValue: seats,
          periodValue: seats,
        },
        {
          resourceId: resourceId,
          name: "Active monitors",
          type: "total",
          units: "monitors",
          dayValue: monitors,
          periodValue: monitors,
        },
        {
          resourceId: resourceId,
          name: "Telemetry",
          type: "interval",
          units: "USD",
          dayValue: VercelMarketplaceBilling.roundToCents(telemetryToday),
          periodValue: VercelMarketplaceBilling.roundToCents(telemetryInPeriod),
        },
      );
    }

    return items;
  }

  /*
   * Share the reports' units out to the kinds of charge they were made of,
   * by largest remainder: each kind gets the whole cents of what it cost,
   * and the cents left over - from the fractions each hour carried to the
   * next - go to the kinds with the largest fractions. The shares always
   * add up to the units the reports billed.
   */
  public static shareUnits(
    reports: Array<MarketplaceUsageReport>,
  ): Record<ChargeKind, number> {
    const micros: Record<ChargeKind, number> = {
      users: 0,
      monitors: 0,
      telemetry: 0,
      topUps: 0,
    };

    let billedUnits: number = 0;

    for (const report of reports) {
      billedUnits += Math.max(0, Math.round(report.quantity || 0));
      micros.users += VercelMarketplaceBilling.toMicros(
        report.breakdown,
        "seatsInUSD",
      );
      micros.monitors += VercelMarketplaceBilling.toMicros(
        report.breakdown,
        "activeMonitorsInUSD",
      );
      micros.telemetry += VercelMarketplaceBilling.toMicros(
        report.breakdown,
        "telemetryInUSD",
      );
      micros.topUps += VercelMarketplaceBilling.toMicros(
        report.breakdown,
        "chargesInUSD",
      );
    }

    const units: Record<ChargeKind, number> = {
      users: Math.floor(micros.users / USAGE_UNIT_IN_MICROS),
      monitors: Math.floor(micros.monitors / USAGE_UNIT_IN_MICROS),
      telemetry: Math.floor(micros.telemetry / USAGE_UNIT_IN_MICROS),
      topUps: Math.floor(micros.topUps / USAGE_UNIT_IN_MICROS),
    };

    let left: number =
      billedUnits -
      CHARGE_KINDS.reduce((sum: number, kind: ChargeKind) => {
        return sum + units[kind];
      }, 0);

    const byRemainder: Array<ChargeKind> = [...CHARGE_KINDS].sort(
      (a: ChargeKind, b: ChargeKind): number => {
        return (
          (micros[b] % USAGE_UNIT_IN_MICROS) -
          (micros[a] % USAGE_UNIT_IN_MICROS)
        );
      },
    );

    const byCost: Array<ChargeKind> = [...CHARGE_KINDS].sort(
      (a: ChargeKind, b: ChargeKind): number => {
        return micros[b] - micros[a];
      },
    );

    for (const kind of byRemainder) {
      if (left <= 0) {
        break;
      }

      if (micros[kind] % USAGE_UNIT_IN_MICROS > 0) {
        units[kind] += 1;
        left -= 1;
      }
    }

    // Whatever is still left over (a fraction carried in from an earlier period) goes to the largest charge.
    if (left > 0) {
      units[byCost[0]!] += left;
    }

    // More whole cents than were billed: taken back from the largest charges.
    while (left < 0) {
      const largest: ChargeKind | undefined = [...CHARGE_KINDS]
        .filter((kind: ChargeKind): boolean => {
          return units[kind] > 0;
        })
        .sort((a: ChargeKind, b: ChargeKind): number => {
          return units[b] - units[a];
        })[0];

      if (!largest) {
        break;
      }

      units[largest] -= 1;
      left += 1;
    }

    return units;
  }

  private static getItemName(
    kind: ChargeKind,
    plan: SubscriptionPlan | undefined,
  ): string {
    switch (kind) {
      case "users":
        return plan ? `Users (${plan.getName()} plan)` : "Users";
      case "monitors":
        return "Active monitors";
      case "telemetry":
        return "Telemetry";
      case "topUps":
        return "Balance top-ups";
    }
  }

  private static getItemDetails(
    kind: ChargeKind,
    plan: SubscriptionPlan | undefined,
  ): string {
    switch (kind) {
      case "users": {
        const price: number = plan?.getMonthlySubscriptionAmountInUSD() || 0;
        return `${formatPriceInUSD(price)} per user per month, by the hour`;
      }
      case "monitors":
        return `${formatPriceInUSD(ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH)} per active monitor per month, by the hour`;
      case "telemetry":
        return "logs, traces, metrics and session replay, by the GB";
      case "topUps":
        return "SMS, call and AI credit balance top-ups";
    }
  }

  private static getFallbackPlanId(): string {
    const cheapest: SubscriptionPlan | undefined =
      VercelMarketplacePlans.getSellablePlans()[0];
    return cheapest ? VercelMarketplacePlans.getVercelPlanId(cheapest) : "free";
  }

  /*
   * Where the next invoice starts: the end of the last one, or - for an
   * installation never invoiced - when it was made (its month, as Vercel's
   * periods are months, but never before the installation existed).
   */
  public static getUninvoicedStart(
    installation: VercelMarketplaceInstallation,
  ): Date {
    if (installation.invoicedUntil) {
      return installation.invoicedUntil;
    }

    return installation.createdAt || OneUptimeDate.getCurrentDate();
  }

  public static getStartOfNextMonth(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  }

  public static getMonthKey(date: Date): string {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  public static unitsToUSD(units: number): string {
    return (Math.round(units) / 100).toFixed(2);
  }

  private static sumItems(items: Array<VercelBillingItem>): string {
    const cents: number = items.reduce(
      (sum: number, item: VercelBillingItem): number => {
        return sum + Math.round(Number(item.total) * 100);
      },
      0,
    );
    return (cents / 100).toFixed(2);
  }

  private static toMicros(
    breakdown: JSONObject | undefined,
    key: string,
  ): number {
    return Math.round(
      VercelMarketplaceBilling.readUSD(breakdown, key) * MICROS_PER_USD,
    );
  }

  private static readUSD(
    breakdown: JSONObject | undefined,
    key: string,
  ): number {
    const value: unknown = breakdown?.[key];
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? value
      : 0;
  }

  private static readCount(breakdown: JSONObject, key: string): number {
    const value: unknown = breakdown[key];
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? Math.round(value)
      : 0;
  }

  private static roundToCents(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private static getCredentials(
    installation: VercelMarketplaceInstallation,
  ): VercelInstallationCredentials {
    if (!installation.accessToken) {
      throw new MarketplaceApiError({
        message: `Vercel installation ${installation.installationId} has no access token.`,
        status: null,
        isRetryable: false,
      });
    }

    return {
      installationId: installation.installationId!,
      accessToken: installation.accessToken,
    };
  }

  private static async markDeleted(
    installation: VercelMarketplaceInstallation,
  ): Promise<void> {
    await VercelMarketplaceInstallationService.updateOneById({
      id: installation.id!,
      data: {
        status: VercelInstallationStatus.Deleted,
        accessToken: null,
        lastBillingError: null,
      } as QueryDeepPartialEntity<VercelMarketplaceInstallation>,
      props: { isRoot: true },
    });
  }

  private static async recordError(
    installation: VercelMarketplaceInstallation,
    err: unknown,
  ): Promise<void> {
    const message: string | null = err
      ? (err as Error).message?.substring(0, 480) || "Unknown error."
      : null;

    if (!message && !installation.lastBillingError) {
      return;
    }

    await VercelMarketplaceInstallationService.updateOneById({
      id: installation.id!,
      data: {
        lastBillingError: message,
      } as QueryDeepPartialEntity<VercelMarketplaceInstallation>,
      props: { isRoot: true },
    });
  }

  private static async underLock(
    installation: VercelMarketplaceInstallation,
    work: (current: VercelMarketplaceInstallation) => Promise<void>,
  ): Promise<void> {
    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: installation.installationId!,
        namespace: BILLING_LOCK_NAMESPACE,
        lockTimeout: 10 * 60_000,
        acquireTimeout: 30_000,
      });
    } catch {
      logger.debug(
        `Vercel billing of installation ${installation.installationId} is already running.`,
      );
      return;
    }

    try {
      const current: VercelMarketplaceInstallation | null =
        await VercelMarketplaceInstallationService.findByInstallationId(
          installation.installationId!,
        );

      if (current) {
        await work(current);
      }
    } finally {
      try {
        await Semaphore.release(mutex);
      } catch (err) {
        logger.error(err);
      }
    }
  }
}
