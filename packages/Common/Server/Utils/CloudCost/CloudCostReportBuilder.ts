import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudBudget from "../../../Models/DatabaseModels/CloudBudget";
import CloudCostRecommendation from "../../../Models/DatabaseModels/CloudCostRecommendation";
import CloudCostReport from "../../../Models/DatabaseModels/CloudCostReport";
import URL from "../../../Types/API/URL";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import QueryHelper from "../../Types/Database/QueryHelper";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  CloudAccountCostSummary,
  CloudAccountSavingsSummary,
  CloudCostAnomaly,
  CloudCostState,
  addUtcDays,
  readCloudAccountCostSummary,
  readCloudAccountSavingsSummary,
  startOfUtcMonth,
  toCloudCostDay,
  totalCloudSavings,
  getCloudSavingActionText,
} from "../../../Types/Cloud/CloudCost";
import {
  CloudCostAllocationGroupResult,
  CloudCostAllocationInterval,
  CloudCostAllocationResult,
  CloudCostAllocationShare,
  CloudCostAllocationWindow,
} from "../../../Types/Cloud/CloudCostAllocation";
import {
  CLOUD_COST_ANOMALY_BASELINE_DAYS,
  findCloudCostDayAnomalies,
} from "../../../Types/Cloud/CloudCostAnomaly";
import {
  CloudCostBasis,
  isCloudCostBasis,
} from "../../../Types/Cloud/CloudCostBasis";
import {
  CloudCostBreakdownComparison,
  CloudCostBreakdownReader,
  CloudCostComparedShare,
  CloudCostScope,
  buildCloudCostAggregateBy,
  compareCloudCostBreakdowns,
  getCloudCostMovers,
  readCloudCostBreakdownComparison,
  toCloudCostGroupComparison,
} from "../../../Types/Cloud/CloudCostBreakdowns";
import {
  CloudCommitmentTotals,
  getCloudCommitmentCoveragePercent,
  getCloudCommitmentUtilizationPercent,
  totalCloudCommitments,
} from "../../../Types/Cloud/CloudCommitments";
import {
  getCloudCostFileName,
  getCloudCostGroupNames,
  toCloudCostAllocationCsv,
  toCloudCostComparisonCsv,
} from "../../../Types/Cloud/CloudCostCsv";
import {
  CLOUD_COST_REPORT_GROUPS,
  CLOUD_COST_REPORT_MOVERS,
  CLOUD_COST_REPORT_SAVINGS,
  CLOUD_COST_REPORT_UNUSUAL_DAYS,
  CloudCostReportBudgetLine,
  CloudCostReportContent,
  CloudCostReportLine,
  CloudCostReportPeriod,
  CloudCostReportSaving,
  CloudCostReportScope,
  CloudCostReportSection,
  CloudCostReportUnusualDay,
  getCloudCostReportPreviousWindow,
  getCloudCostReportWindow,
  toCloudCostReportDays,
} from "../../../Types/Cloud/CloudCostReport";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import CloudBudgetService from "../../Services/CloudBudgetService";
import CloudCostRecommendationService from "../../Services/CloudCostRecommendationService";
import CloudCostSettingService from "../../Services/CloudCostSettingService";
import CaptureSpan from "../Telemetry/CaptureSpan";
import CloudCostAllocation from "./CloudCostAllocation";
import {
  getCloudCostAccountsCurrency,
  getCloudCostServerReader,
  readCloudCostAccounts,
} from "./CloudCostServerReader";

/*
 * WHAT A SCHEDULED COST REPORT SAYS, READ AS ITS READER MAY READ IT (#11009).
 *
 * A report is worked out for the props of whoever it goes to - a person's
 * own, or for addresses outside the project and channels the Cloud admin's
 * who set them (CloudCostReportSender) - so it never holds more than they
 * may read: a grant limited by labels reads the accounts it reaches.
 *
 * Every figure is the Costs page's own: the breakdowns are the ones Costs
 * draws (CloudCostBreakdowns), a cost view's and a group's are its
 * allocation (CloudCostAllocation), each in the report's currency and on
 * its cost basis, over the report's days (getCloudCostReportWindow). What
 * a report adds:
 *
 *   - the total against the period before, and the services (and a view's
 *     groups) that rose and fell the most;
 *   - each budget it counts towards: its month through the report's last
 *     day, on the budget's own basis, as the budget is watched;
 *   - the unusual days of the period, by the rule budgets alert on
 *     (CloudCostAnomaly), against the 14 days before each;
 *   - the largest savings waiting, and how much of the spend commitments
 *     cover - for every account or one; a group's or a view's section
 *     reports what it is charged.
 */

// What a report is worked out for.
export interface CloudCostReportBuildRequest {
  report: CloudCostReport;
  projectId: ObjectID;
  projectName: string;
  // The props of whoever the figures are for.
  props: DatabaseCommonInteractionProps;
  // When it is sent: what its days are worked out from.
  at: Date;
  // A cost view's group whose section this is, alone.
  groupId?: ObjectID | undefined;
  // Where the Dashboard is: "https://oneuptime.example/dashboard".
  dashboardUrl: URL;
}

// The smallest change a mover shows: a cent's worth, or half a percent of the total.
function getMoverMinimum(total: number): number {
  return Math.max(0.01, Math.abs(total) * 0.005);
}

function endOfDay(day: Date): Date {
  return new Date(addUtcDays(day, 1).getTime() - 1);
}

function toLines(
  shares: Array<CloudCostComparedShare>,
  nameOf: (key: string) => string,
): Array<CloudCostReportLine> {
  return shares.map((share: CloudCostComparedShare): CloudCostReportLine => {
    return {
      key: share.key,
      name: nameOf(share.key),
      amount: share.amount,
      previousAmount: share.previousAmount,
    };
  });
}

function serviceName(key: string): string {
  return key || "Unnamed service";
}

export class CloudCostReportBuilder {
  // The days a report sent at `at` covers, and the days before.
  public static getWindows(
    report: CloudCostReport,
    at: Date,
  ): {
    window: CloudCostAllocationWindow;
    previous: CloudCostAllocationWindow;
  } {
    const window: CloudCostAllocationWindow = getCloudCostReportWindow({
      period: report.period || CloudCostReportPeriod.LastWeek,
      at,
      timezone: report.timezone?.toString(),
    });

    return { window, previous: getCloudCostReportPreviousWindow(window) };
  }

  /*
   * Where the button opens: Costs on exactly the report's days and basis -
   * an account's own Costs, or Costs by the view's groups.
   */
  public static getCostsUrl(data: {
    dashboardUrl: URL;
    projectId: ObjectID;
    report: CloudCostReport;
    window: CloudCostAllocationWindow;
    basis: CloudCostBasis;
    viewId?: ObjectID | undefined;
  }): string {
    const days: { start: string; lastDay: string } = toCloudCostReportDays(
      data.window,
    );
    const base: string = data.dashboardUrl.toString().replace(/\/+$/, "");
    const path: string =
      data.report.scope === CloudCostReportScope.Account &&
      data.report.cloudAccountId
        ? `/${data.projectId.toString()}/cloud/accounts/${data.report.cloudAccountId.toString()}/costs`
        : `/${data.projectId.toString()}/cloud/costs`;
    const query: URLSearchParams = new URLSearchParams({
      start: days.start,
      end: days.lastDay,
      basis: data.basis,
    });

    if (data.viewId) {
      query.set("by", "group");
      query.set("view", data.viewId.toString());
    }

    return `${base}${path}?${query.toString()}`;
  }

  @CaptureSpan()
  public static async build(
    request: CloudCostReportBuildRequest,
  ): Promise<CloudCostReportContent> {
    const report: CloudCostReport = request.report;
    const scope: CloudCostReportScope =
      report.scope || CloudCostReportScope.AllAccounts;
    const { window, previous } = this.getWindows(report, request.at);
    const basis: CloudCostBasis = isCloudCostBasis(report.costBasis)
      ? report.costBasis
      : await CloudCostSettingService.getCostBasisOfProject(request.projectId);
    const reader: CloudCostBreakdownReader = getCloudCostServerReader({
      projectId: request.projectId,
      props: request.props,
      now: request.at,
    });

    // The accounts this reader may read, and those the report is over.
    const accounts: Array<CloudAccount> = await readCloudCostAccounts({
      projectId: request.projectId,
      props: request.props,
    });
    const inScope: Array<CloudAccount> =
      scope === CloudCostReportScope.Account
        ? accounts.filter((account: CloudAccount): boolean => {
            return account.id?.toString() === report.cloudAccountId?.toString();
          })
        : accounts;

    if (scope === CloudCostReportScope.Account && inScope.length === 0) {
      throw new BadDataException(
        "The report's account was not found. It may have been deleted, or the person it is read for may not read it.",
      );
    }

    const currency: string = this.getCurrency(inScope, basis);
    const days: { start: string; lastDay: string } =
      toCloudCostReportDays(window);
    const previousDays: { start: string; lastDay: string } =
      toCloudCostReportDays(previous);
    const otherCurrencies: Array<{ name: string; currency: string }> =
      this.getOtherCurrencies(inScope, currency);

    const scopeOfCosts: CloudCostScope = {
      projectId: request.projectId,
      cloudAccountIds:
        scope === CloudCostReportScope.Account && report.cloudAccountId
          ? [report.cloudAccountId]
          : undefined,
      currency,
      startDate: window.start,
      endDate: endOfDay(window.lastDay),
      basis,
    };

    let section: CloudCostReportSection;
    let csv: string;
    let viewId: ObjectID | undefined = undefined;
    let viewName: string | undefined = undefined;

    if (
      scope === CloudCostReportScope.CostGroup ||
      (scope === CloudCostReportScope.CostView && request.groupId)
    ) {
      const groupId: ObjectID | undefined =
        request.groupId || report.cloudCostGroupId;

      if (!groupId) {
        throw new BadDataException("The report names no cost group.");
      }

      const group: {
        section: CloudCostReportSection;
        viewId: string;
        viewName: string;
        csv: string;
      } = await this.buildGroupSection({
        projectId: request.projectId,
        props: request.props,
        groupId,
        window,
        previous,
        currency,
        basis,
        at: request.at,
      });

      section = group.section;
      csv = group.csv;
      viewId = new ObjectID(group.viewId);
      viewName = group.viewName;
    } else {
      const services: CloudCostBreakdownComparison =
        await readCloudCostBreakdownComparison(reader, {
          scope: scopeOfCosts,
          previousStartDate: previous.start,
          previousEndDate: endOfDay(previous.lastDay),
          dimension: "service",
        });
      const movers: {
        rises: Array<CloudCostComparedShare>;
        falls: Array<CloudCostComparedShare>;
      } = getCloudCostMovers({
        comparison: services,
        count: CLOUD_COST_REPORT_MOVERS,
        minimum: getMoverMinimum(services.total),
      });

      section = {
        kind: "summary",
        name:
          scope === CloudCostReportScope.Account
            ? inScope[0]?.name || inScope[0]?.accountId || ""
            : "",
        total: services.total,
        previousTotal: services.previousTotal,
        rises: toLines(movers.rises, serviceName),
        falls: toLines(movers.falls, serviceName),
        budgets: await this.readBudgets({
          projectId: request.projectId,
          props: request.props,
          reader,
          cloudAccountId:
            scope === CloudCostReportScope.Account
              ? report.cloudAccountId
              : undefined,
          window,
          currency,
          reportBasis: basis,
        }),
        unusualDays: await this.readUnusualDays({
          reader,
          scope: scopeOfCosts,
          window,
          accounts: inScope,
        }),
        savings: await this.readSavings({
          projectId: request.projectId,
          props: request.props,
          accounts: inScope,
          currency,
        }),
        commitments: this.getCommitments(inScope, currency),
      };

      csv = toCloudCostComparisonCsv({
        comparison: services,
        context: {
          dimension: "service",
          start: days.start,
          lastDay: days.lastDay,
          previousStart: previousDays.start,
          previousLastDay: previousDays.lastDay,
          currency,
          basis,
        },
      });

      // A cost view: its groups and what no group takes, beside the services.
      if (scope === CloudCostReportScope.CostView) {
        if (!report.cloudCostViewId) {
          throw new BadDataException("The report names no cost view.");
        }

        viewId = report.cloudCostViewId;

        const allocation: CloudCostAllocationResult =
          await reader.readAllocation({
            viewId: report.cloudCostViewId,
            startDate: window.start,
            endDate: endOfDay(window.lastDay),
            currency,
            basis,
          });
        const groups: CloudCostBreakdownComparison =
          toCloudCostGroupComparison(allocation);
        const names: Map<string, string> = getCloudCostGroupNames(
          allocation.groups,
        );

        viewName = allocation.viewName;
        section.name = allocation.viewName;
        // What the view charges: the cloud's spend and its custom line items.
        section.total = allocation.total;
        section.previousTotal = allocation.previousTotal || 0;
        section.groups = toLines(
          groups.shares.slice(0, CLOUD_COST_REPORT_GROUPS),
          (key: string): string => {
            return names.get(key) || key;
          },
        );
        section.unallocated = {
          amount: allocation.unallocated.total,
          previousAmount: allocation.unallocated.previousTotal || 0,
        };
        csv = toCloudCostAllocationCsv(allocation);
      }
    }

    const content: CloudCostReportContent = {
      reportId: report.id?.toString() || "",
      reportName: report.name || "",
      projectName: request.projectName,
      scope,
      period: report.period || CloudCostReportPeriod.LastWeek,
      start: days.start,
      lastDay: days.lastDay,
      previousStart: previousDays.start,
      previousLastDay: previousDays.lastDay,
      currency,
      basis,
      section,
      otherCurrencies,
      costsUrl: this.getCostsUrl({
        dashboardUrl: request.dashboardUrl,
        projectId: request.projectId,
        report,
        window,
        basis,
        viewId,
      }),
      csv,
      csvFileName: getCloudCostFileName({
        what: "cloud-costs",
        dimension:
          scope === CloudCostReportScope.CostView && !request.groupId
            ? "group"
            : "service",
        viewName,
        accountName:
          scope === CloudCostReportScope.Account
            ? inScope[0]?.name || undefined
            : section.kind === "group"
              ? section.name
              : undefined,
        basis,
        start: days.start,
        lastDay: days.lastDay,
      }),
      readAt: request.at.toISOString(),
    };

    return content;
  }

  /*
   * The currency the figures are in: the one most of the accounts are
   * billed in, as Costs totals them - an account's own for one account.
   */
  public static getCurrency(
    accounts: Array<CloudAccount>,
    _basis: CloudCostBasis,
  ): string {
    return getCloudCostAccountsCurrency(accounts);
  }

  // The accounts left out of the figures, billed in another currency.
  public static getOtherCurrencies(
    accounts: Array<CloudAccount>,
    currency: string,
  ): Array<{ name: string; currency: string }> {
    const others: Array<{ name: string; currency: string }> = [];

    for (const account of accounts) {
      const summary: CloudAccountCostSummary | null =
        readCloudAccountCostSummary(account.costSummary);

      if (
        summary?.currency &&
        summary.state === CloudCostState.Reading &&
        summary.currency.toUpperCase() !== currency.toUpperCase()
      ) {
        others.push({
          name: account.name || account.accountId || "",
          currency: summary.currency.toUpperCase(),
        });
      }
    }

    return others;
  }

  // What the scope's spend came to over some days, on a basis.
  private static async readSpend(data: {
    reader: CloudCostBreakdownReader;
    scope: CloudCostScope;
  }): Promise<number> {
    const result: AggregatedResult = await data.reader.aggregate(
      buildCloudCostAggregateBy({
        scope: data.scope,
        interval: AggregationInterval.Total,
      }),
    );

    return result.data.reduce((sum: number, item: AggregatedModel): number => {
      return sum + (Number(item.value) || 0);
    }, 0);
  }

  /*
   * The budgets the report's spend counts towards - every account's, or
   * the account's - in its currency, each against its month through the
   * report's last day, on the budget's own basis (its own, else the
   * project's), as the budget is watched.
   */
  private static async readBudgets(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    reader: CloudCostBreakdownReader;
    cloudAccountId?: ObjectID | undefined;
    window: CloudCostAllocationWindow;
    currency: string;
    reportBasis: CloudCostBasis;
  }): Promise<Array<CloudCostReportBudgetLine>> {
    const budgets: Array<CloudBudget> = await CloudBudgetService.findBy({
      query: {
        projectId: data.projectId,
        isEnabled: true,
        currency: data.currency,
        cloudAccountId: data.cloudAccountId
          ? data.cloudAccountId
          : QueryHelper.isNull(),
      },
      select: {
        _id: true,
        name: true,
        monthlyAmount: true,
        costBasis: true,
      },
      sort: { name: SortOrder.Ascending },
      skip: 0,
      limit: 10,
      props: data.props,
    });

    if (budgets.length === 0) {
      return [];
    }

    const projectBasis: CloudCostBasis =
      await CloudCostSettingService.getCostBasisOfProject(data.projectId);
    const monthStart: Date = startOfUtcMonth(data.window.lastDay);
    const spentByBasis: Map<string, number> = new Map();
    const lines: Array<CloudCostReportBudgetLine> = [];

    for (const budget of budgets) {
      const basis: CloudCostBasis = isCloudCostBasis(budget.costBasis)
        ? budget.costBasis
        : projectBasis;

      if (!spentByBasis.has(basis)) {
        spentByBasis.set(
          basis,
          await this.readSpend({
            reader: data.reader,
            scope: {
              projectId: data.projectId,
              cloudAccountIds: data.cloudAccountId
                ? [data.cloudAccountId]
                : undefined,
              currency: data.currency,
              startDate: monthStart,
              endDate: endOfDay(data.window.lastDay),
              basis,
            },
          }),
        );
      }

      lines.push({
        name: budget.name || "",
        amount: Number(budget.monthlyAmount) || 0,
        spent: spentByBasis.get(basis) || 0,
        month: toCloudCostDay(monthStart).slice(0, 7),
        basis,
      });
    }

    return lines;
  }

  /*
   * The period's unusual days, by the rule budgets alert on: each day of
   * it held to the 14 days before, account by account, the largest
   * increases first.
   */
  private static async readUnusualDays(data: {
    reader: CloudCostBreakdownReader;
    scope: CloudCostScope;
    window: CloudCostAllocationWindow;
    accounts: Array<CloudAccount>;
  }): Promise<Array<CloudCostReportUnusualDay>> {
    const readStart: Date = addUtcDays(
      data.window.start,
      -CLOUD_COST_ANOMALY_BASELINE_DAYS,
    );
    const aggregateBy: ReturnType<typeof buildCloudCostAggregateBy> =
      buildCloudCostAggregateBy({
        scope: { ...data.scope, startDate: readStart },
        interval: AggregationInterval.Day,
        groupBy: { cloudAccountId: true, service: true } as never,
      });
    const result: AggregatedResult = await data.reader.aggregate(aggregateBy);
    const byAccount: Map<string, Map<string, Map<string, number>>> = new Map();

    for (const item of result.data as unknown as Array<
      Record<string, unknown>
    >) {
      const accountId: string = String(item["cloudAccountId"] ?? "");
      const service: string = String(item["service"] ?? "");
      const day: string = new Date(String(item["timestamp"]))
        .toISOString()
        .slice(0, 10);
      const amount: number = Number(item["value"]) || 0;
      let days: Map<string, Map<string, number>> | undefined =
        byAccount.get(accountId);

      if (!days) {
        days = new Map();
        byAccount.set(accountId, days);
      }

      let services: Map<string, number> | undefined = days.get(day);

      if (!services) {
        services = new Map();
        days.set(day, services);
      }

      services.set(service, (services.get(service) || 0) + amount);
    }

    const names: Map<string, string> = new Map(
      data.accounts.map((account: CloudAccount): [string, string] => {
        return [
          account.id?.toString() || "",
          account.name || account.accountId || "",
        ];
      }),
    );
    const found: Array<CloudCostReportUnusualDay> = [];

    for (const [accountId, dailyServiceTotals] of byAccount) {
      for (
        let day: Date = data.window.start;
        day.getTime() <= data.window.lastDay.getTime();
        day = addUtcDays(day, 1)
      ) {
        const anomalies: Array<CloudCostAnomaly> = findCloudCostDayAnomalies({
          dailyServiceTotals,
          day: toCloudCostDay(day),
        });

        for (const anomaly of anomalies) {
          found.push({
            day: anomaly.day,
            accountName: names.get(accountId) || "",
            service: anomaly.service,
            amount: anomaly.amount,
            usual: anomaly.usual,
          });
        }
      }
    }

    return found
      .sort(
        (
          a: CloudCostReportUnusualDay,
          b: CloudCostReportUnusualDay,
        ): number => {
          return (
            b.amount - b.usual - (a.amount - a.usual) ||
            a.day.localeCompare(b.day)
          );
        },
      )
      .slice(0, CLOUD_COST_REPORT_UNUSUAL_DAYS);
  }

  /*
   * The savings waiting in the accounts: how many and what they save a
   * month, as Savings adds them up, and the largest of them.
   */
  private static async readSavings(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    accounts: Array<CloudAccount>;
    currency: string;
  }): Promise<CloudCostReportSection["savings"]> {
    const accountIds: Array<ObjectID> = data.accounts
      .map((account: CloudAccount): ObjectID | undefined => {
        return account.id || undefined;
      })
      .filter((id: ObjectID | undefined): boolean => {
        return Boolean(id);
      }) as Array<ObjectID>;

    if (accountIds.length === 0) {
      return undefined;
    }

    const totals: { count: number; monthlySavings: number; currency: string } =
      totalCloudSavings({
        summaries: data.accounts.map(
          (account: CloudAccount): CloudAccountSavingsSummary | null => {
            return readCloudAccountSavingsSummary(account.savingsSummary);
          },
        ),
        currency: data.currency,
      });

    if (totals.count === 0) {
      return undefined;
    }

    const recommendations: Array<CloudCostRecommendation> =
      await CloudCostRecommendationService.findBy({
        query: {
          projectId: data.projectId,
          cloudAccountId: new Includes(accountIds),
          currency: data.currency,
        },
        select: {
          _id: true,
          action: true,
          kind: true,
          resourceName: true,
          resourceId: true,
          monthlySavings: true,
          cloudAccountId: true,
        },
        sort: { monthlySavings: SortOrder.Descending },
        skip: 0,
        limit: CLOUD_COST_REPORT_SAVINGS,
        props: data.props,
      });
    const names: Map<string, string> = new Map(
      data.accounts.map((account: CloudAccount): [string, string] => {
        return [
          account.id?.toString() || "",
          account.name || account.accountId || "",
        ];
      }),
    );

    return {
      count: totals.count,
      monthlySavings:
        totals.currency.toUpperCase() === data.currency.toUpperCase()
          ? totals.monthlySavings
          : 0,
      top: recommendations.map(
        (recommendation: CloudCostRecommendation): CloudCostReportSaving => {
          return {
            action: getCloudSavingActionText({
              action: recommendation.action,
              kind: recommendation.kind,
              translateText: (text: string): string => {
                return text;
              },
            }),
            resourceName:
              recommendation.resourceName || recommendation.resourceId || "",
            accountName:
              names.get(recommendation.cloudAccountId?.toString() || "") || "",
            monthlySavings: Number(recommendation.monthlySavings) || 0,
          };
        },
      ),
    };
  }

  // How much of the accounts' spend commitments covered, and how much was used.
  public static getCommitments(
    accounts: Array<CloudAccount>,
    currency: string,
  ): CloudCostReportSection["commitments"] {
    const totals: CloudCommitmentTotals = totalCloudCommitments({
      summaries: accounts.map((account: CloudAccount) => {
        return (
          readCloudAccountSavingsSummary(account.savingsSummary)?.commitments ||
          null
        );
      }),
      currency,
      readingState: CloudCostState.Reading,
    });

    if (totals.accountsRead === 0) {
      return undefined;
    }

    return {
      coveredPercent: getCloudCommitmentCoveragePercent(totals),
      usedPercent: getCloudCommitmentUtilizationPercent(totals),
      hasCommitments: totals.accountsWithCommitments > 0,
    };
  }

  /*
   * One cost group's section: what it is charged against the period
   * before, its services that rose and fell the most, and its unusual
   * days - read through its view's allocation, as its page is.
   */
  private static async buildGroupSection(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    groupId: ObjectID;
    window: CloudCostAllocationWindow;
    previous: CloudCostAllocationWindow;
    currency: string;
    basis: CloudCostBasis;
    at: Date;
  }): Promise<{
    section: CloudCostReportSection;
    viewId: string;
    viewName: string;
    csv: string;
  }> {
    const read: (
      start: Date,
      end: Date,
      compareWithPrevious: boolean,
    ) => Promise<{
      allocation: CloudCostAllocationResult;
      group: CloudCostAllocationGroupResult;
    }> = async (
      start: Date,
      end: Date,
      compareWithPrevious: boolean,
    ): Promise<{
      allocation: CloudCostAllocationResult;
      group: CloudCostAllocationGroupResult;
    }> => {
      return await CloudCostAllocation.readGroup({
        projectId: data.projectId,
        groupId: data.groupId,
        startDate: start,
        endDate: end,
        interval: CloudCostAllocationInterval.Day,
        currency: data.currency,
        basis: data.basis,
        compareWithPrevious,
        props: data.props,
        now: data.at,
      });
    };

    const [current, before, extended]: [
      {
        allocation: CloudCostAllocationResult;
        group: CloudCostAllocationGroupResult;
      },
      {
        allocation: CloudCostAllocationResult;
        group: CloudCostAllocationGroupResult;
      },
      {
        allocation: CloudCostAllocationResult;
        group: CloudCostAllocationGroupResult;
      },
    ] = await Promise.all([
      read(data.window.start, endOfDay(data.window.lastDay), true),
      read(data.previous.start, endOfDay(data.previous.lastDay), false),
      // Each day of the period and the 14 before it, for its unusual days.
      read(
        addUtcDays(data.window.start, -CLOUD_COST_ANOMALY_BASELINE_DAYS),
        endOfDay(data.window.lastDay),
        false,
      ),
    ]);

    const toShares: (
      shares: Array<CloudCostAllocationShare> | undefined,
    ) => Array<{ key: string; amount: number }> = (
      shares: Array<CloudCostAllocationShare> | undefined,
    ): Array<{ key: string; amount: number }> => {
      return (shares || []).map((share: CloudCostAllocationShare) => {
        return { key: share.key, amount: share.amount };
      });
    };
    const services: CloudCostBreakdownComparison = compareCloudCostBreakdowns({
      current: {
        shares: toShares(current.group.topServices),
        rest: [],
        total: current.group.total,
      },
      previous: {
        shares: toShares(before.group.topServices),
        rest: [],
        total: before.group.total,
      },
    });
    const movers: {
      rises: Array<CloudCostComparedShare>;
      falls: Array<CloudCostComparedShare>;
    } = getCloudCostMovers({
      comparison: services,
      count: CLOUD_COST_REPORT_MOVERS,
      minimum: getMoverMinimum(current.group.total),
    });

    // The group's day-by-day total, as one "service": its whole.
    const dailyServiceTotals: Map<string, Map<string, number>> = new Map();

    extended.allocation.buckets.forEach((bucket: string, index: number) => {
      dailyServiceTotals.set(
        bucket,
        new Map([[current.group.name, extended.group.series[index] || 0]]),
      );
    });

    const unusualDays: Array<CloudCostReportUnusualDay> = [];

    for (
      let day: Date = data.window.start;
      day.getTime() <= data.window.lastDay.getTime();
      day = addUtcDays(day, 1)
    ) {
      for (const anomaly of findCloudCostDayAnomalies({
        dailyServiceTotals,
        day: toCloudCostDay(day),
      })) {
        // The whole of the group, once: its one "service" is itself.
        if (!anomaly.service) {
          unusualDays.push({
            day: anomaly.day,
            accountName: "",
            service: "",
            amount: anomaly.amount,
            usual: anomaly.usual,
          });
        }
      }
    }

    const days: { start: string; lastDay: string } = toCloudCostReportDays(
      data.window,
    );
    const previousDays: { start: string; lastDay: string } =
      toCloudCostReportDays(data.previous);

    return {
      section: {
        kind: "group",
        groupId: current.group.id,
        name: current.group.name,
        total: current.group.total,
        previousTotal: current.group.previousTotal || 0,
        rises: toLines(movers.rises, serviceName),
        falls: toLines(movers.falls, serviceName),
        budgets: [],
        unusualDays: unusualDays
          .sort(
            (
              a: CloudCostReportUnusualDay,
              b: CloudCostReportUnusualDay,
            ): number => {
              return b.amount - b.usual - (a.amount - a.usual);
            },
          )
          .slice(0, CLOUD_COST_REPORT_UNUSUAL_DAYS),
      },
      viewId: current.allocation.viewId,
      viewName: current.allocation.viewName,
      csv: toCloudCostComparisonCsv({
        comparison: services,
        context: {
          dimension: "service",
          start: days.start,
          lastDay: days.lastDay,
          previousStart: previousDays.start,
          previousLastDay: previousDays.lastDay,
          currency: data.currency,
          basis: data.basis,
        },
      }),
    };
  }
}

export default CloudCostReportBuilder;
