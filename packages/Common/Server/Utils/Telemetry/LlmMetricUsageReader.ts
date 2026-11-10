import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  LlmMetricModelAttributeKeys,
  LlmMetricTeamAttributeKeys,
  LlmMetricUserAttributeKeys,
  LlmTokenTypeAttributeKeys,
} from "../../../Types/Telemetry/LlmMetricConventions";
import {
  LlmMetricUsageDimension,
  LlmMetricUsageResponse,
} from "../../../Types/Telemetry/LlmMetricUsageApi";
import { getLlmProviderStoredValues } from "../../../Types/Telemetry/LlmProviders";
import LlmMetricUsageUtil, {
  LlmMetricUsageRow,
} from "../../../Utils/Telemetry/LlmMetricUsage";
import {
  DbJSONResponse,
  Results,
} from "../../Services/AnalyticsDatabaseService";
import MetricService from "../../Services/MetricService";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import CaptureSpan from "./CaptureSpan";
import TelemetryReadScopeUtil, {
  TelemetryServiceFilter,
} from "./TelemetryReadScope";

/*
 * WHAT THE GENAI METRICS OF A RANGE ADD UP TO, READ THE WAY A COUNTER COUNTS.
 *
 * A token or cost metric is a counter, and OpenTelemetry sends a counter one
 * of two ways:
 *
 *   - DELTA: each point is what was added since the last export. Claude
 *     Code's default, and Cursor's export. The range's usage is the sum of
 *     its points.
 *   - CUMULATIVE: each point is the running total since the series started
 *     (its startTime) - the OpenTelemetry SDKs' default, so Gemini CLI's and
 *     Copilot's, and Claude Code's when OTEL_EXPORTER_OTLP_METRICS_
 *     TEMPORALITY_PREFERENCE=cumulative (its docs suggest it for backends
 *     that expect it), and whatever a collector that converts delta to
 *     cumulative passes on. The range's usage is what the series GREW BY in
 *     it.
 *
 * The Usage tab and the cost budgets used to add every point up whatever the
 * temporality: a Claude Code session exporting its running cost every minute
 * for eight hours counted that cost 480 times over, and a fleet's week read
 * as hundreds of thousands of dollars.
 *
 * So the read groups points by SERIES - the metric, the service, the full
 * attribute set and the start time, which a restart that says so (a new
 * start time) changes - and a cumulative series counts what it grew by the
 * way Prometheus' increase() does: its points in time order, each step up
 * added, and a step DOWN read as a restart from zero, so the value after it
 * is all new usage. A counter that restarts and keeps its start time - a
 * process restarted under a collector that sets the start time itself - is
 * counted right; reading only its highest and lowest value (as this read
 * once did) counted 10 -> 15 -> 2 -> 5 as 13, where it is 5 + 2 + 3 = 10.
 * The first point counts from zero when the series started inside the range,
 * and is where the counting starts when it started before (the usage between
 * the range's start and that point - at most one export interval - is not
 * seen). What no counter can show is a restart whose first export is already
 * higher than the last one before it: that reads as growth.
 *
 * A delta series, or one that names no temporality, counts the sum of its
 * points, as before. Then the series are added up per metric, service, group
 * and token type, and LlmMetricUsageUtil folds those rows into input and
 * output tokens and cost (USD and Codex's millionths of a USD apart).
 *
 * Each service's totals come in rows of their own (GROUPING SETS), so the
 * totals and each service's figures stay exact when the group rows are cut
 * short; LlmUsageReader decides from them which services the Usage tab
 * counts from their metrics.
 *
 * The group (a person, a team, a model, a provider) and the token type are
 * each the FIRST of their attribute keys a point carries, picked in
 * ClickHouse, so any number of spellings can be recognized - a point is
 * counted once, under one name - and the row says which key it was
 * (groupAttribute).
 *
 * Bounded like every read a person waits on: the range is in the WHERE (the
 * table is sorted by project, name and time), 45 seconds with 'throw', and
 * at most LLM_METRIC_USAGE_MAX_ROWS rows, the totals first.
 */

export const LLM_METRIC_USAGE_MAX_ROWS: number = 20000;

const TABLE_NAME: string = AnalyticsTableName.Metric;

// Rows of a group carry its value after this prefix; a service's total has none.
const GROUP_PREFIX: string = "g:";

const QUERY_SETTINGS: string = getQuerySettings({
  maxExecutionTimeInSeconds: 45,
  timeoutOverflowMode: "throw",
  boundScanMemory: true,
});

const IS_CUMULATIVE_SQL: string =
  "ifNull(aggregationTemporality, '') = 'Cumulative'";

/*
 * A cumulative series' points in time order (time, then value, so equal
 * times read the same every time), and what they add up to: each step up,
 * and after a step down the value itself - the counter started again from
 * zero. `seriesPoints` is an alias of this SELECT.
 */
const SERIES_POINTS_SQL: string = `arraySort(groupArrayIf((timeUnixNano, ifNull(value, 0)), ${IS_CUMULATIVE_SQL})) AS seriesPoints`;

const SERIES_STEPS_SQL: string =
  "arraySum(arrayMap((current, previous) -> if(current >= previous, current - previous, greatest(current, 0)), " +
  "arrayPopFront(arrayMap(seriesPoint -> seriesPoint.2, seriesPoints)), " +
  "arrayPopBack(arrayMap(seriesPoint -> seriesPoint.2, seriesPoints))))";

export interface LlmMetricUsageReadQuery extends TelemetryServiceFilter {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  dimension: LlmMetricUsageDimension;
  // Only one telemetry service's points (a budget's service scope).
  serviceId?: ObjectID | undefined;
  /*
   * Only one provider's points, under any spelling it is sent as
   * (gen_ai.system or gen_ai.provider.name). Most coding-tool counters name
   * no provider, so a provider scope reads nothing of theirs.
   */
  llmSystem?: string | undefined;
  // Only one model's points: the first model key a point carries.
  llmModel?: string | undefined;
  // Only one person's points: the first identity key a point carries.
  llmUser?: string | undefined;
  // Only one team's points: the first team key a point carries.
  llmTeam?: string | undefined;
}

export default class LlmMetricUsageReader {
  /*
   * `coalesce(nullIf(attributes['k1'], ''), nullIf(attributes['k2'], ''),
   * ..., '')`: the first non-empty value among the keys. Keys are bound as
   * parameters.
   */
  public static appendFirstValue(
    statement: Statement,
    keys: Array<string>,
  ): void {
    if (keys.length === 0) {
      statement.append("''");
      return;
    }

    statement.append("coalesce(");

    keys.forEach((key: string, index: number) => {
      if (index > 0) {
        statement.append(", ");
      }

      statement.append(
        SQL`nullIf(attributes[${{ type: TableColumnType.Text, value: key }}], '')`,
      );
    });

    statement.append(", '')");
  }

  /*
   * `multiIf(attributes['k1'] != '', 'k1', ..., '')`: which of the keys
   * appendFirstValue took its value from.
   */
  public static appendFirstKey(
    statement: Statement,
    keys: Array<string>,
  ): void {
    if (keys.length === 0) {
      statement.append("''");
      return;
    }

    statement.append("multiIf(");

    keys.forEach((key: string) => {
      statement.append(
        SQL`attributes[${{ type: TableColumnType.Text, value: key }}] != '', ${{
          type: TableColumnType.Text,
          value: key,
        }}, `,
      );
    });

    statement.append("'')");
  }

  public static buildStatement(query: LlmMetricUsageReadQuery): Statement {
    const groupKeys: Array<string> = LlmMetricUsageUtil.getGroupKeys(
      query.dimension,
    );
    // By service or not at all, a service's totals are the whole answer.
    const grouped: boolean = groupKeys.length > 0;

    const statement: Statement = new Statement();

    statement.append(
      "SELECT metric, serviceKey, groupKey, groupAttribute, tokenType, sum(seriesIncrease) AS value FROM (SELECT name AS metric, toString(primaryEntityId) AS serviceKey, ",
    );

    if (grouped) {
      statement.append(`concat('${GROUP_PREFIX}', `);
      LlmMetricUsageReader.appendFirstValue(statement, groupKeys);
      statement.append(") AS groupKey, ");
      LlmMetricUsageReader.appendFirstKey(statement, groupKeys);
      statement.append(" AS groupAttribute, ");
    } else {
      statement.append("'' AS groupKey, '' AS groupAttribute, ");
    }

    LlmMetricUsageReader.appendFirstValue(statement, [
      ...LlmTokenTypeAttributeKeys,
    ]);
    statement.append(" AS tokenType, ");

    /*
     * A cumulative series' growth in the range, or a delta series' sum. The
     * start time is compared with the range's start: a series that started
     * in the range counted up from zero there, so its first point counts.
     */
    statement.append(`${SERIES_POINTS_SQL}, if(${IS_CUMULATIVE_SQL}, `);
    statement.append(`${SERIES_STEPS_SQL} + `);
    statement.append(
      SQL`if(ifNull(min(startTime) >= ${{
        type: TableColumnType.DateTime64,
        value: query.startTime,
      }}, 0), greatest(ifNull(seriesPoints[1].2, 0), 0), 0)`,
    );
    statement.append(", sum(ifNull(value, 0))) AS seriesIncrease");

    statement.append(` FROM ${TABLE_NAME}`);

    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: query.projectId,
      }} AND name IN (`,
    );
    statement.append(
      SQL`${{
        type: TableColumnType.Text,
        value: new Includes(LlmMetricUsageUtil.getMetricNames()),
      }})`,
    );
    statement.append(
      SQL` AND time >= ${{
        type: TableColumnType.DateTime64,
        value: query.startTime,
      }} AND time <= ${{
        type: TableColumnType.DateTime64,
        value: query.endTime,
      }} AND retentionDate >= now()`,
    );

    TelemetryReadScopeUtil.appendServiceFilter(statement, query);

    if (query.serviceId) {
      statement.append(
        SQL` AND primaryEntityId = ${{
          type: TableColumnType.ObjectID,
          value: query.serviceId,
        }}`,
      );
    }

    LlmMetricUsageReader.appendScopeFilters(statement, query);

    /*
     * One group per series of a cumulative counter (its attributes and its
     * start time); a delta series needs no identity - its points add up the
     * same either way - so every delta point of a group shares one.
     */
    statement.append(
      " GROUP BY metric, serviceKey, groupKey, groupAttribute, tokenType, aggregationTemporality, " +
        `if(${IS_CUMULATIVE_SQL}, cityHash64(mapKeys(attributes), mapValues(attributes)), 0), ` +
        `if(${IS_CUMULATIVE_SQL}, ifNull(startTimeUnixNano, 0), 0)`,
    );

    /*
     * Each service's totals, and - grouped - each group's rows: a total's
     * groupKey is '' (a group's is never, it carries the prefix), so the
     * totals sort first and a cut never reaches them.
     */
    statement.append(
      grouped
        ? ") GROUP BY GROUPING SETS ((metric, serviceKey, tokenType), (metric, serviceKey, groupKey, groupAttribute, tokenType))"
        : ") GROUP BY metric, serviceKey, groupKey, groupAttribute, tokenType",
    );
    statement.append(" ORDER BY groupKey = '' DESC, value DESC");
    statement.append(
      SQL` LIMIT ${{
        type: TableColumnType.Number,
        value: LLM_METRIC_USAGE_MAX_ROWS + 1,
      }}`,
    );
    statement.append(QUERY_SETTINGS);

    return statement;
  }

  // The optional scopes: a provider, a model, a person, a team.
  private static appendScopeFilters(
    statement: Statement,
    query: LlmMetricUsageReadQuery,
  ): void {
    if (query.llmSystem) {
      const spellings: Array<string> = getLlmProviderStoredValues(
        query.llmSystem,
      );

      statement.append(" AND (attributes['gen_ai.system'] IN (");
      statement.append(
        SQL`${{ type: TableColumnType.Text, value: new Includes(spellings) }})`,
      );
      statement.append(" OR attributes['gen_ai.provider.name'] IN (");
      statement.append(
        SQL`${{ type: TableColumnType.Text, value: new Includes(spellings) }}))`,
      );
    }

    const equalities: Array<{ keys: Array<string>; value: string }> = [];

    if (query.llmModel) {
      equalities.push({
        keys: [...LlmMetricModelAttributeKeys],
        value: query.llmModel,
      });
    }

    if (query.llmUser) {
      equalities.push({
        keys: [...LlmMetricUserAttributeKeys],
        value: query.llmUser,
      });
    }

    if (query.llmTeam) {
      equalities.push({
        keys: [...LlmMetricTeamAttributeKeys],
        value: query.llmTeam,
      });
    }

    for (const equality of equalities) {
      statement.append(" AND ");
      LlmMetricUsageReader.appendFirstValue(statement, equality.keys);
      statement.append(
        SQL` = ${{ type: TableColumnType.Text, value: equality.value }}`,
      );
    }
  }

  /*
   * The rows ClickHouse answered, every field read defensively. A row whose
   * groupKey is '' is a service's total; a group's row carries the prefix,
   * taken off here.
   */
  public static toRows(data: Array<JSONObject>): Array<LlmMetricUsageRow> {
    return (data || []).map((row: JSONObject): LlmMetricUsageRow => {
      const value: number = Number(row["value"]);
      const groupKey: string =
        typeof row["groupKey"] === "string" ? row["groupKey"] : "";
      const isTotal: boolean = !groupKey.startsWith(GROUP_PREFIX);

      return {
        metric: typeof row["metric"] === "string" ? row["metric"] : "",
        service: typeof row["serviceKey"] === "string" ? row["serviceKey"] : "",
        group: isTotal ? "" : groupKey.substring(GROUP_PREFIX.length),
        groupAttribute:
          typeof row["groupAttribute"] === "string"
            ? row["groupAttribute"]
            : "",
        isTotal: isTotal,
        tokenType: typeof row["tokenType"] === "string" ? row["tokenType"] : "",
        value: Number.isFinite(value) ? value : 0,
      };
    });
  }

  /*
   * The rows of one read, and whether there were more than one read
   * returns. LlmUsageReader folds them with the AI calls'.
   */
  @CaptureSpan()
  public static async readRows(query: LlmMetricUsageReadQuery): Promise<{
    rows: Array<LlmMetricUsageRow>;
    truncated: boolean;
  }> {
    const result: Results = await MetricService.executeQuery(
      LlmMetricUsageReader.buildStatement(query),
    );
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();
    const data: Array<JSONObject> = (response.data || []) as Array<JSONObject>;

    return {
      rows: LlmMetricUsageReader.toRows(
        data.slice(0, LLM_METRIC_USAGE_MAX_ROWS),
      ),
      truncated: data.length > LLM_METRIC_USAGE_MAX_ROWS,
    };
  }

  @CaptureSpan()
  public static async read(
    query: LlmMetricUsageReadQuery,
  ): Promise<LlmMetricUsageResponse> {
    const read: { rows: Array<LlmMetricUsageRow>; truncated: boolean } =
      await LlmMetricUsageReader.readRows(query);

    return LlmMetricUsageUtil.fold(read.rows, {
      dimension: query.dimension,
      truncated: read.truncated,
    });
  }
}
