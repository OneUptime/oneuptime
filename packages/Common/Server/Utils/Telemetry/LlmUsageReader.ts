import { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { getLlmProviderStoredValues } from "../../../Types/Telemetry/LlmProviders";
import {
  LLM_USAGE_HIDDEN_GROUP_KEY,
  LlmUsageDimension,
  LlmUsageResponse,
} from "../../../Types/Telemetry/LlmUsageApi";
import { LlmMetricUsageRow } from "../../../Utils/Telemetry/LlmMetricUsage";
import LlmUsageUtil, {
  LlmUsageSpanRow,
} from "../../../Utils/Telemetry/LlmUsage";
import {
  DbJSONResponse,
  Results,
} from "../../Services/AnalyticsDatabaseService";
import SpanService from "../../Services/SpanService";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import CaptureSpan from "./CaptureSpan";
import LlmCountedCallsSql, {
  LlmCallFigure,
  LlmCountedCallsScope,
} from "./LlmCountedCallsSql";
import LlmMetricUsageReader from "./LlmMetricUsageReader";
import { buildHoldsScrubPlaceholderSql } from "./ScrubPlaceholderSql";
import TelemetryReadScopeUtil, {
  TelemetryServiceFilter,
} from "./TelemetryReadScope";

/*
 * WHAT A RANGE'S AI USAGE ADDS UP TO, FROM THE AI CALLS AND THE USAGE
 * METRICS: the Usage tab's tiles and breakdown, and the cost budgets.
 *
 * Two reads, one answer:
 *
 *   - the AI calls (GenAI spans) of the range, each service's totals and -
 *     grouped - each of its groups', with every model call counted once: a
 *     wrapper's (an agent run's, a parent span's) repeat of the tokens or
 *     cost its calls report is left out (LlmCountedCallsSql);
 *   - the usage metrics (GenAI metrics) of the range, counted the way a
 *     counter counts, resets included (LlmMetricUsageReader).
 *
 * LlmUsageUtil.fold then counts each service from the signal it sends - its
 * AI calls where they report the figure, its usage metrics where they do
 * not - so a coding tool that sends only metrics is counted beside the apps
 * that send calls, and an app that sends both is counted once.
 *
 * Both reads are bounded like every read a person waits on: the project and
 * the range in the WHERE (the tables' sort keys), 45 seconds with 'throw',
 * at most LLM_USAGE_MAX_ROWS rows each, the services' totals first so a cut
 * reaches only the groups.
 */

export const LLM_USAGE_MAX_ROWS: number = 20000;

const TABLE_NAME: string = AnalyticsTableName.Span;

// Rows of a group carry its value after this prefix; a service's total has none.
const GROUP_PREFIX: string = "g:";

const QUERY_SETTINGS: string = getQuerySettings({
  maxExecutionTimeInSeconds: 45,
  timeoutOverflowMode: "throw",
  boundScanMemory: true,
});

const USER_EMAIL_SQL: string = "ifNull(llmUserEmail, '')";
const USER_ID_SQL: string = "ifNull(llmUserId, '')";
const TEAM_SQL: string = "ifNull(llmTeam, '')";

// The usage whose person or team a scrub rule hid, as a group's value.
function hiddenGroupSql(): Statement {
  return SQL`${{
    type: TableColumnType.Text,
    value: LLM_USAGE_HIDDEN_GROUP_KEY,
  }}`;
}

/*
 * What a call is grouped by, per dimension: the person (their email, else
 * their id - emitters send one or the other), the team, the requested
 * model, the provider. A service is every row's own service, and "none"
 * groups nothing.
 *
 * The person and the team are read as stored, after the project's scrub
 * rules (#10435). What a rule left is never somebody's spend: an email a
 * rule hid falls back to the id where a rule left that whole, and a call
 * whose every name was hidden - "[REDACTED]", a mask, a Hash rule's token -
 * is filed under the one group of usage nobody's name can be put to
 * (LLM_USAGE_HIDDEN_GROUP_KEY). Asked of each stored call, so the calls
 * stored before this are read the same.
 */
export function buildSpanGroupSql(
  dimension: LlmUsageDimension,
): Statement | null {
  switch (dimension) {
    case LlmUsageDimension.Employee: {
      const statement: Statement = SQL`multiIf(`;
      statement.append(`${USER_EMAIL_SQL} != '' AND NOT `);
      statement.append(buildHoldsScrubPlaceholderSql(USER_EMAIL_SQL));
      statement.append(`, ${USER_EMAIL_SQL}, ${USER_ID_SQL} != '' AND NOT `);
      statement.append(buildHoldsScrubPlaceholderSql(USER_ID_SQL));
      statement.append(`, ${USER_ID_SQL}, `);
      statement.append(buildHoldsScrubPlaceholderSql(USER_EMAIL_SQL));
      statement.append(" OR ");
      statement.append(buildHoldsScrubPlaceholderSql(USER_ID_SQL));
      statement.append(", ");
      statement.append(hiddenGroupSql());
      statement.append(", '')");
      return statement;
    }

    case LlmUsageDimension.Team: {
      const statement: Statement = SQL`if(`;
      statement.append(buildHoldsScrubPlaceholderSql(TEAM_SQL));
      statement.append(", ");
      statement.append(hiddenGroupSql());
      statement.append(`, ${TEAM_SQL})`);
      return statement;
    }

    case LlmUsageDimension.Model:
      return new Statement(["ifNull(llmRequestModel, '')"], []);

    case LlmUsageDimension.Provider:
      return new Statement(["ifNull(llmSystem, '')"], []);

    default:
      return null;
  }
}

export interface LlmUsageReadQuery extends TelemetryServiceFilter {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  dimension: LlmUsageDimension;
  // Only one telemetry service's calls and points (a budget's scope).
  serviceId?: ObjectID | undefined;
  // Only one provider's, under any spelling it is stored or sent as.
  llmSystem?: string | undefined;
  // Only one model's.
  llmModel?: string | undefined;
  /*
   * Whose usage metrics the caller may read: null leaves the metrics out
   * (the caller may read the AI calls but no metric), undefined reads them
   * with the calls' scope (serviceIds, excludedServiceIds).
   */
  metricFilter?: TelemetryServiceFilter | null | undefined;
  /*
   * The name a metric group's row is filed under (LlmUsageFoldOptions):
   * where a reader names people at read time.
   */
  nameMetricGroup?: ((row: LlmMetricUsageRow) => string) | undefined;
}

export default class LlmUsageReader {
  // What the AI calls' figures are counted against: the read's project, range and scope.
  public static getCountedCallsScope(
    query: LlmUsageReadQuery,
  ): LlmCountedCallsScope {
    return {
      projectId: query.projectId,
      startTime: query.startTime,
      endTime: query.endTime,
      serviceIds: query.serviceIds,
      excludedServiceIds: query.excludedServiceIds,
    };
  }

  /*
   * The AI calls of the range: one row per service (its totals) and -
   * grouped - one per service and group, every model call counted once.
   */
  public static buildSpanStatement(query: LlmUsageReadQuery): Statement {
    const groupSql: Statement | null = buildSpanGroupSql(query.dimension);
    const scope: LlmCountedCallsScope =
      LlmUsageReader.getCountedCallsScope(query);
    const statement: Statement = new Statement();

    statement.append(
      `SELECT serviceKey, groupKey, count() AS calls, countIf(statusCode = ${SpanStatus.Error}) AS erroredCalls, ` +
        "sum(if(tokensCovered, 0, llmInputTokens)) AS inputTokens, " +
        "sum(if(tokensCovered, 0, llmOutputTokens)) AS outputTokens, " +
        "sum(if(tokensCovered, 0, llmTotalTokens)) AS totalTokens, " +
        "sum(if(costCovered, 0, llmCost)) AS costUsd " +
        "FROM (SELECT toString(primaryEntityId) AS serviceKey, ",
    );

    if (groupSql) {
      statement.append(`concat('${GROUP_PREFIX}', `);
      statement.append(groupSql);
      statement.append(") AS groupKey, ");
    } else {
      statement.append("'' AS groupKey, ");
    }

    statement.append(
      "statusCode, llmInputTokens, llmOutputTokens, llmTotalTokens, llmCost, ",
    );

    /*
     * Whether the call's tokens, and its cost, are the calls' inside it:
     * worked out only for a call that reports the figure (the other
     * calls add 0 either way).
     */
    statement.append(
      "if(llmInputTokens > 0 OR llmOutputTokens > 0 OR llmTotalTokens > 0, ",
    );
    statement.append(
      LlmCountedCallsSql.buildCoveredCondition(scope, LlmCallFigure.Tokens),
    );
    statement.append(", 0) AS tokensCovered, if(llmCost > 0, ");
    statement.append(
      LlmCountedCallsSql.buildCoveredCondition(scope, LlmCallFigure.Cost),
    );
    statement.append(`, 0) AS costCovered FROM ${TABLE_NAME}`);

    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: query.projectId,
      }} AND isLlmSpan = 1 AND startTime >= ${{
        type: TableColumnType.DateTime64,
        value: query.startTime,
      }} AND startTime <= ${{
        type: TableColumnType.DateTime64,
        value: query.endTime,
      }} AND retentionDate >= now()`,
    );

    TelemetryReadScopeUtil.appendServiceFilter(statement, {
      serviceIds: query.serviceIds,
      excludedServiceIds: query.excludedServiceIds,
    });

    LlmUsageReader.appendSpanScopeFilters(statement, query);

    /*
     * Each service's totals, and - grouped - each of its groups: a total's
     * groupKey is '' (a group's never is, it carries the prefix), so the
     * totals sort first and a cut never reaches them.
     */
    statement.append(
      groupSql
        ? ") GROUP BY GROUPING SETS ((serviceKey), (serviceKey, groupKey))"
        : ") GROUP BY serviceKey, groupKey",
    );
    statement.append(
      " ORDER BY groupKey = '' DESC, costUsd DESC, serviceKey ASC, groupKey ASC",
    );
    statement.append(
      SQL` LIMIT ${{
        type: TableColumnType.Number,
        value: LLM_USAGE_MAX_ROWS + 1,
      }}`,
    );
    statement.append(QUERY_SETTINGS);

    return statement;
  }

  // A budget's scopes on the AI calls: one service, one provider, one model.
  private static appendSpanScopeFilters(
    statement: Statement,
    query: LlmUsageReadQuery,
  ): void {
    if (query.serviceId) {
      statement.append(
        SQL` AND primaryEntityId = ${{
          type: TableColumnType.ObjectID,
          value: query.serviceId,
        }}`,
      );
    }

    /*
     * Every spelling the provider is stored under: ingest stores the
     * conventions' name (azure.ai.openai), and calls ingested before it did
     * keep what their instrumentation sent (az.ai.openai, OpenAI).
     */
    if (query.llmSystem) {
      statement.append(" AND llmSystem IN (");
      statement.append(
        SQL`${{
          type: TableColumnType.Text,
          value: new Includes(getLlmProviderStoredValues(query.llmSystem)),
        }})`,
      );
    }

    if (query.llmModel) {
      statement.append(
        SQL` AND llmRequestModel = ${{
          type: TableColumnType.Text,
          value: query.llmModel,
        }}`,
      );
    }
  }

  /*
   * The rows ClickHouse answered, every field read defensively. A row whose
   * groupKey is '' is a service's total; a group's row carries the prefix,
   * taken off here.
   */
  public static toSpanRows(data: Array<JSONObject>): Array<LlmUsageSpanRow> {
    const read: (value: unknown) => number = (value: unknown): number => {
      const number: number = Number(value);

      return Number.isFinite(number) ? number : 0;
    };

    return (data || []).map((row: JSONObject): LlmUsageSpanRow => {
      const groupKey: string =
        typeof row["groupKey"] === "string" ? row["groupKey"] : "";
      const isTotal: boolean = !groupKey.startsWith(GROUP_PREFIX);

      return {
        service: typeof row["serviceKey"] === "string" ? row["serviceKey"] : "",
        isTotal: isTotal,
        group: isTotal ? "" : groupKey.substring(GROUP_PREFIX.length),
        calls: read(row["calls"]),
        erroredCalls: read(row["erroredCalls"]),
        inputTokens: read(row["inputTokens"]),
        outputTokens: read(row["outputTokens"]),
        totalTokens: read(row["totalTokens"]),
        costUsd: read(row["costUsd"]),
      };
    });
  }

  @CaptureSpan()
  public static async readSpanRows(query: LlmUsageReadQuery): Promise<{
    rows: Array<LlmUsageSpanRow>;
    truncated: boolean;
  }> {
    const result: Results = await SpanService.executeQuery(
      LlmUsageReader.buildSpanStatement(query),
    );
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();
    const data: Array<JSONObject> = (response.data || []) as Array<JSONObject>;

    return {
      rows: LlmUsageReader.toSpanRows(data.slice(0, LLM_USAGE_MAX_ROWS)),
      truncated: data.length > LLM_USAGE_MAX_ROWS,
    };
  }

  /*
   * The range's usage. A read that fails throws - a budget must never read
   * a failure as "nothing spent", and the Usage tab says it could not read
   * rather than show a 0 nobody measured.
   */
  @CaptureSpan()
  public static async read(
    query: LlmUsageReadQuery,
  ): Promise<LlmUsageResponse> {
    const metricFilter: TelemetryServiceFilter | null =
      query.metricFilter === undefined
        ? {
            serviceIds: query.serviceIds,
            excludedServiceIds: query.excludedServiceIds,
          }
        : query.metricFilter;

    const [spans, metrics] = await Promise.all([
      LlmUsageReader.readSpanRows(query),
      metricFilter
        ? LlmMetricUsageReader.readRows({
            projectId: query.projectId,
            startTime: query.startTime,
            endTime: query.endTime,
            dimension: query.dimension,
            serviceIds: metricFilter.serviceIds,
            excludedServiceIds: metricFilter.excludedServiceIds,
            serviceId: query.serviceId,
            llmSystem: query.llmSystem,
            llmModel: query.llmModel,
          })
        : Promise.resolve({
            rows: [] as Array<LlmMetricUsageRow>,
            truncated: false,
          }),
    ]);

    return LlmUsageUtil.fold({
      spanRows: spans.rows,
      metricRows: metrics.rows,
      options: {
        dimension: query.dimension,
        truncated: spans.truncated || metrics.truncated,
        metricsLeftOut: metricFilter === null,
        nameMetricGroup: query.nameMetricGroup,
      },
    });
  }
}
