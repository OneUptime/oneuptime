import LlmObservabilityConnection from "../../../Models/DatabaseModels/LlmObservabilityConnection";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import { JSONObject } from "../../../Types/JSON";
import { isCompanyToolProvider } from "../../../Types/LlmObservability/LlmConnectionCatalog";
import {
  LLM_CONNECTION_ID_ATTRIBUTE,
  LlmProviderUsageMetricNames,
} from "../../../Types/LlmObservability/LlmProviderUsageMetrics";
import ObjectID from "../../../Types/ObjectID";
import {
  LLM_METRIC_SOURCE_PREFIXES,
  LLM_SETUP_CHECK_MAX_LIST,
  LLM_SETUP_CHECK_RECENT_DAYS,
  LlmMetricSource,
  LlmSetupCheckApps,
  LlmSetupCheckConnection,
  LlmSetupCheckMetricSource,
  LlmSetupCheckProvider,
  LlmSetupCheckResponse,
  LlmSetupCheckService,
  LlmSetupCheckUninstrumentedCalls,
  getLlmMetricSource,
} from "../../../Types/Telemetry/LlmSetupCheckApi";
import {
  AMAZON_HOST_SUFFIX,
  BEDROCK_RUNTIME_HOST_PREFIX,
  LLM_PROVIDER_EXACT_HOSTS,
  VERTEX_AI_REGIONAL_HOST_SUFFIX,
  getAzureLlmHostSuffixes,
  getLlmProviderOfAddress,
  normalizeLlmProvider,
} from "../../../Types/Telemetry/LlmProviders";
import LlmMetricUsageUtil from "../../../Utils/Telemetry/LlmMetricUsage";
import {
  DbJSONResponse,
  Results,
} from "../../Services/AnalyticsDatabaseService";
import { IS_ANSWER_SQL } from "../../Services/LlmConversationService";
import LlmObservabilityConnectionService from "../../Services/LlmObservabilityConnectionService";
import LogService from "../../Services/LogService";
import MetricService from "../../Services/MetricService";
import SpanService from "../../Services/SpanService";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import logger from "../Logger";
import CaptureSpan from "./CaptureSpan";
import TelemetryReadScopeUtil, {
  TelemetryServiceFilter,
} from "./TelemetryReadScope";

/*
 * THE READS BEHIND THE AI / LLM SETUP CHECK (LlmSetupCheckApi).
 *
 * Each part reads one thing, capped in rows and in time ('throw', never
 * 'break': a grouped read cut short with 'break' answers an empty body,
 * which would read as "nothing arrived"). A part that fails - a timeout, a
 * caller who may not read that signal - comes back as null and the check
 * says it does not know, never "none":
 *
 *   - apps: the AI / LLM spans of the past week and of the asked window,
 *     by app and provider, with how many answers recorded the question
 *     (llmUserMessagePreview, which ingest writes only when the prompt was
 *     recorded on the span). Columns only: no attribute map is read. The
 *     company AI tools' imported chats are spans of their connections'
 *     services, and are counted for those connections instead;
 *   - the newest AI call before that, when there was none since: read
 *     newest first, so it stops at the first one (the table is sorted by
 *     project and start time, and isLlmSpan has a skip index);
 *   - uninstrumented calls, only when no app sent an AI call in the past
 *     week: the past day's HTTP client spans to an AI provider's API that
 *     are not AI / LLM spans. This one reads the attribute map, so it reads
 *     one day, and gives up after 15 seconds;
 *   - content in logs, only when the past week's answers recorded no
 *     question: whether GenAI events arrived on the logs signal instead
 *     (attributeKeys has a bloom filter index, so this stops at the first);
 *   - coding tools: which GenAI metrics arrived in the past week, by name
 *     (names and times only);
 *   - provider accounts: each connection's newest day with usage, from the
 *     metrics its reads keep (oneuptime.llm.provider.*);
 *   - connections: the project's connections, read with the caller's own
 *     permissions.
 */

const SPAN_TABLE: string = AnalyticsTableName.Span;
const METRIC_TABLE: string = AnalyticsTableName.Metric;
const LOG_TABLE: string = AnalyticsTableName.Log;

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

// How far back the uninstrumented-call read looks.
export const LLM_SETUP_CHECK_UNINSTRUMENTED_WINDOW_MS: number = DAY_IN_MS;

// How far back a provider account's newest usage day is looked for.
export const LLM_SETUP_CHECK_PROVIDER_USAGE_DAYS: number = 90;

// Rows of the grouped app read (apps x providers).
const APP_ROWS_LIMIT: number = 500;

const READ_SETTINGS: string = getQuerySettings({
  maxExecutionTimeInSeconds: 20,
  timeoutOverflowMode: "throw",
});

const ATTRIBUTE_READ_SETTINGS: string = getQuerySettings({
  maxExecutionTimeInSeconds: 15,
  timeoutOverflowMode: "throw",
  boundScanMemory: true,
});

// Attribute keys that mark a log record as a GenAI event.
export const GENAI_LOG_EVENT_ATTRIBUTE_KEYS: Array<string> = [
  "gen_ai.system",
  "gen_ai.provider.name",
  "gen_ai.input.messages",
  "gen_ai.output.messages",
];

export interface LlmSetupCheckQuery extends TelemetryServiceFilter {
  projectId: ObjectID;
  now: Date;
  // The window of the view asking, when one did.
  windowStart?: Date | undefined;
  windowEnd?: Date | undefined;
  /*
   * What the caller may read of each other signal; null when they may not
   * read it at all (that part is then not read). The span scope is the
   * query's own serviceIds / excludedServiceIds.
   */
  metricFilter: TelemetryServiceFilter | null;
  logFilter: TelemetryServiceFilter | null;
  // The caller, for reading the connections with their permissions.
  props: DatabaseCommonInteractionProps;
}

export interface LlmAppCallRow {
  serviceId: string;
  provider: string;
  callsRecently: number;
  callsInWindow: number;
  answersRecently: number;
  answersWithContent: number;
  newestAtMs: number;
}

function toNumber(value: unknown): number {
  const parsed: number = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIso(ms: number): string | null {
  return ms > 0 ? new Date(ms).toISOString() : null;
}

function readJsonString(result: JSONObject | undefined, key: string): string {
  const value: unknown = result ? result[key] : undefined;
  return typeof value === "string" ? value : "";
}

export default class LlmSetupCheckReader {
  public static getRecentStart(now: Date): Date {
    return new Date(now.getTime() - LLM_SETUP_CHECK_RECENT_DAYS * DAY_IN_MS);
  }

  // The span range the app read covers: the past week and the window.
  public static getAppRange(query: LlmSetupCheckQuery): {
    from: Date;
    to: Date;
  } {
    const recentStart: Date = LlmSetupCheckReader.getRecentStart(query.now);
    const from: Date =
      query.windowStart && query.windowStart.getTime() < recentStart.getTime()
        ? query.windowStart
        : recentStart;
    const to: Date =
      query.windowEnd && query.windowEnd.getTime() > query.now.getTime()
        ? query.windowEnd
        : query.now;

    return { from, to };
  }

  public static buildAppCallsStatement(query: LlmSetupCheckQuery): Statement {
    const recentStart: Date = LlmSetupCheckReader.getRecentStart(query.now);
    const range: { from: Date; to: Date } =
      LlmSetupCheckReader.getAppRange(query);
    const statement: Statement = new Statement();

    statement.append(
      SQL`SELECT primaryEntityId AS serviceId, llmSystem AS provider, countIf(startTime >= ${{
        type: TableColumnType.Date,
        value: recentStart,
      }}) AS callsRecently, `,
    );

    if (query.windowStart && query.windowEnd) {
      statement.append(
        SQL`countIf(startTime >= ${{
          type: TableColumnType.Date,
          value: query.windowStart,
        }} AND startTime <= ${{
          type: TableColumnType.Date,
          value: query.windowEnd,
        }}) AS callsInWindow, `,
      );
    } else {
      statement.append("0 AS callsInWindow, ");
    }

    statement.append(
      SQL`countIf(startTime >= ${{
        type: TableColumnType.Date,
        value: recentStart,
      }} AND `,
    );
    statement.append(`${IS_ANSWER_SQL}) AS answersRecently, `);
    statement.append(
      SQL`countIf(startTime >= ${{
        type: TableColumnType.Date,
        value: recentStart,
      }} AND `,
    );
    statement.append(
      `${IS_ANSWER_SQL} AND llmUserMessagePreview != '') AS answersWithContent, `,
    );
    statement.append(
      `toUnixTimestamp(max(startTime)) * 1000 AS newestAtMs FROM ${SPAN_TABLE}`,
    );
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: query.projectId,
      }} AND isLlmSpan = 1 AND startTime >= ${{
        type: TableColumnType.Date,
        value: range.from,
      }} AND startTime <= ${{
        type: TableColumnType.Date,
        value: range.to,
      }} AND retentionDate >= now()`,
    );
    TelemetryReadScopeUtil.appendServiceFilter(statement, query);
    statement.append(
      " GROUP BY serviceId, provider ORDER BY callsRecently DESC",
    );
    statement.append(
      SQL` LIMIT ${{ type: TableColumnType.Number, value: APP_ROWS_LIMIT }}`,
    );
    statement.append(READ_SETTINGS);

    return statement;
  }

  /*
   * The newest AI call before `before`, leaving out the company AI tools'
   * services: newest first, so ClickHouse stops at the first match.
   */
  public static buildNewestCallStatement(
    query: LlmSetupCheckQuery,
    data: { before: Date; toolServiceIds: Array<string> },
  ): Statement {
    const statement: Statement = new Statement();

    statement.append(
      `SELECT toUnixTimestamp(startTime) * 1000 AS atMs FROM ${SPAN_TABLE}`,
    );
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: query.projectId,
      }} AND isLlmSpan = 1 AND startTime < ${{
        type: TableColumnType.Date,
        value: data.before,
      }} AND retentionDate >= now()`,
    );
    TelemetryReadScopeUtil.appendServiceFilter(statement, query);

    if (data.toolServiceIds.length > 0) {
      statement.append(" AND primaryEntityId NOT IN (");
      statement.append(
        SQL`${{
          type: TableColumnType.ObjectID,
          value: new IncludesNone(data.toolServiceIds),
        }})`,
      );
    }

    statement.append(" ORDER BY startTime DESC LIMIT 1");
    statement.append(READ_SETTINGS);

    return statement;
  }

  /*
   * The past day's HTTP client spans to an AI provider's API that are not
   * AI / LLM spans, by app and host. The host is the first of the address
   * keys a span carries; a URL's or a Host header's port is dropped by
   * domain().
   */
  public static buildUninstrumentedStatement(
    query: LlmSetupCheckQuery,
  ): Statement {
    const statement: Statement = new Statement();
    const from: Date = new Date(
      query.now.getTime() - LLM_SETUP_CHECK_UNINSTRUMENTED_WINDOW_MS,
    );

    statement.append(
      "SELECT serviceId, host, count() AS calls FROM (SELECT primaryEntityId AS serviceId, " +
        "lower(coalesce(nullIf(attributes['server.address'], ''), " +
        "nullIf(attributes['net.peer.name'], ''), " +
        "nullIf(domain(concat('http://', attributes['http.host'])), ''), " +
        "nullIf(domain(attributes['url.full']), ''), " +
        "nullIf(domain(attributes['http.url']), ''), '')) AS host " +
        `FROM ${SPAN_TABLE}`,
    );
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: query.projectId,
      }} AND startTime >= ${{
        type: TableColumnType.Date,
        value: from,
      }} AND startTime <= ${{
        type: TableColumnType.Date,
        value: query.now,
      }} AND kind = 'SPAN_KIND_CLIENT' AND isLlmSpan = 0 AND retentionDate >= now()`,
    );
    TelemetryReadScopeUtil.appendServiceFilter(statement, query);
    statement.append(") WHERE host IN (");
    statement.append(
      SQL`${{
        type: TableColumnType.Text,
        value: new Includes(Object.keys(LLM_PROVIDER_EXACT_HOSTS)),
      }})`,
    );

    for (const suffix of [
      ...getAzureLlmHostSuffixes(),
      VERTEX_AI_REGIONAL_HOST_SUFFIX,
    ]) {
      statement.append(
        SQL` OR endsWith(host, ${{ type: TableColumnType.Text, value: suffix }})`,
      );
    }

    statement.append(
      SQL` OR (startsWith(host, ${{
        type: TableColumnType.Text,
        value: BEDROCK_RUNTIME_HOST_PREFIX,
      }}) AND endsWith(host, ${{
        type: TableColumnType.Text,
        value: AMAZON_HOST_SUFFIX,
      }}))`,
    );
    statement.append(" GROUP BY serviceId, host ORDER BY calls DESC");
    statement.append(
      SQL` LIMIT ${{
        type: TableColumnType.Number,
        value: LLM_SETUP_CHECK_MAX_LIST,
      }}`,
    );
    statement.append(ATTRIBUTE_READ_SETTINGS);

    return statement;
  }

  // Whether a GenAI event arrived on the logs signal in the past week.
  public static buildContentInLogsStatement(
    query: LlmSetupCheckQuery,
    logFilter: TelemetryServiceFilter,
  ): Statement {
    const statement: Statement = new Statement();

    statement.append(`SELECT 1 AS found FROM ${LOG_TABLE}`);
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: query.projectId,
      }} AND time >= ${{
        type: TableColumnType.DateTime64,
        value: LlmSetupCheckReader.getRecentStart(query.now),
      }} AND time <= ${{
        type: TableColumnType.DateTime64,
        value: query.now,
      }} AND retentionDate >= now() AND (`,
    );

    GENAI_LOG_EVENT_ATTRIBUTE_KEYS.forEach((key: string, index: number) => {
      if (index > 0) {
        statement.append(" OR ");
      }

      statement.append(
        SQL`has(attributeKeys, ${{ type: TableColumnType.Text, value: key }})`,
      );
    });

    statement.append(")");
    TelemetryReadScopeUtil.appendServiceFilter(statement, logFilter);
    statement.append(" LIMIT 1");
    statement.append(READ_SETTINGS);

    return statement;
  }

  /*
   * The GenAI metrics of the past week, by name: the usage metrics the
   * Usage tab reads, and every metric of a coding assistant's namespace.
   */
  public static buildMetricSourcesStatement(
    query: LlmSetupCheckQuery,
    metricFilter: TelemetryServiceFilter,
  ): Statement {
    const statement: Statement = new Statement();

    statement.append(
      `SELECT name, count() AS points, toUnixTimestamp64Milli(max(time)) AS newestAtMs FROM ${METRIC_TABLE}`,
    );
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: query.projectId,
      }} AND time >= ${{
        type: TableColumnType.DateTime64,
        value: LlmSetupCheckReader.getRecentStart(query.now),
      }} AND time <= ${{
        type: TableColumnType.DateTime64,
        value: query.now,
      }} AND retentionDate >= now() AND (name IN (`,
    );
    statement.append(
      SQL`${{
        type: TableColumnType.Text,
        value: new Includes(LlmMetricUsageUtil.getMetricNames()),
      }})`,
    );

    for (const entry of LLM_METRIC_SOURCE_PREFIXES) {
      statement.append(
        SQL` OR startsWith(name, ${{
          type: TableColumnType.Text,
          value: entry.prefix,
        }})`,
      );
    }

    statement.append(")");
    TelemetryReadScopeUtil.appendServiceFilter(statement, metricFilter);
    statement.append(" GROUP BY name LIMIT 200");
    statement.append(READ_SETTINGS);

    return statement;
  }

  // Each provider account's newest point with usage, by connection.
  public static buildProviderUsageStatement(
    query: LlmSetupCheckQuery,
    metricFilter: TelemetryServiceFilter,
  ): Statement {
    const statement: Statement = new Statement();

    statement.append(
      SQL`SELECT attributes[${{
        type: TableColumnType.Text,
        value: LLM_CONNECTION_ID_ATTRIBUTE,
      }}] AS connectionId, toUnixTimestamp64Milli(max(time)) AS newestAtMs FROM `,
    );
    statement.append(METRIC_TABLE);
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: query.projectId,
      }} AND name IN (`,
    );
    statement.append(
      SQL`${{
        type: TableColumnType.Text,
        value: new Includes(LlmProviderUsageMetricNames),
      }})`,
    );
    statement.append(
      SQL` AND time >= ${{
        type: TableColumnType.DateTime64,
        value: new Date(
          query.now.getTime() - LLM_SETUP_CHECK_PROVIDER_USAGE_DAYS * DAY_IN_MS,
        ),
      }} AND time <= ${{
        type: TableColumnType.DateTime64,
        value: query.now,
      }} AND value > 0 AND retentionDate >= now()`,
    );
    TelemetryReadScopeUtil.appendServiceFilter(statement, metricFilter);
    statement.append(" GROUP BY connectionId LIMIT 200");
    statement.append(READ_SETTINGS);

    return statement;
  }

  /*
   * The app rows, less the company AI tools' services, folded into the
   * apps part. `newestBeforeMs` is the newest call before the range, read
   * only when the range had none.
   */
  public static toApps(data: {
    rows: Array<LlmAppCallRow>;
    toolServiceIds: Set<string>;
    newestBeforeMs: number;
    hasWindow: boolean;
    uninstrumented: Array<LlmSetupCheckUninstrumentedCalls> | null;
    contentInLogs: boolean | null;
  }): LlmSetupCheckApps {
    const services: Map<string, LlmSetupCheckService> = new Map();
    const providers: Map<string, LlmSetupCheckProvider> = new Map();

    let callsRecently: number = 0;
    let callsInWindow: number = 0;
    let answersRecently: number = 0;
    let answersWithContent: number = 0;
    let newestAtMs: number = 0;

    for (const row of data.rows) {
      if (data.toolServiceIds.has(row.serviceId.toLowerCase())) {
        continue;
      }

      callsRecently += row.callsRecently;
      callsInWindow += row.callsInWindow;
      answersRecently += row.answersRecently;
      answersWithContent += row.answersWithContent;
      newestAtMs = Math.max(newestAtMs, row.newestAtMs);

      if (row.callsRecently > 0) {
        const service: LlmSetupCheckService = services.get(row.serviceId) || {
          serviceId: row.serviceId,
          calls: 0,
          newestAt: null,
        };
        service.calls += row.callsRecently;

        const newest: string | null = toIso(row.newestAtMs);

        if (newest && (!service.newestAt || newest > service.newestAt)) {
          service.newestAt = newest;
        }

        services.set(row.serviceId, service);

        const name: string = normalizeLlmProvider({ reported: row.provider });
        const provider: LlmSetupCheckProvider = providers.get(name) || {
          name: name,
          calls: 0,
        };
        provider.calls += row.callsRecently;
        providers.set(name, provider);
      }
    }

    const byCalls: <T extends { calls: number }>(a: T, b: T) => number = <
      T extends { calls: number },
    >(
      a: T,
      b: T,
    ): number => {
      return b.calls - a.calls;
    };

    return {
      callsInWindow: data.hasWindow ? callsInWindow : null,
      callsRecently: callsRecently,
      newestCallAt: toIso(Math.max(newestAtMs, data.newestBeforeMs)),
      services: Array.from(services.values())
        .sort(byCalls)
        .slice(0, LLM_SETUP_CHECK_MAX_LIST),
      providers: Array.from(providers.values())
        .sort(byCalls)
        .slice(0, LLM_SETUP_CHECK_MAX_LIST),
      answersRecently: answersRecently,
      answersWithContent: answersWithContent,
      contentInLogs: data.contentInLogs,
      uninstrumented: data.uninstrumented,
    };
  }

  public static toAppRows(data: Array<JSONObject>): Array<LlmAppCallRow> {
    return (data || []).map((row: JSONObject): LlmAppCallRow => {
      return {
        serviceId: typeof row["serviceId"] === "string" ? row["serviceId"] : "",
        provider: typeof row["provider"] === "string" ? row["provider"] : "",
        callsRecently: toNumber(row["callsRecently"]),
        callsInWindow: toNumber(row["callsInWindow"]),
        answersRecently: toNumber(row["answersRecently"]),
        answersWithContent: toNumber(row["answersWithContent"]),
        newestAtMs: toNumber(row["newestAtMs"]),
      };
    });
  }

  public static toUninstrumented(
    data: Array<JSONObject>,
  ): Array<LlmSetupCheckUninstrumentedCalls> {
    return (data || [])
      .map((row: JSONObject): LlmSetupCheckUninstrumentedCalls => {
        const host: string = typeof row["host"] === "string" ? row["host"] : "";

        return {
          serviceId:
            typeof row["serviceId"] === "string" ? row["serviceId"] : "",
          host: host,
          provider: getLlmProviderOfAddress(host),
          calls: toNumber(row["calls"]),
        };
      })
      .filter((row: LlmSetupCheckUninstrumentedCalls): boolean => {
        return Boolean(row.provider) && row.calls > 0;
      });
  }

  public static toMetricSources(
    data: Array<JSONObject>,
  ): Array<LlmSetupCheckMetricSource> {
    const sources: Map<LlmMetricSource, LlmSetupCheckMetricSource> = new Map();

    for (const row of data || []) {
      const name: string = typeof row["name"] === "string" ? row["name"] : "";
      const source: LlmMetricSource = getLlmMetricSource(name);
      const entry: LlmSetupCheckMetricSource = sources.get(source) || {
        source: source,
        points: 0,
        newestAt: null,
      };

      entry.points += toNumber(row["points"]);

      const newest: string | null = toIso(toNumber(row["newestAtMs"]));

      if (newest && (!entry.newestAt || newest > entry.newestAt)) {
        entry.newestAt = newest;
      }

      sources.set(source, entry);
    }

    return Array.from(sources.values()).sort(
      (a: LlmSetupCheckMetricSource, b: LlmSetupCheckMetricSource): number => {
        return b.points - a.points;
      },
    );
  }

  /*
   * One connection as the check reports it: its state, what its last read
   * found (resources, the first day read without usage since) and its
   * newest usage - the stored metrics' or the last read's, whichever is
   * newer.
   */
  public static toConnection(data: {
    connection: LlmObservabilityConnection;
    newestUsageAtMs: number;
    toolCallsRecently: number | null;
  }): LlmSetupCheckConnection {
    const connection: LlmObservabilityConnection = data.connection;
    const result: JSONObject | undefined =
      connection.lastPullResult && typeof connection.lastPullResult === "object"
        ? connection.lastPullResult
        : undefined;
    const isTool: boolean = isCompanyToolProvider(connection.provider);

    const lastReadNewest: number = Date.parse(
      readJsonString(result, "newestUsageDay"),
    );
    const newestUsageAtMs: number = Math.max(
      data.newestUsageAtMs,
      Number.isFinite(lastReadNewest) ? lastReadNewest : 0,
    );
    const resources: unknown = result ? result["resources"] : undefined;
    const readSince: string = readJsonString(result, "readSince");

    const toIsoOrNull: (value: Date | string | undefined) => string | null = (
      value: Date | string | undefined,
    ): string | null => {
      if (!value) {
        return null;
      }

      const time: number = new Date(value).getTime();
      return Number.isFinite(time) ? new Date(time).toISOString() : null;
    };

    return {
      connectionId: connection.id?.toString() || "",
      name: connection.name || "",
      provider: connection.provider || "",
      kind: isTool ? "company-tool" : "provider-account",
      isEnabled: connection.isEnabled !== false,
      lastReadAt: toIsoOrNull(connection.lastPulledAt),
      lastSuccessfulReadAt: toIsoOrNull(connection.lastSuccessfulPullAt),
      lastError: connection.lastError || "",
      newestUsageAt: isTool ? null : toIso(newestUsageAtMs),
      resources:
        !isTool && typeof resources === "number" && Number.isFinite(resources)
          ? Math.max(0, Math.round(resources))
          : null,
      readSince: !isTool && readSince ? toIsoOrNull(readSince) : null,
      callsRecently: isTool ? data.toolCallsRecently ?? 0 : null,
    };
  }

  private static async readRows(
    service: { executeQuery: (statement: Statement) => Promise<Results> },
    statement: Statement,
  ): Promise<Array<JSONObject>> {
    const result: Results = await service.executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return (response.data || []) as Array<JSONObject>;
  }

  // A part's read, or null when it failed: the check then says it does not know.
  private static async orNull<T>(
    part: string,
    read: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await read();
    } catch (error) {
      logger.debug(
        `AI / LLM setup check: the ${part} read failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private static async readConnections(
    query: LlmSetupCheckQuery,
  ): Promise<Array<LlmObservabilityConnection> | null> {
    return await LlmSetupCheckReader.orNull(
      "connections",
      async (): Promise<Array<LlmObservabilityConnection>> => {
        return await LlmObservabilityConnectionService.findBy({
          query: { projectId: query.projectId },
          select: {
            _id: true,
            name: true,
            provider: true,
            isEnabled: true,
            serviceId: true,
            lastPulledAt: true,
            lastSuccessfulPullAt: true,
            lastError: true,
            lastPullResult: true,
          },
          limit: 100,
          skip: 0,
          props: query.props,
        });
      },
    );
  }

  @CaptureSpan()
  public static async read(
    query: LlmSetupCheckQuery,
  ): Promise<LlmSetupCheckResponse> {
    const connections: Array<LlmObservabilityConnection> | null =
      await LlmSetupCheckReader.readConnections(query);

    const toolServiceIds: Set<string> = new Set<string>(
      (connections || [])
        .filter((connection: LlmObservabilityConnection): boolean => {
          return (
            isCompanyToolProvider(connection.provider) &&
            Boolean(connection.serviceId)
          );
        })
        .map((connection: LlmObservabilityConnection): string => {
          return connection.serviceId!.toString().toLowerCase();
        }),
    );

    const metricFilter: TelemetryServiceFilter | null = query.metricFilter;

    const [appRows, metricRows, providerRows] = await Promise.all([
      LlmSetupCheckReader.orNull(
        "AI calls",
        async (): Promise<Array<LlmAppCallRow>> => {
          return LlmSetupCheckReader.toAppRows(
            await LlmSetupCheckReader.readRows(
              SpanService,
              LlmSetupCheckReader.buildAppCallsStatement(query),
            ),
          );
        },
      ),
      metricFilter
        ? LlmSetupCheckReader.orNull(
            "GenAI metrics",
            async (): Promise<Array<JSONObject>> => {
              return await LlmSetupCheckReader.readRows(
                MetricService,
                LlmSetupCheckReader.buildMetricSourcesStatement(
                  query,
                  metricFilter,
                ),
              );
            },
          )
        : Promise.resolve(null),
      metricFilter
        ? LlmSetupCheckReader.orNull(
            "provider usage",
            async (): Promise<Array<JSONObject>> => {
              return await LlmSetupCheckReader.readRows(
                MetricService,
                LlmSetupCheckReader.buildProviderUsageStatement(
                  query,
                  metricFilter,
                ),
              );
            },
          )
        : Promise.resolve(null),
    ]);

    let apps: LlmSetupCheckApps | null = null;

    if (appRows) {
      const appCallsInRange: number = appRows
        .filter((row: LlmAppCallRow): boolean => {
          return !toolServiceIds.has(row.serviceId.toLowerCase());
        })
        .reduce((total: number, row: LlmAppCallRow): number => {
          return total + row.callsRecently + row.callsInWindow;
        }, 0);

      const hasCallsInRange: boolean = appRows.some(
        (row: LlmAppCallRow): boolean => {
          return (
            !toolServiceIds.has(row.serviceId.toLowerCase()) &&
            row.newestAtMs > 0
          );
        },
      );

      const answers: { recently: number; withContent: number } = appRows
        .filter((row: LlmAppCallRow): boolean => {
          return !toolServiceIds.has(row.serviceId.toLowerCase());
        })
        .reduce(
          (
            total: { recently: number; withContent: number },
            row: LlmAppCallRow,
          ): { recently: number; withContent: number } => {
            return {
              recently: total.recently + row.answersRecently,
              withContent: total.withContent + row.answersWithContent,
            };
          },
          { recently: 0, withContent: 0 },
        );

      const logFilter: TelemetryServiceFilter | null = query.logFilter;

      const [newestBefore, uninstrumented, contentInLogs] = await Promise.all([
        hasCallsInRange
          ? Promise.resolve(0)
          : LlmSetupCheckReader.orNull(
              "newest AI call",
              async (): Promise<number> => {
                const rows: Array<JSONObject> =
                  await LlmSetupCheckReader.readRows(
                    SpanService,
                    LlmSetupCheckReader.buildNewestCallStatement(query, {
                      before: LlmSetupCheckReader.getAppRange(query).from,
                      toolServiceIds: Array.from(toolServiceIds),
                    }),
                  );

                return toNumber(rows[0]?.["atMs"]);
              },
            ),
        appCallsInRange === 0
          ? LlmSetupCheckReader.orNull(
              "uninstrumented AI calls",
              async (): Promise<Array<LlmSetupCheckUninstrumentedCalls>> => {
                return LlmSetupCheckReader.toUninstrumented(
                  await LlmSetupCheckReader.readRows(
                    SpanService,
                    LlmSetupCheckReader.buildUninstrumentedStatement(query),
                  ),
                );
              },
            )
          : Promise.resolve(null),
        answers.recently > 0 && answers.withContent === 0 && logFilter
          ? LlmSetupCheckReader.orNull(
              "GenAI log events",
              async (): Promise<boolean> => {
                const rows: Array<JSONObject> =
                  await LlmSetupCheckReader.readRows(
                    LogService,
                    LlmSetupCheckReader.buildContentInLogsStatement(
                      query,
                      logFilter,
                    ),
                  );

                return rows.length > 0;
              },
            )
          : Promise.resolve(null),
      ]);

      apps = LlmSetupCheckReader.toApps({
        rows: appRows,
        toolServiceIds,
        newestBeforeMs: newestBefore || 0,
        hasWindow: Boolean(query.windowStart && query.windowEnd),
        uninstrumented,
        contentInLogs,
      });
    }

    const newestUsageByConnection: Map<string, number> = new Map();

    for (const row of providerRows || []) {
      const connectionId: string =
        typeof row["connectionId"] === "string"
          ? row["connectionId"].toLowerCase()
          : "";

      if (connectionId) {
        newestUsageByConnection.set(
          connectionId,
          Math.max(
            newestUsageByConnection.get(connectionId) || 0,
            toNumber(row["newestAtMs"]),
          ),
        );
      }
    }

    const toolCallsByService: Map<string, number> = new Map();

    for (const row of appRows || []) {
      const serviceId: string = row.serviceId.toLowerCase();

      if (toolServiceIds.has(serviceId)) {
        toolCallsByService.set(
          serviceId,
          (toolCallsByService.get(serviceId) || 0) + row.callsRecently,
        );
      }
    }

    return {
      checkedAt: query.now.toISOString(),
      apps: apps,
      metrics: metricRows
        ? LlmSetupCheckReader.toMetricSources(metricRows)
        : null,
      connections: connections
        ? connections.map(
            (
              connection: LlmObservabilityConnection,
            ): LlmSetupCheckConnection => {
              const serviceId: string =
                connection.serviceId?.toString().toLowerCase() || "";

              return LlmSetupCheckReader.toConnection({
                connection,
                newestUsageAtMs:
                  newestUsageByConnection.get(
                    connection.id?.toString().toLowerCase() || "",
                  ) || 0,
                toolCallsRecently: appRows
                  ? toolCallsByService.get(serviceId) || 0
                  : null,
              });
            },
          )
        : null,
    };
  }
}
