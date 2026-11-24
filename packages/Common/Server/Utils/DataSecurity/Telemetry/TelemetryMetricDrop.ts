import { ResponseJSON } from "@clickhouse/client";
import AnalyticsTableName from "../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DataSecurityDropMetricImpact,
  DataSecurityDropMetricUnavailableReason,
} from "../../../../Types/DataSecurity/DataSecurityApiTypes";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import MetricPipelineRuleFilterCondition from "../../../../Types/Metrics/MetricPipelineRuleFilterCondition";
import ObjectID from "../../../../Types/ObjectID";
import LinearRegExp from "../../../../Utils/LinearRegExp/LinearRegExp";
import { getLinearRegExp } from "../../../../Utils/LinearRegExp/PatternCache";
import { Results } from "../../../Services/AnalyticsDatabaseService";
import MetricService from "../../../Services/MetricService";
import { getQuerySettings } from "../../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../../AnalyticsDatabase/Statement";
import logger from "../../Logger";
import { TelemetryFieldReaderKind } from "../../../../Types/Telemetry/TelemetryFieldReaders";
import { findMetricUsers, MetricUsers } from "./MetricNameUsers";
import {
  appendOwnersIn,
  appendWhere,
  getTelemetrySource,
  readText,
  SourceDefinition,
  tableOf,
} from "./TelemetryDataScanner";
import { TelemetrySampleSource } from "./TelemetrySampleSource";
import {
  buildMetricDropFilters,
  buildMetricDropRule,
  findCoveringScrubRule,
  getMetricDropUnavailableReason,
  getScrubCoverage,
  CoveringScrubRule,
} from "./TelemetryScrubCoverage";

/*
 * WHAT DROPPING A SERVICE'S METRICS NAMED WITH A FINDING'S DATA WOULD DO
 * (issue #9757).
 *
 * Drop This Metric makes a metric pipeline Drop rule (TelemetryScrubCoverage.
 * buildMetricDropRule): every new data point of the service's metrics whose
 * name has the finding's data type's shape is dropped before it is stored,
 * and lost for good. Before a person asks for it, the page says what it
 * would drop and what that leaves without data:
 *
 *  - how many of the service's metrics written in the last day have such a
 *    name - read from the per-minute rollup, a row per metric per minute,
 *    and matched here by the rule's own pattern on the linear-time matcher
 *    ingest runs it on, so the count is what the rule would drop. The names
 *    themselves never leave the server: they hold the data;
 *  - which monitors, dashboards (and their widgets), SLOs and recording
 *    rules read such a metric (MetricNameUsers), named only where the
 *    reader may read them and counted where they may not;
 *  - the rule that already drops them, if one does.
 */

// How far back the service's metrics are counted.
export const METRIC_DROP_LOOKBACK_IN_HOURS: number = 24;

// The most of the service's metric names counted: more are said to be more.
export const MAX_METRIC_NAMES_COUNTED: number = 10_000;

// How long the count may run.
const READ_TIME_LIMIT_IN_SECONDS: number = 20;

/*
 * The names of the metrics one service wrote in the window, from the
 * per-minute rollup: at most `limit`, never a point.
 */
export function buildServiceMetricNamesStatement(data: {
  projectId: ObjectID;
  serviceId: string;
  since: Date;
  until: Date;
  limit: number;
}): Statement {
  const statement: Statement = SQL`SELECT DISTINCT name AS metricName FROM `;

  statement.append(tableOf(AnalyticsTableName.MetricItemAggMV1m));
  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND primaryEntityId = ${{
      type: TableColumnType.Text,
      value: data.serviceId,
    }} AND bucketTime >= ${{
      type: TableColumnType.DateTime64,
      value: data.since,
    }} AND bucketTime <= ${{
      type: TableColumnType.DateTime64,
      value: data.until,
    }} AND retentionDate >= now() LIMIT ${{
      type: TableColumnType.Number,
      value: Math.max(1, Math.trunc(data.limit)),
    }}`,
  );
  statement.append(
    getQuerySettings({
      maxExecutionTimeInSeconds: READ_TIME_LIMIT_IN_SECONDS,
      timeoutOverflowMode: "throw",
      boundScanMemory: true,
    }),
  );

  return statement;
}

/*
 * Whether a metric's name is one a Drop rule's filter drops: its pattern on
 * the matcher ingest runs it on (MetricPipelineRuleService). A pattern that
 * cannot answer drops nothing there, so nothing here.
 */
export function buildDroppedNameMatcher(
  filters: ReadonlyArray<MetricPipelineRuleFilterCondition>,
): (metricName: string) => boolean {
  const patterns: Array<LinearRegExp> = [];

  for (const filter of filters) {
    try {
      patterns.push(getLinearRegExp(filter.value || ""));
    } catch {
      return (): boolean => {
        return false;
      };
    }
  }

  return (metricName: string): boolean => {
    try {
      return patterns.every((pattern: LinearRegExp): boolean => {
        return pattern.test(metricName);
      });
    } catch {
      return false;
    }
  };
}

interface DroppedMetricsCount {
  matched: number;
  isCapped: boolean;
  // False when the names could not be read: matched is then no count.
  isCounted: boolean;
}

async function countDroppedMetrics(data: {
  projectId: ObjectID;
  serviceId: string;
  now: Date;
  isNameDropped: (metricName: string) => boolean;
}): Promise<DroppedMetricsCount> {
  try {
    const result: Results = await MetricService.executeQuery(
      buildServiceMetricNamesStatement({
        projectId: data.projectId,
        serviceId: data.serviceId,
        since: new Date(
          data.now.getTime() - METRIC_DROP_LOOKBACK_IN_HOURS * 60 * 60 * 1000,
        ),
        until: data.now,
        limit: MAX_METRIC_NAMES_COUNTED + 1,
      }),
    );
    const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();
    const rows: Array<JSONObject> = (response.data || []) as Array<JSONObject>;
    let matched: number = 0;

    for (const row of rows.slice(0, MAX_METRIC_NAMES_COUNTED)) {
      if (data.isNameDropped(readText(row["metricName"]))) {
        matched++;
      }
    }

    return {
      matched,
      isCapped: rows.length > MAX_METRIC_NAMES_COUNTED,
      isCounted: true,
    };
  } catch (error) {
    logger.warn(
      `DataSecurity: could not count the metrics of service ${data.serviceId} a drop would drop:`,
    );
    logger.warn(error);

    // Said as not known: "no metric has such a name" would be a guess.
    return { matched: 0, isCapped: false, isCounted: false };
  }
}

/*
 * What Drop This Metric would do for a finding, for the page to say before
 * it is asked for: why it cannot, the rule that already does it, or how
 * many metrics it drops and what reads them that it empties.
 */
export async function getDropMetricImpact(data: {
  projectId: ObjectID;
  kind: DataStoreKind;
  dataTypeId: string;
  location: string;
  serviceId?: ObjectID | string | null | undefined;
  // The reader's: only what they may read is named; the rest is counted.
  props: DatabaseCommonInteractionProps;
  now?: Date | undefined;
}): Promise<DataSecurityDropMetricImpact> {
  const impact: DataSecurityDropMetricImpact = {
    isAvailable: false,
    metricsMatched: 0,
    isMetricsMatchedCapped: false,
    metricsCounted: false,
    monitors: [],
    dashboards: [],
    slos: [],
    recordingRules: [],
    monitorsChecked: false,
    dashboardsChecked: false,
    slosChecked: false,
    recordingRulesChecked: false,
    monitorsHidden: 0,
    dashboardsHidden: 0,
    slosHidden: 0,
    recordingRulesHidden: 0,
  };
  const reason: DataSecurityDropMetricUnavailableReason | null =
    getMetricDropUnavailableReason(data);

  if (reason) {
    impact.unavailableReason = reason;
    return impact;
  }

  const serviceId: string = data.serviceId!.toString();
  const existing: CoveringScrubRule | null = findCoveringScrubRule(
    await getScrubCoverage(data.projectId),
    {
      kind: data.kind,
      dataTypeId: data.dataTypeId,
      location: data.location,
      serviceId,
    },
  );

  impact.isAvailable = true;
  impact.ruleName = buildMetricDropRule({ ...data, serviceId }).name || "";

  if (existing) {
    impact.existingRule = { id: existing.id, name: existing.name };
  }

  const isNameDropped: (metricName: string) => boolean =
    buildDroppedNameMatcher(buildMetricDropFilters(data.dataTypeId) || []);
  const [counted, users]: [DroppedMetricsCount, MetricUsers] =
    await Promise.all([
      countDroppedMetrics({
        projectId: data.projectId,
        serviceId,
        now: data.now || OneUptimeDate.getCurrentDate(),
        isNameDropped,
      }),
      findMetricUsers({
        projectId: data.projectId,
        serviceId,
        isNameDropped,
        props: data.props,
      }),
    ]);

  impact.metricsMatched = counted.matched;
  impact.isMetricsMatchedCapped = counted.isCapped;
  impact.metricsCounted = counted.isCounted;

  return { ...impact, ...users };
}

/*
 * WHAT READS WHAT A METRIC ATTRIBUTE'S RULE WOULD HIDE (#10753).
 *
 * A Redact Attribute rule for a finding in a metric's attribute changes the
 * values of that attribute in every metric of the service that carries it,
 * so what reads those metrics - monitors, dashboards, SLOs and recording
 * rules, as Drop This Metric lists them (findMetricUsers) - would read what
 * the rule leaves instead. The metrics are the service's that carried the
 * attribute in the last day, read from its data points by the attribute's
 * key; when more carried it than are read, every metric of the service is
 * taken as one, so nothing that reads one is missed. What reads them is
 * counted by kind, as OneUptime AI's plan keeps readers: none named.
 */

// The names of the metrics of one service that carried an attribute in the window.
export function buildMetricNamesWithAttributeStatement(data: {
  projectId: ObjectID;
  serviceId: string;
  attributeKey: string;
  since: Date;
  until: Date;
  limit: number;
}): Statement {
  const source: SourceDefinition = getTelemetrySource(
    TelemetrySampleSource.Metrics,
  );
  const statement: Statement = SQL`SELECT DISTINCT name AS metricName FROM `;

  statement.append(tableOf(source.table));
  appendWhere(statement, source, {
    projectId: data.projectId,
    since: data.since,
    until: data.until,
  });
  appendOwnersIn(statement, source, [data.serviceId]);
  statement.append(
    SQL` AND has(attributeKeys, ${{
      type: TableColumnType.Text,
      value: data.attributeKey,
    }}) LIMIT ${{
      type: TableColumnType.Number,
      value: Math.max(1, Math.trunc(data.limit)),
    }}`,
  );
  statement.append(
    getQuerySettings({
      maxExecutionTimeInSeconds: READ_TIME_LIMIT_IN_SECONDS,
      timeoutOverflowMode: "throw",
      boundScanMemory: true,
    }),
  );

  return statement;
}

/*
 * How many of each kind read the metrics a metric attribute's rule would
 * change, as OneUptime AI's plan counts readers (ScrubReaderCounts) - or
 * none when that could not be read just now: the rule then waits.
 */
export async function findMetricScrubRuleReaders(data: {
  projectId: ObjectID;
  serviceId: string;
  attributeKey: string;
  props: DatabaseCommonInteractionProps;
  now?: Date | undefined;
  // Stands in for the read of the metric names, in a test.
  readMetricNames?:
    | ((statement: Statement) => Promise<Array<string>>)
    | undefined;
}): Promise<Partial<Record<TelemetryFieldReaderKind, number>> | undefined> {
  const now: Date = data.now || OneUptimeDate.getCurrentDate();
  const statement: Statement = buildMetricNamesWithAttributeStatement({
    projectId: data.projectId,
    serviceId: data.serviceId,
    attributeKey: data.attributeKey,
    since: new Date(
      now.getTime() - METRIC_DROP_LOOKBACK_IN_HOURS * 60 * 60 * 1000,
    ),
    until: now,
    limit: MAX_METRIC_NAMES_COUNTED + 1,
  });
  let names: Array<string>;

  try {
    names = data.readMetricNames
      ? await data.readMetricNames(statement)
      : await readMetricNames(statement);
  } catch (error) {
    logger.warn(
      `DataSecurity: could not read which metrics of service ${data.serviceId} carry ${data.attributeKey}:`,
    );
    logger.warn(error);

    return undefined;
  }

  // More than are read: every metric of the service is taken as one.
  const isEveryMetric: boolean = names.length > MAX_METRIC_NAMES_COUNTED;
  const carrying: Set<string> = new Set<string>(names);
  let users: MetricUsers;

  try {
    users = await findMetricUsers({
      projectId: data.projectId,
      serviceId: data.serviceId,
      isNameDropped: (metricName: string): boolean => {
        return isEveryMetric || carrying.has(metricName);
      },
      props: data.props,
    });
  } catch (error) {
    logger.warn(
      `DataSecurity: could not read what reads the metrics of service ${data.serviceId}:`,
    );
    logger.warn(error);

    return undefined;
  }

  if (
    !users.monitorsChecked ||
    !users.dashboardsChecked ||
    !users.slosChecked ||
    !users.recordingRulesChecked
  ) {
    return undefined;
  }

  return {
    [TelemetryFieldReaderKind.Monitor]:
      users.monitors.length + users.monitorsHidden,
    [TelemetryFieldReaderKind.Dashboard]:
      users.dashboards.length + users.dashboardsHidden,
    [TelemetryFieldReaderKind.SavedView]: 0,
    [TelemetryFieldReaderKind.RecordingRule]:
      users.recordingRules.length + users.recordingRulesHidden,
    [TelemetryFieldReaderKind.ServiceLevelObjective]:
      users.slos.length + users.slosHidden,
  };
}

// The names a statement of metric names answers.
async function readMetricNames(statement: Statement): Promise<Array<string>> {
  const result: Results = await MetricService.executeQuery(statement);
  const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();

  return ((response.data || []) as Array<JSONObject>)
    .map((row: JSONObject): string => {
      return readText(row["metricName"]);
    })
    .filter((name: string): boolean => {
      return name.length > 0;
    });
}
