import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import CloudCost from "../../Models/AnalyticsModels/CloudCost";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import AggregationInterval from "../../Types/BaseDatabase/AggregationInterval";
import { getPercentileLevel } from "../../Types/BaseDatabase/AggregationType";
import { CLOUD_COST_TAG_KEY_MAX_LENGTH } from "../../Types/Cloud/CloudCost";
import BadDataException from "../../Types/Exception/BadDataException";
import AggregateBy, {
  AggregateUtil,
} from "../Types/AnalyticsDatabase/AggregateBy";
import { getQuerySettings } from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";

/*
 * What each connected cloud account cost (CloudCost). Written by the costs
 * lane only (CloudCostWriter), read through /aggregate and the account's
 * summary. Its rows keep the table's own retention (400 days), not the
 * project's telemetry retention: a year back is what a cost compares with.
 *
 * Besides every analytics model's aggregate, it breaks the spend down by
 * one of its tags: an aggregate with groupByAttributeKeys [key] sums the
 * costs by the tag's value - "" for the costs without it - and each row
 * carries { [key]: value } as its attributes, as a metric's grouped rows
 * carry theirs (Costs' breakdown by tag).
 */
export class CloudCostService extends AnalyticsDatabaseService<CloudCost> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: CloudCost, database: clickhouseDatabase });
  }

  /*
   * The tag a breakdown is by: the one key asked, trimmed - null when none
   * is asked. More than one, or one longer than a tag's key may be, is
   * refused.
   */
  public static getTagKey(keys: Array<string> | undefined): string | null {
    const asked: Array<string> = (keys || [])
      .map((key: unknown): string => {
        return typeof key === "string" ? key.trim() : "";
      })
      .filter((key: string): boolean => {
        return key.length > 0;
      });

    if (asked.length === 0) {
      return null;
    }

    if (asked.length > 1) {
      throw new BadDataException(
        "Cloud costs are broken down by one tag at a time.",
      );
    }

    if (asked[0]!.length > CLOUD_COST_TAG_KEY_MAX_LENGTH) {
      throw new BadDataException(
        `A tag's key is at most ${CLOUD_COST_TAG_KEY_MAX_LENGTH} characters.`,
      );
    }

    return asked[0]!;
  }

  public override toAggregateStatement(aggregateBy: AggregateBy<CloudCost>): {
    statement: Statement;
    columns: Array<string>;
  } {
    const tagKey: string | null = CloudCostService.getTagKey(
      aggregateBy.groupByAttributeKeys,
    );

    if (tagKey === null) {
      return super.toAggregateStatement(aggregateBy);
    }

    return this.toTagAggregateStatement({ aggregateBy, tagKey });
  }

  /*
   * The costs summed by one tag's value, as the generic aggregate sums them
   * by a column: the same filter (table-qualified, as the generic one is,
   * since the select aliases the summed column to its own name), the
   * retention filter, the time bucket when one is asked, and the same read
   * settings. The tag's key is a bound parameter, never written into the
   * text.
   */
  public toTagAggregateStatement(data: {
    aggregateBy: AggregateBy<CloudCost>;
    tagKey: string;
  }): { statement: Statement; columns: Array<string> } {
    const aggregateBy: AggregateBy<CloudCost> = data.aggregateBy;

    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string = this.database.getDatasourceOptions().database!;
    const interval: AggregationInterval = AggregateUtil.getAggregationInterval({
      startDate: aggregateBy.startTimestamp!,
      endDate: aggregateBy.endTimestamp!,
      aggregationInterval: aggregateBy.aggregationInterval,
    });
    const bucketByTime: boolean = !AggregateUtil.isTotalAggregation(interval);
    const aggregateColumn: string = aggregateBy.aggregateColumnName.toString();
    const timestampColumn: string =
      aggregateBy.aggregationTimestampColumnName.toString();

    if (
      !this.model.getTableColumn(aggregateColumn) ||
      !this.model.getTableColumn(timestampColumn)
    ) {
      throw new BadDataException("Unknown column.");
    }

    const columnKeys: Array<string> = Object.keys(aggregateBy.groupBy || {});
    // The columns asked beside the tag, as the generic aggregate names them.
    const columns: Statement | null =
      columnKeys.length > 0
        ? this.statementGenerator.toGroupByStatement(aggregateBy.groupBy!)
        : null;

    // A percentile as the generic aggregate compiles it: quantile(level).
    const percentileLevel: number | null = getPercentileLevel(
      aggregateBy.aggregationType,
    );
    const aggregation: string =
      percentileLevel !== null
        ? `quantile(${percentileLevel})(${aggregateColumn})`
        : `${aggregateBy.aggregationType.toLocaleLowerCase()}(${aggregateColumn})`;
    const statement: Statement = SQL`SELECT `;

    statement
      .append(`${aggregation} as ${aggregateColumn}, `)
      .append(
        AggregateUtil.buildBucketTimestampSelectStatement(
          interval,
          timestampColumn,
          aggregateBy.timezone,
        ),
      );
    statement.append(
      SQL`, map(${{
        type: TableColumnType.Text,
        value: data.tagKey,
      }}, tags[${{
        type: TableColumnType.Text,
        value: data.tagKey,
      }}]) AS attributes`,
    );

    if (columns) {
      statement.append(SQL`, `).append(columns);
    }

    statement.append(SQL` FROM ${databaseName}.${this.model.tableName}`);
    statement
      .append(SQL` WHERE TRUE `)
      .append(
        this.statementGenerator.toWhereStatement(aggregateBy.query, {
          tableAlias: this.model.tableName,
        }),
      )
      .append(this.getRetentionReadFilter());

    statement.append(
      bucketByTime
        ? ` GROUP BY ${timestampColumn}, attributes`
        : " GROUP BY attributes",
    );

    if (columns) {
      statement.append(SQL`, `).append(columns);
    }
    statement
      .append(SQL` ORDER BY `)
      .append(
        aggregateBy.sort && Object.keys(aggregateBy.sort).length > 0
          ? this.statementGenerator.toSortStatement(aggregateBy.sort)
          : `${aggregateColumn} DESC`,
      );
    statement.append(
      SQL` LIMIT ${{
        value: Number(aggregateBy.limit),
        type: TableColumnType.Number,
      }} OFFSET ${{
        value: Number(aggregateBy.skip) || 0,
        type: TableColumnType.Number,
      }}`,
    );
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: this.getTimeoutOverflowMode(aggregateBy),
        additionalSettings: { max_threads: 4 },
      }),
    );

    return {
      statement,
      columns: [aggregateColumn, timestampColumn, "attributes", ...columnKeys],
    };
  }
}

export default new CloudCostService();
