import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import {
  addTelemetryUsageAmounts,
  getEmptyTelemetryUsageAmount,
  getTelemetryUsageDays,
  isTelemetryUsageProductType,
  TELEMETRY_USAGE_EXCEPTIONS_SIGNAL,
  TelemetryProjectUsagePage,
  TelemetryProjectUsageSortBy,
  TelemetryProjectUsageSummary,
  TelemetryUsageAmount,
  TelemetryUsageByProduct,
  TelemetryUsageDaySummary,
  TelemetryUsageResourceSummary,
  TelemetryUsageSignal,
  TelemetryUsageSummary,
  TelemetryUsageWindow,
  toTelemetryUsageDay,
} from "../../../Types/Telemetry/TelemetryUsage";
import TelemetryUsageBillingService from "../../Services/TelemetryUsageBillingService";
import CaptureSpan from "../Telemetry/CaptureSpan";
import TelemetryUsageResourceNames from "./TelemetryUsageResourceNames";

/*
 * The usage pages' reads: the staged daily usage rows (TelemetryUsageBilling)
 * summed in Postgres, never a ClickHouse scan. A row is one resource's usage
 * of one signal on one UTC day, and its createdAt is that day's UTC midnight,
 * so a range of days is a range of createdAt.
 *
 *   - getProjectUsage: one project over a range - each day by signal, each
 *     resource by signal with the retention it is kept for, and the totals.
 *     Project Settings > Telemetry & APM > Usage, and the Admin Dashboard's
 *     view of one project.
 *   - getUsageByProject: every project over a range, heaviest first, for the
 *     instance admin (Admin Dashboard > Telemetry Usage).
 *
 * What usage cost is read only when the caller may see it (isCostIncluded):
 * billing is on and they read billing. Without it no cost leaves the server.
 *
 * Exceptions are shown as a signal of their own (issue #6356), though they
 * are billed inside Traces: a Traces row keeps everything it is billed for in
 * dataIngestedInGB, and how much of that was exceptions in
 * exceptionDataIngestedInGB. Each read takes that part out of the row's
 * Traces and shows it as Exceptions, with its share of the row's cost - so
 * every total, and every cost, is what it was. A Traces row counted before
 * the exceptions were counted apart has no part to take out: its exceptions
 * stay inside Traces, as they were shown when it was counted.
 */

const TABLE: string = '"TelemetryUsageBilling"';

// A UTC day of a row, as YYYY-MM-DD.
const ROW_DAY: string = `to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

/*
 * A row's exceptions, in GB: a Traces row's recorded part, never less than
 * none nor more than the row holds. Every other row - another product's, and
 * a Traces row counted before the part was recorded (NULL) - has none.
 * `alias` is the table's, with its dot ('u.'), or '' for none.
 */
export const getExceptionGBSql: (alias: string) => string = (
  alias: string,
): string => {
  return `(CASE WHEN ${alias}"productType" = '${ProductType.Traces}' THEN LEAST(GREATEST(COALESCE(${alias}"exceptionDataIngestedInGB", 0), 0), ${alias}"dataIngestedInGB") ELSE 0 END)`;
};

/*
 * What a row's exceptions cost, of its cost: their share of its GB. A row's
 * cost is its GB times a price for its retention, so the share is exact; the
 * exceptions are never priced, or charged, apart.
 */
export const getExceptionCostSql: (alias: string) => string = (
  alias: string,
): string => {
  return `(CASE WHEN ${alias}"dataIngestedInGB" > 0 THEN ${alias}"totalCostInUSD" * ${getExceptionGBSql(alias)} / ${alias}"dataIngestedInGB" ELSE 0 END)`;
};

/*
 * The sums each read selects for its group of rows: the rows' own product
 * with the exceptions taken out, and the exceptions apart - together, every
 * GB and every cent of the rows, each counted once.
 */
export const getSignalSumsSql: (alias: string) => string = (
  alias: string,
): string => {
  return [
    `COALESCE(SUM(${alias}"dataIngestedInGB" - ${getExceptionGBSql(alias)}), 0)::text AS "dataIngestedInGB"`,
    `COALESCE(SUM(${alias}"totalCostInUSD" - ${getExceptionCostSql(alias)}), 0)::text AS "totalCostInUSD"`,
    `COALESCE(SUM(${getExceptionGBSql(alias)}), 0)::text AS "exceptionDataIngestedInGB"`,
    `COALESCE(SUM(${getExceptionCostSql(alias)}), 0)::text AS "exceptionCostInUSD"`,
  ].join(", ");
};

interface ProductSumRow {
  productType: string;
  // The product's own, the exceptions taken out of Traces.
  dataIngestedInGB: string | number | null;
  totalCostInUSD: string | number | null;
  // The exceptions of Traces rows; none for any other product.
  exceptionDataIngestedInGB?: string | number | null | undefined;
  exceptionCostInUSD?: string | number | null | undefined;
}

interface DaySumRow extends ProductSumRow {
  day: string;
}

interface ResourceSumRow extends ProductSumRow {
  primaryEntityId: string;
  primaryEntityType: string | null;
  retentionInDays: string | number | null;
}

interface ProjectSumRow extends ProductSumRow {
  projectId: string;
  projectName: string | null;
}

const toNumber: (value: string | number | null | undefined) => number = (
  value: string | number | null | undefined,
): number => {
  const parsed: number = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
};

const toAmount: (
  sums: {
    dataIngestedInGB: string | number | null | undefined;
    totalCostInUSD: string | number | null | undefined;
  },
  isCostIncluded: boolean,
) => TelemetryUsageAmount = (
  sums: {
    dataIngestedInGB: string | number | null | undefined;
    totalCostInUSD: string | number | null | undefined;
  },
  isCostIncluded: boolean,
): TelemetryUsageAmount => {
  const amount: TelemetryUsageAmount = {
    dataIngestedInGB: toNumber(sums.dataIngestedInGB),
  };

  if (isCostIncluded) {
    amount.totalCostInUSD = toNumber(sums.totalCostInUSD);
  }

  return amount;
};

export interface TelemetryUsageSignalAmount {
  signal: TelemetryUsageSignal;
  amount: TelemetryUsageAmount;
}

/*
 * The signals a group of one product's rows holds, and how much of each: the
 * product's own, and for Traces the exceptions apart, when there were any.
 * Rows that held only exceptions hold no Traces of their own.
 */
export const getSignalAmounts: (
  row: ProductSumRow & { productType: ProductType },
  isCostIncluded: boolean,
) => Array<TelemetryUsageSignalAmount> = (
  row: ProductSumRow & { productType: ProductType },
  isCostIncluded: boolean,
): Array<TelemetryUsageSignalAmount> => {
  const own: TelemetryUsageAmount = toAmount(row, isCostIncluded);
  const exceptions: TelemetryUsageAmount = toAmount(
    {
      dataIngestedInGB: row.exceptionDataIngestedInGB,
      totalCostInUSD: row.exceptionCostInUSD,
    },
    isCostIncluded,
  );
  const hasExceptions: boolean =
    row.productType === ProductType.Traces && exceptions.dataIngestedInGB > 0;

  const amounts: Array<TelemetryUsageSignalAmount> = [];

  if (!hasExceptions || own.dataIngestedInGB > 0) {
    amounts.push({ signal: row.productType, amount: own });
  }

  if (hasExceptions) {
    amounts.push({
      signal: TELEMETRY_USAGE_EXCEPTIONS_SIGNAL,
      amount: exceptions,
    });
  }

  return amounts;
};

// Adds an amount to a signal's, and to a total.
const addToProduct: (
  target: { byProduct: TelemetryUsageByProduct; total: TelemetryUsageAmount },
  signal: TelemetryUsageSignal,
  amount: TelemetryUsageAmount,
  isCostIncluded: boolean,
) => void = (
  target: { byProduct: TelemetryUsageByProduct; total: TelemetryUsageAmount },
  signal: TelemetryUsageSignal,
  amount: TelemetryUsageAmount,
  isCostIncluded: boolean,
): void => {
  target.byProduct[signal] = addTelemetryUsageAmounts(
    target.byProduct[signal] || getEmptyTelemetryUsageAmount(isCostIncluded),
    amount,
  );
  target.total = addTelemetryUsageAmounts(target.total, amount);
};

// Adds each signal a group of rows holds to a target's, and to its total.
const addSignals: (
  target: { byProduct: TelemetryUsageByProduct; total: TelemetryUsageAmount },
  signalAmounts: Array<TelemetryUsageSignalAmount>,
  isCostIncluded: boolean,
) => void = (
  target: { byProduct: TelemetryUsageByProduct; total: TelemetryUsageAmount },
  signalAmounts: Array<TelemetryUsageSignalAmount>,
  isCostIncluded: boolean,
): void => {
  for (const each of signalAmounts) {
    addToProduct(target, each.signal, each.amount, isCostIncluded);
  }
};

export default class TelemetryUsageReads {
  @CaptureSpan()
  public static async getProjectUsage(data: {
    projectId: ObjectID;
    window: TelemetryUsageWindow;
    isCostIncluded: boolean;
    // Whose read the resources are named with (TelemetryUsageResourceNames).
    nameProps: DatabaseCommonInteractionProps;
  }): Promise<TelemetryUsageSummary> {
    const parameters: Array<unknown> = [
      data.projectId.toString(),
      data.window.start,
      data.window.end,
    ];
    const where: string = `"projectId" = $1 AND "createdAt" >= $2 AND "createdAt" < $3 AND "deletedAt" IS NULL`;

    const [dayRows, resourceRows, latestRows]: [
      Array<DaySumRow>,
      Array<ResourceSumRow>,
      Array<{ latestDay: string | null }>,
    ] = await Promise.all([
      TelemetryUsageReads.query<DaySumRow>(
        `SELECT ${ROW_DAY} AS "day", "productType" AS "productType", ${getSignalSumsSql("")} FROM ${TABLE} WHERE ${where} GROUP BY 1, 2`,
        parameters,
      ),
      /*
       * A resource's retention is the one its newest row in the range was
       * counted at: retention is changed now and then, and the newest day
       * is the one still being kept for it.
       */
      TelemetryUsageReads.query<ResourceSumRow>(
        `SELECT "primaryEntityId"::text AS "primaryEntityId", "primaryEntityType" AS "primaryEntityType", "productType" AS "productType", ${getSignalSumsSql("")}, (ARRAY_AGG("retainTelemetryDataForDays" ORDER BY "createdAt" DESC))[1] AS "retentionInDays" FROM ${TABLE} WHERE ${where} GROUP BY 1, 2, 3`,
        parameters,
      ),
      // The newest day counted at all, so an empty range can say why.
      TelemetryUsageReads.query<{ latestDay: string | null }>(
        `SELECT to_char(MAX("createdAt") AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "latestDay" FROM ${TABLE} WHERE "projectId" = $1 AND "deletedAt" IS NULL`,
        [data.projectId.toString()],
      ),
    ]);

    const summary: TelemetryUsageSummary = {
      startDay: toTelemetryUsageDay(data.window.start),
      endDay: toTelemetryUsageDay(new Date(data.window.end.getTime() - 1)),
      isCostIncluded: data.isCostIncluded,
      total: getEmptyTelemetryUsageAmount(data.isCostIncluded),
      byProduct: {},
      days: [],
      resources: [],
      latestDay: latestRows[0]?.latestDay || null,
    };

    const days: Map<string, TelemetryUsageDaySummary> = new Map();

    for (const day of getTelemetryUsageDays(data.window)) {
      days.set(day, {
        day: day,
        byProduct: {},
        total: getEmptyTelemetryUsageAmount(data.isCostIncluded),
      });
    }

    for (const row of dayRows) {
      const day: TelemetryUsageDaySummary | undefined = days.get(row.day);

      if (!day || !isTelemetryUsageProductType(row.productType)) {
        continue;
      }

      const signalAmounts: Array<TelemetryUsageSignalAmount> = getSignalAmounts(
        { ...row, productType: row.productType },
        data.isCostIncluded,
      );

      addSignals(day, signalAmounts, data.isCostIncluded);
      addSignals(summary, signalAmounts, data.isCostIncluded);
    }

    summary.days = Array.from(days.values());

    const resources: Map<string, TelemetryUsageResourceSummary> = new Map();
    // Each resource's retention by signal, on the newest day it sent it.
    const retentions: Map<string, Map<ProductType, number>> = new Map();

    for (const row of resourceRows) {
      if (!isTelemetryUsageProductType(row.productType)) {
        continue;
      }

      const key: string = row.primaryEntityId;
      const resource: TelemetryUsageResourceSummary = resources.get(key) || {
        primaryEntityId: row.primaryEntityId,
        primaryEntityType: (row.primaryEntityType as ServiceType) || null,
        name: null,
        byProduct: {},
        total: getEmptyTelemetryUsageAmount(data.isCostIncluded),
        retentionInDays: null,
        sessionReplayRetentionInDays: null,
      };

      addSignals(
        resource,
        getSignalAmounts(
          { ...row, productType: row.productType },
          data.isCostIncluded,
        ),
        data.isCostIncluded,
      );

      if (!resource.primaryEntityType && row.primaryEntityType) {
        resource.primaryEntityType = row.primaryEntityType as ServiceType;
      }

      const retentionInDays: number = toNumber(row.retentionInDays);

      if (retentionInDays > 0) {
        const byProduct: Map<ProductType, number> =
          retentions.get(key) || new Map();
        byProduct.set(row.productType, retentionInDays);
        retentions.set(key, byProduct);
      }

      resources.set(key, resource);
    }

    for (const [key, byProduct] of retentions) {
      const resource: TelemetryUsageResourceSummary = resources.get(key)!;
      const retention: {
        retentionInDays: number | null;
        sessionReplayRetentionInDays: number | null;
      } = TelemetryUsageReads.getRetention(byProduct);

      resource.retentionInDays = retention.retentionInDays;
      resource.sessionReplayRetentionInDays =
        retention.sessionReplayRetentionInDays;
    }

    const names: Map<string, string> =
      await TelemetryUsageResourceNames.resolve({
        projectId: data.projectId,
        resources: Array.from(resources.values()),
        props: data.nameProps,
      });

    summary.resources = Array.from(resources.values())
      .map(
        (
          resource: TelemetryUsageResourceSummary,
        ): TelemetryUsageResourceSummary => {
          return {
            ...resource,
            name: names.get(resource.primaryEntityId) || null,
          };
        },
      )
      .sort(
        (
          first: TelemetryUsageResourceSummary,
          second: TelemetryUsageResourceSummary,
        ): number => {
          return (
            second.total.dataIngestedInGB - first.total.dataIngestedInGB ||
            first.primaryEntityId.localeCompare(second.primaryEntityId)
          );
        },
      );

    return summary;
  }

  /*
   * Every project's usage over a range, for the instance admin: one page of
   * the projects that sent anything, in the order asked for (the heaviest
   * first by default), with the instance-wide totals beside it. A project
   * that has been deleted is left out, and so is a sample project (issue
   * #6808), which is in nobody's usage.
   */
  @CaptureSpan()
  public static async getUsageByProject(data: {
    window: TelemetryUsageWindow;
    isCostIncluded: boolean;
    sortBy: TelemetryProjectUsageSortBy;
    sortOrder: "asc" | "desc";
    skip: number;
    limit: number;
  }): Promise<TelemetryProjectUsagePage> {
    const rows: Array<ProjectSumRow> =
      await TelemetryUsageReads.query<ProjectSumRow>(
        `SELECT u."projectId"::text AS "projectId", p."name" AS "projectName", u."productType" AS "productType", ${getSignalSumsSql("u.")} FROM ${TABLE} u INNER JOIN "Project" p ON p."_id" = u."projectId" AND p."deletedAt" IS NULL AND p."isSampleProject" = false WHERE u."createdAt" >= $1 AND u."createdAt" < $2 AND u."deletedAt" IS NULL GROUP BY 1, 2, 3`,
        [data.window.start, data.window.end],
      );

    const instance: {
      byProduct: TelemetryUsageByProduct;
      total: TelemetryUsageAmount;
    } = {
      byProduct: {},
      total: getEmptyTelemetryUsageAmount(data.isCostIncluded),
    };
    const projects: Map<string, TelemetryProjectUsageSummary> = new Map();

    for (const row of rows) {
      if (!isTelemetryUsageProductType(row.productType)) {
        continue;
      }

      const project: TelemetryProjectUsageSummary = projects.get(
        row.projectId,
      ) || {
        projectId: row.projectId,
        projectName: row.projectName || null,
        byProduct: {},
        total: getEmptyTelemetryUsageAmount(data.isCostIncluded),
      };
      const signalAmounts: Array<TelemetryUsageSignalAmount> = getSignalAmounts(
        { ...row, productType: row.productType },
        data.isCostIncluded,
      );

      addSignals(project, signalAmounts, data.isCostIncluded);
      addSignals(instance, signalAmounts, data.isCostIncluded);
      projects.set(row.projectId, project);
    }

    const sorted: Array<TelemetryProjectUsageSummary> = Array.from(
      projects.values(),
    ).sort(
      (
        first: TelemetryProjectUsageSummary,
        second: TelemetryProjectUsageSummary,
      ): number => {
        const order: number = TelemetryUsageReads.compareProjects(
          first,
          second,
          data.sortBy,
        );

        // Ties, and the name order's own, by id, so a page never reshuffles.
        return (
          (data.sortOrder === "asc" ? order : -order) ||
          first.projectId.localeCompare(second.projectId)
        );
      },
    );

    return {
      startDay: toTelemetryUsageDay(data.window.start),
      endDay: toTelemetryUsageDay(new Date(data.window.end.getTime() - 1)),
      isCostIncluded: data.isCostIncluded,
      total: instance.total,
      byProduct: instance.byProduct,
      projects: sorted.slice(data.skip, data.skip + data.limit),
      count: sorted.length,
      skip: data.skip,
      limit: data.limit,
    };
  }

  // Ascending order by what the list is sorted by.
  public static compareProjects(
    first: TelemetryProjectUsageSummary,
    second: TelemetryProjectUsageSummary,
    sortBy: TelemetryProjectUsageSortBy,
  ): number {
    if (sortBy === "name") {
      return (first.projectName || "").localeCompare(
        second.projectName || "",
        undefined,
        { sensitivity: "base" },
      );
    }

    if (sortBy === "total") {
      return first.total.dataIngestedInGB - second.total.dataIngestedInGB;
    }

    return (
      (first.byProduct[sortBy]?.dataIngestedInGB || 0) -
      (second.byProduct[sortBy]?.dataIngestedInGB || 0)
    );
  }

  /*
   * A resource's retention, from each signal's on the newest day it sent it:
   * the longest of its telemetry's, and its session replays' apart - a RUM
   * application keeps its recordings for days of their own (7 unless
   * changed), never for the telemetry retention.
   */
  public static getRetention(byProduct: Map<ProductType, number>): {
    retentionInDays: number | null;
    sessionReplayRetentionInDays: number | null;
  } {
    let retentionInDays: number | null = null;

    for (const [productType, days] of byProduct) {
      if (productType !== ProductType.SessionReplay) {
        retentionInDays = Math.max(retentionInDays || 0, days);
      }
    }

    return {
      retentionInDays: retentionInDays,
      sessionReplayRetentionInDays:
        byProduct.get(ProductType.SessionReplay) || null,
    };
  }

  private static async query<T>(
    sql: string,
    parameters: Array<unknown>,
  ): Promise<Array<T>> {
    return (await TelemetryUsageBillingService.getRepository().manager.query(
      sql,
      parameters,
    )) as Array<T>;
  }
}
