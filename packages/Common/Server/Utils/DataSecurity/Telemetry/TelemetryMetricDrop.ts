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
import { findMetricUsers, MetricUsers } from "./MetricNameUsers";
import { readText, tableOf } from "./TelemetryDataScanner";
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
 *  - which monitors and dashboards read such a metric (MetricNameUsers),
 *    read with the reader's own permissions;
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
 * many metrics it drops and which monitors and dashboards that empties.
 */
export async function getDropMetricImpact(data: {
  projectId: ObjectID;
  kind: DataStoreKind;
  dataTypeId: string;
  location: string;
  serviceId?: ObjectID | string | null | undefined;
  // The reader's: only the monitors and dashboards they may read are named.
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
    monitorsChecked: false,
    dashboardsChecked: false,
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
  impact.monitors = users.monitors;
  impact.dashboards = users.dashboards;
  impact.monitorsChecked = users.monitorsChecked;
  impact.dashboardsChecked = users.dashboardsChecked;

  return impact;
}
