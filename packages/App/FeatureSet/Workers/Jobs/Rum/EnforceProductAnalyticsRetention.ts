import RunCron from "../../Utils/Cron";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import AnalyticsDatabaseService, {
  MigrationExecuteOptions,
} from "Common/Server/Services/AnalyticsDatabaseService";
import RumApplicationService from "Common/Server/Services/RumApplicationService";
import RumProductAnalyticsEventService from "Common/Server/Services/RumProductAnalyticsEventService";
import RumProductAnalyticsSessionService from "Common/Server/Services/RumProductAnalyticsSessionService";
import RumProductAnalyticsUserService from "Common/Server/Services/RumProductAnalyticsUserService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import {
  getStorageTableName,
  onClusterClause,
} from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import {
  SQL,
  Statement,
} from "Common/Server/Utils/AnalyticsDatabase/Statement";
import logger from "Common/Server/Utils/Logger";
import AnalyticsTableName from "Common/Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import Includes from "Common/Types/BaseDatabase/Includes";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import {
  DEFAULT_PRODUCT_ANALYTICS_RETENTION_MONTHS,
  MAX_PRODUCT_ANALYTICS_RETENTION_MONTHS,
  PRODUCT_ANALYTICS_RETENTION_MONTHS_OPTIONS,
  getProductAnalyticsRetentionCutoff,
  getProductAnalyticsRetentionMonths,
} from "Common/Types/Rum/ProductAnalytics";
import { EVERY_DAY } from "Common/Utils/CronTime";

/*
 * ------------------------------------------------------------------
 * Rum:EnforceProductAnalyticsRetention
 *
 * Each RUM application chooses how long product analytics keeps its
 * numbers and events: 3, 6, 13 or 25 months (issue #6626). The three
 * tables' TTL keeps the longest choice for everyone, by whole monthly parts;
 * this job deletes, once a day, every application's rows older than its own
 * choice - the default 13 months included.
 *
 * Why a job and not a per-row TTL, as the telemetry tables have: the session
 * and person tables are filled by materialized views from RumSessionV1,
 * which cannot read an application's setting, and a retention stamped on a
 * row when it is written would leave everything already kept where it was
 * when someone lowers it - a privacy policy that promises 6 months needs the
 * older months gone, not the new ones kept shorter. A job reads the setting
 * as it is now.
 *
 * What it costs. A month's rows reach a cutoff together, so each table sees
 * at most one mutation per choice per month, plus one when a setting is
 * lowered. Applications are grouped by their choice rather than handled one
 * by one, so the count does not grow with the number of applications: for
 * every choice below the default, a mutation names its applications (a
 * thousand a mutation); for the default, it names the few that chose more,
 * and deletes everyone else's older rows - those of an application deleted
 * since, too. A mutation that matches no row is never queued: each one is
 * first probed with a SELECT ... LIMIT 1 under the same WHERE. A mutation
 * rewrites only the parts it matches, and one that empties a part writes
 * nothing for it. Deletes go through the migration pool and are queued, not
 * waited for (mutations_sync is left at its default), as the erasure job's
 * are.
 *
 * Erasure is separate: an erasure request removes a subject's rows at once
 * (Rum:ProcessSessionErasureRequests); this only keeps the setting.
 * ------------------------------------------------------------------
 */

const JOB_NAME: string = "Rum:EnforceProductAnalyticsRetention";

/* Once a day: a month's rows reach their cutoff together, on its first day. */
export const PRODUCT_ANALYTICS_RETENTION_SCHEDULE: string = EVERY_DAY;

/* Applications one statement names, as the erasure job's deletes do. */
export const PRODUCT_ANALYTICS_RETENTION_IDS_PER_STATEMENT: number = 1000;

/* A product analytics table, and the column its rows are aged by. */
export interface ProductAnalyticsRetentionTable {
  tableName: AnalyticsTableName;
  timeColumn: string;
  timeType: TableColumnType;
  service: AnalyticsDatabaseService<AnalyticsBaseModel>;
}

export const PRODUCT_ANALYTICS_RETENTION_TABLES: Array<ProductAnalyticsRetentionTable> =
  [
    {
      tableName: AnalyticsTableName.RumProductAnalyticsSession,
      timeColumn: "startTime",
      timeType: TableColumnType.DateTime64,
      service:
        RumProductAnalyticsSessionService as unknown as AnalyticsDatabaseService<AnalyticsBaseModel>,
    },
    {
      tableName: AnalyticsTableName.RumProductAnalyticsUser,
      timeColumn: "month",
      timeType: TableColumnType.Date,
      service:
        RumProductAnalyticsUserService as unknown as AnalyticsDatabaseService<AnalyticsBaseModel>,
    },
    {
      tableName: AnalyticsTableName.RumProductAnalyticsEvent,
      timeColumn: "time",
      timeType: TableColumnType.DateTime64,
      service:
        RumProductAnalyticsEventService as unknown as AnalyticsDatabaseService<AnalyticsBaseModel>,
    },
  ];

/* An application that chose other than the default, and what it chose. */
export interface ProductAnalyticsRetentionChoice {
  rumApplicationId: string;
  months: number;
}

/*
 * One choice's deletes: the rows older than its cutoff, of the applications
 * listed ("only"), or of every application but those listed ("allBut").
 */
export interface ProductAnalyticsRetentionBucket {
  months: number;
  cutoff: Date;
  mode: "only" | "allBut";
  rumApplicationIds: Array<string>;
}

/*
 * The choices' deletes, shortest first. The longest is the TTL's, and has
 * none. The default names the applications that chose more and takes
 * every other one's rows: the default is what an application keeps unless
 * it chose otherwise, an application deleted since included, and its
 * cutoff is past every shorter choice's, whose rows are gone already. Any
 * other choice names its own applications, and is left out when nobody
 * made it.
 */
export function buildProductAnalyticsRetentionBuckets(data: {
  choices: Array<ProductAnalyticsRetentionChoice>;
  now: Date;
}): Array<ProductAnalyticsRetentionBucket> {
  const buckets: Array<ProductAnalyticsRetentionBucket> = [];

  const sortedOptions: Array<number> = [
    ...PRODUCT_ANALYTICS_RETENTION_MONTHS_OPTIONS,
  ].sort((left: number, right: number): number => {
    return left - right;
  });

  for (const months of sortedOptions) {
    if (months === MAX_PRODUCT_ANALYTICS_RETENTION_MONTHS) {
      continue;
    }

    const cutoff: Date = getProductAnalyticsRetentionCutoff(months, data.now);

    if (months === DEFAULT_PRODUCT_ANALYTICS_RETENTION_MONTHS) {
      buckets.push({
        months: months,
        cutoff: cutoff,
        mode: "allBut",
        rumApplicationIds: distinct(
          data.choices
            .filter((choice: ProductAnalyticsRetentionChoice): boolean => {
              return choice.months > months;
            })
            .map((choice: ProductAnalyticsRetentionChoice): string => {
              return choice.rumApplicationId;
            }),
        ),
      });
      continue;
    }

    const rumApplicationIds: Array<string> = distinct(
      data.choices
        .filter((choice: ProductAnalyticsRetentionChoice): boolean => {
          return choice.months === months;
        })
        .map((choice: ProductAnalyticsRetentionChoice): string => {
          return choice.rumApplicationId;
        }),
    );

    if (rumApplicationIds.length > 0) {
      buckets.push({
        months: months,
        cutoff: cutoff,
        mode: "only",
        rumApplicationIds: rumApplicationIds,
      });
    }
  }

  return buckets;
}

function distinct(values: Array<string>): Array<string> {
  return Array.from(new Set<string>(values)).sort();
}

function chunk(values: Array<string>, size: number): Array<Array<string>> {
  const chunks: Array<Array<string>> = [];

  for (let index: number = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

/*
 * The WHEREs of one bucket on one table: the rows older than the cutoff, of
 * a thousand applications each ("only"), or of every application but those
 * the bucket names - all of them in one WHERE, a thousand to a bound list
 * ("allBut"). Ids and the cutoff are bound, never written into the SQL.
 */
export function buildProductAnalyticsRetentionWheres(data: {
  table: ProductAnalyticsRetentionTable;
  bucket: ProductAnalyticsRetentionBucket;
}): Array<Statement> {
  const older: () => Statement = (): Statement => {
    const statement: Statement = SQL``;
    statement.append(`${data.table.timeColumn} < `);
    statement.append(
      SQL`${{
        type: data.table.timeType,
        value: data.bucket.cutoff,
      }}`,
    );
    return statement;
  };

  const lists: Array<Array<string>> = chunk(
    data.bucket.rumApplicationIds,
    PRODUCT_ANALYTICS_RETENTION_IDS_PER_STATEMENT,
  );

  if (data.bucket.mode === "only") {
    return lists.map((ids: Array<string>): Statement => {
      return older().append(
        SQL` AND rumApplicationId IN ${{
          type: TableColumnType.Text,
          value: new Includes(ids),
        }}`,
      );
    });
  }

  const where: Statement = older();

  for (const ids of lists) {
    where.append(
      SQL` AND rumApplicationId NOT IN ${{
        type: TableColumnType.Text,
        value: new Includes(ids),
      }}`,
    );
  }

  return [where];
}

/* Whether a WHERE matches any row, across the cluster: SELECT 1 ... LIMIT 1. */
export function buildProductAnalyticsRetentionProbe(data: {
  databaseName: string;
  table: ProductAnalyticsRetentionTable;
  where: Statement;
}): Statement {
  return SQL`SELECT 1 AS paFound FROM ${data.databaseName}.${data.table.tableName} WHERE `
    .append(data.where)
    .append(" LIMIT 1");
}

/*
 * The delete: on the LOCAL storage table, dispatched to every shard (ON
 * CLUSTER), as every delete of the analytics tables is.
 */
export function buildProductAnalyticsRetentionDelete(data: {
  databaseName: string;
  table: ProductAnalyticsRetentionTable;
  where: Statement;
}): Statement {
  return SQL`ALTER TABLE ${data.databaseName}.${getStorageTableName(data.table.tableName)}`
    .append(onClusterClause())
    .append(" DELETE WHERE ")
    .append(data.where);
}

/*
 * The applications whose choice is not the default, as they are kept:
 * every other application keeps the default, by the bucket that names
 * none of them.
 */
async function readRetentionChoices(): Promise<
  Array<ProductAnalyticsRetentionChoice>
> {
  const applications: Array<RumApplication> =
    await RumApplicationService.findAllBy({
      query: {
        productAnalyticsRetentionInMonths: QueryHelper.notEquals(
          String(DEFAULT_PRODUCT_ANALYTICS_RETENTION_MONTHS),
        ) as never,
      },
      select: {
        _id: true,
        productAnalyticsRetentionInMonths: true,
      },
      props: {
        isRoot: true,
      },
    });

  return applications
    .filter((application: RumApplication): boolean => {
      return Boolean(application.id);
    })
    .map((application: RumApplication): ProductAnalyticsRetentionChoice => {
      return {
        rumApplicationId: application.id!.toString(),
        months: getProductAnalyticsRetentionMonths(
          application.productAnalyticsRetentionInMonths,
        ),
      };
    });
}

interface ClickhouseJsonResultSet {
  json: () => Promise<{ data: Array<JSONObject> }>;
}

async function matchesAnyRow(data: {
  databaseName: string;
  table: ProductAnalyticsRetentionTable;
  where: Statement;
}): Promise<boolean> {
  const resultSet: ClickhouseJsonResultSet =
    (await data.table.service.executeQuery(
      buildProductAnalyticsRetentionProbe(data),
      MigrationExecuteOptions,
    )) as unknown as ClickhouseJsonResultSet;

  const parsed: { data: Array<JSONObject> } = await resultSet.json();

  return (parsed.data || []).length > 0;
}

export interface ProductAnalyticsRetentionResult {
  /* Deletes queued, across the tables. */
  deletesSubmitted: number;
  /* Tables a statement failed on; the others still ran. */
  failures: Array<string>;
}

/*
 * One run: every bucket on every table, probed and, where it matches,
 * deleted. A table that fails is logged and the others still run; the next
 * day's run tries it again.
 */
export async function enforceProductAnalyticsRetention(data: {
  databaseName: string;
  now: Date;
}): Promise<ProductAnalyticsRetentionResult> {
  const buckets: Array<ProductAnalyticsRetentionBucket> =
    buildProductAnalyticsRetentionBuckets({
      choices: await readRetentionChoices(),
      now: data.now,
    });

  const result: ProductAnalyticsRetentionResult = {
    deletesSubmitted: 0,
    failures: [],
  };

  for (const table of PRODUCT_ANALYTICS_RETENTION_TABLES) {
    try {
      for (const bucket of buckets) {
        for (const where of buildProductAnalyticsRetentionWheres({
          table: table,
          bucket: bucket,
        })) {
          if (
            !(await matchesAnyRow({
              databaseName: data.databaseName,
              table: table,
              where: where,
            }))
          ) {
            continue;
          }

          await table.service.execute(
            buildProductAnalyticsRetentionDelete({
              databaseName: data.databaseName,
              table: table,
              where: where,
            }),
            MigrationExecuteOptions,
          );

          result.deletesSubmitted++;

          logger.info(
            `${JOB_NAME}: queued the deletion of ${table.tableName} rows older than ${bucket.cutoff.toISOString().substring(0, 10)} for the applications that keep ${bucket.months} months`,
          );
        }
      }
    } catch (error) {
      const message: string =
        error instanceof Error ? error.message : String(error);

      logger.error(`${JOB_NAME}: ${table.tableName} was skipped: ${message}`);
      result.failures.push(`${table.tableName}: ${message}`);
    }
  }

  return result;
}

RunCron(
  JOB_NAME,
  { schedule: PRODUCT_ANALYTICS_RETENTION_SCHEDULE, runOnStartup: false },
  async (): Promise<void> => {
    // The database the services read, as the erasure job names it.
    const databaseName: string | undefined =
      RumProductAnalyticsSessionService.database.getDatasourceOptions()
        .database;

    if (!databaseName) {
      throw new Error("ClickHouse database name is not configured");
    }

    const result: ProductAnalyticsRetentionResult =
      await enforceProductAnalyticsRetention({
        databaseName: databaseName,
        now: OneUptimeDate.getCurrentDate(),
      });

    if (result.deletesSubmitted > 0) {
      logger.info(
        `${JOB_NAME}: queued ${result.deletesSubmitted} delete(s) of product analytics rows past their application's retention`,
      );
    }
  },
);
