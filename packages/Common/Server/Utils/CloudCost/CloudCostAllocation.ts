import CloudCost from "../../../Models/AnalyticsModels/CloudCost";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudCostGroup from "../../../Models/DatabaseModels/CloudCostGroup";
import CloudCostLineItem from "../../../Models/DatabaseModels/CloudCostLineItem";
import CloudCostView from "../../../Models/DatabaseModels/CloudCostView";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  CLOUD_COST_MAX_GROUPS_PER_VIEW,
  CloudCostAllocationGroupResult,
  CloudCostAllocationInterval,
  CloudCostAllocationResult,
  CloudCostAllocationShare,
  CloudCostAllocationTagShare,
  CloudCostAllocationWindow,
  CloudCostBucketAmounts,
  CloudCostLineItemKind,
  CloudCostLineItemRecurrence,
  CloudCostSharedPercentages,
  CloudCostSharedSplit,
  CloudCostSplitGroup,
  CloudCostSplitResult,
  getCloudCostAllocationInterval,
  getCloudCostBuckets,
  getCloudCostLineItemDays,
  getPreviousCloudCostWindow,
  readCloudCostSharedPercentages,
  roundAllocation,
  splitCloudCostSharedGroups,
  toCloudCostAllocationWindow,
  toCloudCostBucket,
  toCloudCostMonth,
  topCloudCostShares,
} from "../../../Types/Cloud/CloudCostAllocation";
import {
  CLOUD_COST_DEFAULT_CURRENCY,
  CloudAccountCostSummary,
  addUtcDays,
  addUtcMonths,
  fromCloudCostDay,
  getMostCommonCloudCurrency,
  readCloudAccountCostSummary,
  startOfUtcDay,
  startOfUtcMonth,
} from "../../../Types/Cloud/CloudCost";
import {
  CloudCostFacts,
  CloudCostPartPlacement,
  CloudCostRule,
  CloudCostRuleCondition,
  CloudCostRuleField,
  findCloudCostGroupsThatNeverMatch,
  placeCloudCost,
  readCloudCostRules,
} from "../../../Types/Cloud/CloudCostRules";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import CloudAccountService from "../../Services/CloudAccountService";
import CloudCostGroupService from "../../Services/CloudCostGroupService";
import CloudCostLineItemService from "../../Services/CloudCostLineItemService";
import CloudCostService from "../../Services/CloudCostService";
import CloudCostViewService from "../../Services/CloudCostViewService";
import KubernetesCostAllocationService, {
  KubernetesNamespaceShare,
} from "../../Services/KubernetesCostAllocationService";
import Query from "../../Types/AnalyticsDatabase/Query";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import CaptureSpan from "../Telemetry/CaptureSpan";
import CloudCostAllocationFacts, {
  CloudCostPlatformResourceRow,
} from "./CloudCostAllocationFacts";
import {
  CloudCostAllocationDimension,
  CloudCostAllocationSqlContext,
  CloudCostQueryFacts,
  RESOURCE_HASH_SQL,
  amountsStatement,
  platformResourcesStatement,
  topStatement,
  topTagValuesStatement,
  windowFilter,
  wouldMatchStatement,
} from "./CloudCostAllocationQuery";

/*
 * WHAT A COST VIEW ALLOCATES: each group's spend, what no group takes, and
 * how the shared groups are split - read when asked, from the rules as
 * they are now.
 *
 * One read of a view, for a window of whole UTC days (both ends included):
 *
 *   1. The view and its groups, in their order, read as the caller may
 *      read them; the facts their rules need from Postgres (owners,
 *      labels, App Platforms) (CloudCostAllocationFacts).
 *   2. The costs (CloudCost), read as the caller may read them, sorted
 *      into the groups by one ClickHouse statement per question
 *      (CloudCostAllocationQuery): what each group took by the day or the
 *      month, the same for the window before, and what makes up the
 *      unallocated spend.
 *   3. Custom line items, day by day: a group's go to it, an account's go
 *      through the rules as its costs do.
 *   4. The shared groups split across the others, bucket by bucket:
 *      evenly, by their month's share of the cloud spend, by fixed
 *      percentages, or by a Kubernetes cluster's namespaces.
 *
 * A group's total is what it is charged (CloudCostAllocationAmounts); the
 * groups' totals and the unallocated total add up to the window's spend.
 *
 * Budgets (#11008) and reports (#11009) read a group's month through
 * readGroup, as OneUptime (root) or as the person asking.
 */

// The resources one statement names; more are read in parts.
export const CLOUD_COST_FACTS_PER_READ: number = 8000;

// How many of each kind the unallocated spend lists, and a group's page.
export const CLOUD_COST_TOP_COUNT: number = 10;

// A currency as ISO 4217 writes one: three letters.
const CURRENCY_CODE: RegExp = /^[A-Z]{3}$/;

// A view's groups, as a read uses them.
export interface CloudCostLoadedGroup {
  id: string;
  name: string;
  order: number;
  isShared: boolean;
  split: CloudCostSharedSplit;
  percentages: CloudCostSharedPercentages;
  teamId?: string | undefined;
  kubernetesClusterId?: string | undefined;
  rules: Array<CloudCostRule>;
}

export interface CloudCostAllocationRequest {
  projectId: ObjectID;
  viewId: ObjectID;
  startDate: Date;
  endDate: Date;
  interval?: CloudCostAllocationInterval | undefined;
  // The currency read: the project's accounts' most common when absent.
  currency?: string | undefined;
  // Only these accounts' costs; every account's when absent.
  cloudAccountIds?: Array<ObjectID> | undefined;
  // One group's read: its top services, resources and accounts too.
  groupId?: ObjectID | undefined;
  // Whether to read the window before too (default: yes).
  compareWithPrevious?: boolean | undefined;
  props: DatabaseCommonInteractionProps;
  // Today, for a read of the month so far (tests set it).
  now?: Date | undefined;
}

interface PartitionedContext {
  ctx: CloudCostAllocationSqlContext;
  partition?: Statement | undefined;
}

type GroupBucketAmounts = Map<number, Map<string, number>>;

function add(
  map: Map<string, number>,
  key: string,
  amount: number,
): Map<string, number> {
  map.set(key, (map.get(key) || 0) + amount);
  return map;
}

function sumOf(values: Iterable<number>): number {
  let sum: number = 0;

  for (const value of values) {
    sum += value;
  }

  return sum;
}

function and(a: Statement | undefined, b: Statement | undefined): Statement {
  if (!a) {
    return b || SQL`1`;
  }

  if (!b) {
    return a;
  }

  return SQL`(`
    .append(a)
    .append(SQL`) AND (`)
    .append(b)
    .append(SQL`)`);
}

function toNumber(value: unknown): number {
  const number: number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export class CloudCostAllocationClass {
  // A view's groups in their order, the older first at one number.
  public static toLoadedGroups(
    groups: Array<CloudCostGroup>,
  ): Array<CloudCostLoadedGroup> {
    return groups
      .slice()
      .sort((a: CloudCostGroup, b: CloudCostGroup): number => {
        return (
          (a.order || 0) - (b.order || 0) ||
          (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0)
        );
      })
      .map((group: CloudCostGroup): CloudCostLoadedGroup => {
        let rules: Array<CloudCostRule> = [];
        let percentages: CloudCostSharedPercentages = {};

        try {
          rules = readCloudCostRules(group.rules);
        } catch {
          // A group whose stored rules no longer read takes nothing.
          rules = [];
        }

        try {
          percentages = readCloudCostSharedPercentages(group.sharedPercentages);
        } catch {
          percentages = {};
        }

        return {
          id: group.id!.toString().toLowerCase(),
          name: group.name || "",
          order: group.order || 0,
          isShared: Boolean(group.isShared),
          split: group.sharedSplit || CloudCostSharedSplit.Proportional,
          percentages,
          teamId: group.teamId?.toString().toLowerCase(),
          kubernetesClusterId: group.kubernetesClusterId
            ?.toString()
            .toLowerCase(),
          rules,
        };
      });
  }

  // The currency most of the project's accounts are billed in.
  @CaptureSpan()
  public async getProjectCurrency(projectId: ObjectID): Promise<string> {
    const accounts: Array<CloudAccount> = await CloudAccountService.findBy({
      query: { projectId },
      select: { _id: true, costSummary: true },
      props: { isRoot: true },
      skip: 0,
      limit: 1000,
    });
    const counts: Map<string, number> = new Map();

    for (const account of accounts) {
      const summary: CloudAccountCostSummary | null =
        readCloudAccountCostSummary(account.costSummary);

      if (summary?.currency) {
        add(counts, summary.currency.toUpperCase(), 1);
      }
    }

    return counts.size > 0
      ? getMostCommonCloudCurrency(counts)
      : CLOUD_COST_DEFAULT_CURRENCY;
  }

  /*
   * The read split into parts when its facts name more resources than one
   * statement carries: each part reads the resources whose hash starts
   * with its digits, so the parts' sums add up to the whole.
   */
  public static partition(
    ctx: CloudCostAllocationSqlContext,
    limit: number = CLOUD_COST_FACTS_PER_READ,
  ): Array<PartitionedContext> {
    const count: number = ctx.facts.resourceHashes.length;

    if (count <= limit) {
      return [{ ctx }];
    }

    let parts: number = 2;

    while (parts < 16 && count / parts > limit) {
      parts *= 2;
    }

    const digits: Array<string> = "0123456789ABCDEF".split("");
    const contexts: Array<PartitionedContext> = [];

    for (let part: number = 0; part < parts; part++) {
      const own: Array<string> = digits.filter(
        (_digit: string, index: number): boolean => {
          return index % parts === part;
        },
      );
      const hashes: Array<string> = [];
      const classes: Array<number> = [];

      ctx.facts.resourceHashes.forEach((hash: string, index: number): void => {
        if (own.includes(hash.charAt(0))) {
          hashes.push(hash);
          classes.push(ctx.facts.resourceClasses[index]!);
        }
      });

      contexts.push({
        ctx: {
          ...ctx,
          facts: {
            ...ctx.facts,
            resourceHashes: hashes,
            resourceClasses: classes,
          },
        },
        partition: SQL`has(${{
          type: TableColumnType.ArrayText,
          value: own,
        }}, left(`
          .append(RESOURCE_HASH_SQL)
          .append(SQL`, 1))`),
      });
    }

    return contexts;
  }

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

  // What each group took, bucket by bucket, over every part of the read.
  private async readAmounts(data: {
    parts: Array<PartitionedContext>;
    byMonth: boolean;
    window: CloudCostAllocationWindow;
  }): Promise<GroupBucketAmounts> {
    const amounts: GroupBucketAmounts = new Map();
    const results: Array<Array<JSONObject>> = await Promise.all(
      data.parts.map((part: PartitionedContext) => {
        return this.rowsOf(
          amountsStatement(part.ctx, {
            byMonth: data.byMonth,
            extraWhere: and(windowFilter(data.window), part.partition),
          }),
        );
      }),
    );

    for (const rows of results) {
      for (const row of rows) {
        const group: number = toNumber(row["groupNumber"]);
        const byBucket: Map<string, number> = amounts.get(group) || new Map();
        add(byBucket, String(row["bucket"] || ""), toNumber(row["amount"]));
        amounts.set(group, byBucket);
      }
    }

    return amounts;
  }

  private async readWouldMatch(data: {
    parts: Array<PartitionedContext>;
    window: CloudCostAllocationWindow;
    groupCount: number;
  }): Promise<Array<number>> {
    const sums: Array<number> = new Array(data.groupCount).fill(0);
    const results: Array<Array<JSONObject>> = await Promise.all(
      data.parts.map((part: PartitionedContext) => {
        return this.rowsOf(
          wouldMatchStatement(part.ctx, {
            extraWhere: and(windowFilter(data.window), part.partition),
          }),
        );
      }),
    );

    for (const rows of results) {
      const row: JSONObject = rows[0] || {};

      for (let index: number = 0; index < data.groupCount; index++) {
        sums[index] = sums[index]! + toNumber(row[`wouldMatch${index + 1}`]);
      }
    }

    return sums;
  }

  private async readTop(data: {
    parts: Array<PartitionedContext>;
    window: CloudCostAllocationWindow;
    groupNumber: number;
    dimension: CloudCostAllocationDimension;
  }): Promise<Array<CloudCostAllocationShare>> {
    const totals: Map<string, number> = new Map();
    const results: Array<Array<JSONObject>> = await Promise.all(
      data.parts.map((part: PartitionedContext) => {
        return this.rowsOf(
          topStatement(part.ctx, {
            groupNumber: data.groupNumber,
            dimension: data.dimension,
            // Each part's own top: more of them, so the merge stays right.
            limit:
              data.parts.length > 1
                ? CLOUD_COST_TOP_COUNT * 5
                : CLOUD_COST_TOP_COUNT,
            extraWhere: and(windowFilter(data.window), part.partition),
          }),
        );
      }),
    );

    for (const rows of results) {
      for (const row of rows) {
        add(totals, String(row["key"] ?? ""), toNumber(row["amount"]));
      }
    }

    return topCloudCostShares(totals, CLOUD_COST_TOP_COUNT);
  }

  private async readTopTagValues(data: {
    parts: Array<PartitionedContext>;
    window: CloudCostAllocationWindow;
    groupNumber: number;
  }): Promise<Array<CloudCostAllocationTagShare>> {
    const totals: Map<string, { key: string; value: string; amount: number }> =
      new Map();
    const results: Array<Array<JSONObject>> = await Promise.all(
      data.parts.map((part: PartitionedContext) => {
        return this.rowsOf(
          topTagValuesStatement(part.ctx, {
            groupNumber: data.groupNumber,
            limit:
              data.parts.length > 1
                ? CLOUD_COST_TOP_COUNT * 5
                : CLOUD_COST_TOP_COUNT * 2,
            extraWhere: and(windowFilter(data.window), part.partition),
          }),
        );
      }),
    );

    for (const rows of results) {
      for (const row of rows) {
        const key: string = String(row["tagKey"] ?? "");
        const value: string = String(row["tagValue"] ?? "");
        const id: string = JSON.stringify([key, value]);
        const entry: { key: string; value: string; amount: number } =
          totals.get(id) || { key, value, amount: 0 };
        entry.amount += toNumber(row["amount"]);
        totals.set(id, entry);
      }
    }

    return Array.from(totals.values())
      .map((entry: { key: string; value: string; amount: number }) => {
        return { ...entry, amount: roundAllocation(entry.amount) };
      })
      .filter((entry: CloudCostAllocationTagShare): boolean => {
        return Math.abs(entry.amount) >= 0.005;
      })
      .sort(
        (a: CloudCostAllocationTagShare, b: CloudCostAllocationTagShare) => {
          return (
            b.amount - a.amount ||
            a.key.localeCompare(b.key) ||
            a.value.localeCompare(b.value)
          );
        },
      )
      .slice(0, CLOUD_COST_TOP_COUNT * 2);
  }

  /*
   * A Kubernetes split's weights, month by month: each group's share of the
   * cluster's namespaces' costs, a namespace's part going to the first
   * group whose rules match it - the namespace and its labels read as a
   * cost's tags. Idle capacity and the parts no group takes keep their
   * share with the shared group.
   */
  public static toKubernetesWeights(data: {
    shares: Array<KubernetesNamespaceShare>;
    groups: Array<CloudCostLoadedGroup>;
    kubernetesClusterId: string;
  }): Map<string, Map<string, number>> {
    const byMonth: Map<string, Array<KubernetesNamespaceShare>> = new Map();

    for (const share of data.shares) {
      const rows: Array<KubernetesNamespaceShare> =
        byMonth.get(share.month) || [];
      rows.push(share);
      byMonth.set(share.month, rows);
    }

    const weights: Map<string, Map<string, number>> = new Map();

    for (const [month, shares] of byMonth.entries()) {
      const total: number = sumOf(
        shares.map((share: KubernetesNamespaceShare): number => {
          return share.amount;
        }),
      );

      if (total <= 0) {
        continue;
      }

      const monthWeights: Map<string, number> = new Map();

      for (const share of shares) {
        if (share.namespace.startsWith("__") || share.amount <= 0) {
          continue;
        }

        const facts: CloudCostFacts = {
          cloudAccountId: "",
          provider: "",
          service: "",
          region: "",
          resourceId: "",
          tags: share.labels,
          kubernetesClusterId: data.kubernetesClusterId,
          kubernetesNamespace: share.namespace,
        };
        const placement: Array<CloudCostPartPlacement> = placeCloudCost({
          groups: data.groups,
          facts,
        });

        for (const part of placement) {
          const group: CloudCostLoadedGroup | undefined =
            data.groups[part.groupIndex];

          if (group && !group.isShared) {
            add(monthWeights, group.id, (share.amount * part.share) / total);
          }
        }
      }

      weights.set(month, monthWeights);
    }

    return weights;
  }

  // The tag keys the view's rules read: all a namespace's labels are asked for.
  public static getRuleTagKeys(
    groups: Array<CloudCostLoadedGroup>,
  ): Array<string> {
    const keys: Set<string> = new Set();

    for (const group of groups) {
      for (const rule of group.rules) {
        for (const condition of rule.conditions as Array<CloudCostRuleCondition>) {
          if (condition.field === CloudCostRuleField.Tag && condition.key) {
            keys.add(condition.key);
          }
        }
      }
    }

    return Array.from(keys);
  }

  /*
   * Where custom line items go, bucket by bucket: a group's to the group
   * (one of this view's), an account's through the rules as its costs go -
   * with its account's cloud and labels, and nothing else a cost carries.
   */
  public static placeLineItems(data: {
    items: Array<CloudCostLineItem>;
    groups: Array<CloudCostLoadedGroup>;
    window: CloudCostAllocationWindow;
    interval: CloudCostAllocationInterval;
    accountProviders: Map<string, string>;
    accountLabels: Map<string, Array<string>>;
  }): GroupBucketAmounts {
    const amounts: GroupBucketAmounts = new Map();
    const groupNumbers: Map<string, number> = new Map(
      data.groups.map(
        (group: CloudCostLoadedGroup, index: number): [string, number] => {
          return [group.id, index + 1];
        },
      ),
    );

    const put: (group: number, bucket: string, amount: number) => void = (
      group: number,
      bucket: string,
      amount: number,
    ): void => {
      const byBucket: Map<string, number> = amounts.get(group) || new Map();
      add(byBucket, bucket, amount);
      amounts.set(group, byBucket);
    };

    for (const item of data.items) {
      const days: Array<{ day: string; amount: number }> =
        getCloudCostLineItemDays({
          item: {
            kind: item.kind || CloudCostLineItemKind.Charge,
            amount: Number(item.amount) || 0,
            recurrence: item.recurrence || CloudCostLineItemRecurrence.Monthly,
            startDate: item.startDate || new Date(0),
            endDate: item.endDate || undefined,
          },
          window: data.window,
        });

      if (days.length === 0) {
        continue;
      }

      let placements: Array<{ group: number; share: number }> = [];

      if (item.cloudCostGroupId) {
        const group: number | undefined = groupNumbers.get(
          item.cloudCostGroupId.toString().toLowerCase(),
        );

        // A line item of another view's group is not this view's.
        if (group === undefined) {
          continue;
        }

        placements = [{ group, share: 1 }];
      } else if (item.cloudAccountId) {
        const accountId: string = item.cloudAccountId.toString().toLowerCase();

        placements = placeCloudCost({
          groups: data.groups,
          facts: {
            cloudAccountId: accountId,
            provider: data.accountProviders.get(accountId) || "",
            service: "",
            region: "",
            resourceId: "",
            tags: {},
            labelIds: data.accountLabels.get(accountId) || [],
          },
        }).map((part: CloudCostPartPlacement) => {
          return { group: part.groupIndex + 1, share: part.share };
        });
      } else {
        placements = [{ group: 0, share: 1 }];
      }

      for (const day of days) {
        const bucket: string = toCloudCostBucket(
          fromCloudCostDay(day.day),
          data.interval,
        );

        for (const placement of placements) {
          put(placement.group, bucket, day.amount * placement.share);
        }
      }
    }

    return amounts;
  }

  // Per group ID (and "" for the unallocated), per bucket, from group numbers.
  private static toBucketAmounts(data: {
    amounts: GroupBucketAmounts;
    groups: Array<CloudCostLoadedGroup>;
  }): CloudCostBucketAmounts {
    const byId: CloudCostBucketAmounts = new Map();

    for (const [number, byBucket] of data.amounts.entries()) {
      const id: string = number === 0 ? "" : data.groups[number - 1]?.id || "";
      const existing: Map<string, number> = byId.get(id) || new Map();

      for (const [bucket, amount] of byBucket.entries()) {
        add(existing, bucket, amount);
      }

      byId.set(id, existing);
    }

    return byId;
  }

  /*
   * A window's figures after the split: each group's own cloud spend and
   * line items, what it took of the shared groups and what it gave away.
   */
  private static settle(data: {
    groups: Array<CloudCostLoadedGroup>;
    cloud: CloudCostBucketAmounts;
    lineItems: CloudCostBucketAmounts;
    monthSpend: Map<string, Map<string, number>>;
    kubernetesWeights: Map<string, Map<string, Map<string, number>>>;
  }): {
    cloudSplit: CloudCostSplitResult;
    lineItemSplit: CloudCostSplitResult;
  } {
    const splitGroups: Array<CloudCostSplitGroup> = data.groups.map(
      (group: CloudCostLoadedGroup): CloudCostSplitGroup => {
        return {
          id: group.id,
          isShared: group.isShared,
          split: group.split,
          percentages: group.percentages,
          kubernetesWeights: data.kubernetesWeights.get(group.id),
        };
      },
    );

    return {
      cloudSplit: splitCloudCostSharedGroups({
        groups: splitGroups,
        amounts: data.cloud,
        monthSpend: data.monthSpend,
        monthOf: toCloudCostMonth,
      }),
      lineItemSplit: splitCloudCostSharedGroups({
        groups: splitGroups,
        amounts: data.lineItems,
        monthSpend: data.monthSpend,
        monthOf: toCloudCostMonth,
      }),
    };
  }

  @CaptureSpan()
  public async read(
    request: CloudCostAllocationRequest,
  ): Promise<CloudCostAllocationResult> {
    const now: Date = request.now || new Date();
    const view: CloudCostView | null = await CloudCostViewService.findOneBy({
      query: { _id: request.viewId, projectId: request.projectId },
      select: { _id: true, name: true },
      props: request.props,
    });

    if (!view?.id) {
      throw new NotFoundException(
        "This cost view was not found. It may have been deleted, or you may not have access to it.",
      );
    }

    const groups: Array<CloudCostLoadedGroup> =
      CloudCostAllocationClass.toLoadedGroups(
        await CloudCostGroupService.findBy({
          query: {
            cloudCostViewId: request.viewId,
            projectId: request.projectId,
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
          props: request.props,
          skip: 0,
          limit: CLOUD_COST_MAX_GROUPS_PER_VIEW,
        }),
      );

    const askedGroupId: string | undefined = request.groupId
      ?.toString()
      .toLowerCase();

    if (
      askedGroupId &&
      !groups.some((group: CloudCostLoadedGroup): boolean => {
        return group.id === askedGroupId;
      })
    ) {
      throw new NotFoundException(
        "This cost group was not found in its view. It may have been deleted, or you may not have access to it.",
      );
    }

    const currency: string = (
      request.currency || (await this.getProjectCurrency(request.projectId))
    )
      .trim()
      .toUpperCase();

    if (!CURRENCY_CODE.test(currency)) {
      throw new BadDataException(
        "The currency must be a three-letter code such as USD or EUR.",
      );
    }

    const window: CloudCostAllocationWindow = toCloudCostAllocationWindow({
      startDate: request.startDate,
      endDate: request.endDate,
    });
    const interval: CloudCostAllocationInterval =
      getCloudCostAllocationInterval({ window, asked: request.interval });
    const previous: CloudCostAllocationWindow | null =
      request.compareWithPrevious === false
        ? null
        : getPreviousCloudCostWindow(window);
    const today: Date = startOfUtcDay(now);

    /*
     * What the read covers: both windows, and the whole of every month they
     * touch up to today - a proportional split weighs each bucket by its
     * month's spend, so a day's split never depends on the window asked.
     */
    const readStart: Date = startOfUtcMonth(
      previous && previous.start.getTime() < window.start.getTime()
        ? previous.start
        : window.start,
    );
    const monthEnd: Date = addUtcDays(
      addUtcMonths(startOfUtcMonth(window.lastDay), 1),
      -1,
    );
    const readLastDay: Date = new Date(
      Math.max(
        window.lastDay.getTime(),
        Math.min(monthEnd.getTime(), today.getTime()),
      ),
    );

    const query: Query<CloudCost> = {
      projectId: request.projectId,
      currency,
      day: new InBetween<Date>(readStart, readLastDay),
    } as Query<CloudCost>;

    if (request.cloudAccountIds && request.cloudAccountIds.length > 0) {
      (query as Record<string, unknown>)["cloudAccountId"] =
        request.cloudAccountIds.length === 1
          ? request.cloudAccountIds[0]
          : new Includes(request.cloudAccountIds);
    }

    const where: Statement = await CloudCostService.getScopedWhere({
      query,
      props: request.props,
    });
    const table: { databaseName: string; tableName: string } =
      CloudCostService.getTableReference();

    const facts: CloudCostQueryFacts = await CloudCostAllocationFacts.load({
      projectId: request.projectId,
      groups,
      platformRows: async (): Promise<Array<CloudCostPlatformResourceRow>> => {
        const rows: Array<JSONObject> = await this.rowsOf(
          platformResourcesStatement({
            ...table,
            where,
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
      },
    });

    const ctx: CloudCostAllocationSqlContext = {
      ...table,
      where,
      groups,
      facts,
    };
    const parts: Array<PartitionedContext> =
      CloudCostAllocationClass.partition(ctx);

    const needsMonthSpend: boolean = groups.some(
      (group: CloudCostLoadedGroup): boolean => {
        return (
          group.isShared && group.split === CloudCostSharedSplit.Proportional
        );
      },
    );
    const monthSpendWindow: CloudCostAllocationWindow = {
      start: readStart,
      lastDay: readLastDay,
    };
    const asksWouldMatch: boolean = groups.length > 0 && groups.length <= 64;

    const [
      windowAmounts,
      previousAmounts,
      monthAmounts,
      wouldMatch,
      topServices,
      topAccounts,
      topTagValues,
      topOwnerTeams,
    ]: [
      GroupBucketAmounts,
      GroupBucketAmounts,
      GroupBucketAmounts,
      Array<number>,
      Array<CloudCostAllocationShare>,
      Array<CloudCostAllocationShare>,
      Array<CloudCostAllocationTagShare>,
      Array<CloudCostAllocationShare>,
    ] = await Promise.all([
      this.readAmounts({
        parts,
        byMonth: interval === CloudCostAllocationInterval.Month,
        window,
      }),
      previous
        ? this.readAmounts({ parts, byMonth: true, window: previous })
        : Promise.resolve(new Map()),
      needsMonthSpend
        ? this.readAmounts({ parts, byMonth: true, window: monthSpendWindow })
        : Promise.resolve(new Map()),
      asksWouldMatch
        ? this.readWouldMatch({ parts, window, groupCount: groups.length })
        : Promise.resolve([]),
      this.readTop({ parts, window, groupNumber: 0, dimension: "service" }),
      this.readTop({
        parts,
        window,
        groupNumber: 0,
        dimension: "cloudAccountId",
      }),
      this.readTopTagValues({ parts, window, groupNumber: 0 }),
      facts.splitsByOwner
        ? this.readTop({
            parts,
            window,
            groupNumber: 0,
            dimension: "ownerTeam",
          })
        : Promise.resolve([]),
    ]);

    const askedGroupNumber: number = askedGroupId
      ? groups.findIndex((group: CloudCostLoadedGroup): boolean => {
          return group.id === askedGroupId;
        }) + 1
      : 0;
    const [groupServices, groupResources, groupAccounts]: [
      Array<CloudCostAllocationShare>,
      Array<CloudCostAllocationShare>,
      Array<CloudCostAllocationShare>,
    ] = askedGroupNumber
      ? await Promise.all([
          this.readTop({
            parts,
            window,
            groupNumber: askedGroupNumber,
            dimension: "service",
          }),
          this.readTop({
            parts,
            window,
            groupNumber: askedGroupNumber,
            dimension: "resourceId",
          }),
          this.readTop({
            parts,
            window,
            groupNumber: askedGroupNumber,
            dimension: "cloudAccountId",
          }),
        ])
      : [[], [], []];

    // The months' cloud spend of each group: what a proportional split weighs.
    const monthSpend: Map<string, Map<string, number>> = new Map();

    for (const [number, byMonth] of monthAmounts.entries()) {
      const group: CloudCostLoadedGroup | undefined = groups[number - 1];

      if (!group) {
        continue;
      }

      for (const [month, amount] of byMonth.entries()) {
        const spend: Map<string, number> = monthSpend.get(month) || new Map();
        add(spend, group.id, amount);
        monthSpend.set(month, spend);
      }
    }

    // A Kubernetes split's weights, per shared group.
    const kubernetesWeights: Map<
      string,
      Map<string, Map<string, number>>
    > = new Map();
    const kubernetesGroups: Array<CloudCostLoadedGroup> = groups.filter(
      (group: CloudCostLoadedGroup): boolean => {
        return (
          group.isShared &&
          group.split === CloudCostSharedSplit.Kubernetes &&
          Boolean(group.kubernetesClusterId)
        );
      },
    );

    if (kubernetesGroups.length > 0) {
      const labelKeys: Array<string> =
        CloudCostAllocationClass.getRuleTagKeys(groups);

      await Promise.all(
        kubernetesGroups.map(async (group: CloudCostLoadedGroup) => {
          const shares: Array<KubernetesNamespaceShare> =
            await KubernetesCostAllocationService.readNamespaceShares({
              projectId: request.projectId,
              kubernetesClusterId: new ObjectID(group.kubernetesClusterId!),
              start: readStart,
              endBefore: addUtcDays(readLastDay, 1),
              labelKeys,
              props: request.props,
            });

          kubernetesWeights.set(
            group.id,
            CloudCostAllocationClass.toKubernetesWeights({
              shares,
              groups,
              kubernetesClusterId: group.kubernetesClusterId!,
            }),
          );
        }),
      );
    }

    // Line items, read as the caller may read them, in the read's currency.
    const lineItems: Array<CloudCostLineItem> =
      await CloudCostLineItemService.findBy({
        query: { projectId: request.projectId, currency },
        select: {
          _id: true,
          kind: true,
          amount: true,
          recurrence: true,
          startDate: true,
          endDate: true,
          cloudAccountId: true,
          cloudCostGroupId: true,
        },
        props: request.props,
        skip: 0,
        limit: 5000,
      });
    const accountsInScope: Set<string> | null =
      request.cloudAccountIds && request.cloudAccountIds.length > 0
        ? new Set(
            request.cloudAccountIds.map((id: ObjectID): string => {
              return id.toString().toLowerCase();
            }),
          )
        : null;
    const itemsInScope: Array<CloudCostLineItem> = lineItems.filter(
      (item: CloudCostLineItem): boolean => {
        // A read of some accounts takes their line items, not a group's.
        return accountsInScope
          ? Boolean(
              item.cloudAccountId &&
                accountsInScope.has(
                  item.cloudAccountId.toString().toLowerCase(),
                ),
            )
          : true;
      },
    );
    const accountProviders: Map<string, string> = new Map();

    if (
      itemsInScope.some((item: CloudCostLineItem): boolean => {
        return Boolean(item.cloudAccountId);
      })
    ) {
      const accounts: Array<CloudAccount> = await CloudAccountService.findBy({
        query: { projectId: request.projectId },
        select: { _id: true, provider: true },
        props: { isRoot: true },
        skip: 0,
        limit: 1000,
      });

      for (const account of accounts) {
        if (account.id) {
          accountProviders.set(
            account.id.toString().toLowerCase(),
            String(account.provider || "").toLowerCase(),
          );
        }
      }
    }

    const windowLineItems: GroupBucketAmounts =
      CloudCostAllocationClass.placeLineItems({
        items: itemsInScope,
        groups,
        window,
        interval,
        accountProviders,
        accountLabels: facts.accountLabels,
      });
    const previousLineItems: GroupBucketAmounts = previous
      ? CloudCostAllocationClass.placeLineItems({
          items: itemsInScope,
          groups,
          window: previous,
          interval: CloudCostAllocationInterval.Month,
          accountProviders,
          accountLabels: facts.accountLabels,
        })
      : new Map();

    const windowCloud: CloudCostBucketAmounts =
      CloudCostAllocationClass.toBucketAmounts({
        amounts: windowAmounts,
        groups,
      });
    const windowItems: CloudCostBucketAmounts =
      CloudCostAllocationClass.toBucketAmounts({
        amounts: windowLineItems,
        groups,
      });
    const windowSplit: {
      cloudSplit: CloudCostSplitResult;
      lineItemSplit: CloudCostSplitResult;
    } = CloudCostAllocationClass.settle({
      groups,
      cloud: windowCloud,
      lineItems: windowItems,
      monthSpend,
      kubernetesWeights,
    });

    const previousCloud: CloudCostBucketAmounts =
      CloudCostAllocationClass.toBucketAmounts({
        amounts: previousAmounts,
        groups,
      });
    const previousItems: CloudCostBucketAmounts =
      CloudCostAllocationClass.toBucketAmounts({
        amounts: previousLineItems,
        groups,
      });
    const previousSplit: {
      cloudSplit: CloudCostSplitResult;
      lineItemSplit: CloudCostSplitResult;
    } = CloudCostAllocationClass.settle({
      groups,
      cloud: previousCloud,
      lineItems: previousItems,
      monthSpend,
      kubernetesWeights,
    });

    const buckets: Array<string> = getCloudCostBuckets({ window, interval });
    const coveredBy: Map<number, number> = new Map(
      findCloudCostGroupsThatNeverMatch(groups).map(
        (shadow: { groupIndex: number; coveredByGroupIndex: number }) => {
          return [shadow.groupIndex, shadow.coveredByGroupIndex];
        },
      ),
    );

    const bucketOf: (
      map: CloudCostBucketAmounts,
      id: string,
      bucket: string,
    ) => number = (
      map: CloudCostBucketAmounts,
      id: string,
      bucket: string,
    ): number => {
      return map.get(id)?.get(bucket) || 0;
    };
    const totalOf: (map: CloudCostBucketAmounts, id: string) => number = (
      map: CloudCostBucketAmounts,
      id: string,
    ): number => {
      return sumOf(map.get(id)?.values() || []);
    };

    const sharedFromOf: (groupId: string) => Array<CloudCostAllocationShare> = (
      groupId: string,
    ): Array<CloudCostAllocationShare> => {
      const from: Map<string, number> = new Map();

      for (const split of [windowSplit.cloudSplit, windowSplit.lineItemSplit]) {
        for (const [sharedId, to] of split.sharedTo.entries()) {
          const amount: number = to.get(groupId) || 0;

          if (amount !== 0) {
            add(from, sharedId, amount);
          }
        }
      }

      return topCloudCostShares(from, CLOUD_COST_MAX_GROUPS_PER_VIEW);
    };

    const groupResults: Array<CloudCostAllocationGroupResult> = groups.map(
      (
        group: CloudCostLoadedGroup,
        index: number,
      ): CloudCostAllocationGroupResult => {
        const cloud: number = totalOf(windowCloud, group.id);
        const items: number = totalOf(windowItems, group.id);
        const sharedIn: number =
          totalOf(windowSplit.cloudSplit.received, group.id) +
          totalOf(windowSplit.lineItemSplit.received, group.id);
        const sharedOut: number =
          totalOf(windowSplit.cloudSplit.given, group.id) +
          totalOf(windowSplit.lineItemSplit.given, group.id);
        const series: Array<number> = buckets.map((bucket: string): number => {
          return roundAllocation(
            bucketOf(windowCloud, group.id, bucket) +
              bucketOf(windowItems, group.id, bucket) +
              bucketOf(windowSplit.cloudSplit.received, group.id, bucket) +
              bucketOf(windowSplit.lineItemSplit.received, group.id, bucket) -
              bucketOf(windowSplit.cloudSplit.given, group.id, bucket) -
              bucketOf(windowSplit.lineItemSplit.given, group.id, bucket),
          );
        });
        const previousTotal: number | undefined = previous
          ? totalOf(previousCloud, group.id) +
            totalOf(previousItems, group.id) +
            totalOf(previousSplit.cloudSplit.received, group.id) +
            totalOf(previousSplit.lineItemSplit.received, group.id) -
            totalOf(previousSplit.cloudSplit.given, group.id) -
            totalOf(previousSplit.lineItemSplit.given, group.id)
          : undefined;
        const coveredByIndex: number | undefined = coveredBy.get(index);
        const sharedTo: Map<string, number> = new Map();

        for (const split of [
          windowSplit.cloudSplit,
          windowSplit.lineItemSplit,
        ]) {
          for (const [targetId, amount] of (
            split.sharedTo.get(group.id) || new Map<string, number>()
          ).entries()) {
            add(sharedTo, targetId, amount);
          }
        }

        const result: CloudCostAllocationGroupResult = {
          id: group.id,
          name: group.name,
          order: group.order,
          isShared: group.isShared,
          split: group.isShared ? group.split : undefined,
          teamId: group.teamId,
          cloud: roundAllocation(cloud),
          lineItems: roundAllocation(items),
          sharedIn: roundAllocation(sharedIn),
          sharedOut: roundAllocation(sharedOut),
          total: roundAllocation(cloud + items + sharedIn - sharedOut),
          previousTotal:
            previousTotal === undefined
              ? undefined
              : roundAllocation(previousTotal),
          series,
          wouldMatch: asksWouldMatch
            ? roundAllocation(wouldMatch[index] || 0)
            : undefined,
          coveredByGroupId:
            coveredByIndex === undefined
              ? undefined
              : groups[coveredByIndex]?.id,
        };

        if (group.isShared) {
          result.sharedTo = topCloudCostShares(
            sharedTo,
            CLOUD_COST_MAX_GROUPS_PER_VIEW,
          );
        } else {
          const from: Array<CloudCostAllocationShare> = sharedFromOf(group.id);

          if (from.length > 0) {
            result.sharedFrom = from;
          }
        }

        if (index + 1 === askedGroupNumber) {
          result.topServices = groupServices;
          result.topResources = groupResources;
          result.topAccounts = groupAccounts;
        }

        return result;
      },
    );

    const unallocatedCloud: number = totalOf(windowCloud, "");
    const unallocatedItems: number = totalOf(windowItems, "");
    const cloudTotal: number = sumOf(
      Array.from(windowCloud.values()).map((byBucket: Map<string, number>) => {
        return sumOf(byBucket.values());
      }),
    );
    const itemsTotal: number = sumOf(
      Array.from(windowItems.values()).map((byBucket: Map<string, number>) => {
        return sumOf(byBucket.values());
      }),
    );
    const previousTotal: number | undefined = previous
      ? sumOf(
          Array.from(previousCloud.values()).map(
            (byBucket: Map<string, number>) => {
              return sumOf(byBucket.values());
            },
          ),
        ) +
        sumOf(
          Array.from(previousItems.values()).map(
            (byBucket: Map<string, number>) => {
              return sumOf(byBucket.values());
            },
          ),
        )
      : undefined;

    return {
      viewId: view.id.toString(),
      viewName: view.name || "",
      currency,
      interval,
      start: toCloudCostBucket(window.start, CloudCostAllocationInterval.Day),
      lastDay: toCloudCostBucket(
        window.lastDay,
        CloudCostAllocationInterval.Day,
      ),
      previousStart: previous
        ? toCloudCostBucket(previous.start, CloudCostAllocationInterval.Day)
        : undefined,
      previousLastDay: previous
        ? toCloudCostBucket(previous.lastDay, CloudCostAllocationInterval.Day)
        : undefined,
      buckets,
      cloud: roundAllocation(cloudTotal),
      lineItems: roundAllocation(itemsTotal),
      total: roundAllocation(cloudTotal + itemsTotal),
      previousTotal:
        previousTotal === undefined
          ? undefined
          : roundAllocation(previousTotal),
      groups: groupResults,
      unallocated: {
        cloud: roundAllocation(unallocatedCloud),
        lineItems: roundAllocation(unallocatedItems),
        total: roundAllocation(unallocatedCloud + unallocatedItems),
        previousTotal: previous
          ? roundAllocation(
              totalOf(previousCloud, "") + totalOf(previousItems, ""),
            )
          : undefined,
        series: buckets.map((bucket: string): number => {
          return roundAllocation(
            bucketOf(windowCloud, "", bucket) +
              bucketOf(windowItems, "", bucket),
          );
        }),
        topServices,
        topAccounts,
        topTagValues,
        topOwnerTeams,
      },
      readAt: now.toISOString(),
    };
  }

  /*
   * One group's spend in a window: its view read with the group asked for,
   * and the group's own entry - what a budget compares with its amount and
   * a report sends to its team.
   */
  @CaptureSpan()
  public async readGroup(data: {
    projectId: ObjectID;
    groupId: ObjectID;
    startDate: Date;
    endDate: Date;
    interval?: CloudCostAllocationInterval | undefined;
    currency?: string | undefined;
    compareWithPrevious?: boolean | undefined;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<{
    allocation: CloudCostAllocationResult;
    group: CloudCostAllocationGroupResult;
  }> {
    const group: CloudCostGroup | null = await CloudCostGroupService.findOneBy({
      query: { _id: data.groupId, projectId: data.projectId },
      select: { _id: true, cloudCostViewId: true },
      props: data.props,
    });

    if (!group?.cloudCostViewId) {
      throw new NotFoundException(
        "This cost group was not found. It may have been deleted, or you may not have access to it.",
      );
    }

    const allocation: CloudCostAllocationResult = await this.read({
      projectId: data.projectId,
      viewId: group.cloudCostViewId,
      groupId: data.groupId,
      startDate: data.startDate,
      endDate: data.endDate,
      interval: data.interval,
      currency: data.currency,
      compareWithPrevious: data.compareWithPrevious,
      props: data.props,
      now: data.now,
    });
    const own: CloudCostAllocationGroupResult | undefined =
      allocation.groups.find(
        (entry: CloudCostAllocationGroupResult): boolean => {
          return entry.id === data.groupId.toString().toLowerCase();
        },
      );

    if (!own) {
      throw new NotFoundException(
        "This cost group was not found in its view. It may have been deleted, or you may not have access to it.",
      );
    }

    return { allocation, group: own };
  }
}

export default new CloudCostAllocationClass();
