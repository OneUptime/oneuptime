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
 * So the read groups points by SERIES - the metric, the full attribute set
 * and the start time, which a counter's reset (a restarted process) changes -
 * and a cumulative series counts:
 *
 *   - its largest value, when it started inside the range (it counted up
 *     from zero there);
 *   - its largest value less its smallest, when it started before the range
 *     (what it grew by in the range; the usage between the range's start and
 *     its first point there - at most one export interval - is not seen);
 *   - never less than nothing.
 *
 * A delta series, or one that names no temporality, counts the sum of its
 * points, as before. Then the series are added up per metric, group and
 * token type, and LlmMetricUsageUtil folds those rows into input and output
 * tokens and cost (USD and Codex's millionths of a USD apart).
 *
 * The group (a person, a team, a model) and the token type are each the
 * FIRST of their attribute keys a point carries, picked in ClickHouse, so
 * any number of spellings can be recognized - a point is counted once,
 * under one name.
 *
 * Bounded like every read a person waits on: the range is in the WHERE (the
 * table is sorted by project, name and time), 45 seconds with 'throw', and
 * at most LLM_METRIC_USAGE_MAX_ROWS rows, largest first.
 */

export const LLM_METRIC_USAGE_MAX_ROWS: number = 20000;

const TABLE_NAME: string = AnalyticsTableName.Metric;

const QUERY_SETTINGS: string = getQuerySettings({
  maxExecutionTimeInSeconds: 45,
  timeoutOverflowMode: "throw",
  boundScanMemory: true,
});

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

  public static buildStatement(query: LlmMetricUsageReadQuery): Statement {
    const groupKeys: Array<string> = LlmMetricUsageUtil.getGroupKeys(
      query.dimension,
    );

    const statement: Statement = new Statement();

    statement.append(
      "SELECT metric, groupKey, tokenType, sum(increase) AS value FROM (SELECT name AS metric, ",
    );
    LlmMetricUsageReader.appendFirstValue(statement, groupKeys);
    statement.append(" AS groupKey, ");
    LlmMetricUsageReader.appendFirstValue(statement, [
      ...LlmTokenTypeAttributeKeys,
    ]);
    statement.append(" AS tokenType, ");

    /*
     * A cumulative series' growth in the range, or a delta series' sum. The
     * start time is compared with the range's start: a series that started
     * in the range counted up from zero there.
     */
    statement.append(
      SQL`if(aggregationTemporality = 'Cumulative', greatest(max(value) - if(min(startTime) >= ${{
        type: TableColumnType.DateTime64,
        value: query.startTime,
      }}, 0, min(value)), 0), sum(value)) AS increase`,
    );

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
      " GROUP BY metric, groupKey, tokenType, aggregationTemporality, " +
        "if(aggregationTemporality = 'Cumulative', cityHash64(mapKeys(attributes), mapValues(attributes)), 0), " +
        "if(aggregationTemporality = 'Cumulative', startTimeUnixNano, 0)",
    );
    statement.append(
      ") GROUP BY metric, groupKey, tokenType ORDER BY value DESC",
    );
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

  // The rows ClickHouse answered, every field read defensively.
  public static toRows(data: Array<JSONObject>): Array<LlmMetricUsageRow> {
    return (data || []).map((row: JSONObject): LlmMetricUsageRow => {
      const value: number = Number(row["value"]);

      return {
        metric: typeof row["metric"] === "string" ? row["metric"] : "",
        group: typeof row["groupKey"] === "string" ? row["groupKey"] : "",
        tokenType: typeof row["tokenType"] === "string" ? row["tokenType"] : "",
        value: Number.isFinite(value) ? value : 0,
      };
    });
  }

  @CaptureSpan()
  public static async read(
    query: LlmMetricUsageReadQuery,
  ): Promise<LlmMetricUsageResponse> {
    const result: Results = await MetricService.executeQuery(
      LlmMetricUsageReader.buildStatement(query),
    );
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();
    const data: Array<JSONObject> = (response.data || []) as Array<JSONObject>;

    return LlmMetricUsageUtil.fold(
      LlmMetricUsageReader.toRows(data.slice(0, LLM_METRIC_USAGE_MAX_ROWS)),
      {
        grouped: query.dimension !== LlmMetricUsageDimension.None,
        truncated: data.length > LLM_METRIC_USAGE_MAX_ROWS,
      },
    );
  }
}
