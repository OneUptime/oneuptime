import MetricService from "../../Services/MetricService";
import MetricTypeService from "../../Services/MetricTypeService";
import { MutableMetricService } from "../../Services/MutableMetricService";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import TelemetryReadScopeUtil, {
  TelemetryServiceFilter,
} from "../Telemetry/TelemetryReadScope";
import {
  DbJSONResponse,
  Results,
} from "../../Services/AnalyticsDatabaseService";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../../Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  PROMQL_METRIC_NAME_LABEL,
  PromQLLabelMatcher,
  PromQLMatchType,
} from "../../../Utils/PromQL/PromQLAst";
import {
  PromQLSeries,
  PromQLSeriesSelection,
  PromQLSeriesSource,
} from "../../../Utils/PromQL/PromQLEngineTypes";
import PromQLError, {
  PromQLErrorType,
} from "../../../Utils/PromQL/PromQLError";
import {
  PromQLLabelsTest,
  compilePromQLMatchers,
} from "../../../Utils/PromQL/PromQLLabels";
import {
  PROMQL_LABEL_NAME_SQL_PATTERN,
  PromQLMetricRequest,
  PromQLSeriesKind,
  resolvePromQLMetricName,
  toPromQLMetricName,
} from "../../../Utils/PromQL/PromQLMetricNames";
import {
  PromQLMetricRow,
  parsePromQLMetricRow,
  promQLSeriesFromRows,
} from "./PromQLMetricRows";

/*
 * Reads a project's metrics from ClickHouse for the PromQL engine
 * (issue #6796).
 *
 * Every read is the project's own: it filters on projectId first (the
 * table's leading sort key) and on the services the caller may read
 * (TelemetryReadAccess), so a PromQL query reaches exactly the rows the
 * Metrics explorer would show the same caller. A query never runs as SQL:
 * the engine hands this source selectors, and this source writes the SQL,
 * with every value bound as a parameter.
 */

// The most rows one selector may read before the query is refused.
export const PROMQL_DEFAULT_MAX_ROWS: number = 1000000;

// How long one read may run in ClickHouse.
export const PROMQL_QUERY_TIMEOUT_SECONDS: number = 30;

// Labels the series kind or the resource sets, never an attribute's.
const NOT_PUSHED_DOWN_LABELS: ReadonlySet<string> = new Set<string>([
  PROMQL_METRIC_NAME_LABEL,
  "le",
  "quantile",
  "job",
  "instance",
]);

const STORED_NAMES_CACHE_MS: number = 60 * 1000;

const storedNamesCache: Map<
  string,
  { names: Array<string>; expiresAt: number }
> = new Map();

/*
 * The metric names a project stores, from the metric catalog, kept for a
 * minute. Read as root: the names only decide which rows to read, and the
 * rows themselves are read through the caller's service scope.
 */
export const listStoredMetricNames: (
  projectId: ObjectID,
) => Promise<Array<string>> = async (
  projectId: ObjectID,
): Promise<Array<string>> => {
  const key: string = projectId.toString();
  const cached: { names: Array<string>; expiresAt: number } | undefined =
    storedNamesCache.get(key);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.names;
  }

  const metricTypes: Array<MetricType> = await MetricTypeService.findBy({
    query: { projectId },
    select: { name: true },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props: { isRoot: true },
  });

  const names: Array<string> = metricTypes
    .map((metricType: MetricType): string => {
      return (metricType.name || "").toLowerCase();
    })
    .filter((name: string): boolean => {
      return name.length > 0;
    });

  if (storedNamesCache.size > 1000) {
    storedNamesCache.clear();
  }

  storedNamesCache.set(key, {
    names,
    expiresAt: Date.now() + STORED_NAMES_CACHE_MS,
  });

  return names;
};

/*
 * The stored metrics, and which of their series, a selector asks for. A
 * selector with a `__name__="x"` matcher means the metrics that name can
 * mean (resolvePromQLMetricName); any other selector means every stored
 * metric whose PromQL names its name matchers accept.
 */
export const resolvePromQLSelection: (
  matchers: Array<PromQLLabelMatcher>,
  storedNames: ReadonlyArray<string>,
) => Array<PromQLMetricRequest> = (
  matchers: Array<PromQLLabelMatcher>,
  storedNames: ReadonlyArray<string>,
): Array<PromQLMetricRequest> => {
  const nameMatchers: Array<PromQLLabelMatcher> = matchers.filter(
    (matcher: PromQLLabelMatcher): boolean => {
      return matcher.name === PROMQL_METRIC_NAME_LABEL;
    },
  );
  const equality: PromQLLabelMatcher | undefined = nameMatchers.find(
    (matcher: PromQLLabelMatcher): boolean => {
      return matcher.type === PromQLMatchType.Equal;
    },
  );

  if (equality) {
    return resolvePromQLMetricName(equality.value, storedNames);
  }

  const requests: Array<PromQLMetricRequest> = [];
  // The name matchers' patterns, compiled once for every stored name below.
  const acceptsName: PromQLLabelsTest = compilePromQLMatchers(nameMatchers);
  const kinds: Array<{ suffix: string; kind: PromQLSeriesKind }> = [
    { suffix: "", kind: PromQLSeriesKind.Value },
    { suffix: "_bucket", kind: PromQLSeriesKind.Bucket },
    { suffix: "_count", kind: PromQLSeriesKind.Count },
    { suffix: "_sum", kind: PromQLSeriesKind.Sum },
  ];

  for (const storedName of storedNames) {
    const base: string = toPromQLMetricName(storedName);

    for (const { suffix, kind } of kinds) {
      const seriesName: string = `${base}${suffix}`;

      if (acceptsName({ [PROMQL_METRIC_NAME_LABEL]: seriesName })) {
        requests.push({ storedName, kind, seriesName });
      }
    }
  }

  return requests;
};

/*
 * The equality matchers ClickHouse can check before rows leave it: an
 * attribute whose PromQL label name and value match. The engine checks every
 * matcher again on the series, so this only has to keep every row that can
 * match.
 */
const pushedDownMatchers: (
  matchers: Array<PromQLLabelMatcher>,
) => Array<PromQLLabelMatcher> = (
  matchers: Array<PromQLLabelMatcher>,
): Array<PromQLLabelMatcher> => {
  return matchers.filter((matcher: PromQLLabelMatcher): boolean => {
    return (
      matcher.type === PromQLMatchType.Equal &&
      matcher.value.length > 0 &&
      !NOT_PUSHED_DOWN_LABELS.has(matcher.name)
    );
  });
};

const appendAttributeMatchers: (
  statement: Statement,
  matchers: Array<PromQLLabelMatcher>,
  column: "attributes" | "latestAttributes",
) => void = (
  statement: Statement,
  matchers: Array<PromQLLabelMatcher>,
  column: "attributes" | "latestAttributes",
): void => {
  for (const matcher of pushedDownMatchers(matchers)) {
    statement.append(
      SQL` AND arrayExists((k, v) -> v = ${{
        type: TableColumnType.Text,
        value: matcher.value,
      }} AND (k = ${{
        type: TableColumnType.Text,
        value: matcher.name,
      }} OR replaceRegexpAll(k, '`,
    );
    statement.append(PROMQL_LABEL_NAME_SQL_PATTERN);
    statement.append(
      SQL`', '_') = ${{
        type: TableColumnType.Text,
        value: matcher.name,
      }}), `,
    );
    // The column is one of the two this file names, never a caller's.
    statement.append(`mapKeys(${column}), mapValues(${column}))`);
  }
};

// The whole second the `time` column holds for a time in milliseconds.
const toWholeSecond: (timeMs: number) => Date = (timeMs: number): Date => {
  return new Date(Math.floor(timeMs / 1000) * 1000);
};

export interface PromQLMetricRowsStatementData {
  projectId: ObjectID;
  storedNames: Array<string>;
  // Rows after this time are read...
  startTimeMs: number;
  // ...up to and with this one.
  endTimeMs: number;
  serviceFilter: TelemetryServiceFilter;
  matchers: Array<PromQLLabelMatcher>;
  limit: number;
}

/*
 * The SELECT for a selector's rows in the metric table. `time` holds whole
 * seconds, so the window is widened to them here and narrowed to the
 * millisecond, from timeUnixNano, when the rows become series.
 */
export const buildPromQLMetricRowsStatement: (
  data: PromQLMetricRowsStatementData,
) => Statement = (data: PromQLMetricRowsStatementData): Statement => {
  const statement: Statement = SQL`SELECT name, metricPointType, aggregationTemporality, attributes, if(timeUnixNano > 0, toInt64(intDiv(timeUnixNano, 1000000)), toUnixTimestamp64Milli(time)) AS timestampMs, value, count, sum, bucketCounts, explicitBounds, summaryQuantiles, summaryValues FROM ${AnalyticsTableName.Metric} WHERE projectId = ${{
    type: TableColumnType.ObjectID,
    value: data.projectId,
  }} AND name IN (${{
    type: TableColumnType.Text,
    value: new Includes(data.storedNames),
  }}) AND time >= ${{
    type: TableColumnType.DateTime64,
    value: toWholeSecond(data.startTimeMs),
  }} AND time <= ${{
    type: TableColumnType.DateTime64,
    value: toWholeSecond(data.endTimeMs),
  }}`;

  // Rows past their retention stay on disk until the midnight after it.
  statement.append(" AND retentionDate >= now()");
  TelemetryReadScopeUtil.appendServiceFilter(statement, data.serviceFilter);
  appendAttributeMatchers(statement, data.matchers, "attributes");
  statement.append(
    SQL` LIMIT ${{ type: TableColumnType.Number, value: data.limit }}`,
  );
  statement.append(promQLReadSettings());

  return statement;
};

/*
 * The same read from the table that keeps incident, alert and maintenance
 * metrics, where a point can be rewritten: each point's latest version, and
 * not a deleted one.
 */
export const buildPromQLMutableMetricRowsStatement: (
  data: PromQLMetricRowsStatementData,
) => Statement = (data: PromQLMetricRowsStatementData): Statement => {
  /*
   * The inner query names each latest value apart from its column: an alias
   * named like the column would be what the inner WHERE reads, and an
   * aggregate cannot be filtered on there. The window is checked on the raw
   * rows first (any version in it) and on the latest version after.
   */
  const statement: Statement = SQL`SELECT name, latestPointType AS metricPointType, '' AS aggregationTemporality, latestAttributes AS attributes, if(latestTimeUnixNano > 0, toInt64(intDiv(latestTimeUnixNano, 1000000)), toUnixTimestamp64Milli(latestTime)) AS timestampMs, latestValue AS value FROM (SELECT name, primaryEntityId, metricPointId, argMax(metricPointType, version) AS latestPointType, argMax(attributes, version) AS latestAttributes, argMax(time, version) AS latestTime, argMax(timeUnixNano, version) AS latestTimeUnixNano, argMax(value, version) AS latestValue, argMax(isDeleted, version) AS latestDeleted, argMax(retentionDate, version) AS latestRetentionDate FROM ${AnalyticsTableName.MutableMetric} WHERE projectId = ${{
    type: TableColumnType.ObjectID,
    value: data.projectId,
  }} AND name IN (${{
    type: TableColumnType.Text,
    value: new Includes(data.storedNames),
  }}) AND time >= ${{
    type: TableColumnType.DateTime64,
    value: toWholeSecond(data.startTimeMs),
  }} AND time <= ${{
    type: TableColumnType.DateTime64,
    value: toWholeSecond(data.endTimeMs),
  }}`;

  TelemetryReadScopeUtil.appendServiceFilter(statement, data.serviceFilter);
  statement.append(
    SQL` GROUP BY name, primaryEntityId, metricPointId) WHERE latestDeleted = false AND latestRetentionDate >= now() AND latestTime >= ${{
      type: TableColumnType.DateTime64,
      value: toWholeSecond(data.startTimeMs),
    }} AND latestTime <= ${{
      type: TableColumnType.DateTime64,
      value: toWholeSecond(data.endTimeMs),
    }}`,
  );
  appendAttributeMatchers(statement, data.matchers, "latestAttributes");
  statement.append(
    SQL` LIMIT ${{ type: TableColumnType.Number, value: data.limit }}`,
  );
  statement.append(promQLReadSettings());

  return statement;
};

const promQLReadSettings: () => string = (): string => {
  return getQuerySettings({
    maxExecutionTimeInSeconds: PROMQL_QUERY_TIMEOUT_SECONDS,
    timeoutOverflowMode: "throw",
    boundScanMemory: true,
    additionalSettings: { optimize_move_to_prewhere: 1 },
  });
};

const readRowsFromClickhouse: (
  statement: Statement,
) => Promise<Array<JSONObject>> = async (
  statement: Statement,
): Promise<Array<JSONObject>> => {
  const result: Results = await MetricService.executeQuery(statement);
  const response: DbJSONResponse = await result.json<{
    data?: Array<JSONObject>;
  }>();

  return response.data || [];
};

export interface PromQLMetricSeriesSourceOptions {
  projectId: ObjectID;
  // The services the caller may read (TelemetryReadAccess.getServiceFilter).
  serviceFilter: TelemetryServiceFilter;
  maxRows?: number | undefined;
  // How rows are read; tests hand in their own.
  readRows?: ((statement: Statement) => Promise<Array<JSONObject>>) | undefined;
  // The names the project stores; tests hand in their own.
  listStoredNames?: (() => Promise<Array<string>>) | undefined;
}

export default class PromQLMetricSeriesSource implements PromQLSeriesSource {
  private readonly options: PromQLMetricSeriesSourceOptions;

  public constructor(options: PromQLMetricSeriesSourceOptions) {
    this.options = options;
  }

  private get maxRows(): number {
    return this.options.maxRows ?? PROMQL_DEFAULT_MAX_ROWS;
  }

  public async select(
    selection: PromQLSeriesSelection,
  ): Promise<Array<PromQLSeries>> {
    const storedNames: Array<string> = await (
      this.options.listStoredNames ||
      ((): Promise<Array<string>> => {
        return listStoredMetricNames(this.options.projectId);
      })
    )();
    const requests: Array<PromQLMetricRequest> = resolvePromQLSelection(
      selection.matchers,
      storedNames,
    );

    if (requests.length === 0) {
      return [];
    }

    const names: Array<string> = Array.from(
      new Set<string>(
        requests.map((request: PromQLMetricRequest): string => {
          return request.storedName;
        }),
      ),
    );
    const mutableNames: Array<string> = names.filter(
      (name: string): boolean => {
        return MutableMetricService.isMutableMetricName(name);
      },
    );
    const regularNames: Array<string> = names.filter(
      (name: string): boolean => {
        return !MutableMetricService.isMutableMetricName(name);
      },
    );

    const readRows: (statement: Statement) => Promise<Array<JSONObject>> =
      this.options.readRows || readRowsFromClickhouse;
    const base: Omit<PromQLMetricRowsStatementData, "storedNames"> = {
      projectId: this.options.projectId,
      startTimeMs: selection.startTimeMs,
      endTimeMs: selection.endTimeMs,
      serviceFilter: this.options.serviceFilter,
      matchers: selection.matchers,
      // One more than allowed, to tell "exactly at the limit" from "over".
      limit: this.maxRows + 1,
    };

    const reads: Array<Promise<Array<JSONObject>>> = [];

    if (regularNames.length > 0) {
      reads.push(
        readRows(
          buildPromQLMetricRowsStatement({
            ...base,
            storedNames: regularNames,
          }),
        ),
      );
    }

    if (mutableNames.length > 0) {
      reads.push(
        readRows(
          buildPromQLMutableMetricRowsStatement({
            ...base,
            storedNames: mutableNames,
          }),
        ),
      );
    }

    const rows: Array<PromQLMetricRow> = [];

    for (const batch of await Promise.all(reads)) {
      for (const row of batch) {
        rows.push(parsePromQLMetricRow(row as Record<string, unknown>));
      }
    }

    if (rows.length > this.maxRows) {
      throw new PromQLError(
        `The query reads more than ${this.maxRows.toLocaleString("en-US")} metric points. Add label matchers, shorten the time range, or use a larger step.`,
        PromQLErrorType.Execution,
      );
    }

    return promQLSeriesFromRows({
      rows,
      requests,
      matchers: selection.matchers,
      startTimeMs: selection.startTimeMs,
      endTimeMs: selection.endTimeMs,
    });
  }
}
