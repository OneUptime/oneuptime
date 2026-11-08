import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import {
  addTelemetryUsageAmounts,
  getEmptyTelemetryUsageAmount,
  getTelemetryUsageDays,
  isTelemetryUsageProductType,
  TelemetryProjectUsagePage,
  TelemetryProjectUsageSortBy,
  TelemetryProjectUsageSummary,
  TelemetryUsageAmount,
  TelemetryUsageByProduct,
  TelemetryUsageDaySummary,
  TelemetryUsageResourceSummary,
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
 */

const TABLE: string = '"TelemetryUsageBilling"';

// A UTC day of a row, as YYYY-MM-DD.
const ROW_DAY: string = `to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

interface ProductSumRow {
  productType: string;
  dataIngestedInGB: string | number | null;
  totalCostInUSD: string | number | null;
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
  row: ProductSumRow,
  isCostIncluded: boolean,
) => TelemetryUsageAmount = (
  row: ProductSumRow,
  isCostIncluded: boolean,
): TelemetryUsageAmount => {
  const amount: TelemetryUsageAmount = {
    dataIngestedInGB: toNumber(row.dataIngestedInGB),
  };

  if (isCostIncluded) {
    amount.totalCostInUSD = toNumber(row.totalCostInUSD);
  }

  return amount;
};

// Adds an amount to a signal's, and to a total.
const addToProduct: (
  target: { byProduct: TelemetryUsageByProduct; total: TelemetryUsageAmount },
  productType: ProductType,
  amount: TelemetryUsageAmount,
  isCostIncluded: boolean,
) => void = (
  target: { byProduct: TelemetryUsageByProduct; total: TelemetryUsageAmount },
  productType: ProductType,
  amount: TelemetryUsageAmount,
  isCostIncluded: boolean,
): void => {
  target.byProduct[productType] = addTelemetryUsageAmounts(
    target.byProduct[productType] ||
      getEmptyTelemetryUsageAmount(isCostIncluded),
    amount,
  );
  target.total = addTelemetryUsageAmounts(target.total, amount);
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
        `SELECT ${ROW_DAY} AS "day", "productType" AS "productType", COALESCE(SUM("dataIngestedInGB"), 0)::text AS "dataIngestedInGB", COALESCE(SUM("totalCostInUSD"), 0)::text AS "totalCostInUSD" FROM ${TABLE} WHERE ${where} GROUP BY 1, 2`,
        parameters,
      ),
      /*
       * A resource's retention is the one its newest row in the range was
       * counted at: retention is changed now and then, and the newest day
       * is the one still being kept for it.
       */
      TelemetryUsageReads.query<ResourceSumRow>(
        `SELECT "primaryEntityId"::text AS "primaryEntityId", "primaryEntityType" AS "primaryEntityType", "productType" AS "productType", COALESCE(SUM("dataIngestedInGB"), 0)::text AS "dataIngestedInGB", COALESCE(SUM("totalCostInUSD"), 0)::text AS "totalCostInUSD", (ARRAY_AGG("retainTelemetryDataForDays" ORDER BY "createdAt" DESC))[1] AS "retentionInDays" FROM ${TABLE} WHERE ${where} GROUP BY 1, 2, 3`,
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

      const amount: TelemetryUsageAmount = toAmount(row, data.isCostIncluded);

      addToProduct(day, row.productType, amount, data.isCostIncluded);
      addToProduct(summary, row.productType, amount, data.isCostIncluded);
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

      addToProduct(
        resource,
        row.productType,
        toAmount(row, data.isCostIncluded),
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

    const names: Map<string, string> = await TelemetryUsageResourceNames.resolve(
      {
        projectId: data.projectId,
        resources: Array.from(resources.values()),
        props: data.nameProps,
      },
    );

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
   * that has been deleted is left out.
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
        `SELECT u."projectId"::text AS "projectId", p."name" AS "projectName", u."productType" AS "productType", COALESCE(SUM(u."dataIngestedInGB"), 0)::text AS "dataIngestedInGB", COALESCE(SUM(u."totalCostInUSD"), 0)::text AS "totalCostInUSD" FROM ${TABLE} u INNER JOIN "Project" p ON p."_id" = u."projectId" AND p."deletedAt" IS NULL WHERE u."createdAt" >= $1 AND u."createdAt" < $2 AND u."deletedAt" IS NULL GROUP BY 1, 2, 3`,
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
      const amount: TelemetryUsageAmount = toAmount(row, data.isCostIncluded);

      addToProduct(project, row.productType, amount, data.isCostIncluded);
      addToProduct(instance, row.productType, amount, data.isCostIncluded);
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
  public static getRetention(
    byProduct: Map<ProductType, number>,
  ): {
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
