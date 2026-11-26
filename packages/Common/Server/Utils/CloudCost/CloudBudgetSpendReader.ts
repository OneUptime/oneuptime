import CloudCost from "../../../Models/AnalyticsModels/CloudCost";
import CloudCostGroup from "../../../Models/DatabaseModels/CloudCostGroup";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { CloudBudgetScope } from "../../../Types/Cloud/CloudBudget";
import { CloudCostBasis } from "../../../Types/Cloud/CloudCostBasis";
import {
  addUtcDays,
  startOfUtcDay,
  toCloudBudgetMonth,
} from "../../../Types/Cloud/CloudCost";
import {
  CLOUD_COST_ALLOCATION_MAX_DAYS_BY_DAY,
  CLOUD_COST_MAX_GROUPS_PER_VIEW,
  CloudCostAllocationGroupResult,
  CloudCostAllocationInterval,
  CloudCostAllocationResult,
  CloudCostAllocationShare,
  getCloudCostWindowDays,
} from "../../../Types/Cloud/CloudCostAllocation";
import { CloudCostRule } from "../../../Types/Cloud/CloudCostRules";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import CloudCostGroupService from "../../Services/CloudCostGroupService";
import CloudCostService from "../../Services/CloudCostService";
import Query from "../../Types/AnalyticsDatabase/Query";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import CaptureSpan from "../Telemetry/CaptureSpan";
import CloudCostAllocation, {
  CloudCostAllocationClass,
  CloudCostLoadedGroup,
} from "./CloudCostAllocation";
import CloudCostAllocationFacts, {
  CloudCostPlatformResourceRow,
} from "./CloudCostAllocationFacts";
import {
  CloudCostAllocationSqlContext,
  CloudCostQueryFacts,
  amountsStatement,
  emptyCloudCostQueryFacts,
  groupNumberExpression,
  platformResourcesStatement,
  sourceStatement,
  topStatement,
  windowFilter,
} from "./CloudCostAllocationQuery";

/*
 * WHAT A BUDGET'S SCOPE COST (#11008): the spend a budget is checked against
 * and a forecast is made from, read from CloudCost as it is now - so a
 * changed cost group rule, or a cost a cloud corrected, restates the period.
 *
 *   - every account, one account, or a filter: the costs in the currency,
 *     read as the caller may read them (CloudCostService.getScopedWhere),
 *     a filter's rules compiled as a cost group's are - the same SQL, its
 *     owner teams split evenly, its labels and App Platforms read from
 *     Postgres first (CloudCostAllocationQuery, CloudCostAllocationFacts);
 *   - a cost group: what the group is charged, as its page says it - its
 *     rules' costs, its line items, its share of the shared groups - read
 *     through the allocation (CloudCostAllocation.readGroup). Its unusual
 *     days are judged on its rules' own costs, before shared costs and line
 *     items, which are spread evenly and never spike on their own.
 *
 * Every sum is on the read's cost basis (#11007): billed, amortized or net,
 * as the budget watches it.
 *
 * By the day (a window of up to three months: a month and the week before
 * it) or by the month (up to the 400 days the costs are kept).
 *
 * The budget evaluator reads as OneUptime; the API reads a budget's page
 * and a forecast as the person asking.
 */

export interface CloudBudgetScopeRead {
  projectId: ObjectID;
  scope: CloudBudgetScope;
  cloudAccountId?: ObjectID | null | undefined;
  cloudCostGroupId?: ObjectID | null | undefined;
  filterRules?: Array<CloudCostRule> | null | undefined;
  // The currency read: only costs billed in it count.
  currency: string;
  /*
   * The cost summed (#11007): billed, amortized or net - the budget's
   * basis. The billed cost when absent.
   */
  basis?: CloudCostBasis | undefined;
  props: DatabaseCommonInteractionProps;
  // Today, for a read of the month so far (tests set it).
  now?: Date | undefined;
}

// What a scope cost, by service: "2026-11-02" -> service -> amount.
export type CloudBudgetDailyServiceTotals = Map<string, Map<string, number>>;

// The read a part of a large one is (CloudCostAllocationClass.partition).
type ScopePart = ReturnType<typeof CloudCostAllocationClass.partition>[number];

// The service the unallocated spend and a group's costs are read by.
const SERVICE_SQL: string = "service";

function toNumber(value: unknown): number {
  const number: number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function and(a: Statement, b: Statement | undefined): Statement {
  if (!b) {
    return a;
  }

  return SQL`(`
    .append(a)
    .append(SQL`) AND (`)
    .append(b)
    .append(SQL`)`);
}

/*
 * Each day's cost by service of one group of a read (0 for a read with no
 * groups, every cost being group 0): what a scope's unusual days are
 * judged on.
 */
export function dailyServiceAmountsStatement(
  ctx: CloudCostAllocationSqlContext,
  data: { groupNumber: number; extraWhere?: Statement | undefined },
): Statement {
  return SQL`SELECT bucket, key, sum(spend * weight) AS amount FROM (SELECT `
    .append(groupNumberExpression(ctx))
    .append(
      ` AS groupNumber, toString(toDate(day, 'UTC')) AS bucket, ${SERVICE_SQL} AS key, spend, weight FROM (`,
    )
    .append(sourceStatement(ctx, data.extraWhere))
    .append(
      SQL`)) WHERE groupNumber = ${{
        type: TableColumnType.Number,
        value: data.groupNumber,
      }} GROUP BY bucket, key ORDER BY bucket, key`,
    )
    .append(
      getQuerySettings({
        maxExecutionTimeInSeconds: 45,
        additionalSettings: { max_threads: 4 },
      }),
    );
}

export class CloudBudgetSpendReaderClass {
  private async rowsOf(statement: Statement): Promise<Array<JSONObject>> {
    const result: { json: <T>() => Promise<T> } =
      (await CloudCostService.executeQuery(statement)) as unknown as {
        json: <T>() => Promise<T>;
      };
    const response: { data?: Array<JSONObject> } = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return response.data || [];
  }

  /*
   * A read of every account, one account or a filter: its context, split
   * into parts when its filter names more resources than one statement
   * carries, and the group its costs are: 1 for a filter's, 0 otherwise.
   */
  private async directParts(
    read: CloudBudgetScopeRead,
    start: Date,
    lastDay: Date,
  ): Promise<{ parts: Array<ScopePart>; groupNumber: number }> {
    const query: Query<CloudCost> = {
      projectId: read.projectId,
      currency: read.currency,
      day: new InBetween<Date>(start, lastDay),
    } as Query<CloudCost>;

    if (read.scope === CloudBudgetScope.Account) {
      if (!read.cloudAccountId) {
        throw new NotFoundException(
          "This budget's account was not found. It may have been deleted.",
        );
      }

      (query as Record<string, unknown>)["cloudAccountId"] =
        read.cloudAccountId;
    }

    const where: Statement = await CloudCostService.getScopedWhere({
      query,
      props: read.props,
    });
    const table: { databaseName: string; tableName: string } =
      CloudCostService.getTableReference();
    const isFilter: boolean = read.scope === CloudBudgetScope.Filter;
    const groups: Array<{ rules: Array<CloudCostRule> }> = isFilter
      ? [{ rules: read.filterRules || [] }]
      : [];
    const facts: CloudCostQueryFacts = isFilter
      ? await CloudCostAllocationFacts.load({
          projectId: read.projectId,
          groups,
          platformRows: (): Promise<Array<CloudCostPlatformResourceRow>> => {
            return this.platformRows({ ...table, where });
          },
        })
      : emptyCloudCostQueryFacts();
    const ctx: CloudCostAllocationSqlContext = {
      ...table,
      where,
      groups,
      facts,
      basis: read.basis,
    };

    return {
      parts: CloudCostAllocationClass.partition(ctx),
      groupNumber: isFilter ? 1 : 0,
    };
  }

  private async platformRows(data: {
    databaseName: string;
    tableName: string;
    where: Statement;
  }): Promise<Array<CloudCostPlatformResourceRow>> {
    const rows: Array<JSONObject> = await this.rowsOf(
      platformResourcesStatement({
        ...data,
        services: CloudCostAllocationFacts.getPlatformServices(),
      }),
    );

    return rows.map((row: JSONObject): CloudCostPlatformResourceRow => {
      return {
        accountId: String(row["accountId"] ?? ""),
        region: String(row["region"] ?? ""),
        service: String(row["service"] ?? ""),
        resourceId: String(row["resourceId"] ?? ""),
      };
    });
  }

  // A direct read's sums by bucket, over every part of it.
  private async directAmounts(data: {
    read: CloudBudgetScopeRead;
    start: Date;
    lastDay: Date;
    byMonth: boolean;
  }): Promise<Map<string, number>> {
    const { parts, groupNumber } = await this.directParts(
      data.read,
      data.start,
      data.lastDay,
    );
    const amounts: Map<string, number> = new Map();
    const results: Array<Array<JSONObject>> = await Promise.all(
      parts.map((part: ScopePart) => {
        return this.rowsOf(
          amountsStatement(part.ctx, {
            byMonth: data.byMonth,
            extraWhere: and(
              windowFilter({ start: data.start, lastDay: data.lastDay }),
              part.partition,
            ),
          }),
        );
      }),
    );

    for (const rows of results) {
      for (const row of rows) {
        // A read with no groups counts every cost; a filter, its own group.
        if (groupNumber !== 0 && toNumber(row["groupNumber"]) !== groupNumber) {
          continue;
        }

        const bucket: string = String(row["bucket"] || "");
        const key: string = data.byMonth ? bucket.slice(0, 7) : bucket;
        amounts.set(key, (amounts.get(key) || 0) + toNumber(row["amount"]));
      }
    }

    return amounts;
  }

  // A cost group's read, through the allocation: what its page says.
  private async readGroup(data: {
    read: CloudBudgetScopeRead;
    start: Date;
    lastDay: Date;
    interval: CloudCostAllocationInterval;
  }): Promise<{
    allocation: CloudCostAllocationResult;
    group: CloudCostAllocationGroupResult;
  }> {
    if (!data.read.cloudCostGroupId) {
      throw new NotFoundException(
        "This budget's cost group was not found. It may have been deleted: choose another group for the budget, or delete it.",
      );
    }

    return CloudCostAllocation.readGroup({
      projectId: data.read.projectId,
      groupId: data.read.cloudCostGroupId,
      startDate: data.start,
      endDate: data.lastDay,
      interval: data.interval,
      currency: data.read.currency,
      basis: data.read.basis,
      compareWithPrevious: false,
      props: data.read.props,
      now: data.read.now,
    });
  }

  private static groupSeries(
    read: {
      allocation: CloudCostAllocationResult;
      group: CloudCostAllocationGroupResult;
    },
    byMonth: boolean,
  ): Map<string, number> {
    const amounts: Map<string, number> = new Map();

    read.allocation.buckets.forEach((bucket: string, index: number): void => {
      const amount: number = read.group.series[index] || 0;

      if (amount !== 0) {
        amounts.set(byMonth ? bucket.slice(0, 7) : bucket, amount);
      }
    });

    return amounts;
  }

  /*
   * Each day's cost from `start` to `lastDay`, both included:
   * "2026-11-02" -> amount. Days with no cost are left out.
   */
  @CaptureSpan()
  public async readDays(
    read: CloudBudgetScopeRead,
    start: Date,
    lastDay: Date,
  ): Promise<Map<string, number>> {
    const window: { start: Date; lastDay: Date } = {
      start: startOfUtcDay(start),
      lastDay: startOfUtcDay(lastDay),
    };

    if (
      getCloudCostWindowDays(window) > CLOUD_COST_ALLOCATION_MAX_DAYS_BY_DAY
    ) {
      throw new Error(
        `A budget reads at most ${CLOUD_COST_ALLOCATION_MAX_DAYS_BY_DAY} days by the day.`,
      );
    }

    if (read.scope === CloudBudgetScope.CostGroup) {
      return CloudBudgetSpendReaderClass.groupSeries(
        await this.readGroup({
          read,
          ...window,
          interval: CloudCostAllocationInterval.Day,
        }),
        false,
      );
    }

    return this.directAmounts({ read, ...window, byMonth: false });
  }

  /*
   * Each month's cost from `start`'s month to `lastDay`'s, the days between
   * them included: "2026-10" -> amount. Months with no cost are left out.
   */
  @CaptureSpan()
  public async readMonths(
    read: CloudBudgetScopeRead,
    start: Date,
    lastDay: Date,
  ): Promise<Map<string, number>> {
    const window: { start: Date; lastDay: Date } = {
      start: startOfUtcDay(start),
      lastDay: startOfUtcDay(lastDay),
    };

    if (read.scope === CloudBudgetScope.CostGroup) {
      return CloudBudgetSpendReaderClass.groupSeries(
        await this.readGroup({
          read,
          ...window,
          interval: CloudCostAllocationInterval.Month,
        }),
        true,
      );
    }

    return this.directAmounts({ read, ...window, byMonth: true });
  }

  /*
   * Each day's cost by service from `start` to `lastDay`: what a scope's
   * unusual days are judged on. A cost group's is its rules' own costs.
   */
  @CaptureSpan()
  public async readDaysByService(
    read: CloudBudgetScopeRead,
    start: Date,
    lastDay: Date,
  ): Promise<CloudBudgetDailyServiceTotals> {
    const window: { start: Date; lastDay: Date } = {
      start: startOfUtcDay(start),
      lastDay: startOfUtcDay(lastDay),
    };
    const { parts, groupNumber } =
      read.scope === CloudBudgetScope.CostGroup
        ? await this.groupParts(read, window.start, window.lastDay)
        : await this.directParts(read, window.start, window.lastDay);
    const totals: CloudBudgetDailyServiceTotals = new Map();
    const results: Array<Array<JSONObject>> = await Promise.all(
      parts.map((part: ScopePart) => {
        return this.rowsOf(
          dailyServiceAmountsStatement(part.ctx, {
            groupNumber,
            extraWhere: and(windowFilter(window), part.partition),
          }),
        );
      }),
    );

    for (const rows of results) {
      for (const row of rows) {
        const day: string = String(row["bucket"] || "");
        const service: string = String(row["key"] ?? "");
        const byService: Map<string, number> = totals.get(day) || new Map();
        byService.set(
          service,
          (byService.get(service) || 0) + toNumber(row["amount"]),
        );
        totals.set(day, byService);
      }
    }

    return totals;
  }

  /*
   * The services that cost the most from `start` to `lastDay`, the most
   * first: what an alert names as where the money went.
   */
  @CaptureSpan()
  public async readTopServices(
    read: CloudBudgetScopeRead,
    start: Date,
    lastDay: Date,
    limit: number,
  ): Promise<Array<{ service: string; amount: number }>> {
    const window: { start: Date; lastDay: Date } = {
      start: startOfUtcDay(start),
      lastDay: startOfUtcDay(lastDay),
    };
    const totals: Map<string, number> = new Map();

    if (read.scope === CloudBudgetScope.CostGroup) {
      const group: CloudCostAllocationGroupResult = (
        await this.readGroup({
          read,
          ...window,
          interval: CloudCostAllocationInterval.Month,
        })
      ).group;

      for (const share of group.topServices || []) {
        totals.set(share.key, share.amount);
      }
    } else {
      const { parts, groupNumber } = await this.directParts(
        read,
        window.start,
        window.lastDay,
      );
      const results: Array<Array<JSONObject>> = await Promise.all(
        parts.map((part: ScopePart) => {
          return this.rowsOf(
            topStatement(part.ctx, {
              groupNumber,
              dimension: "service",
              limit: parts.length > 1 ? limit * 5 : limit,
              extraWhere: and(windowFilter(window), part.partition),
            }),
          );
        }),
      );

      for (const rows of results) {
        for (const row of rows) {
          const key: string = String(row["key"] ?? "");
          totals.set(key, (totals.get(key) || 0) + toNumber(row["amount"]));
        }
      }
    }

    return Array.from(totals.entries())
      .map(([service, amount]: [string, number]) => {
        return { service, amount: Math.round(amount * 100) / 100 };
      })
      .filter((entry: { service: string; amount: number }): boolean => {
        return entry.service.length > 0 && entry.amount >= 0.01;
      })
      .sort(
        (
          a: { service: string; amount: number },
          b: { service: string; amount: number },
        ): number => {
          return b.amount - a.amount || a.service.localeCompare(b.service);
        },
      )
      .slice(0, limit);
  }

  /*
   * A cost group's rules, as its view sorts the costs: the view's groups in
   * their order, so a cost an earlier group takes is not this one's.
   */
  private async groupParts(
    read: CloudBudgetScopeRead,
    start: Date,
    lastDay: Date,
  ): Promise<{ parts: Array<ScopePart>; groupNumber: number }> {
    const group: CloudCostGroup | null = read.cloudCostGroupId
      ? await CloudCostGroupService.findOneBy({
          query: { _id: read.cloudCostGroupId, projectId: read.projectId },
          select: { _id: true, cloudCostViewId: true },
          props: read.props,
        })
      : null;

    if (!group?.cloudCostViewId) {
      throw new NotFoundException(
        "This budget's cost group was not found. It may have been deleted: choose another group for the budget, or delete it.",
      );
    }

    const groups: Array<CloudCostLoadedGroup> =
      CloudCostAllocationClass.toLoadedGroups(
        await CloudCostGroupService.findBy({
          query: {
            cloudCostViewId: group.cloudCostViewId,
            projectId: read.projectId,
          },
          select: {
            _id: true,
            name: true,
            order: true,
            rules: true,
            isShared: true,
            sharedSplit: true,
            sharedPercentages: true,
            teamId: true,
            kubernetesClusterId: true,
            createdAt: true,
          },
          sort: { order: SortOrder.Ascending },
          props: read.props,
          skip: 0,
          limit: CLOUD_COST_MAX_GROUPS_PER_VIEW,
        }),
      );
    const groupNumber: number =
      groups.findIndex((entry: CloudCostLoadedGroup): boolean => {
        return entry.id === read.cloudCostGroupId!.toString().toLowerCase();
      }) + 1;

    if (groupNumber === 0) {
      throw new NotFoundException(
        "This budget's cost group was not found in its view. It may have been deleted, or you may not have access to it.",
      );
    }

    const where: Statement = await CloudCostService.getScopedWhere({
      query: {
        projectId: read.projectId,
        currency: read.currency,
        day: new InBetween<Date>(start, lastDay),
      } as Query<CloudCost>,
      props: read.props,
    });
    const table: { databaseName: string; tableName: string } =
      CloudCostService.getTableReference();
    const facts: CloudCostQueryFacts = await CloudCostAllocationFacts.load({
      projectId: read.projectId,
      groups,
      platformRows: (): Promise<Array<CloudCostPlatformResourceRow>> => {
        return this.platformRows({ ...table, where });
      },
    });

    return {
      parts: CloudCostAllocationClass.partition({
        ...table,
        where,
        groups,
        facts,
        basis: read.basis,
      }),
      groupNumber,
    };
  }

  /*
   * The newest full months a forecast is made from, and a window's earlier
   * months: from the first month the costs are all kept for - the 400 days
   * CloudCost keeps reach into a month part way - to the end of last month.
   */
  public static getHistoryWindow(data: {
    now: Date;
    keptDays: number;
  }): { start: Date; lastDay: Date } | null {
    const today: Date = startOfUtcDay(data.now);
    const thisMonthStart: Date = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
    );
    const oldestKept: Date = addUtcDays(today, -(data.keptDays - 1));
    let start: Date = new Date(
      Date.UTC(oldestKept.getUTCFullYear(), oldestKept.getUTCMonth(), 1),
    );

    if (start.getTime() < oldestKept.getTime()) {
      start = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
      );
    }

    const lastDay: Date = addUtcDays(thisMonthStart, -1);

    if (lastDay.getTime() < start.getTime()) {
      return null;
    }

    return { start, lastDay };
  }

  // The months of a window, as the reader names them: "2026-10".
  public static monthOf(day: Date): string {
    return toCloudBudgetMonth(day);
  }

  // The top services of a share list, as an alert names them.
  public static toServices(
    shares: Array<CloudCostAllocationShare>,
  ): Array<{ service: string; amount: number }> {
    return shares.map((share: CloudCostAllocationShare) => {
      return { service: share.key, amount: share.amount };
    });
  }
}

export default new CloudBudgetSpendReaderClass();
