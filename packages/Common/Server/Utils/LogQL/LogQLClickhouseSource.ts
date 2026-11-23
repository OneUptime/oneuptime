import LogService from "../../Services/LogService";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import TelemetryReadScopeUtil, {
  TelemetryServiceFilter,
} from "../Telemetry/TelemetryReadScope";
import {
  DbJSONResponse,
  Results,
} from "../../Services/AnalyticsDatabaseService";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../../Types/JSON";
import { NO_BREAK_SPACE } from "../../../Types/NoBreakSpaces";
import ObjectID from "../../../Types/ObjectID";
import {
  LogQLLineFilterOperator,
  LogQLLogSelector,
} from "../../../Utils/LogQL/LogQLAst";
import LogQLEngine, {
  LogQLBucketCount,
  LogQLBucketsRequest,
  LogQLDirection,
  LogQLLinesRequest,
  LogQLLogRow,
  LogQLLogSource,
  LogQLSamplesRequest,
  sourceLineFilters,
} from "../../../Utils/LogQL/LogQLEngine";
import {
  LOGQL_DETECTED_LEVEL_LABEL,
  LOGQL_LEVEL_OF_SEVERITY_NUMBER,
  LOGQL_LEVEL_WORDS,
  LogQLLevel,
  logQLLabelsOf,
} from "../../../Utils/LogQL/LogQLLabels";
import {
  PromQLLabelMatcher,
  PromQLMatchType,
} from "../../../Utils/PromQL/PromQLAst";
import {
  PromQLLabels,
  PromQLLabelsTest,
  compilePromQLMatchers,
  promQLLabelsKey,
} from "../../../Utils/PromQL/PromQLLabels";
import { compilePromQLRegex } from "../../../Utils/PromQL/PromQLRegex";
import PromQLError, {
  PromQLErrorType,
} from "../../../Utils/PromQL/PromQLError";

/*
 * Reads a project's logs from ClickHouse for the LogQL engine (issue
 * #7700).
 *
 * Every read is the project's own: it filters on projectId and time first
 * (the table's sort key) and on the services the caller may read
 * (TelemetryReadAccess), so a LogQL query reaches exactly the logs the
 * Logs explorer would show the same caller. A query never runs as SQL: the
 * engine hands this source a selector, and this source writes the SQL,
 * every value bound as a parameter.
 *
 * What ClickHouse checks before rows leave it: each matcher that names a
 * value (= with one, =~ that matches none empty), and the line filters
 * before any stage that rewrites the line - exactly, so a count over them
 * is made in ClickHouse (countBuckets). Everything else, and every matcher
 * again, is the engine's.
 */

// A label name: a word of letters, digits and _, as the parser reads one.
const SAFE_LABEL: RegExp = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// How long one read may run in ClickHouse.
export const LOGQL_QUERY_TIMEOUT_SECONDS: number = 30;

/*
 * The most bytes of logs one read of lines hands back (ClickHouse's
 * max_result_bytes): lines are read whole, and a few thousand very long
 * ones would otherwise fill the server's memory. A read over it is refused.
 */
export const LOGQL_MAX_RESULT_BYTES: number = 64 * 1024 * 1024;

// The most rows a lookup of the levels present reads, then it answers.
export const LOGQL_LEVELS_ROWS_READ_BUDGET: number = 1000000;

// TOO_MANY_ROWS_OR_BYTES: a read over max_result_bytes, under 'throw'.
const RESULT_LIMIT_ERROR_CODE: string = "396";
const RESULT_LIMIT_ERROR_TYPE: string = "TOO_MANY_ROWS_OR_BYTES";

const RESOURCE_PREFIX_LENGTH: number = "resource.".length;

// A key's LogQL label name in SQL, as labelNameOfAttribute writes it.
const labelOfKeySql: (key: string) => string = (key: string): string => {
  const sanitized: string = `replaceRegexpAll(if(startsWith(${key}, 'resource.'), substring(${key}, ${RESOURCE_PREFIX_LENGTH + 1}), ${key}), '[^a-zA-Z0-9_]', '_')`;

  return `if(match(${sanitized}, '^[0-9]'), concat('_', ${sanitized}), ${sanitized})`;
};

const BACKSLASHES: RegExp = /\\/g;

const QUOTES: RegExp = /'/g;

const quote: (text: string) => string = (text: string): string => {
  // Only ever OneUptime's own words, never a caller's.
  return `'${text.replace(BACKSLASHES, "\\\\").replace(QUOTES, "\\'")}'`;
};

/*
 * A log's detected level in SQL, from the same tables detectLogQLLevel
 * reads, so a count by level in ClickHouse is the engine's own.
 */
export const DETECTED_LEVEL_SQL: string = (() => {
  const branches: Array<string> = [];

  for (const range of LOGQL_LEVEL_OF_SEVERITY_NUMBER) {
    branches.push(
      `ifNull(severityNumber, 0) BETWEEN ${range.from} AND ${range.to}`,
      quote(range.level),
    );
  }

  const wordsByLevel: Map<LogQLLevel, Array<string>> = new Map();

  for (const [word, level] of LOGQL_LEVEL_WORDS) {
    wordsByLevel.set(level, [...(wordsByLevel.get(level) || []), word]);
  }

  for (const [level, words] of wordsByLevel) {
    branches.push(
      `lower(trimBoth(ifNull(severityText, ''))) IN (${words.map(quote).join(", ")})`,
      quote(level),
    );
  }

  return `if(mapContains(attributes, ${quote(LOGQL_DETECTED_LEVEL_LABEL)}), attributes[${quote(LOGQL_DETECTED_LEVEL_LABEL)}], multiIf(${branches.join(", ")}, ${quote(LogQLLevel.Unknown)}))`;
})();

// Whether a matcher keeps a log that does not have its label at all.
const matchesEmpty: (matcher: PromQLLabelMatcher) => boolean = (
  matcher: PromQLLabelMatcher,
): boolean => {
  return compilePromQLMatchers([matcher])({});
};

/*
 * The matchers ClickHouse can check: those that name a value a log must
 * have - = with a value, =~ with a pattern that matches none empty.
 * Loki holds a query to one such matcher at least, so every read is
 * narrowed by one (assertSelectsSomething).
 */
export const pushedDownMatchers: (
  matchers: Array<PromQLLabelMatcher>,
) => Array<PromQLLabelMatcher> = (
  matchers: Array<PromQLLabelMatcher>,
): Array<PromQLLabelMatcher> => {
  return matchers.filter((matcher: PromQLLabelMatcher): boolean => {
    return (
      (matcher.type === PromQLMatchType.Equal ||
        matcher.type === PromQLMatchType.RegexMatch) &&
      !matchesEmpty(matcher)
    );
  });
};

const appendMatchers: (
  statement: Statement,
  matchers: Array<PromQLLabelMatcher>,
) => void = (
  statement: Statement,
  matchers: Array<PromQLLabelMatcher>,
): void => {
  for (const matcher of pushedDownMatchers(matchers)) {
    const valueTest: (column: string) => void = (column: string): void => {
      if (matcher.type === PromQLMatchType.Equal) {
        statement.append(` ${column} = `);
        statement.append(
          SQL`${{ type: TableColumnType.Text, value: matcher.value }}`,
        );
        return;
      }

      // Anchored, as a label matcher's pattern is (PromQLRegex).
      statement.append(` match(${column}, `);
      statement.append(
        SQL`${{
          type: TableColumnType.Text,
          value: compilePromQLRegex(matcher.value).anchoredPattern,
        }}`,
      );
      statement.append(")");
    };

    if (matcher.name === LOGQL_DETECTED_LEVEL_LABEL) {
      statement.append(" AND");
      valueTest(DETECTED_LEVEL_SQL);
      continue;
    }

    statement.append(" AND arrayExists((k, v) ->");
    valueTest("v");
    statement.append(` AND ${labelOfKeySql("k")} = `);
    statement.append(
      SQL`${{ type: TableColumnType.Text, value: matcher.name }}`,
    );
    statement.append(", mapKeys(attributes), mapValues(attributes))");
  }
};

/*
 * The line filters ClickHouse checks exactly: `|=` and `!=` as text, `|~`
 * and `!~` as RE2, which ClickHouse's match() is and Loki's line filters
 * are - anywhere in the line.
 */
const appendLineFilters: (
  statement: Statement,
  selector: LogQLLogSelector,
) => void = (statement: Statement, selector: LogQLLogSelector): void => {
  for (const filter of sourceLineFilters(selector)) {
    const negated: boolean =
      filter.operator === LogQLLineFilterOperator.NotContains ||
      filter.operator === LogQLLineFilterOperator.NotMatches;
    const isPattern: boolean =
      filter.operator === LogQLLineFilterOperator.Matches ||
      filter.operator === LogQLLineFilterOperator.NotMatches;

    statement.append(negated ? " AND NOT (" : " AND (");

    filter.values.forEach((value: string, index: number): void => {
      if (index > 0) {
        statement.append(" OR ");
      }

      statement.append(isPattern ? "match(body, " : "position(body, ");
      statement.append(SQL`${{ type: TableColumnType.Text, value }}`);
      statement.append(isPattern ? ")" : ") > 0");
    });

    statement.append(")");
  }
};

// The whole second the `time` column holds for a time in nanoseconds.
const toSecondFloor: (timeNs: bigint) => Date = (timeNs: bigint): Date => {
  return new Date(Number(timeNs / BigInt(1000000000)) * 1000);
};

const toSecondCeiling: (timeNs: bigint) => Date = (timeNs: bigint): Date => {
  return new Date((Number(timeNs / BigInt(1000000000)) + 1) * 1000);
};

/*
 * The project's logs in a range, narrowed by the selector: `time` (whole
 * seconds, the sort key's) widened, then the range itself on
 * timeUnixNano, from after (or with) `startNs` up to and with (or before)
 * `endNs`.
 */
const appendRange: (
  statement: Statement,
  data: {
    projectId: ObjectID;
    serviceFilter: TelemetryServiceFilter;
    selector: LogQLLogSelector;
    startNs: bigint;
    endNs: bigint;
    // Loki's log query reads [start, end); a window reads (start, end].
    startInclusive: boolean;
  },
) => void = (
  statement: Statement,
  data: {
    projectId: ObjectID;
    serviceFilter: TelemetryServiceFilter;
    selector: LogQLLogSelector;
    startNs: bigint;
    endNs: bigint;
    startInclusive: boolean;
  },
): void => {
  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND time >= ${{
      type: TableColumnType.DateTime64,
      value: toSecondFloor(data.startNs),
    }} AND time <= ${{
      type: TableColumnType.DateTime64,
      value: toSecondCeiling(data.endNs),
    }}`,
  );
  statement.append(
    data.startInclusive ? " AND timeUnixNano >= " : " AND timeUnixNano > ",
  );
  statement.append(
    SQL`${{ type: TableColumnType.UInt64, value: data.startNs.toString() }}`,
  );
  statement.append(
    data.startInclusive ? " AND timeUnixNano < " : " AND timeUnixNano <= ",
  );
  statement.append(
    SQL`${{ type: TableColumnType.UInt64, value: data.endNs.toString() }}`,
  );
  // Logs past their retention stay on disk until the midnight after it.
  statement.append(" AND retentionDate >= now()");
  TelemetryReadScopeUtil.appendServiceFilter(statement, data.serviceFilter);
  appendMatchers(statement, data.selector.matchers);
  appendLineFilters(statement, data.selector);
};

// Every read of lines, counts or label sets: in time, and in what it hands back.
const readSettings: () => string = (): string => {
  return getQuerySettings({
    maxExecutionTimeInSeconds: LOGQL_QUERY_TIMEOUT_SECONDS,
    timeoutOverflowMode: "throw",
    boundScanMemory: true,
    additionalSettings: {
      optimize_move_to_prewhere: 1,
      max_result_bytes: LOGQL_MAX_RESULT_BYTES,
      result_overflow_mode: "throw",
    },
  });
};

// Whether a read failed for handing back more than max_result_bytes.
export const isResultLimitError: (error: unknown) => boolean = (
  error: unknown,
): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code: unknown = (error as { code?: unknown }).code;
  const type: unknown = (error as { type?: unknown }).type;

  return (
    (typeof code === "string" && code === RESULT_LIMIT_ERROR_CODE) ||
    (typeof type === "string" && type === RESULT_LIMIT_ERROR_TYPE)
  );
};

const ROW_COLUMNS: string =
  "SELECT toString(timeUnixNano) AS timeNs, body, severityText, severityNumber, attributes";

export interface LogQLRowsStatementData {
  projectId: ObjectID;
  serviceFilter: TelemetryServiceFilter;
  selector: LogQLLogSelector;
  startNs: bigint;
  endNs: bigint;
  startInclusive: boolean;
  direction: LogQLDirection | undefined;
  limit: number;
}

// The SELECT of a selector's logs, in the direction asked for.
export const buildLogQLRowsStatement: (
  data: LogQLRowsStatementData,
) => Statement = (data: LogQLRowsStatementData): Statement => {
  const statement: Statement = SQL``;
  statement.append(`${ROW_COLUMNS} FROM ${AnalyticsTableName.Log}`);
  appendRange(statement, data);

  if (data.direction) {
    const order: string =
      data.direction === LogQLDirection.Forward ? "ASC" : "DESC";
    statement.append(` ORDER BY time ${order}, timeUnixNano ${order}`);
  }

  statement.append(
    SQL` LIMIT ${{ type: TableColumnType.Number, value: data.limit }}`,
  );
  statement.append(readSettings());

  return statement;
};

export interface LogQLBucketsStatementData {
  projectId: ObjectID;
  serviceFilter: TelemetryServiceFilter;
  request: LogQLBucketsRequest;
}

/*
 * A value of a label in SQL: a log's own attribute of that name first,
 * then its resource's, as logQLLabelsOf reads them; its detected level.
 */
const labelValueSql: (label: string) => string = (label: string): string => {
  if (label === LOGQL_DETECTED_LEVEL_LABEL) {
    return DETECTED_LEVEL_SQL;
  }

  const name: string = quote(label);
  const own: string = `arrayElement(mapValues(attributes), indexOf(arrayMap(k -> if(startsWith(k, 'resource.'), '', ${labelOfKeySql("k")}), mapKeys(attributes)), ${name}))`;
  const resource: string = `arrayElement(mapValues(attributes), indexOf(arrayMap(k -> if(startsWith(k, 'resource.'), ${labelOfKeySql("k")}, ''), mapKeys(attributes)), ${name}))`;

  return `if(${own} != '', ${own}, ${resource})`;
};

/*
 * The labels a count by some labels is made by in ClickHouse: those the
 * query reads, and those its matchers name, so each matcher is checked
 * again on the very labels the engine would read.
 */
export const countedLabelsOf: (
  request: LogQLBucketsRequest,
) => Array<string> | undefined = (
  request: LogQLBucketsRequest,
): Array<string> | undefined => {
  if (!request.labels) {
    return undefined;
  }

  const labels: Array<string> = [...request.labels];

  for (const matcher of request.selector.matchers) {
    if (!labels.includes(matcher.name)) {
      labels.push(matcher.name);
    }
  }

  return labels.filter((label: string): boolean => {
    return SAFE_LABEL.test(label);
  });
};

/*
 * The counts of a selector's logs and their bytes, by bucket and label
 * set: by every attribute and level, or by the labels the query reads.
 */
export const buildLogQLBucketsStatement: (
  data: LogQLBucketsStatementData,
) => Statement = (data: LogQLBucketsStatementData): Statement => {
  const request: LogQLBucketsRequest = data.request;
  const countedLabels: Array<string> | undefined = countedLabelsOf(request);
  const statement: Statement = SQL`SELECT intDiv(timeUnixNano - ${{
    type: TableColumnType.UInt64,
    value: request.originNs.toString(),
  }} - 1, ${{
    type: TableColumnType.UInt64,
    value: request.bucketNs.toString(),
  }}) + 1 AS bucket, count() AS lines, sum(length(body)) AS bytes`;
  const groupBy: Array<string> = ["bucket"];

  if (countedLabels) {
    // Each a word of letters, digits and _ (countedLabelsOf).
    countedLabels.forEach((label: string, index: number): void => {
      statement.append(`, ${labelValueSql(label)} AS label_${index}`);
      groupBy.push(`label_${index}`);
    });
  } else {
    statement.append(", attributes, severityText, severityNumber");
    groupBy.push("attributes", "severityText", "severityNumber");
  }

  statement.append(` FROM ${AnalyticsTableName.Log}`);
  appendRange(statement, {
    projectId: data.projectId,
    serviceFilter: data.serviceFilter,
    selector: request.selector,
    startNs: request.originNs,
    endNs: request.endNs,
    startInclusive: false,
  });
  statement.append(` GROUP BY ${groupBy.join(", ")}`);
  statement.append(
    SQL` LIMIT ${{ type: TableColumnType.Number, value: request.limit }}`,
  );
  statement.append(readSettings());

  return statement;
};

const toNumber: (value: unknown) => number | undefined = (
  value: unknown,
): number | undefined => {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const number: number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

const toAttributes: (value: unknown) => Record<string, unknown> = (
  value: unknown,
): Record<string, unknown> => {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

// A row as ClickHouse answers it in JSON, as the engine reads a log.
export const toLogQLLogRow: (row: JSONObject) => LogQLLogRow = (
  row: JSONObject,
): LogQLLogRow => {
  return {
    timeNs: String(row["timeNs"] ?? "0"),
    line:
      typeof row["body"] === "string" ? row["body"] : String(row["body"] ?? ""),
    labels: logQLLabelsOf({
      attributes: toAttributes(row["attributes"]),
      severityNumber: toNumber(row["severityNumber"]),
      severityText:
        typeof row["severityText"] === "string"
          ? row["severityText"]
          : undefined,
    }),
  };
};

const readRowsFromClickhouse: (
  statement: Statement,
) => Promise<Array<JSONObject>> = async (
  statement: Statement,
): Promise<Array<JSONObject>> => {
  const result: Results = await LogService.executeQuery(statement);
  const response: DbJSONResponse = await result.json<{
    data?: Array<JSONObject>;
  }>();

  return (response.data || []) as Array<JSONObject>;
};

export interface LogQLClickhouseSourceOptions {
  projectId: ObjectID;
  // The services the caller may read (TelemetryReadAccess.getServiceFilter).
  serviceFilter: TelemetryServiceFilter;
  // How rows are read; tests hand in their own.
  readRows?: ((statement: Statement) => Promise<Array<JSONObject>>) | undefined;
}

export default class LogQLClickhouseSource implements LogQLLogSource {
  private readonly options: LogQLClickhouseSourceOptions;

  public constructor(options: LogQLClickhouseSourceOptions) {
    this.options = options;
  }

  private async read(statement: Statement): Promise<Array<JSONObject>> {
    try {
      return await (this.options.readRows || readRowsFromClickhouse)(statement);
    } catch (error: unknown) {
      if (isResultLimitError(error)) {
        throw new PromQLError(
          `the logs this query reads are more than ${LOGQL_MAX_RESULT_BYTES / (1024 * 1024)}${NO_BREAK_SPACE}MB. Ask for fewer lines (a lower limit), a shorter time range, or add label matchers or line filters.`,
          PromQLErrorType.Execution,
        );
      }

      throw error;
    }
  }

  public async readLines(request: LogQLLinesRequest): Promise<{
    rows: Array<LogQLLogRow>;
    reachedLimit: boolean;
  }> {
    const rows: Array<JSONObject> = await this.read(
      buildLogQLRowsStatement({
        projectId: this.options.projectId,
        serviceFilter: this.options.serviceFilter,
        selector: request.selector,
        startNs: request.startNs,
        endNs: request.endNs,
        startInclusive: true,
        direction: request.direction,
        limit: request.limit + 1,
      }),
    );

    return {
      rows: rows.slice(0, request.limit).map(toLogQLLogRow),
      reachedLimit: rows.length > request.limit,
    };
  }

  public async readSamples(request: LogQLSamplesRequest): Promise<{
    rows: Array<LogQLLogRow>;
    reachedLimit: boolean;
  }> {
    const rows: Array<JSONObject> = await this.read(
      buildLogQLRowsStatement({
        projectId: this.options.projectId,
        serviceFilter: this.options.serviceFilter,
        selector: request.selector,
        startNs: request.startNs,
        endNs: request.endNs,
        startInclusive: false,
        direction: undefined,
        limit: request.limit + 1,
      }),
    );

    return {
      rows: rows.slice(0, request.limit).map(toLogQLLogRow),
      reachedLimit: rows.length > request.limit,
    };
  }

  public async countBuckets(request: LogQLBucketsRequest): Promise<{
    groups: Array<LogQLBucketCount>;
    reachedLimit: boolean;
  }> {
    const rows: Array<JSONObject> = await this.read(
      buildLogQLBucketsStatement({
        projectId: this.options.projectId,
        serviceFilter: this.options.serviceFilter,
        request,
      }),
    );
    // Every matcher again, on the labels each count was made by.
    const matches: PromQLLabelsTest = compilePromQLMatchers(
      request.selector.matchers,
    );
    const countedLabels: Array<string> | undefined = countedLabelsOf(request);
    const groups: Array<LogQLBucketCount> = [];

    for (const row of rows) {
      let labels: PromQLLabels;

      if (countedLabels && request.labels) {
        const counted: PromQLLabels = {};

        countedLabels.forEach((label: string, index: number): void => {
          const value: unknown = row[`label_${index}`];

          if (typeof value === "string" && value.length > 0) {
            counted[label] = value;
          }
        });

        if (!matches(counted)) {
          continue;
        }

        // Then only the labels the query reads.
        labels = {};

        for (const label of request.labels) {
          if (counted[label] !== undefined) {
            labels[label] = counted[label]!;
          }
        }
      } else {
        labels = logQLLabelsOf({
          attributes: toAttributes(row["attributes"]),
          severityNumber: toNumber(row["severityNumber"]),
          severityText:
            typeof row["severityText"] === "string"
              ? row["severityText"]
              : undefined,
        });

        if (!matches(labels)) {
          continue;
        }
      }

      groups.push({
        labels,
        bucket: toNumber(row["bucket"]) ?? 0,
        count: toNumber(row["lines"]) ?? 0,
        bytes: toNumber(row["bytes"]) ?? 0,
      });
    }

    return { groups, reachedLimit: rows.length >= request.limit };
  }

  /*
   * The label sets of the logs a selector's matchers keep in a range, at
   * most `limit` of them: what /series, and /labels and label values asked
   * with a query, answer.
   */
  public async readLabelSets(data: {
    matchers: Array<PromQLLabelMatcher>;
    startNs: bigint;
    endNs: bigint;
    limit: number;
  }): Promise<Array<PromQLLabels>> {
    const selector: LogQLLogSelector = {
      kind: "LogSelector",
      matchers: data.matchers,
      stages: [],
    };
    const statement: Statement = SQL``;
    statement.append(
      `SELECT DISTINCT attributes, severityText, severityNumber FROM ${AnalyticsTableName.Log}`,
    );
    appendRange(statement, {
      projectId: this.options.projectId,
      serviceFilter: this.options.serviceFilter,
      selector,
      startNs: data.startNs,
      endNs: data.endNs,
      startInclusive: true,
    });
    statement.append(
      SQL` LIMIT ${{ type: TableColumnType.Number, value: data.limit * 4 }}`,
    );
    statement.append(readSettings());

    const matches: PromQLLabelsTest = compilePromQLMatchers(data.matchers);
    const seen: Map<string, PromQLLabels> = new Map();

    for (const row of await this.read(statement)) {
      const labels: PromQLLabels = toLogQLLogRow(row).labels;

      if (!matches(labels)) {
        continue;
      }

      seen.set(promQLLabelsKey(labels), labels);

      if (seen.size >= data.limit) {
        break;
      }
    }

    return Array.from(seen.values());
  }

  /*
   * The levels (detected_level) of the project's logs in a range: what
   * label values of detected_level answer. A bounded read - at most
   * LOGQL_LEVELS_ROWS_READ_BUDGET rows, then it answers with the levels
   * it found - since a level seen once in a billion logs can wait.
   */
  public async readDetectedLevels(data: {
    startNs: bigint;
    endNs: bigint;
  }): Promise<Array<string>> {
    const statement: Statement = SQL``;
    statement.append(
      `SELECT DISTINCT ${DETECTED_LEVEL_SQL} AS level FROM ${AnalyticsTableName.Log}`,
    );
    appendRange(statement, {
      projectId: this.options.projectId,
      serviceFilter: this.options.serviceFilter,
      selector: { kind: "LogSelector", matchers: [], stages: [] },
      startNs: data.startNs,
      endNs: data.endNs,
      startInclusive: true,
    });
    statement.append(" LIMIT 100");
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: LOGQL_QUERY_TIMEOUT_SECONDS,
        timeoutOverflowMode: "throw",
        additionalSettings: {
          max_rows_to_read: LOGQL_LEVELS_ROWS_READ_BUDGET,
          read_overflow_mode: "break",
        },
      }),
    );

    const levels: Array<string> = [];

    for (const row of await this.read(statement)) {
      if (typeof row["level"] === "string" && row["level"].length > 0) {
        levels.push(row["level"]);
      }
    }

    return levels;
  }
}

// The engine over a project's logs, for the services the caller may read.
export const createLogQLEngine: (data: {
  projectId: ObjectID;
  serviceFilter: TelemetryServiceFilter;
}) => { engine: LogQLEngine; source: LogQLClickhouseSource } = (data: {
  projectId: ObjectID;
  serviceFilter: TelemetryServiceFilter;
}): { engine: LogQLEngine; source: LogQLClickhouseSource } => {
  const source: LogQLClickhouseSource = new LogQLClickhouseSource(data);
  return { engine: new LogQLEngine(source), source };
};
