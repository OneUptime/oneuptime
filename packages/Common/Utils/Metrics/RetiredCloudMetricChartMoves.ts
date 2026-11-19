import {
  CosmosLatencyEvidence,
  RetiredCloudMetricOutcome,
  RetiredCloudMetricQuery,
  RetiredCloudMetricRead,
  getRetiredCloudMetric,
  moveRetiredCloudMetricReads,
  toRetiredCloudMetricQuery,
} from "./RetiredCloudMetricMoves";
import {
  readDashboardMetricQueries,
  readSloMetricQuery,
} from "./SavedMetricQueryReads";

/*
 * DASHBOARD CHARTS AND SLOS MOVED OFF THE METRICS THEIR CLOUDS DEPRECATE
 * (#9980), as monitors were (#9739, RetiredCloudMetricMoves).
 *
 * A dashboard's widgets and an SLO hold a query of Cosmos DB's
 * ServerSideLatency or Pub/Sub's send_message_operation_count in shapes of
 * their own. Each is read into a RetiredCloudMetricRead and moved by the
 * monitors' one rule, so it moves exactly as a monitor would:
 *
 *   - a Chart's queries (metricQueryConfig, metricQueryConfigs), the
 *     threshold lines drawn on each and its formulas; a Value's and a
 *     Gauge's query, its warning and critical thresholds and a gauge's
 *     range; a Table's metric columns, their thresholds and unit, its
 *     formula columns, the widget's filter and group-by, and its older
 *     queries. Pub/Sub's thresholds, a gauge's range among them, are 60
 *     times what they were and its formulas read it divided by 60; a chart
 *     draws the messages published a minute, its "/s" unit dropped.
 *   - an SLO's metric (metricQueryConfig): its name, and a histogram's
 *     good value 60 times what it was. Its filters are text: one that names
 *     a response code keeps it where it is. A Cosmos DB account's latency
 *     is chosen by what the account its filter names reported.
 *
 * Pure: the caller writes and tells (MoveOffRetiredCloudMetrics).
 */

// Each read of a deprecated metric of a stored dashboard's widgets (SavedMetricQueryReads).
function getDashboardReads(
  dashboardViewConfigJSON: unknown,
): Array<RetiredCloudMetricRead> {
  return readDashboardMetricQueries(
    dashboardViewConfigJSON,
    getRetiredCloudMetric,
  );
}

// Every query of a stored dashboard that reads a metric its cloud deprecates, in order.
export function findRetiredCloudMetricQueriesOfDashboard(
  dashboardViewConfigJSON: unknown,
): Array<RetiredCloudMetricQuery> {
  return getDashboardReads(dashboardViewConfigJSON).map(
    toRetiredCloudMetricQuery,
  );
}

/*
 * Every query of a stored dashboard that reads a metric its cloud
 * deprecates, moved as a monitor's would be: written on the view config
 * handed in. Says what moved, and what stays and why.
 */
export function moveRetiredCloudMetricQueriesOfDashboard(data: {
  dashboardViewConfigJSON: unknown;
  evidenceOf: (query: RetiredCloudMetricQuery) => CosmosLatencyEvidence | null;
}): RetiredCloudMetricOutcome {
  return moveRetiredCloudMetricReads({
    reads: getDashboardReads(data.dashboardViewConfigJSON),
    evidenceOf: data.evidenceOf,
  });
}

// An SLO's metric, read when it is one its cloud deprecates (SavedMetricQueryReads).
function getSloRead(metricQueryConfig: unknown): RetiredCloudMetricRead | null {
  return readSloMetricQuery(metricQueryConfig, getRetiredCloudMetric);
}

// An SLO's metric, when it reads one its cloud deprecates.
export function findRetiredCloudMetricQueryOfSlo(
  metricQueryConfig: unknown,
): RetiredCloudMetricQuery | null {
  const read: RetiredCloudMetricRead | null = getSloRead(metricQueryConfig);

  return read ? toRetiredCloudMetricQuery(read) : null;
}

/*
 * An SLO's metric, moved as a monitor's query would be, when it reads one
 * its cloud deprecates: written on the config handed in.
 */
export function moveRetiredCloudMetricQueryOfSlo(data: {
  metricQueryConfig: unknown;
  evidenceOf: (query: RetiredCloudMetricQuery) => CosmosLatencyEvidence | null;
}): RetiredCloudMetricOutcome {
  const read: RetiredCloudMetricRead | null = getSloRead(
    data.metricQueryConfig,
  );

  return moveRetiredCloudMetricReads({
    reads: read ? [read] : [],
    evidenceOf: data.evidenceOf,
  });
}
