import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import QueryHelper from "../../Types/Database/QueryHelper";
import RumApplicationService from "../../Services/RumApplicationService";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../../Types/BaseDatabase/Includes";
import {
  DEFAULT_PRODUCT_ANALYTICS_RETENTION_MONTHS,
  MAX_PRODUCT_ANALYTICS_RETENTION_MONTHS,
  PRODUCT_ANALYTICS_RETENTION_MONTHS_OPTIONS,
  getProductAnalyticsRetentionCutoff,
  getProductAnalyticsRetentionMonths,
} from "../../../Types/Rum/ProductAnalytics";

/*
 * How long each RUM application keeps its product analytics (issue #6626),
 * as SQL: which rows a choice no longer keeps. Shared by the job that
 * deletes them every day (Workers/Jobs/Rum/EnforceProductAnalyticsRetention)
 * and the backfill that must not copy them back (Workers/DataMigrations/
 * BackfillProductAnalyticsFromKeptSessions, issue #6624). Not in either's
 * module: a job module registers its cron when it is imported.
 */

/* Applications one statement names, as the erasure job's deletes do. */
export const PRODUCT_ANALYTICS_RETENTION_IDS_PER_STATEMENT: number = 1000;

/* The column a table's rows are aged by, and its type. */
export interface ProductAnalyticsRetentionTimeColumn {
  timeColumn: string;
  timeType: TableColumnType;
}

/* An application that chose other than the default, and what it chose. */
export interface ProductAnalyticsRetentionChoice {
  rumApplicationId: string;
  months: number;
}

/*
 * One choice's rows past it: those older than its cutoff, of the
 * applications listed ("only"), or of every application but those listed
 * ("allBut").
 */
export interface ProductAnalyticsRetentionBucket {
  months: number;
  cutoff: Date;
  mode: "only" | "allBut";
  rumApplicationIds: Array<string>;
}

/*
 * The choices' buckets, shortest first. The longest is the TTL's, and has
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
  table: ProductAnalyticsRetentionTimeColumn;
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

/*
 * The applications whose choice is not the default, as they are kept:
 * every other application keeps the default, by the bucket that names
 * none of them.
 */
export async function readProductAnalyticsRetentionChoices(): Promise<
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
