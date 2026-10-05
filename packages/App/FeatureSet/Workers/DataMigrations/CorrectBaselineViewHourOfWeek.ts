import DataMigrationBase from "./DataMigrationBase";
import { ClickHouseJsonResult } from "./ClickHouseMigrationUtil";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import LogCountBaseline from "Common/Models/AnalyticsModels/LogCountBaseline";
import MetricBaselineHourly from "Common/Models/AnalyticsModels/MetricBaselineHourly";
import SpanCountBaseline from "Common/Models/AnalyticsModels/SpanCountBaseline";
import { MigrationExecuteOptions } from "Common/Server/Services/AnalyticsDatabaseService";
import MetricService from "Common/Server/Services/MetricService";
import {
  applyClusterToMaterializedViewQuery,
  getClickhouseClusterName,
  getClickhouseDatabaseName,
  getStorageTableName,
  onClusterClause,
} from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import MaterializedView from "Common/Types/AnalyticsDatabase/MaterializedView";
import logger from "Common/Server/Utils/Logger";

export const BASELINE_MODELS: Array<{ new (): AnalyticsBaseModel }> = [
  LogCountBaseline,
  SpanCountBaseline,
  MetricBaselineHourly,
];

/**
 * Points the three baseline views at the hour of week the readers use.
 *
 * The views (LogCountBaseline_mv, SpanCountBaseline_mv,
 * MetricBaselineHourly_mv) encoded the hour of the week as
 * `(toDayOfWeek(time, 1) - 1) * 24 + toHour(time)`, expecting mode 1 to
 * number Monday 1. In ClickHouse mode 1 numbers Monday 0 (mode 0 is the 1..7
 * one), so Monday was written to 232..255 and every other day one slot early,
 * while computeHourOfWeek numbers the week correctly: every anomaly lookup
 * read the next day's history, and Sunday's cells were never written.
 *
 * The stored rows are not rewritten. Each carries its `day`, so the readers
 * (MetricBaselineService.hourOfWeekCellFilter) read both encodings under the
 * weekday they belong to, and the history stays in use. The views still have
 * to change, or existing installs would keep writing the old encoding while
 * the models say otherwise: the boot schema-sync recognises view drift by
 * source table, target table and aggregate functions, not by a changed
 * expression.
 *
 * Per view, two statements, both ON CLUSTER, idempotent and metadata-only:
 *
 *   1. the model's own CREATE ... IF NOT EXISTS, which gives the corrected
 *      view to any host that lacks it - the boot schema-sync only checks the
 *      host it is connected to;
 *   2. ALTER TABLE ... MODIFY QUERY with the model's SELECT, which replaces
 *      the old query in place - the view stays attached, so no insert falls
 *      into a gap, and no worker still on the previous release can re-create
 *      the old view in one.
 *
 * Then every host's stored definition is checked against the model's own
 * hourOfWeek expression. A host that has not applied the DDL within the
 * distributed DDL timeout is named in a warning rather than failing the run,
 * as for every other ON CLUSTER statement here (MigrationExecuteOptions): the
 * DDL stays queued, and the readers are right in either state.
 *
 * Safe to run twice concurrently: both runs send the same idempotent DDL and
 * converge on the same definition.
 */
export default class CorrectBaselineViewHourOfWeek extends DataMigrationBase {
  public constructor() {
    super("CorrectBaselineViewHourOfWeek");
  }

  public static getModifyQueryStatement(view: MaterializedView): string {
    const database: string = getClickhouseDatabaseName();
    // The SELECT of the model's CREATE, reading the local source table.
    const select: string = view.query
      .slice(view.query.search(/\bSELECT\b/))
      .replace(
        /(\bFROM\s+)([A-Za-z_][A-Za-z0-9_]*)/,
        (_match: string, lead: string, table: string): string => {
          return `${lead}${database}.${getStorageTableName(table)}`;
        },
      );

    return `ALTER TABLE ${database}.${view.name}${onClusterClause()} MODIFY QUERY ${select}`;
  }

  /*
   * True when a stored view definition carries the model's hourOfWeek
   * expression. ClickHouse re-parenthesises the stored text, so both sides
   * are compared without whitespace, parentheses and backticks. Anything
   * unrecognised counts as not carrying it.
   */
  public static carriesModelEncoding(
    stored: string,
    view: MaterializedView,
  ): boolean {
    const item: string | undefined = view.query.match(
      /^\s*(.+?)\s+AS\s+hourOfWeek\s*,?\s*$/m,
    )?.[1];
    const strip: (text: string) => string = (text: string): string => {
      return text.replace(/[\s()`]/g, "");
    };

    return (
      Boolean(item) && strip(stored).includes(`${strip(item!)}AShourOfWeek`)
    );
  }

  public override async migrate(): Promise<void> {
    const pending: Array<string> = [];

    for (const modelType of BASELINE_MODELS) {
      // Each baseline model declares exactly one view: the one feeding it.
      const view: MaterializedView = new modelType().materializedViews[0]!;

      await MetricService.execute(
        applyClusterToMaterializedViewQuery(view.query),
        MigrationExecuteOptions,
      );
      await MetricService.execute(
        CorrectBaselineViewHourOfWeek.getModifyQueryStatement(view),
        MigrationExecuteOptions,
      );

      pending.push(...(await this.findUncorrected(view)));
    }

    if (pending.length > 0) {
      logger.warn(
        `CorrectBaselineViewHourOfWeek: not yet corrected on every host: ${pending.join(
          "; ",
        )}. The DDL stays queued on those hosts; the baseline readers accept both encodings meanwhile.`,
      );
      return;
    }

    logger.info(
      "CorrectBaselineViewHourOfWeek: every host's baseline views write the corrected hour of week.",
    );
  }

  public override async rollback(): Promise<void> {
    /*
     * Deliberately a no-op. The readers accept both encodings, and the old
     * view would only write more rows in the wrong one.
     */
    return;
  }

  private async findUncorrected(
    view: MaterializedView,
  ): Promise<Array<string>> {
    const cluster: string = getClickhouseClusterName();
    const problems: Array<string> = [];

    try {
      const hosts: number = Number(
        (
          await this.queryRows(
            `SELECT count() AS hosts FROM system.clusters WHERE cluster = '${cluster}'`,
          )
        )[0]?.["hosts"] ?? 0,
      );
      // An unreachable replica fails the query, so it is reported as such.
      const rows: Array<Record<string, unknown>> = await this.queryRows(
        `SELECT hostName() AS host, create_table_query AS query FROM clusterAllReplicas('${cluster}', system.tables) WHERE database = '${getClickhouseDatabaseName()}' AND name = '${view.name}'`,
      );

      for (const row of rows) {
        if (
          !CorrectBaselineViewHourOfWeek.carriesModelEncoding(
            String(row["query"]),
            view,
          )
        ) {
          problems.push(
            `${view.name}@${String(row["host"])} holds the old definition`,
          );
        }
      }

      if (rows.length < hosts) {
        problems.push(
          `${view.name} is missing on ${hosts - rows.length} host(s)`,
        );
      }
    } catch (err) {
      problems.push(
        `${view.name} could not be checked: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return problems;
  }

  private async queryRows(
    statement: string,
  ): Promise<Array<Record<string, unknown>>> {
    const result: { json: () => Promise<unknown> } =
      await MetricService.executeQuery(statement);
    const json: ClickHouseJsonResult =
      (await result.json()) as ClickHouseJsonResult;
    return json.data ?? [];
  }
}
